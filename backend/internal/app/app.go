package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/xinquiry/video-insight/backend/internal/annotations"
	"github.com/xinquiry/video-insight/backend/internal/auth"
	"github.com/xinquiry/video-insight/backend/internal/groups"
	"github.com/xinquiry/video-insight/backend/internal/httpapi"
	"github.com/xinquiry/video-insight/backend/internal/platform/config"
	"github.com/xinquiry/video-insight/backend/internal/platform/media"
	"github.com/xinquiry/video-insight/backend/internal/platform/postgres"
	"github.com/xinquiry/video-insight/backend/internal/platform/storage"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

type App struct {
	Handler         http.Handler
	store           *postgres.Store
	processorCancel context.CancelFunc
	processorDone   <-chan struct{}
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	store, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
	}
	recovered, err := store.RequeueInterruptedVideoProcessing(ctx)
	if err != nil {
		store.Close()
		return nil, fmt.Errorf("recover interrupted video processing jobs: %w", err)
	}
	if recovered > 0 {
		logger.Info("requeued interrupted video processing jobs", "count", recovered)
	}
	objectStorage, err := storage.NewS3(ctx, storage.Config{
		Endpoint: cfg.S3Endpoint, PublicEndpoint: cfg.S3PublicEndpoint,
		AccessKey: cfg.S3AccessKey, SecretKey: cfg.S3SecretKey,
		Region: cfg.S3Region, Bucket: cfg.S3Bucket,
	})
	if err != nil {
		store.Close()
		return nil, err
	}
	tokens := auth.NewTokenManager(cfg.SecretKey, cfg.AccessTokenTTL)
	authService := auth.NewService(store, tokens)
	if cfg.SeedAdminOnStartup {
		if err := authService.EnsureAdmin(ctx, cfg.AdminUsername, cfg.AdminPassword, cfg.DefaultGroupName); err != nil {
			store.Close()
			return nil, fmt.Errorf("seed admin user: %w", err)
		}
	}
	groupService := groups.NewService(store)
	videoService := videos.NewService(store, objectStorage, videos.Config{
		PartSize: cfg.UploadPartSize, MaxParts: cfg.UploadMaxParts,
		URLTTL: cfg.UploadURLTTL, Concurrency: cfg.UploadConcurrency,
		ProcessingEnabled: cfg.VideoProcessingEnabled,
	})
	annotationService := annotations.NewService(store)
	handler := httpapi.New(authService, groupService, videoService, annotationService, tokens, store, logger, cfg.CORSOrigins)
	application := &App{Handler: handler, store: store}
	if cfg.VideoProcessingEnabled {
		optimizer, err := media.NewFFmpegOptimizer(
			objectStorage,
			cfg.VideoProcessingFFmpegPath,
			cfg.VideoProcessingTempDir,
		)
		if err != nil {
			store.Close()
			return nil, fmt.Errorf("initialize video processor: %w", err)
		}
		processor := videos.NewProcessor(store, optimizer, logger, videos.ProcessorConfig{
			PollInterval: cfg.VideoProcessingPollInterval,
			MaxAttempts:  cfg.VideoProcessingMaxAttempts,
		})
		processorCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		application.processorCancel = cancel
		application.processorDone = done
		go func() {
			defer close(done)
			processor.Run(processorCtx)
		}()
	}
	return application, nil
}

func (a *App) Close() {
	if a.processorCancel != nil {
		a.processorCancel()
		<-a.processorDone
	}
	a.store.Close()
}

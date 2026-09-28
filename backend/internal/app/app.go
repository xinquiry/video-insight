package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/annotations"
	"github.com/xinquiry/video-insight/backend/internal/auth"
	"github.com/xinquiry/video-insight/backend/internal/driveexports"
	"github.com/xinquiry/video-insight/backend/internal/groups"
	"github.com/xinquiry/video-insight/backend/internal/httpapi"
	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/platform/config"
	"github.com/xinquiry/video-insight/backend/internal/platform/media"
	"github.com/xinquiry/video-insight/backend/internal/platform/postgres"
	"github.com/xinquiry/video-insight/backend/internal/platform/storage"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

type App struct {
	Handler           http.Handler
	store             *postgres.Store
	processorCancel   context.CancelFunc
	processorDone     <-chan struct{}
	videoGCCancel     context.CancelFunc
	videoGCDone       <-chan struct{}
	driveExportCancel context.CancelFunc
	driveExportDone   <-chan struct{}
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
	driveExportSigner, err := driveexports.NewGatewayUploader(driveexports.GatewayConfig{
		BaseURL: cfg.DriveExportGatewayURL, AccessKey: cfg.DriveExportAccessKey,
		Secret: cfg.DriveExportSecret, Timeout: cfg.DriveExportTimeout,
	})
	if err != nil {
		return nil, fmt.Errorf("initialize drive export gateway client: %w", err)
	}
	driveExportService := driveexports.NewService(store, driveexports.ServiceConfig{
		Enabled: cfg.DriveExportEnabled, DestinationRoot: cfg.DriveExportDestinationRoot,
	}, driveExportSigner)
	handler := httpapi.New(
		authService, groupService, videoService, annotationService, driveExportService,
		tokens, store, logger, cfg.CORSOrigins,
	)
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
		publishHook := videos.PublishHook(nil)
		if cfg.DriveExportEnabled {
			systemUser := uuid.MustParse("00000000-0000-0000-0000-000000000000")
			publishHook = func(ctx context.Context, video model.Video) {
				if err := driveExportService.Publish(ctx, video, systemUser); err != nil {
					logger.Error("queue drive publish", "video_id", video.ID, "error", err)
				}
			}
		}
		processor := videos.NewProcessor(store, optimizer, logger, videos.ProcessorConfig{
			PollInterval: cfg.VideoProcessingPollInterval,
			MaxAttempts:  cfg.VideoProcessingMaxAttempts,
		}, publishHook)
		processorCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		application.processorCancel = cancel
		application.processorDone = done
		go func() {
			defer close(done)
			processor.Run(processorCtx)
		}()
	}
	if cfg.DriveExportEnabled {
		recovered, err := store.RequeueInterruptedDriveExports(ctx)
		if err != nil {
			application.Close()
			return nil, fmt.Errorf("recover interrupted drive export jobs: %w", err)
		}
		if recovered > 0 {
			logger.Info("requeued interrupted drive export jobs", "count", recovered)
		}
		publisher := driveexports.NewPublisher(videoService, driveExportSigner)
		processor := driveexports.NewProcessor(store, publisher, logger, driveexports.ProcessorConfig{
			PollInterval: cfg.DriveExportPollInterval, MaxAttempts: cfg.DriveExportMaxAttempts,
		})
		processorCtx, cancel := context.WithCancel(ctx)
		done := make(chan struct{})
		application.driveExportCancel = cancel
		application.driveExportDone = done
		go func() {
			defer close(done)
			processor.Run(processorCtx)
		}()
	}
	{
		rustfsPurger := &storageDeleter{storage: objectStorage}
		drivePurger := &driveexportsGatewayDeleter{uploader: driveExportSigner}
		gc := driveexports.NewGC(store, driveexports.NewPurger(rustfsPurger, drivePurger), driveExportService, logger, driveexports.GCConfig{
			Interval: cfg.VideoGCInterval, Keep: cfg.VideoGCKeep,
		})
		gcCtx, cancel := context.WithCancel(ctx)
		gcDone := make(chan struct{})
		application.videoGCCancel = cancel
		application.videoGCDone = gcDone
		go func() {
			defer close(gcDone)
			gc.Run(gcCtx)
		}()
	}
	return application, nil
}

// storageDeleter adapts the S3-compatible storage to the GC's purger.
type storageDeleter struct {
	storage *storage.S3
}

func (d *storageDeleter) DeleteRustFSObject(ctx context.Context, objectKey string) error {
	return d.storage.DeleteObject(ctx, objectKey)
}

func (d *storageDeleter) DeleteDriveObject(context.Context, string) error {
	return nil
}

// driveexportsGatewayDeleter adapts the gateway uploader.
type driveexportsGatewayDeleter struct {
	uploader *driveexports.GatewayUploader
}

func (d *driveexportsGatewayDeleter) DeleteRustFSObject(context.Context, string) error {
	return nil
}

func (d *driveexportsGatewayDeleter) DeleteDriveObject(ctx context.Context, objectKey string) error {
	return d.uploader.DeleteObject(ctx, objectKey)
}

func (a *App) Close() {
	if a.driveExportCancel != nil {
		a.driveExportCancel()
		<-a.driveExportDone
	}
	if a.videoGCCancel != nil {
		a.videoGCCancel()
		<-a.videoGCDone
	}
	if a.processorCancel != nil {
		a.processorCancel()
		<-a.processorDone
	}
	a.store.Close()
}

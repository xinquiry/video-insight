package app

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"

	"github.com/xinquiry/video-insight/backend-go/internal/annotations"
	"github.com/xinquiry/video-insight/backend-go/internal/auth"
	"github.com/xinquiry/video-insight/backend-go/internal/groups"
	"github.com/xinquiry/video-insight/backend-go/internal/httpapi"
	"github.com/xinquiry/video-insight/backend-go/internal/platform/config"
	"github.com/xinquiry/video-insight/backend-go/internal/platform/postgres"
	"github.com/xinquiry/video-insight/backend-go/internal/platform/storage"
	"github.com/xinquiry/video-insight/backend-go/internal/videos"
)

type App struct {
	Handler http.Handler
	store   *postgres.Store
}

func New(ctx context.Context, cfg config.Config, logger *slog.Logger) (*App, error) {
	store, err := postgres.Open(ctx, cfg.DatabaseURL)
	if err != nil {
		return nil, err
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
	})
	annotationService := annotations.NewService(store)
	handler := httpapi.New(authService, groupService, videoService, annotationService, tokens, store, logger, cfg.CORSOrigins)
	return &App{Handler: handler, store: store}, nil
}

func (a *App) Close() { a.store.Close() }

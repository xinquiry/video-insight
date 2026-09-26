package driveexports

import (
	"context"
	"fmt"
	"net/http"
	"path"
	"strings"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
)

// Service coordinates publishing videos to the SJTU Drive through the
// storage gateway. The published copy of a video is its download source
// (CDN semantics): publishing happens automatically when processing marks
// a video ready, and downloads fetch the object directly from COS with
// per-request presigned URLs. Annotations never enter the published copy —
// they are read from PostgreSQL at download time and assembled into the
// package by the browser.
type ServiceStore interface {
	GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error)
	GetDriveExportByVideoForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.DriveExport, bool, error)
	ListReadyVideosWithoutCompletedExport(ctx context.Context) ([]model.Video, error)
	QueueDriveExport(ctx context.Context, videoID, groupID, requestedBy uuid.UUID, destinationPath string) (model.DriveExport, error)
}

type ServiceConfig struct {
	Enabled         bool
	DestinationRoot string
}

// URLSigner signs short-lived URLs against published objects (the
// sjtu-oss-gateway uploader implements it).
type URLSigner interface {
	DownloadURL(ctx context.Context, objectKey string) (string, error)
}

type Status struct {
	Enabled     bool
	Job         *model.DriveExport
	DownloadURL string // present when the video has a published copy
}

type Service struct {
	store  ServiceStore
	config ServiceConfig
	signer URLSigner
}

func NewService(store ServiceStore, config ServiceConfig, signer URLSigner) *Service {
	config.DestinationRoot = strings.Trim(config.DestinationRoot, "/")
	return &Service{store: store, config: config, signer: signer}
}

// PublishObjectKey is the stable drive key for a video's published copy.
// It is derived from the video ID alone so the copy stays addressable
// independently of titles, filenames, or groups.
func (s *Service) PublishObjectKey(video model.Video) string {
	return path.Join(s.config.DestinationRoot, videoObject(video))
}

func videoObject(video model.Video) string {
	ext := path.Ext(strings.ReplaceAll(video.OriginalFilename, "\\", "/"))
	if ext == "" || len(ext) > 12 {
		ext = ".mp4"
	}
	return video.ID.String() + ext
}

// Status reports the publish state for a video and signs a download URL
// whenever a completed publish exists.
func (s *Service) Status(ctx context.Context, videoID, groupID uuid.UUID) (Status, error) {
	video, found, err := s.store.GetVideoByIDForGroup(ctx, videoID, groupID)
	if err != nil {
		return Status{}, err
	}
	if !found {
		return Status{}, apperror.New(http.StatusNotFound, "Video not found")
	}
	job, found, err := s.store.GetDriveExportByVideoForGroup(ctx, videoID, groupID)
	if err != nil {
		return Status{}, err
	}
	if !found {
		return Status{Enabled: s.config.Enabled}, nil
	}
	status := Status{Enabled: s.config.Enabled, Job: &job}
	if job.Status == model.DriveExportCompleted && s.signer != nil {
		if url, signErr := s.signer.DownloadURL(ctx, s.PublishObjectKey(video)); signErr == nil {
			status.DownloadURL = url
		}
		// Signing failures are surfaced as a missing URL; the client falls
		// back to the RustFS playback path for the media bytes.
	}
	return status, nil
}

// Publish enqueues a publish job for a ready video. Idempotent: in-flight
// or completed jobs are left alone.
func (s *Service) Publish(ctx context.Context, video model.Video, requestedBy uuid.UUID) error {
	if !s.config.Enabled {
		return nil
	}
	if video.ProcessingStatus != model.VideoProcessingReady {
		return nil
	}
	current, found, err := s.store.GetDriveExportByVideoForGroup(ctx, video.ID, video.GroupID)
	if err != nil {
		return err
	}
	if found {
		switch current.Status {
		case model.DriveExportPending, model.DriveExportPreparing, model.DriveExportUploading, model.DriveExportCompleted:
			return nil
		}
	}
	_, err = s.store.QueueDriveExport(ctx, video.ID, video.GroupID, requestedBy, s.PublishObjectKey(video))
	return err
}

// PublishAll enqueues publish jobs for every ready video without a
// completed copy — the backfill path for videos uploaded before
// auto-publish existed.
func (s *Service) PublishAll(ctx context.Context, requestedBy uuid.UUID) (int, error) {
	if !s.config.Enabled {
		return 0, nil
	}
	videos, err := s.store.ListReadyVideosWithoutCompletedExport(ctx)
	if err != nil {
		return 0, err
	}
	published := 0
	for _, video := range videos {
		if err := s.Publish(ctx, video, requestedBy); err != nil {
			return published, fmt.Errorf("queue publish for video %s: %w", video.ID, err)
		}
		published++
	}
	return published, nil
}

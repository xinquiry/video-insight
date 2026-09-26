package driveexports

import (
	"context"
	"fmt"
	"io"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

// VideoSource opens a video's stored object for streaming to the drive.
type VideoSource interface {
	OpenExport(ctx context.Context, videoID, groupID uuid.UUID) (videos.Export, error)
}

// Uploader streams an object to the drive at a destination key.
type Uploader interface {
	Upload(ctx context.Context, destinationPath string, source io.Reader, contentType string) error
}

// Publisher copies a video object from RustFS to the drive. The published
// copy is the video alone — annotations live in PostgreSQL and are
// assembled into a package by the browser at download time.
type Publisher struct {
	videos   VideoSource
	uploader Uploader
}

func NewPublisher(videos VideoSource, uploader Uploader) *Publisher {
	return &Publisher{videos: videos, uploader: uploader}
}

// Run streams the video to the drive. onPrepared transitions the job to
// uploading (size unknown because the object is streamed, not staged).
func (p *Publisher) Run(
	ctx context.Context,
	job model.DriveExport,
	onPrepared func(sizeBytes int64) error,
) error {
	result, err := p.videos.OpenExport(ctx, job.VideoID, job.GroupID)
	if err != nil {
		return fmt.Errorf("open video for publish: %w", err)
	}
	defer func() { _ = result.Media.Close() }()

	// Transition the job to uploading before the transfer starts; the size
	// is unknown because the object streams straight from RustFS.
	if err := onPrepared(0); err != nil {
		return err
	}
	if err := p.uploader.Upload(ctx, job.DestinationPath, result.Media, result.Video.ContentType); err != nil {
		return fmt.Errorf("upload published video: %w", err)
	}
	return nil
}

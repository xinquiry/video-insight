package driveexports

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/portable"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

type VideoSource interface {
	OpenExport(ctx context.Context, videoID, groupID uuid.UUID) (videos.Export, error)
}

type AnnotationSource interface {
	List(ctx context.Context, videoID, groupID uuid.UUID) ([]model.Annotation, error)
}

type Uploader interface {
	Upload(ctx context.Context, destinationPath, localPath, contentType string) error
}

type PackageExporter struct {
	videos   VideoSource
	items    AnnotationSource
	uploader Uploader
	tempDir  string
	maxBytes int64
}

func NewPackageExporter(
	videos VideoSource,
	items AnnotationSource,
	uploader Uploader,
	tempDir string,
	maxBytes int64,
) (*PackageExporter, error) {
	if err := os.MkdirAll(tempDir, 0o750); err != nil {
		return nil, fmt.Errorf("create drive export directory: %w", err)
	}
	workDirs, err := filepath.Glob(filepath.Join(tempDir, "export-*"))
	if err != nil {
		return nil, fmt.Errorf("find interrupted drive export directories: %w", err)
	}
	for _, workDir := range workDirs {
		if err := os.RemoveAll(workDir); err != nil {
			return nil, fmt.Errorf("remove interrupted drive export directory: %w", err)
		}
	}
	return &PackageExporter{
		videos: videos, items: items, uploader: uploader, tempDir: tempDir, maxBytes: maxBytes,
	}, nil
}

func (e *PackageExporter) Run(
	ctx context.Context,
	job model.DriveExport,
	onPrepared func(sizeBytes int64) error,
) error {
	workDir, err := os.MkdirTemp(e.tempDir, "export-")
	if err != nil {
		return fmt.Errorf("create drive export work directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	localPath := filepath.Join(workDir, "package.vinsight")
	if err := e.writePackage(ctx, job, localPath); err != nil {
		return err
	}
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat drive export package: %w", err)
	}
	if info.Size() <= 0 {
		return fmt.Errorf("drive export package is empty")
	}
	if e.maxBytes > 0 && info.Size() > e.maxBytes {
		return fmt.Errorf("drive export package is %d bytes, exceeding the configured %d-byte limit", info.Size(), e.maxBytes)
	}
	if err := onPrepared(info.Size()); err != nil {
		return err
	}
	if err := e.uploader.Upload(ctx, job.DestinationPath, localPath, portable.PackageMIME); err != nil {
		return fmt.Errorf("upload drive export: %w", err)
	}
	return nil
}

func (e *PackageExporter) writePackage(ctx context.Context, job model.DriveExport, localPath string) error {
	result, err := e.videos.OpenExport(ctx, job.VideoID, job.GroupID)
	if err != nil {
		return fmt.Errorf("open video for drive export: %w", err)
	}
	defer func() { _ = result.Media.Close() }()
	items, err := e.items.List(ctx, job.VideoID, job.GroupID)
	if err != nil {
		return fmt.Errorf("list annotations for drive export: %w", err)
	}

	portableVideo := result.Video
	portableVideo.OriginalFilename = result.Filename
	bundle, err := portable.NewBundle(
		portableVideo,
		"media/"+result.Filename,
		items,
		time.Now(),
	)
	if err != nil {
		return fmt.Errorf("build drive export package: %w", err)
	}
	file, err := os.OpenFile(localPath, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return fmt.Errorf("create drive export package: %w", err)
	}
	writeErr := portable.WritePackage(file, bundle, result.Media)
	closeErr := file.Close()
	if writeErr != nil {
		return fmt.Errorf("write drive export package: %w", writeErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close drive export package: %w", closeErr)
	}
	return nil
}

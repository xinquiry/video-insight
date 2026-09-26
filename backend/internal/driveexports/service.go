package driveexports

import (
	"context"
	"net/http"
	"path"
	"strings"
	"unicode/utf8"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
)

type ServiceStore interface {
	GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error)
	GetDriveExportByVideoForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.DriveExport, bool, error)
	QueueDriveExport(ctx context.Context, videoID, groupID, requestedBy uuid.UUID, destinationPath string) (model.DriveExport, error)
}

type ServiceConfig struct {
	Enabled         bool
	DestinationRoot string
}

// URLSigner signs short-lived download URLs for exported packages (the
// sjtu-oss-gateway uploader implements it).
type URLSigner interface {
	DownloadURL(ctx context.Context, objectKey string) (string, error)
}

type Status struct {
	Enabled     bool
	Job         *model.DriveExport
	DownloadURL string // present when a completed export can still be served
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

func (s *Service) Status(ctx context.Context, videoID, groupID uuid.UUID) (Status, error) {
	if _, err := s.getVideo(ctx, videoID, groupID); err != nil {
		return Status{}, err
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
		if url, signErr := s.signer.DownloadURL(ctx, job.DestinationPath); signErr == nil {
			status.DownloadURL = url
		}
		// Signing failures are not fatal: the client sees a completed export
		// and can re-queue to regenerate the package.
	}
	return status, nil
}

func (s *Service) Queue(ctx context.Context, videoID, groupID, requestedBy uuid.UUID) (model.DriveExport, error) {
	if !s.config.Enabled {
		return model.DriveExport{}, apperror.NewCode(
			http.StatusServiceUnavailable,
			"drive_export_disabled",
			"Drive export is not configured",
		)
	}
	video, err := s.getVideo(ctx, videoID, groupID)
	if err != nil {
		return model.DriveExport{}, err
	}
	if video.ProcessingStatus != model.VideoProcessingReady {
		return model.DriveExport{}, apperror.New(http.StatusConflict, "Video is not ready for export")
	}
	current, found, err := s.store.GetDriveExportByVideoForGroup(ctx, videoID, groupID)
	if err != nil {
		return model.DriveExport{}, err
	}
	if found && (current.Status == model.DriveExportPreparing || current.Status == model.DriveExportUploading) {
		return model.DriveExport{}, apperror.NewCode(
			http.StatusConflict,
			"drive_export_in_progress",
			"This video is already being exported to the drive",
		)
	}
	return s.store.QueueDriveExport(
		ctx,
		videoID,
		groupID,
		requestedBy,
		destinationPath(s.config.DestinationRoot, video),
	)
}

func (s *Service) getVideo(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, error) {
	video, found, err := s.store.GetVideoByIDForGroup(ctx, videoID, groupID)
	if err != nil {
		return model.Video{}, err
	}
	if !found {
		return model.Video{}, apperror.New(http.StatusNotFound, "Video not found")
	}
	return video, nil
}

func destinationPath(root string, video model.Video) string {
	filename := strings.ReplaceAll(video.OriginalFilename, "\\", "/")
	filename = path.Base(filename)
	stem := strings.TrimSuffix(filename, path.Ext(filename))
	stem = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f || strings.ContainsRune(`<>:"/\\|?*#%`, char) {
			return '_'
		}
		return char
	}, stem)
	stem = strings.Trim(strings.TrimSpace(stem), ".")
	if stem == "" {
		stem = "video"
	}
	stem = truncateUTF8(stem, 160)
	name := stem + "-" + video.ID.String()[:8] + ".vinsight"
	return path.Join(root, video.GroupID.String(), name)
}

func truncateUTF8(value string, maximumBytes int) string {
	if len(value) <= maximumBytes {
		return value
	}
	for len(value) > maximumBytes || !utf8.ValidString(value) {
		value = value[:len(value)-1]
	}
	return value
}

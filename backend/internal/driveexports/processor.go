package driveexports

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

type ProcessingStore interface {
	ClaimDriveExport(ctx context.Context) (model.DriveExport, bool, error)
	MarkDriveExportUploading(ctx context.Context, exportID uuid.UUID, sizeBytes int64) (bool, error)
	MarkDriveExportCompleted(ctx context.Context, exportID uuid.UUID) (bool, error)
	MarkDriveExportFailed(ctx context.Context, exportID uuid.UUID, status model.DriveExportStatus, message string, nextAttemptAt time.Time) (bool, error)
}

type ExportRunner interface {
	Run(ctx context.Context, job model.DriveExport, onPrepared func(sizeBytes int64) error) error
}

type ProcessorConfig struct {
	PollInterval time.Duration
	MaxAttempts  int
}

type Processor struct {
	store    ProcessingStore
	exporter ExportRunner
	logger   *slog.Logger
	config   ProcessorConfig
}

func NewProcessor(store ProcessingStore, exporter ExportRunner, logger *slog.Logger, config ProcessorConfig) *Processor {
	if config.PollInterval <= 0 {
		config.PollInterval = 5 * time.Second
	}
	if config.MaxAttempts < 1 {
		config.MaxAttempts = 3
	}
	return &Processor{store: store, exporter: exporter, logger: logger, config: config}
}

func (p *Processor) Run(ctx context.Context) {
	p.logger.Info("drive export processor started", "max_attempts", p.config.MaxAttempts)
	defer p.logger.Info("drive export processor stopped")
	for {
		job, found, err := p.store.ClaimDriveExport(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			p.logger.Error("claim drive export job", "error", err)
			if !wait(ctx, p.config.PollInterval) {
				return
			}
			continue
		}
		if !found {
			if !wait(ctx, p.config.PollInterval) {
				return
			}
			continue
		}
		p.processOne(ctx, job)
		if ctx.Err() != nil {
			return
		}
	}
}

func (p *Processor) processOne(ctx context.Context, job model.DriveExport) {
	started := time.Now()
	p.logger.Info("preparing drive export", "export_id", job.ID, "video_id", job.VideoID, "attempt", job.Attempts)
	err := p.exporter.Run(ctx, job, func(sizeBytes int64) error {
		updated, updateErr := p.store.MarkDriveExportUploading(ctx, job.ID, sizeBytes)
		if updateErr != nil {
			return fmt.Errorf("mark drive export uploading: %w", updateErr)
		}
		if !updated {
			return fmt.Errorf("drive export is no longer in preparing state")
		}
		p.logger.Info("uploading drive export", "export_id", job.ID, "bytes", sizeBytes, "destination", job.DestinationPath)
		return nil
	})
	if err == nil {
		updated, updateErr := p.store.MarkDriveExportCompleted(ctx, job.ID)
		if updateErr != nil {
			p.logger.Error("mark drive export completed", "export_id", job.ID, "error", updateErr)
			return
		}
		if !updated {
			p.logger.Warn("drive export result was not applied", "export_id", job.ID)
			return
		}
		p.logger.Info("drive export completed", "export_id", job.ID, "destination", job.DestinationPath, "duration", time.Since(started))
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
		return
	}

	status := model.DriveExportPending
	nextAttemptAt := time.Now().Add(exportRetryDelay(job.Attempts))
	if job.Attempts >= p.config.MaxAttempts {
		status = model.DriveExportFailed
	}
	message := err.Error()
	if len(message) > 2000 {
		message = message[len(message)-2000:]
	}
	updated, updateErr := p.store.MarkDriveExportFailed(ctx, job.ID, status, message, nextAttemptAt)
	if updateErr != nil {
		p.logger.Error("mark drive export failed", "export_id", job.ID, "error", updateErr)
		return
	}
	if !updated {
		p.logger.Warn("drive export failure was not applied", "export_id", job.ID)
		return
	}
	p.logger.Error("drive export failed", "export_id", job.ID, "attempt", job.Attempts, "status", status, "error", err)
}

func exportRetryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := time.Minute * time.Duration(1<<(min(attempt, 6)-1))
	return min(delay, 30*time.Minute)
}

func wait(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

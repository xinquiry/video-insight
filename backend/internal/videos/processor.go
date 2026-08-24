package videos

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

type ProcessingStore interface {
	ClaimVideoForProcessing(ctx context.Context) (model.Video, bool, error)
	MarkVideoProcessingReady(ctx context.Context, videoID uuid.UUID, sizeBytes int64) (bool, error)
	MarkVideoProcessingFailed(
		ctx context.Context,
		videoID uuid.UUID,
		status model.VideoProcessingStatus,
		message string,
		nextAttemptAt time.Time,
	) (bool, error)
}

type ObjectOptimizer interface {
	Optimize(ctx context.Context, video model.Video) (int64, error)
}

type ProcessorConfig struct {
	PollInterval time.Duration
	MaxAttempts  int
}

type Processor struct {
	store     ProcessingStore
	optimizer ObjectOptimizer
	logger    *slog.Logger
	config    ProcessorConfig
}

func NewProcessor(
	store ProcessingStore,
	optimizer ObjectOptimizer,
	logger *slog.Logger,
	config ProcessorConfig,
) *Processor {
	if config.PollInterval <= 0 {
		config.PollInterval = 5 * time.Second
	}
	if config.MaxAttempts < 1 {
		config.MaxAttempts = 3
	}
	return &Processor{store: store, optimizer: optimizer, logger: logger, config: config}
}

func (p *Processor) Run(ctx context.Context) {
	p.logger.Info("video processor started", "max_attempts", p.config.MaxAttempts)
	defer p.logger.Info("video processor stopped")
	for {
		video, found, err := p.store.ClaimVideoForProcessing(ctx)
		if err != nil {
			if ctx.Err() != nil {
				return
			}
			p.logger.Error("claim video processing job", "error", err)
			if !waitForProcessor(ctx, p.config.PollInterval) {
				return
			}
			continue
		}
		if !found {
			if !waitForProcessor(ctx, p.config.PollInterval) {
				return
			}
			continue
		}
		p.processOne(ctx, video)
		if ctx.Err() != nil {
			return
		}
	}
}

func (p *Processor) processOne(ctx context.Context, video model.Video) {
	started := time.Now()
	p.logger.Info("optimizing video", "video_id", video.ID, "attempt", video.ProcessingAttempts)
	sizeBytes, err := p.optimizer.Optimize(ctx, video)
	if err == nil {
		updated, updateErr := p.store.MarkVideoProcessingReady(ctx, video.ID, sizeBytes)
		if updateErr != nil {
			p.logger.Error("mark video processing ready", "video_id", video.ID, "error", updateErr)
			return
		}
		if !updated {
			p.logger.Warn("video processing result was not applied", "video_id", video.ID)
			return
		}
		p.logger.Info("video optimized", "video_id", video.ID, "bytes", sizeBytes, "duration", time.Since(started))
		return
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) || ctx.Err() != nil {
		return
	}

	status := model.VideoProcessingPending
	nextAttemptAt := time.Now().Add(retryDelay(video.ProcessingAttempts))
	if video.ProcessingAttempts >= p.config.MaxAttempts {
		status = model.VideoProcessingFailed
	}
	message := err.Error()
	if len(message) > 2000 {
		message = message[len(message)-2000:]
	}
	updated, updateErr := p.store.MarkVideoProcessingFailed(ctx, video.ID, status, message, nextAttemptAt)
	if updateErr != nil {
		p.logger.Error("mark video processing failed", "video_id", video.ID, "error", updateErr)
		return
	}
	if !updated {
		p.logger.Warn("video processing failure was not applied", "video_id", video.ID)
		return
	}
	p.logger.Error("video optimization failed", "video_id", video.ID, "attempt", video.ProcessingAttempts, "status", status, "error", err)
}

func retryDelay(attempt int) time.Duration {
	if attempt < 1 {
		attempt = 1
	}
	delay := 30 * time.Second * time.Duration(1<<(min(attempt, 6)-1))
	return min(delay, 15*time.Minute)
}

func waitForProcessor(ctx context.Context, duration time.Duration) bool {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

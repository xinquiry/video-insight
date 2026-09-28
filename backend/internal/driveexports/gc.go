package driveexports

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

// PurgeStore provides the GC data set: soft-deleted videos older than the
// retention window, plus hard removal of the row after the copies are gone.
type PurgeStore interface {
	ListStaleDeletedVideos(ctx context.Context, olderThan time.Time) ([]model.Video, error)
	PurgeVideo(ctx context.Context, videoID, groupID uuid.UUID) (bool, error)
}

// ObjectPurger removes the video bytes from object storage and the
// published copy from the drive (the video processor's storage and the
// gateway uploader implement the respective halves; Purger bundles both).
type ObjectPurger interface {
	DeleteRustFSObject(ctx context.Context, objectKey string) error
	DeleteDriveObject(ctx context.Context, objectKey string) error
}

// Purger bundles the two deletion targets behind one interface.
type Purger struct {
	rustfs ObjectPurger
	drive  ObjectPurger
}

func NewPurger(rustfs, drive ObjectPurger) *Purger {
	return &Purger{rustfs: rustfs, drive: drive}
}

func (p *Purger) DeleteRustFSObject(ctx context.Context, objectKey string) error {
	return p.rustfs.DeleteRustFSObject(ctx, objectKey)
}

func (p *Purger) DeleteDriveObject(ctx context.Context, objectKey string) error {
	return p.drive.DeleteDriveObject(ctx, objectKey)
}

// GC periodically purges soft-deleted videos older than the retention
// window: RustFS bytes, the published drive copy, then the PG row (which
// cascades to annotations).
type GC struct {
	store    PurgeStore
	purger   *Purger
	keys     *Service
	logger   *slog.Logger
	interval time.Duration
	keep     time.Duration
}

type GCConfig struct {
	Interval time.Duration // how often the sweep runs
	Keep     time.Duration // soft-deleted rows older than this are purged
}

func NewGC(store PurgeStore, purger *Purger, keys *Service, logger *slog.Logger, config GCConfig) *GC {
	if config.Interval <= 0 {
		config.Interval = 24 * time.Hour
	}
	if config.Keep <= 0 {
		config.Keep = 30 * 24 * time.Hour
	}
	return &GC{store: store, purger: purger, keys: keys, logger: logger, interval: config.Interval, keep: config.Keep}
}

func (g *GC) Run(ctx context.Context) {
	g.logger.Info("deleted-video gc started", "retention", g.keep.String(), "interval", g.interval.String())
	defer g.logger.Info("deleted-video gc stopped")
	timer := time.NewTimer(0) // sweep once at startup
	defer timer.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-timer.C:
		}
		g.sweep(ctx)
		timer.Reset(g.interval)
	}
}

func (g *GC) sweep(ctx context.Context) {
	videos, err := g.store.ListStaleDeletedVideos(ctx, time.Now().Add(-g.keep))
	if err != nil {
		g.logger.Error("gc list stale videos", "error", err)
		return
	}
	for _, video := range videos {
		if ctx.Err() != nil {
			return
		}
		if err := g.purgeOne(ctx, video); err != nil {
			g.logger.Error("gc purge video", "video_id", video.ID, "error", err)
			continue
		}
	}
	if len(videos) > 0 {
		g.logger.Info("gc purged videos", "count", len(videos))
	}
}

func (g *GC) purgeOne(ctx context.Context, video model.Video) error {
	// Drive copy first: the published object key is derived the same way the
	// publish pipeline derived it.
	driveKey := g.keys.PublishObjectKey(video)
	if err := g.purger.DeleteDriveObject(ctx, driveKey); err != nil {
		return fmt.Errorf("delete published copy %q: %w", driveKey, err)
	}
	// Then the stored object.
	if err := g.purger.DeleteRustFSObject(ctx, video.ObjectKey); err != nil {
		return fmt.Errorf("delete stored object %q: %w", video.ObjectKey, err)
	}
	// Finally the row (annotations cascade).
	purged, err := g.store.PurgeVideo(ctx, video.ID, video.GroupID)
	if err != nil {
		return fmt.Errorf("purge row: %w", err)
	}
	if !purged {
		// Someone restored it between listing and purging — fine.
		return nil
	}
	g.logger.Info("gc purged video", "video_id", video.ID, "title", video.Title)
	return nil
}

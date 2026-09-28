package driveexports

import (
	"context"
	"errors"
	"io"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

type fakePurgeStore struct {
	videos  []model.Video
	purged  []uuid.UUID
	purgeOK bool
}

func (f *fakePurgeStore) ListStaleDeletedVideos(context.Context, time.Time) ([]model.Video, error) {
	return f.videos, nil
}

func (f *fakePurgeStore) GetVideoByIDForGroup(context.Context, uuid.UUID, uuid.UUID) (model.Video, bool, error) {
	return model.Video{}, false, nil
}

func (f *fakePurgeStore) GetDriveExportByVideoForGroup(context.Context, uuid.UUID, uuid.UUID) (model.DriveExport, bool, error) {
	return model.DriveExport{}, false, nil
}

func (f *fakePurgeStore) ListReadyVideosWithoutCompletedExport(context.Context) ([]model.Video, error) {
	return nil, nil
}

func (f *fakePurgeStore) QueueDriveExport(context.Context, uuid.UUID, uuid.UUID, uuid.UUID, string) (model.DriveExport, error) {
	return model.DriveExport{}, nil
}

func (f *fakePurgeStore) PurgeVideo(_ context.Context, videoID, _ uuid.UUID) (bool, error) {
	f.purged = append(f.purged, videoID)
	return f.purgeOK, nil
}

type fakePurger struct {
	rustfsKeys []string
	driveKeys  []string
	rustfsErr  error
	driveErr   error
}

func (f *fakePurger) DeleteRustFSObject(_ context.Context, key string) error {
	if f.rustfsErr != nil {
		return f.rustfsErr
	}
	f.rustfsKeys = append(f.rustfsKeys, key)
	return nil
}

func (f *fakePurger) DeleteDriveObject(_ context.Context, key string) error {
	if f.driveErr != nil {
		return f.driveErr
	}
	f.driveKeys = append(f.driveKeys, key)
	return nil
}

func newGCTest(t *testing.T) (*GC, *fakePurgeStore, *fakePurger) {
	t.Helper()
	store := &fakePurgeStore{purgeOK: true}
	purger := &fakePurger{}
	keys := NewService(store, ServiceConfig{Enabled: true, DestinationRoot: "published"}, nil)
	gc := NewGC(store, NewPurger(purger, purger), keys, discardLogger(), GCConfig{
		Interval: time.Hour, Keep: 30 * 24 * time.Hour,
	})
	return gc, store, purger
}

func discardLogger() *slog.Logger { return slog.New(slog.NewTextHandler(io.Discard, nil)) }

func TestGCSweepPurgesAllCopies(t *testing.T) {
	t.Parallel()
	gc, store, purger := newGCTest(t)
	video := model.Video{
		ID: uuid.New(), GroupID: uuid.New(), ObjectKey: "videos/a.mp4",
		OriginalFilename: "lesson.mp4",
	}
	store.videos = []model.Video{video}
	gc.sweep(context.Background())
	if len(store.purged) != 1 || store.purged[0] != video.ID {
		t.Fatalf("purged rows: %v", store.purged)
	}
	if len(purger.rustfsKeys) != 1 || purger.rustfsKeys[0] != "videos/a.mp4" {
		t.Fatalf("rustfs deletions: %v", purger.rustfsKeys)
	}
	// Drive key derives from the publish root + video UUID + extension.
	want := "published/" + video.ID.String() + ".mp4"
	if len(purger.driveKeys) != 1 || purger.driveKeys[0] != want {
		t.Fatalf("drive deletions: %v", purger.driveKeys)
	}
}

func TestGCSweepContinuesPastErrors(t *testing.T) {
	t.Parallel()
	gc, store, purger := newGCTest(t)
	first := model.Video{ID: uuid.New(), GroupID: uuid.New(), ObjectKey: "videos/1.mp4", OriginalFilename: "a.mp4"}
	second := model.Video{ID: uuid.New(), GroupID: uuid.New(), ObjectKey: "videos/2.mp4", OriginalFilename: "b.mp4"}
	store.videos = []model.Video{first, second}
	purger.driveErr = errors.New("drive delete failed")
	gc.sweep(context.Background())
	// First video fails on the drive; the row must NOT be purged.
	if len(store.purged) != 0 {
		t.Fatalf("rows purged despite drive failure: %v", store.purged)
	}
	// The sweep continues to the second video (also failing on drive).
	if len(purger.rustfsKeys) != 0 {
		t.Fatalf("rustfs deleted before drive succeeded: %v", purger.rustfsKeys)
	}
}

func TestGCSweepEmptyIsQuiet(t *testing.T) {
	t.Parallel()
	gc, store, purger := newGCTest(t)
	gc.sweep(context.Background())
	if len(store.purged) != 0 || len(purger.driveKeys) != 0 || len(purger.rustfsKeys) != 0 {
		t.Fatal("unexpected deletions for empty sweep")
	}
}

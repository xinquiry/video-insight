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

type fakeProcessingStore struct {
	uploadingSize int64
	completed     bool
	failedStatus  model.DriveExportStatus
	failedError   string
}

func (f *fakeProcessingStore) ClaimDriveExport(context.Context) (model.DriveExport, bool, error) {
	return model.DriveExport{}, false, nil
}

func (f *fakeProcessingStore) MarkDriveExportUploading(_ context.Context, _ uuid.UUID, sizeBytes int64) (bool, error) {
	f.uploadingSize = sizeBytes
	return true, nil
}

func (f *fakeProcessingStore) MarkDriveExportCompleted(context.Context, uuid.UUID) (bool, error) {
	f.completed = true
	return true, nil
}

func (f *fakeProcessingStore) MarkDriveExportFailed(
	_ context.Context,
	_ uuid.UUID,
	status model.DriveExportStatus,
	message string,
	_ time.Time,
) (bool, error) {
	f.failedStatus = status
	f.failedError = message
	return true, nil
}

type fakeRunner struct{ err error }

func (f fakeRunner) Run(_ context.Context, _ model.DriveExport, onPrepared func(int64) error) error {
	if f.err != nil {
		return f.err
	}
	return onPrepared(4321)
}

func TestProcessorCompletesDriveExport(t *testing.T) {
	t.Parallel()
	store := &fakeProcessingStore{}
	processor := NewProcessor(store, fakeRunner{}, discardLogger(), ProcessorConfig{MaxAttempts: 3})
	processor.processOne(context.Background(), model.DriveExport{ID: uuid.New(), Attempts: 1})
	if store.uploadingSize != 4321 || !store.completed {
		t.Fatalf("uploading size = %d, completed = %v", store.uploadingSize, store.completed)
	}
}

func TestProcessorRetriesThenFailsDriveExport(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		attempt int
		want    model.DriveExportStatus
	}{
		{attempt: 1, want: model.DriveExportPending},
		{attempt: 3, want: model.DriveExportFailed},
	} {
		store := &fakeProcessingStore{}
		processor := NewProcessor(store, fakeRunner{err: errors.New("drive unavailable")}, discardLogger(), ProcessorConfig{MaxAttempts: 3})
		processor.processOne(context.Background(), model.DriveExport{ID: uuid.New(), Attempts: test.attempt})
		if store.failedStatus != test.want || store.failedError != "drive unavailable" {
			t.Fatalf("attempt %d status = %q, error = %q", test.attempt, store.failedStatus, store.failedError)
		}
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

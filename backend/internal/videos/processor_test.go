package videos

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
	readySize    int64
	failedStatus model.VideoProcessingStatus
	failedError  string
}

func (f *fakeProcessingStore) ClaimVideoForProcessing(context.Context) (model.Video, bool, error) {
	return model.Video{}, false, nil
}

func (f *fakeProcessingStore) MarkVideoProcessingReady(_ context.Context, _ uuid.UUID, sizeBytes int64) (bool, error) {
	f.readySize = sizeBytes
	return true, nil
}

func (f *fakeProcessingStore) MarkVideoProcessingFailed(
	_ context.Context,
	_ uuid.UUID,
	status model.VideoProcessingStatus,
	message string,
	_ time.Time,
) (bool, error) {
	f.failedStatus = status
	f.failedError = message
	return true, nil
}

type fakeOptimizer struct {
	size int64
	err  error
}

func (f fakeOptimizer) Optimize(context.Context, model.Video) (int64, error) {
	return f.size, f.err
}

func TestProcessorMarksSuccessfulOptimizationReady(t *testing.T) {
	t.Parallel()
	store := &fakeProcessingStore{}
	processor := NewProcessor(store, fakeOptimizer{size: 1234}, discardLogger(), ProcessorConfig{MaxAttempts: 3})
	processor.processOne(context.Background(), model.Video{ID: uuid.New(), ProcessingAttempts: 1})
	if store.readySize != 1234 {
		t.Fatalf("ready size = %d", store.readySize)
	}
}

func TestProcessorRetriesThenMarksFailure(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		attempt int
		want    model.VideoProcessingStatus
	}{
		{attempt: 1, want: model.VideoProcessingPending},
		{attempt: 3, want: model.VideoProcessingFailed},
	} {
		store := &fakeProcessingStore{}
		processor := NewProcessor(store, fakeOptimizer{err: errors.New("broken video")}, discardLogger(), ProcessorConfig{MaxAttempts: 3})
		processor.processOne(context.Background(), model.Video{ID: uuid.New(), ProcessingAttempts: test.attempt})
		if store.failedStatus != test.want {
			t.Fatalf("attempt %d status = %q, want %q", test.attempt, store.failedStatus, test.want)
		}
		if store.failedError != "broken video" {
			t.Fatalf("error = %q", store.failedError)
		}
	}
}

func discardLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(io.Discard, nil))
}

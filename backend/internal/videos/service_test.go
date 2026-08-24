package videos

import (
	"context"
	"errors"
	"net/http"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
)

type fakeStore struct {
	video        model.Video
	found        bool
	createErr    error
	created      model.Video
	deleteCalled bool
}

func (f *fakeStore) GetVideoByIDForGroup(context.Context, uuid.UUID, uuid.UUID) (model.Video, bool, error) {
	return f.video, f.found, nil
}
func (f *fakeStore) ListVideosForGroup(context.Context, uuid.UUID, int, int) ([]model.Video, int64, error) {
	if !f.found {
		return []model.Video{}, 0, nil
	}
	return []model.Video{f.video}, 1, nil
}
func (f *fakeStore) CreateVideo(_ context.Context, video model.Video) (model.Video, error) {
	f.created = video
	if f.createErr != nil {
		return model.Video{}, f.createErr
	}
	video.ID = uuid.New()
	video.CreatedAt = time.Now()
	return video, nil
}
func (f *fakeStore) UpdateVideo(_ context.Context, video model.Video) (model.Video, error) {
	f.video = video
	return video, nil
}

func (f *fakeStore) DeleteVideo(context.Context, uuid.UUID, uuid.UUID) (bool, error) {
	f.deleteCalled = true
	return true, nil
}

type fakeStorage struct {
	parts      []int
	completed  []CompletedPart
	deletedKey string
	presigned  int
}

func (f *fakeStorage) CreateMultipartUpload(context.Context, string, string) (string, error) {
	return "upload-1", nil
}
func (f *fakeStorage) PresignUploadPart(_ context.Context, _ string, _ string, number int, _ time.Duration) (string, error) {
	f.parts = append(f.parts, number)
	return "https://upload/part", nil
}
func (f *fakeStorage) CompleteMultipartUpload(_ context.Context, _ string, _ string, parts []CompletedPart) error {
	f.completed = append([]CompletedPart(nil), parts...)
	return nil
}
func (f *fakeStorage) AbortMultipartUpload(context.Context, string, string) error { return nil }
func (f *fakeStorage) PresignGet(context.Context, string, time.Duration) (string, error) {
	f.presigned++
	return "https://playback", nil
}

func TestPlaybackURLIsOnlyIssuedForReadyVideos(t *testing.T) {
	t.Parallel()
	groupID := uuid.New()
	videoID := uuid.New()
	store := &fakeStore{found: true, video: model.Video{
		ID: videoID, GroupID: groupID, ObjectKey: "videos/key",
		ProcessingStatus: model.VideoProcessingPending,
	}}
	storage := &fakeStorage{}
	service := NewService(store, storage, Config{})

	pending, err := service.Get(context.Background(), videoID, groupID)
	if err != nil {
		t.Fatal(err)
	}
	if pending.PlaybackURL != nil || storage.presigned != 0 {
		t.Fatalf("pending video returned playback URL: %#v", pending.PlaybackURL)
	}

	store.video.ProcessingStatus = model.VideoProcessingReady
	ready, err := service.Get(context.Background(), videoID, groupID)
	if err != nil {
		t.Fatal(err)
	}
	if ready.PlaybackURL == nil || *ready.PlaybackURL != "https://playback" || storage.presigned != 1 {
		t.Fatalf("ready video playback URL = %#v, presign calls = %d", ready.PlaybackURL, storage.presigned)
	}
}
func (f *fakeStorage) DeleteObject(_ context.Context, key string) error {
	f.deletedKey = key
	return nil
}

func TestInitUploadCreatesExpectedParts(t *testing.T) {
	t.Parallel()
	store, storage := &fakeStore{}, &fakeStorage{}
	service := NewService(store, storage, Config{PartSize: 5 * 1024 * 1024, MaxParts: 10_000, URLTTL: time.Hour, Concurrency: 1})
	result, err := service.InitUpload(context.Background(), "lesson/video.mp4", "video/mp4", 10*1024*1024)
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Parts) != 2 || len(storage.parts) != 2 {
		t.Fatalf("got %d parts", len(result.Parts))
	}
	if result.Concurrency != 1 {
		t.Fatalf("got concurrency %d", result.Concurrency)
	}
	if result.ObjectKey == "" || result.UploadID != "upload-1" {
		t.Fatalf("unexpected upload result: %+v", result)
	}
}

func TestCompleteUploadSortsPartsAndCleansUpOnDatabaseFailure(t *testing.T) {
	t.Parallel()
	store := &fakeStore{createErr: errors.New("database failed")}
	storage := &fakeStorage{}
	service := NewService(store, storage, Config{})
	_, err := service.CompleteUpload(context.Background(), CompleteInput{
		ObjectKey: "videos/object", UploadID: "upload-1", Title: "Lesson", Filename: "lesson.mp4",
		ContentType: "video/mp4", SizeBytes: 10, Parts: []CompletedPart{{PartNumber: 2, ETag: "b"}, {PartNumber: 1, ETag: "a"}},
	}, uuid.New())
	if err == nil {
		t.Fatal("expected database error")
	}
	if storage.completed[0].PartNumber != 1 || storage.completed[1].PartNumber != 2 {
		t.Fatalf("parts not sorted: %+v", storage.completed)
	}
	if storage.deletedKey != "videos/object" {
		t.Fatalf("object was not cleaned up: %q", storage.deletedKey)
	}
}

func TestCompleteUploadStatusFollowsProcessingConfiguration(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name              string
		processingEnabled bool
		want              model.VideoProcessingStatus
		wantPlayback      bool
	}{
		{name: "processing enabled", processingEnabled: true, want: model.VideoProcessingPending},
		{name: "processing disabled", processingEnabled: false, want: model.VideoProcessingReady, wantPlayback: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			store := &fakeStore{}
			storage := &fakeStorage{}
			service := NewService(store, storage, Config{ProcessingEnabled: test.processingEnabled})
			result, err := service.CompleteUpload(context.Background(), CompleteInput{
				ObjectKey: "videos/object", UploadID: "upload-1", Title: "Lesson", Filename: "lesson.mp4",
				ContentType: "video/mp4", SizeBytes: 10, Parts: []CompletedPart{{PartNumber: 1, ETag: "a"}},
			}, uuid.New())
			if err != nil {
				t.Fatal(err)
			}
			if store.created.ProcessingStatus != test.want {
				t.Fatalf("processing status = %q, want %q", store.created.ProcessingStatus, test.want)
			}
			if (result.PlaybackURL != nil) != test.wantPlayback {
				t.Fatalf("playback URL present = %v, want %v", result.PlaybackURL != nil, test.wantPlayback)
			}
		})
	}
}

func TestDeleteRejectsVideoBeingProcessed(t *testing.T) {
	t.Parallel()
	store := &fakeStore{found: true, video: model.Video{
		ID: uuid.New(), GroupID: uuid.New(), ProcessingStatus: model.VideoProcessingProcessing,
	}}
	service := NewService(store, &fakeStorage{}, Config{})
	err := service.Delete(context.Background(), store.video.ID, store.video.GroupID)
	appErr, ok := apperror.As(err)
	if !ok || appErr.Status != http.StatusConflict {
		t.Fatalf("delete error = %v, want HTTP 409", err)
	}
	if store.deleteCalled {
		t.Fatal("processing video reached database deletion")
	}
}

func TestUpdateCanClearDescription(t *testing.T) {
	t.Parallel()
	description := "old"
	store := &fakeStore{found: true, video: model.Video{ID: uuid.New(), GroupID: uuid.New(), Title: "Title", Description: &description, ObjectKey: "videos/key"}}
	service := NewService(store, &fakeStorage{}, Config{})
	_, err := service.Update(context.Background(), store.video.ID, store.video.GroupID, UpdateInput{
		Description: optional.Value[string]{Set: true, Null: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if store.video.Description != nil {
		t.Fatal("description was not cleared")
	}
}

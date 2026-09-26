package driveexports

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

type fakeServiceStore struct {
	video  model.Video
	job    *model.DriveExport
	queued []model.DriveExport
}

func (f *fakeServiceStore) GetVideoByIDForGroup(_ context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error) {
	if f.video.ID != videoID || f.video.GroupID != groupID {
		return model.Video{}, false, nil
	}
	return f.video, true, nil
}

func (f *fakeServiceStore) GetDriveExportByVideoForGroup(context.Context, uuid.UUID, uuid.UUID) (model.DriveExport, bool, error) {
	if f.job == nil {
		return model.DriveExport{}, false, nil
	}
	return *f.job, true, nil
}

func (f *fakeServiceStore) ListReadyVideosWithoutCompletedExport(context.Context) ([]model.Video, error) {
	return nil, nil
}

func (f *fakeServiceStore) QueueDriveExport(
	_ context.Context,
	videoID, groupID, requestedBy uuid.UUID,
	destinationPath string,
) (model.DriveExport, error) {
	job := model.DriveExport{
		ID: uuid.New(), VideoID: videoID, GroupID: groupID, RequestedBy: requestedBy,
		Status: model.DriveExportPending, DestinationPath: destinationPath,
	}
	f.job = &job
	f.queued = append(f.queued, job)
	return job, nil
}

func TestPublishObjectKeyIsStablePerVideo(t *testing.T) {
	t.Parallel()
	videoID := uuid.MustParse("12345678-1234-1234-1234-123456789012")
	store := &fakeServiceStore{video: model.Video{
		ID: videoID, GroupID: uuid.New(), OriginalFilename: `folder/Lesson #1?.mp4`,
		ProcessingStatus: model.VideoProcessingReady,
	}}
	service := NewService(store, ServiceConfig{Enabled: true, DestinationRoot: "/published/"}, nil)
	if got, want := service.PublishObjectKey(store.video), "published/"+videoID.String()+".mp4"; got != want {
		t.Fatalf("object key = %q, want %q", got, want)
	}
}

func TestPublishIsIdempotentAndRequiresReady(t *testing.T) {
	t.Parallel()
	videoID, groupID := uuid.New(), uuid.New()
	store := &fakeServiceStore{video: model.Video{
		ID: videoID, GroupID: groupID, OriginalFilename: "lesson.mp4",
		ProcessingStatus: model.VideoProcessingReady,
	}}
	service := NewService(store, ServiceConfig{Enabled: true, DestinationRoot: "published"}, nil)

	if err := service.Publish(context.Background(), store.video, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if len(store.queued) != 1 {
		t.Fatalf("queued %d jobs, want 1", len(store.queued))
	}
	// A second Publish while pending/uploading/completed must not re-queue.
	for _, status := range []model.DriveExportStatus{
		model.DriveExportPending, model.DriveExportPreparing, model.DriveExportUploading, model.DriveExportCompleted,
	} {
		store.job.Status = status
		if err := service.Publish(context.Background(), store.video, uuid.New()); err != nil {
			t.Fatal(err)
		}
		if len(store.queued) != 1 {
			t.Fatalf("status %s re-queued (total %d)", status, len(store.queued))
		}
	}
	// A failed job may be retried.
	store.job.Status = model.DriveExportFailed
	if err := service.Publish(context.Background(), store.video, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if len(store.queued) != 2 {
		t.Fatalf("failed job did not re-queue (total %d)", len(store.queued))
	}
	// Not-ready videos are never queued.
	store.job = nil
	store.video.ProcessingStatus = model.VideoProcessingProcessing
	if err := service.Publish(context.Background(), store.video, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if len(store.queued) != 2 {
		t.Fatalf("processing video queued (total %d)", len(store.queued))
	}
}

func TestPublishDisabledIsNoop(t *testing.T) {
	t.Parallel()
	videoID, groupID := uuid.New(), uuid.New()
	store := &fakeServiceStore{video: model.Video{
		ID: videoID, GroupID: groupID, OriginalFilename: "lesson.mp4",
		ProcessingStatus: model.VideoProcessingReady,
	}}
	service := NewService(store, ServiceConfig{Enabled: false}, nil)
	if err := service.Publish(context.Background(), store.video, uuid.New()); err != nil {
		t.Fatal(err)
	}
	if len(store.queued) != 0 {
		t.Fatalf("disabled service queued %d jobs", len(store.queued))
	}
}

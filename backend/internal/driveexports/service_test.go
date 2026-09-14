package driveexports

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
)

type fakeServiceStore struct {
	video model.Video
	job   *model.DriveExport
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
	return job, nil
}

func TestQueueDriveExportBuildsStableDestination(t *testing.T) {
	t.Parallel()
	videoID := uuid.MustParse("12345678-1234-1234-1234-123456789012")
	groupID := uuid.New()
	store := &fakeServiceStore{video: model.Video{
		ID: videoID, GroupID: groupID, OriginalFilename: `folder/Lesson #1?.mp4`,
		ProcessingStatus: model.VideoProcessingReady,
	}}
	service := NewService(store, ServiceConfig{Enabled: true, DestinationRoot: "/VideoInsight/"})
	job, err := service.Queue(context.Background(), videoID, groupID, uuid.New())
	if err != nil {
		t.Fatal(err)
	}
	want := "VideoInsight/" + groupID.String() + "/Lesson _1_-12345678.vinsight"
	if job.DestinationPath != want {
		t.Fatalf("destination = %q, want %q", job.DestinationPath, want)
	}
}

func TestQueueDriveExportRejectsDisabledAndActiveJobs(t *testing.T) {
	t.Parallel()
	videoID, groupID := uuid.New(), uuid.New()
	store := &fakeServiceStore{video: model.Video{
		ID: videoID, GroupID: groupID, OriginalFilename: "lesson.mp4",
		ProcessingStatus: model.VideoProcessingReady,
	}}
	_, err := NewService(store, ServiceConfig{}).Queue(context.Background(), videoID, groupID, uuid.New())
	if appErr, ok := apperror.As(err); !ok || appErr.Code != "drive_export_disabled" {
		t.Fatalf("disabled error = %v", err)
	}

	store.job = &model.DriveExport{Status: model.DriveExportUploading}
	_, err = NewService(store, ServiceConfig{Enabled: true}).Queue(context.Background(), videoID, groupID, uuid.New())
	if appErr, ok := apperror.As(err); !ok || appErr.Code != "drive_export_in_progress" {
		t.Fatalf("active error = %v", err)
	}
}

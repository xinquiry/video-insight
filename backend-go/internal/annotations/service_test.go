package annotations

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend-go/internal/model"
	"github.com/xinquiry/video-insight/backend-go/internal/shared/optional"
)

type fakeStore struct {
	videoFound bool
	annotation model.Annotation
}

func (f *fakeStore) GetVideoByIDForGroup(context.Context, uuid.UUID, uuid.UUID) (model.Video, bool, error) {
	return model.Video{}, f.videoFound, nil
}
func (f *fakeStore) GetAnnotationByID(context.Context, uuid.UUID) (model.Annotation, bool, error) {
	return f.annotation, f.annotation.ID != uuid.Nil, nil
}
func (f *fakeStore) ListAnnotationsForVideo(context.Context, uuid.UUID) ([]model.Annotation, error) {
	return []model.Annotation{}, nil
}
func (f *fakeStore) CreateAnnotation(_ context.Context, annotation model.Annotation) (model.Annotation, error) {
	annotation.ID = uuid.New()
	f.annotation = annotation
	return annotation, nil
}
func (f *fakeStore) UpdateAnnotation(_ context.Context, annotation model.Annotation) (model.Annotation, error) {
	f.annotation = annotation
	return annotation, nil
}
func (f *fakeStore) DeleteAnnotation(context.Context, uuid.UUID) (bool, error) { return true, nil }

func TestCreateAppliesDefaults(t *testing.T) {
	t.Parallel()
	store := &fakeStore{videoFound: true}
	service := NewService(store)
	created, err := service.Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
		TimestampSeconds: 3, Title: "Point", Body: "Body", Interactive: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if created.DurationSeconds != 6 || created.Shape != "marker" || created.DisplayMode != "card" || created.Kind != "note" || created.Color != "#2563eb" {
		t.Fatalf("defaults not applied: %+v", created)
	}
}

func TestUpdateClearsNullablePosition(t *testing.T) {
	t.Parallel()
	position := 0.5
	annotationID := uuid.New()
	videoID := uuid.New()
	store := &fakeStore{videoFound: true, annotation: model.Annotation{
		ID: annotationID, VideoID: videoID, TimestampSeconds: 1, DurationSeconds: 6,
		PositionX: &position, Shape: "marker", DisplayMode: "card", Interactive: true,
		Title: "Title", Body: "Body", Kind: "note", Color: "#2563eb", CustomData: map[string]any{},
	}}
	service := NewService(store)
	_, err := service.Update(context.Background(), annotationID, uuid.New(), UpdateInput{
		PositionX: optional.Value[float64]{Set: true, Null: true},
	})
	if err != nil {
		t.Fatal(err)
	}
	if store.annotation.PositionX != nil {
		t.Fatal("position was not cleared")
	}
}

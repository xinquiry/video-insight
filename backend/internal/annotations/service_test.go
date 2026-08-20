package annotations

import (
	"context"
	"testing"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
)

type fakeStore struct {
	videoFound bool
	annotation model.Annotation
	comments   []model.AnnotationComment
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
func (f *fakeStore) ListAnnotationComments(context.Context, uuid.UUID) ([]model.AnnotationComment, error) {
	return f.comments, nil
}
func (f *fakeStore) CreateAnnotationComment(_ context.Context, comment model.AnnotationComment) (model.AnnotationComment, error) {
	comment.ID = uuid.New()
	f.comments = append(f.comments, comment)
	return comment, nil
}

func richText(text string) map[string]any {
	return map[string]any{
		"type": "doc",
		"content": []any{map[string]any{
			"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": text}},
		}},
	}
}

func TestCreateAppliesDefaults(t *testing.T) {
	t.Parallel()
	store := &fakeStore{videoFound: true}
	service := NewService(store)
	created, err := service.Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
		TimestampSeconds: 3, Content: richText("Point"), Interactive: true,
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
		Content: richText("Body"), Kind: "note", Color: "#2563eb", CustomData: map[string]any{},
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

func TestCreateAcceptsEmbeddedImage(t *testing.T) {
	t.Parallel()
	store := &fakeStore{videoFound: true}
	content := map[string]any{
		"type": "doc",
		"content": []any{map[string]any{
			"type": "image", "attrs": map[string]any{"src": "data:image/png;base64,iVBORw0KGgo="},
		}},
	}
	if _, err := NewService(store).Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
		TimestampSeconds: 3, Content: content, Interactive: true,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRejectsRemoteImage(t *testing.T) {
	t.Parallel()
	store := &fakeStore{videoFound: true}
	content := map[string]any{
		"type": "doc",
		"content": []any{map[string]any{
			"type": "image", "attrs": map[string]any{"src": "https://example.com/tracker.png"},
		}},
	}
	if _, err := NewService(store).Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
		TimestampSeconds: 3, Content: content, Interactive: true,
	}); err == nil {
		t.Fatal("expected remote image to be rejected")
	}
}

func TestCreateAcceptsStructuredRichText(t *testing.T) {
	t.Parallel()
	content := map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{
				"type": "heading", "attrs": map[string]any{"level": float64(2)},
				"content": []any{map[string]any{
					"type": "text", "text": "Heading", "marks": []any{map[string]any{"type": "underline"}},
				}},
			},
			map[string]any{
				"type": "bulletList", "content": []any{map[string]any{
					"type": "listItem", "content": []any{map[string]any{
						"type": "paragraph", "content": []any{map[string]any{
							"type": "text", "text": "Item", "marks": []any{map[string]any{
								"type": "link", "attrs": map[string]any{"href": "https://example.com"},
							}},
						}},
					}},
				}},
			},
		},
	}
	store := &fakeStore{videoFound: true}
	if _, err := NewService(store).Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
		TimestampSeconds: 3, Content: content, Interactive: true,
	}); err != nil {
		t.Fatal(err)
	}
}

func TestCreateRejectsMalformedRichText(t *testing.T) {
	t.Parallel()
	tests := map[string]map[string]any{
		"text directly under document": {
			"type": "doc", "content": []any{map[string]any{"type": "text", "text": "hello"}},
		},
		"text stored on paragraph": {
			"type": "doc", "content": []any{map[string]any{"type": "paragraph", "text": "hello"}},
		},
		"paragraph directly under list": {
			"type": "doc", "content": []any{map[string]any{
				"type": "bulletList", "content": []any{map[string]any{
					"type": "paragraph", "content": []any{map[string]any{"type": "text", "text": "hello"}},
				}},
			}},
		},
	}
	for name, content := range tests {
		content := content
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			store := &fakeStore{videoFound: true}
			_, err := NewService(store).Create(context.Background(), uuid.New(), uuid.New(), CreateInput{
				TimestampSeconds: 3, Content: content, Interactive: true,
			})
			if err == nil {
				t.Fatal("expected malformed rich text to be rejected")
			}
		})
	}
}

func TestUserCanCommentMoreThanOnce(t *testing.T) {
	t.Parallel()
	annotationID := uuid.New()
	userID := uuid.New()
	store := &fakeStore{videoFound: true, annotation: model.Annotation{
		ID: annotationID, VideoID: uuid.New(), Content: richText("Body"),
	}}
	service := NewService(store)
	for _, body := range []string{"First", "Second"} {
		if _, err := service.CreateComment(context.Background(), annotationID, uuid.New(), userID, body); err != nil {
			t.Fatal(err)
		}
	}
	if len(store.comments) != 2 || store.comments[0].UserID != userID || store.comments[1].UserID != userID {
		t.Fatalf("expected two comments from the same user: %+v", store.comments)
	}
}

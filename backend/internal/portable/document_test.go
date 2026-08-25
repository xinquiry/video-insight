package portable

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

func TestNewDocumentKeepsPortableContractSeparateFromGroupData(t *testing.T) {
	t.Parallel()
	videoID := uuid.New()
	annotationID := uuid.New()
	exportedAt := time.Date(2026, 8, 24, 12, 0, 0, 0, time.FixedZone("test", 8*60*60))
	document := NewDocument(model.Video{
		ID: videoID, GroupID: uuid.New(), Title: "Lesson", OriginalFilename: "lesson.mp4",
		ContentType: "video/mp4", SizeBytes: 42,
	}, "media/lesson.mp4", []model.Annotation{{
		ID: annotationID, VideoID: videoID, TimestampSeconds: 3.5, DurationSeconds: 6,
		Content: map[string]any{"type": "doc"}, Kind: "note", Color: "#2563eb",
	}}, exportedAt)

	if document.Format != DocumentFormat || document.FormatVersion != 1 {
		t.Fatalf("unexpected document version: %+v", document)
	}
	if document.AnnotationTrack.Format != AnnotationTrackFormat || len(document.AnnotationTrack.Annotations) != 1 {
		t.Fatalf("unexpected annotation track: %+v", document.AnnotationTrack)
	}
	if document.ExportedAt.Location() != time.UTC || document.Video.ID != videoID.String() {
		t.Fatalf("unexpected metadata: %+v", document)
	}
	if document.AnnotationTrack.Annotations[0].CustomData == nil || document.Extensions == nil {
		t.Fatal("portable maps must encode as objects, not null")
	}
}

func TestSharedV1ContractFixture(t *testing.T) {
	t.Parallel()
	data, err := os.ReadFile("../../../docs/schemas/fixtures/annotated-video-v1-rich.json")
	if err != nil {
		t.Fatal(err)
	}
	var document Document
	if err := json.Unmarshal(data, &document); err != nil {
		t.Fatal(err)
	}
	if document.Format != DocumentFormat || document.FormatVersion != DocumentFormatVersion {
		t.Fatalf("unexpected document contract: %s v%d", document.Format, document.FormatVersion)
	}
	if document.AnnotationTrack.Format != AnnotationTrackFormat || document.AnnotationTrack.FormatVersion != AnnotationTrackVersion {
		t.Fatalf("unexpected track contract: %s v%d", document.AnnotationTrack.Format, document.AnnotationTrack.FormatVersion)
	}
	content, err := json.Marshal(document.AnnotationTrack.Annotations[0].Content)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(content, []byte(AssetScheme+"assets/shared.png")) {
		t.Fatalf("fixture lost package asset reference: %s", content)
	}
}

func TestWritePackageContainsManifestAndStoredMedia(t *testing.T) {
	t.Parallel()
	document := NewDocument(model.Video{
		ID: uuid.New(), Title: "Lesson", OriginalFilename: "lesson.mp4",
		ContentType: "video/mp4", SizeBytes: 5,
	}, "media/lesson.mp4", nil, time.Now())
	var output bytes.Buffer
	if err := WritePackage(&output, Bundle{Document: document}, bytes.NewReader([]byte("video"))); err != nil {
		t.Fatal(err)
	}
	archive, err := zip.NewReader(bytes.NewReader(output.Bytes()), int64(output.Len()))
	if err != nil {
		t.Fatal(err)
	}
	entries := map[string]*zip.File{}
	for _, entry := range archive.File {
		entries[entry.Name] = entry
	}
	if entries["mimetype"] == nil || entries[ManifestPath] == nil || entries["media/lesson.mp4"] == nil {
		t.Fatalf("unexpected package entries: %+v", entries)
	}
	if entries["media/lesson.mp4"].Method != zip.Store {
		t.Fatal("compressed media wastes CPU and can increase package size")
	}
	media, err := entries["media/lesson.mp4"].Open()
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = media.Close() }()
	data, err := io.ReadAll(media)
	if err != nil || string(data) != "video" {
		t.Fatalf("media = %q, error = %v", data, err)
	}
}

func TestNewBundleExternalizesAndDeduplicatesAnnotationImages(t *testing.T) {
	t.Parallel()
	source := "data:image/png;base64,iVBORw0KGgo="
	content := map[string]any{
		"type": "doc",
		"content": []any{
			map[string]any{"type": "image", "attrs": map[string]any{"src": source}},
			map[string]any{"type": "image", "attrs": map[string]any{"src": source}},
		},
	}
	bundle, err := NewBundle(model.Video{
		ID: uuid.New(), OriginalFilename: "lesson.mp4", ContentType: "video/mp4",
	}, "media/lesson.mp4", []model.Annotation{{
		ID: uuid.New(), TimestampSeconds: 1, DurationSeconds: 1, Content: content,
	}}, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	if len(bundle.Assets) != 1 {
		t.Fatalf("assets = %d, want deduplicated image", len(bundle.Assets))
	}
	encoded, err := json.Marshal(bundle.Document.AnnotationTrack.Annotations[0].Content)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(encoded, []byte("data:image")) || !bytes.Contains(encoded, []byte(AssetScheme)) {
		t.Fatalf("content was not rewritten: %s", encoded)
	}
	if original, _ := content["content"].([]any)[0].(map[string]any)["attrs"].(map[string]any)["src"].(string); original != source {
		t.Fatal("export mutated the database model content")
	}
}

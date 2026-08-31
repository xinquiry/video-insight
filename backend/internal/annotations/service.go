package annotations

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"regexp"
	"strings"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

const (
	MaxEmbeddedImageBytes = 50 << 20
	MaxRichTextBytes      = ((MaxEmbeddedImageBytes + 2) / 3 * 4) + (1 << 20)
)

type Store interface {
	GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error)
	GetAnnotationByID(ctx context.Context, id uuid.UUID) (model.Annotation, bool, error)
	ListAnnotationsForVideo(ctx context.Context, videoID uuid.UUID) ([]model.Annotation, error)
	CreateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error)
	UpdateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error)
	DeleteAnnotation(ctx context.Context, id uuid.UUID) (bool, error)
	ListAnnotationComments(ctx context.Context, annotationID uuid.UUID) ([]model.AnnotationComment, error)
	CreateAnnotationComment(ctx context.Context, comment model.AnnotationComment) (model.AnnotationComment, error)
}

type Service struct{ store Store }

type CreateInput struct {
	TimestampSeconds float64
	DurationSeconds  float64
	PositionX        *float64
	PositionY        *float64
	RegionX          *float64
	RegionY          *float64
	RegionWidth      *float64
	RegionHeight     *float64
	Shape            string
	DisplayMode      string
	Interactive      bool
	Content          map[string]any
	Kind             string
	Color            string
	CustomData       map[string]any
}

type UpdateInput struct {
	TimestampSeconds optional.Value[float64]
	DurationSeconds  optional.Value[float64]
	PositionX        optional.Value[float64]
	PositionY        optional.Value[float64]
	RegionX          optional.Value[float64]
	RegionY          optional.Value[float64]
	RegionWidth      optional.Value[float64]
	RegionHeight     optional.Value[float64]
	Shape            optional.Value[string]
	DisplayMode      optional.Value[string]
	Interactive      optional.Value[bool]
	Content          optional.Value[map[string]any]
	Kind             optional.Value[string]
	Color            optional.Value[string]
	CustomData       optional.Value[map[string]any]
}

func NewService(store Store) *Service { return &Service{store: store} }

func DefaultCreate(input CreateInput) CreateInput {
	if input.DurationSeconds == 0 {
		input.DurationSeconds = 6
	}
	if input.Shape == "" {
		input.Shape = "marker"
	}
	if input.DisplayMode == "" {
		input.DisplayMode = "card"
	}
	if input.Kind == "" {
		input.Kind = "note"
	}
	if input.Color == "" {
		input.Color = "#2563eb"
	}
	input.CustomData = model.NormalizeJSONMap(input.CustomData)
	return input
}

func (s *Service) List(ctx context.Context, videoID, groupID uuid.UUID) ([]model.Annotation, error) {
	if err := s.ensureVideo(ctx, videoID, groupID); err != nil {
		return nil, err
	}
	return s.store.ListAnnotationsForVideo(ctx, videoID)
}

func (s *Service) Create(ctx context.Context, videoID, groupID uuid.UUID, input CreateInput) (model.Annotation, error) {
	input = DefaultCreate(input)
	if err := validateCreate(input); err != nil {
		return model.Annotation{}, err
	}
	if err := s.ensureVideo(ctx, videoID, groupID); err != nil {
		return model.Annotation{}, err
	}
	return s.store.CreateAnnotation(ctx, model.Annotation{
		VideoID: videoID, TimestampSeconds: input.TimestampSeconds, DurationSeconds: input.DurationSeconds,
		PositionX: input.PositionX, PositionY: input.PositionY, RegionX: input.RegionX, RegionY: input.RegionY,
		RegionWidth: input.RegionWidth, RegionHeight: input.RegionHeight, Shape: input.Shape,
		DisplayMode: input.DisplayMode, Interactive: input.Interactive, Content: input.Content,
		Kind: input.Kind, Color: input.Color, CustomData: input.CustomData,
	})
}

func (s *Service) ListComments(ctx context.Context, annotationID, groupID uuid.UUID) ([]model.AnnotationComment, error) {
	if _, err := s.get(ctx, annotationID, groupID); err != nil {
		return nil, err
	}
	return s.store.ListAnnotationComments(ctx, annotationID)
}

func (s *Service) CreateComment(ctx context.Context, annotationID, groupID, userID uuid.UUID, body string) (model.AnnotationComment, error) {
	if _, err := s.get(ctx, annotationID, groupID); err != nil {
		return model.AnnotationComment{}, err
	}
	body = strings.TrimSpace(body)
	if body == "" || len(body) > 2000 {
		return model.AnnotationComment{}, apperror.New(http.StatusUnprocessableEntity, "Invalid comment data")
	}
	return s.store.CreateAnnotationComment(ctx, model.AnnotationComment{
		AnnotationID: annotationID, UserID: userID, Body: body,
	})
}

func (s *Service) Update(ctx context.Context, annotationID, groupID uuid.UUID, input UpdateInput) (model.Annotation, error) {
	annotation, err := s.get(ctx, annotationID, groupID)
	if err != nil {
		return model.Annotation{}, err
	}
	if err := applyUpdate(&annotation, input); err != nil {
		return model.Annotation{}, err
	}
	return s.store.UpdateAnnotation(ctx, annotation)
}

func (s *Service) Delete(ctx context.Context, annotationID, groupID uuid.UUID) error {
	if _, err := s.get(ctx, annotationID, groupID); err != nil {
		return err
	}
	deleted, err := s.store.DeleteAnnotation(ctx, annotationID)
	if err != nil {
		return err
	}
	if !deleted {
		return apperror.New(http.StatusNotFound, "Annotation not found")
	}
	return nil
}

func (s *Service) get(ctx context.Context, annotationID, groupID uuid.UUID) (model.Annotation, error) {
	annotation, found, err := s.store.GetAnnotationByID(ctx, annotationID)
	if err != nil {
		return model.Annotation{}, err
	}
	if !found {
		return model.Annotation{}, apperror.New(http.StatusNotFound, "Annotation not found")
	}
	if err := s.ensureVideo(ctx, annotation.VideoID, groupID); err != nil {
		return model.Annotation{}, err
	}
	return annotation, nil
}

func (s *Service) ensureVideo(ctx context.Context, videoID, groupID uuid.UUID) error {
	_, found, err := s.store.GetVideoByIDForGroup(ctx, videoID, groupID)
	if err != nil {
		return err
	}
	if !found {
		return apperror.New(http.StatusNotFound, "Video not found")
	}
	return nil
}

func validateCreate(input CreateInput) error {
	if input.TimestampSeconds < 0 {
		return invalidAnnotation("annotation_timestamp_invalid", "Annotation timestamp must be zero or greater")
	}
	if input.DurationSeconds <= 0 || input.DurationSeconds > 3600 {
		return invalidAnnotation("annotation_duration_invalid", "Annotation duration must be between 0 and 3600 seconds")
	}
	if !validUnit(input.PositionX) || !validUnit(input.PositionY) || !validUnit(input.RegionX) ||
		!validUnit(input.RegionY) || !validUnit(input.RegionWidth) || !validUnit(input.RegionHeight) {
		return invalidAnnotation("annotation_geometry_invalid", "Annotation positions and regions must be between 0 and 1")
	}
	if !validText(input.Shape, 60) || !validText(input.DisplayMode, 60) || !validText(input.Kind, 60) {
		return invalidAnnotation("annotation_field_invalid", "Annotation type fields are invalid")
	}
	if !colorPattern.MatchString(input.Color) {
		return invalidAnnotation("annotation_color_invalid", "Annotation color must be a six-digit hexadecimal color")
	}
	if err := validateRichText(input.Content); err != nil {
		return err
	}
	return nil
}

func applyUpdate(annotation *model.Annotation, input UpdateInput) error {
	if input.TimestampSeconds.Set {
		if input.TimestampSeconds.Null || input.TimestampSeconds.Value < 0 {
			return invalidAnnotation("annotation_timestamp_invalid", "Annotation timestamp must be zero or greater")
		}
		annotation.TimestampSeconds = input.TimestampSeconds.Value
	}
	if input.DurationSeconds.Set {
		if input.DurationSeconds.Null || input.DurationSeconds.Value <= 0 || input.DurationSeconds.Value > 3600 {
			return invalidAnnotation("annotation_duration_invalid", "Annotation duration must be between 0 and 3600 seconds")
		}
		annotation.DurationSeconds = input.DurationSeconds.Value
	}
	for value, target := range map[*optional.Value[float64]]**float64{
		&input.PositionX: &annotation.PositionX, &input.PositionY: &annotation.PositionY,
		&input.RegionX: &annotation.RegionX, &input.RegionY: &annotation.RegionY,
		&input.RegionWidth: &annotation.RegionWidth, &input.RegionHeight: &annotation.RegionHeight,
	} {
		if value.Set {
			if value.Null {
				*target = nil
			} else if value.Value < 0 || value.Value > 1 {
				return invalidAnnotation("annotation_geometry_invalid", "Annotation positions and regions must be between 0 and 1")
			} else {
				copy := value.Value
				*target = &copy
			}
		}
	}
	if err := applyString(&annotation.Shape, input.Shape, 60, false); err != nil {
		return err
	}
	if err := applyString(&annotation.DisplayMode, input.DisplayMode, 60, false); err != nil {
		return err
	}
	if input.Interactive.Set {
		if input.Interactive.Null {
			return invalidAnnotation("annotation_field_invalid", "Annotation type fields are invalid")
		}
		annotation.Interactive = input.Interactive.Value
	}
	if input.Content.Set {
		if input.Content.Null {
			return invalidAnnotation("annotation_content_invalid", "Annotation content is invalid")
		}
		if err := validateRichText(input.Content.Value); err != nil {
			return err
		}
		annotation.Content = input.Content.Value
	}
	if err := applyString(&annotation.Kind, input.Kind, 60, false); err != nil {
		return err
	}
	if input.Color.Set {
		if input.Color.Null || !colorPattern.MatchString(input.Color.Value) {
			return invalidAnnotation("annotation_color_invalid", "Annotation color must be a six-digit hexadecimal color")
		}
		annotation.Color = input.Color.Value
	}
	if input.CustomData.Set {
		if input.CustomData.Null {
			return invalidAnnotation("annotation_custom_data_invalid", "Annotation custom data must be an object")
		}
		annotation.CustomData = model.NormalizeJSONMap(input.CustomData.Value)
	}
	return nil
}

func applyString(target *string, value optional.Value[string], maxLength int, allowEmpty bool) error {
	if !value.Set {
		return nil
	}
	if value.Null || (!allowEmpty && value.Value == "") || (maxLength > 0 && len(value.Value) > maxLength) {
		return invalidAnnotation("annotation_field_invalid", "Annotation type fields are invalid")
	}
	*target = value.Value
	return nil
}

func validUnit(value *float64) bool              { return value == nil || (*value >= 0 && *value <= 1) }
func validText(value string, maxLength int) bool { return value != "" && len(value) <= maxLength }

func validateRichText(value map[string]any) error {
	if value == nil || value["type"] != "doc" {
		return invalidAnnotation("annotation_content_invalid", "Annotation content must be a rich-text document")
	}
	content, ok := value["content"].([]any)
	if !ok || len(content) == 0 {
		return invalidAnnotation("annotation_content_invalid", "Annotation content cannot be empty")
	}
	encoded, err := json.Marshal(value)
	if err != nil {
		return invalidAnnotation("annotation_content_invalid", "Annotation content is invalid")
	}
	if len(encoded) > MaxRichTextBytes {
		return invalidAnnotation("annotation_content_too_large", "Annotation content is too large")
	}
	if err := validateEmbeddedImages(content); err != nil {
		return err
	}
	if !validDocumentNodes(content) || !richTextHasContent(content) {
		return invalidAnnotation("annotation_content_invalid", "Annotation content contains unsupported or malformed formatting")
	}
	return nil
}

func validDocumentNodes(nodes []any) bool {
	for _, raw := range nodes {
		node, ok := richTextNode(raw)
		if !ok || !validBlockNode(node) {
			return false
		}
	}
	return true
}

func validBlockNode(node map[string]any) bool {
	typeName, ok := node["type"].(string)
	if !ok || node["text"] != nil || node["marks"] != nil {
		return false
	}
	switch typeName {
	case "paragraph":
		return validInlineContent(node)
	case "heading":
		attrs, ok := node["attrs"].(map[string]any)
		return ok && validHeadingLevel(attrs["level"]) && validInlineContent(node)
	case "bulletList", "orderedList":
		children, ok := richTextChildren(node)
		if !ok || len(children) == 0 {
			return false
		}
		for _, raw := range children {
			child, ok := richTextNode(raw)
			if !ok || child["type"] != "listItem" || !validListItem(child) {
				return false
			}
		}
		return true
	case "listItem":
		return false
	case "blockquote":
		children, ok := richTextChildren(node)
		return ok && len(children) > 0 && validDocumentNodes(children)
	case "codeBlock":
		children, ok := richTextChildren(node)
		if !ok {
			return false
		}
		for _, raw := range children {
			child, ok := richTextNode(raw)
			if !ok || !validTextNode(child, false) {
				return false
			}
		}
		return true
	case "horizontalRule":
		return validLeafNode(node)
	case "image":
		attrs, ok := node["attrs"].(map[string]any)
		src, srcOK := attrs["src"].(string)
		return ok && srcOK && src != "" && validLeafNode(node)
	default:
		return false
	}
}

func validListItem(node map[string]any) bool {
	if node["text"] != nil || node["marks"] != nil {
		return false
	}
	children, ok := richTextChildren(node)
	if !ok || len(children) == 0 {
		return false
	}
	first, ok := richTextNode(children[0])
	if !ok || first["type"] != "paragraph" || !validBlockNode(first) {
		return false
	}
	for _, raw := range children[1:] {
		child, ok := richTextNode(raw)
		if !ok || !validBlockNode(child) {
			return false
		}
	}
	return true
}

func validInlineContent(node map[string]any) bool {
	children, ok := richTextChildren(node)
	if !ok {
		return false
	}
	for _, raw := range children {
		child, ok := richTextNode(raw)
		if !ok {
			return false
		}
		switch child["type"] {
		case "text":
			if !validTextNode(child, true) {
				return false
			}
		case "hardBreak":
			if !validLeafNode(child) {
				return false
			}
		default:
			return false
		}
	}
	return true
}

func validTextNode(node map[string]any, allowMarks bool) bool {
	text, ok := node["text"].(string)
	if node["type"] != "text" || !ok || text == "" {
		return false
	}
	if children, exists := node["content"]; exists {
		values, ok := children.([]any)
		if !ok || len(values) != 0 {
			return false
		}
	}
	if !allowMarks {
		_, hasMarks := node["marks"]
		return !hasMarks
	}
	return validRichTextMarks(node["marks"])
}

func validRichTextMarks(raw any) bool {
	if raw == nil {
		return true
	}
	marks, ok := raw.([]any)
	if !ok {
		return false
	}
	allowed := map[string]bool{
		"bold": true, "italic": true, "strike": true, "code": true, "link": true, "underline": true,
	}
	seen := make(map[string]bool, len(marks))
	for _, rawMark := range marks {
		mark, ok := rawMark.(map[string]any)
		markType, typeOK := mark["type"].(string)
		if !ok || !typeOK || !allowed[markType] || seen[markType] {
			return false
		}
		seen[markType] = true
		if markType == "link" {
			attrs, attrsOK := mark["attrs"].(map[string]any)
			href, hrefOK := attrs["href"].(string)
			if !attrsOK || !hrefOK || !validLink(href) {
				return false
			}
		}
	}
	return true
}

func richTextNode(raw any) (map[string]any, bool) {
	node, ok := raw.(map[string]any)
	return node, ok
}

func richTextChildren(node map[string]any) ([]any, bool) {
	raw, exists := node["content"]
	if !exists {
		return nil, true
	}
	children, ok := raw.([]any)
	return children, ok
}

func validLeafNode(node map[string]any) bool {
	if node["text"] != nil || node["marks"] != nil {
		return false
	}
	children, ok := richTextChildren(node)
	return ok && len(children) == 0
}

func validHeadingLevel(value any) bool {
	switch level := value.(type) {
	case float64:
		return level >= 1 && level <= 6 && level == float64(int(level))
	case int:
		return level >= 1 && level <= 6
	default:
		return false
	}
}

func richTextHasContent(nodes []any) bool {
	for _, raw := range nodes {
		node, _ := raw.(map[string]any)
		if node["type"] == "image" {
			return true
		}
		if text, ok := node["text"].(string); ok && strings.TrimSpace(text) != "" {
			return true
		}
		if children, ok := node["content"].([]any); ok && richTextHasContent(children) {
			return true
		}
	}
	return false
}

func validLink(value string) bool {
	return strings.HasPrefix(value, "https://") || strings.HasPrefix(value, "http://") || strings.HasPrefix(value, "mailto:")
}

func validateEmbeddedImages(nodes []any) error {
	for _, raw := range nodes {
		node, ok := richTextNode(raw)
		if !ok {
			continue
		}
		if node["type"] == "image" {
			attrs, attrsOK := node["attrs"].(map[string]any)
			src, srcOK := attrs["src"].(string)
			if !attrsOK || !srcOK {
				return invalidAnnotation("annotation_image_invalid", "Embedded image data is invalid")
			}
			if err := validateImageDataURL(src); err != nil {
				return err
			}
		}
		if children, ok := node["content"].([]any); ok {
			if err := validateEmbeddedImages(children); err != nil {
				return err
			}
		}
	}
	return nil
}

func validateImageDataURL(value string) error {
	checks := map[string]func([]byte) bool{
		"data:image/png;base64,":  func(data []byte) bool { return bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n")) },
		"data:image/jpeg;base64,": func(data []byte) bool { return bytes.HasPrefix(data, []byte("\xff\xd8\xff")) },
		"data:image/gif;base64,": func(data []byte) bool {
			return bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))
		},
		"data:image/webp;base64,": func(data []byte) bool {
			return len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
		},
	}
	for prefix, validSignature := range checks {
		if !strings.HasPrefix(value, prefix) {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(value, prefix))
		if err != nil {
			return invalidAnnotation("annotation_image_invalid", "Embedded image data is not valid base64")
		}
		if len(decoded) > MaxEmbeddedImageBytes {
			return invalidAnnotation("annotation_image_too_large", "Embedded images must be 50 MiB or smaller")
		}
		if !validSignature(decoded) {
			return invalidAnnotation("annotation_image_invalid", "Embedded image type does not match its file data")
		}
		return nil
	}
	if strings.HasPrefix(value, "data:image/") {
		return invalidAnnotation("annotation_image_type_unsupported", "Embedded images must be PNG, JPEG, GIF, or WebP")
	}
	return invalidAnnotation("annotation_image_source_invalid", "Embedded images must use an inline data URL")
}

func invalidAnnotation(code, detail string) error {
	return apperror.NewCode(http.StatusUnprocessableEntity, code, detail)
}

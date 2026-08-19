package annotations

import (
	"context"
	"net/http"
	"regexp"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
)

var colorPattern = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)

type Store interface {
	GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error)
	GetAnnotationByID(ctx context.Context, id uuid.UUID) (model.Annotation, bool, error)
	ListAnnotationsForVideo(ctx context.Context, videoID uuid.UUID) ([]model.Annotation, error)
	CreateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error)
	UpdateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error)
	DeleteAnnotation(ctx context.Context, id uuid.UUID) (bool, error)
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
	Title            string
	Body             string
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
	Title            optional.Value[string]
	Body             optional.Value[string]
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
		DisplayMode: input.DisplayMode, Interactive: input.Interactive, Title: input.Title, Body: input.Body,
		Kind: input.Kind, Color: input.Color, CustomData: input.CustomData,
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
	if input.TimestampSeconds < 0 || input.DurationSeconds <= 0 || input.DurationSeconds > 3600 ||
		!validUnit(input.PositionX) || !validUnit(input.PositionY) || !validUnit(input.RegionX) ||
		!validUnit(input.RegionY) || !validUnit(input.RegionWidth) || !validUnit(input.RegionHeight) ||
		!validText(input.Shape, 60) || !validText(input.DisplayMode, 60) || !validText(input.Title, 200) ||
		input.Body == "" || !validText(input.Kind, 60) || !colorPattern.MatchString(input.Color) {
		return apperror.New(http.StatusUnprocessableEntity, "Invalid annotation data")
	}
	return nil
}

func applyUpdate(annotation *model.Annotation, input UpdateInput) error {
	if input.TimestampSeconds.Set {
		if input.TimestampSeconds.Null || input.TimestampSeconds.Value < 0 {
			return invalidUpdate()
		}
		annotation.TimestampSeconds = input.TimestampSeconds.Value
	}
	if input.DurationSeconds.Set {
		if input.DurationSeconds.Null || input.DurationSeconds.Value <= 0 || input.DurationSeconds.Value > 3600 {
			return invalidUpdate()
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
				return invalidUpdate()
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
			return invalidUpdate()
		}
		annotation.Interactive = input.Interactive.Value
	}
	if err := applyString(&annotation.Title, input.Title, 200, false); err != nil {
		return err
	}
	if err := applyString(&annotation.Body, input.Body, 0, false); err != nil {
		return err
	}
	if err := applyString(&annotation.Kind, input.Kind, 60, false); err != nil {
		return err
	}
	if input.Color.Set {
		if input.Color.Null || !colorPattern.MatchString(input.Color.Value) {
			return invalidUpdate()
		}
		annotation.Color = input.Color.Value
	}
	if input.CustomData.Set {
		if input.CustomData.Null {
			return invalidUpdate()
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
		return invalidUpdate()
	}
	*target = value.Value
	return nil
}

func validUnit(value *float64) bool              { return value == nil || (*value >= 0 && *value <= 1) }
func validText(value string, maxLength int) bool { return value != "" && len(value) <= maxLength }
func invalidUpdate() error {
	return apperror.New(http.StatusUnprocessableEntity, "Invalid annotation data")
}

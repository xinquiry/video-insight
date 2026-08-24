package httpapi

import (
	"time"

	"github.com/xinquiry/video-insight/backend/internal/annotations"
	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

type detailResponse struct {
	Detail string `json:"detail"`
}

type healthResponse struct {
	Status string `json:"status"`
}

type userResponse struct {
	ID        string `json:"id"`
	GroupID   string `json:"group_id"`
	Username  string `json:"username"`
	IsAdmin   bool   `json:"is_admin"`
	CreatedAt string `json:"created_at"`
}

type tokenResponse struct {
	AccessToken string       `json:"access_token"`
	TokenType   string       `json:"token_type"`
	User        userResponse `json:"user"`
}

type groupResponse struct {
	ID        string `json:"id"`
	Name      string `json:"name"`
	CreatedAt string `json:"created_at"`
}

type videoResponse struct {
	ID               string  `json:"id"`
	GroupID          string  `json:"group_id"`
	Title            string  `json:"title"`
	Description      *string `json:"description"`
	OriginalFilename string  `json:"original_filename"`
	ContentType      string  `json:"content_type"`
	SizeBytes        int64   `json:"size_bytes"`
	PlaybackURL      *string `json:"playback_url"`
	ProcessingStatus string  `json:"processing_status"`
	ProcessingError  *string `json:"processing_error"`
	CreatedAt        string  `json:"created_at"`
	UpdatedAt        *string `json:"updated_at"`
}

type annotationResponse struct {
	ID               string         `json:"id"`
	VideoID          string         `json:"video_id"`
	TimestampSeconds float64        `json:"timestamp_seconds"`
	DurationSeconds  float64        `json:"duration_seconds"`
	PositionX        *float64       `json:"position_x"`
	PositionY        *float64       `json:"position_y"`
	RegionX          *float64       `json:"region_x"`
	RegionY          *float64       `json:"region_y"`
	RegionWidth      *float64       `json:"region_width"`
	RegionHeight     *float64       `json:"region_height"`
	Shape            string         `json:"shape"`
	DisplayMode      string         `json:"display_mode"`
	Interactive      bool           `json:"interactive"`
	Content          map[string]any `json:"content"`
	Kind             string         `json:"kind"`
	Color            string         `json:"color"`
	CustomData       map[string]any `json:"custom_data"`
	CreatedAt        string         `json:"created_at"`
	UpdatedAt        *string        `json:"updated_at"`
}

type annotationCommentResponse struct {
	ID             string  `json:"id"`
	AnnotationID   string  `json:"annotation_id"`
	UserID         string  `json:"user_id"`
	AuthorUsername string  `json:"author_username"`
	Body           string  `json:"body"`
	CreatedAt      string  `json:"created_at"`
	UpdatedAt      *string `json:"updated_at"`
}

type paginatedVideosResponse struct {
	Items    []videoResponse `json:"items"`
	Total    int64           `json:"total"`
	Page     int             `json:"page"`
	PageSize int             `json:"page_size"`
}

type uploadInitResponse struct {
	ObjectKey   string                  `json:"object_key"`
	UploadID    string                  `json:"upload_id"`
	PartSize    int64                   `json:"part_size"`
	Parts       []uploadPartURLResponse `json:"parts"`
	ExpiresIn   int                     `json:"expires_in"`
	Concurrency int                     `json:"concurrency"`
}

type uploadPartURLResponse struct {
	PartNumber int    `json:"part_number"`
	URL        string `json:"url"`
}

type loginRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
}

type createUserRequest struct {
	Username string `json:"username"`
	Password string `json:"password"`
	GroupID  string `json:"group_id"`
}

type createGroupRequest struct {
	Name string `json:"name"`
}

type initUploadRequest struct {
	Filename    string `json:"filename"`
	ContentType string `json:"content_type"`
	SizeBytes   int64  `json:"size_bytes"`
}

type abortUploadRequest struct {
	ObjectKey string `json:"object_key"`
	UploadID  string `json:"upload_id"`
}

type completeUploadRequest struct {
	ObjectKey   string                 `json:"object_key"`
	UploadID    string                 `json:"upload_id"`
	Title       string                 `json:"title"`
	Description *string                `json:"description"`
	Filename    string                 `json:"filename"`
	ContentType string                 `json:"content_type"`
	SizeBytes   int64                  `json:"size_bytes"`
	Parts       []completedPartRequest `json:"parts"`
}

type completedPartRequest struct {
	PartNumber int    `json:"part_number"`
	ETag       string `json:"etag"`
}

type updateVideoRequest struct {
	Title       optional.Value[string] `json:"title"`
	Description optional.Value[string] `json:"description"`
}

type createAnnotationRequest struct {
	TimestampSeconds *float64       `json:"timestamp_seconds"`
	DurationSeconds  *float64       `json:"duration_seconds"`
	PositionX        *float64       `json:"position_x"`
	PositionY        *float64       `json:"position_y"`
	RegionX          *float64       `json:"region_x"`
	RegionY          *float64       `json:"region_y"`
	RegionWidth      *float64       `json:"region_width"`
	RegionHeight     *float64       `json:"region_height"`
	Shape            *string        `json:"shape"`
	DisplayMode      *string        `json:"display_mode"`
	Interactive      *bool          `json:"interactive"`
	Content          map[string]any `json:"content"`
	Kind             *string        `json:"kind"`
	Color            *string        `json:"color"`
	CustomData       map[string]any `json:"custom_data"`
}

type updateAnnotationRequest struct {
	TimestampSeconds optional.Value[float64]        `json:"timestamp_seconds"`
	DurationSeconds  optional.Value[float64]        `json:"duration_seconds"`
	PositionX        optional.Value[float64]        `json:"position_x"`
	PositionY        optional.Value[float64]        `json:"position_y"`
	RegionX          optional.Value[float64]        `json:"region_x"`
	RegionY          optional.Value[float64]        `json:"region_y"`
	RegionWidth      optional.Value[float64]        `json:"region_width"`
	RegionHeight     optional.Value[float64]        `json:"region_height"`
	Shape            optional.Value[string]         `json:"shape"`
	DisplayMode      optional.Value[string]         `json:"display_mode"`
	Interactive      optional.Value[bool]           `json:"interactive"`
	Content          optional.Value[map[string]any] `json:"content"`
	Kind             optional.Value[string]         `json:"kind"`
	Color            optional.Value[string]         `json:"color"`
	CustomData       optional.Value[map[string]any] `json:"custom_data"`
}

type createAnnotationCommentRequest struct {
	Body string `json:"body"`
}

func userDTO(user model.User) userResponse {
	return userResponse{ID: user.ID.String(), GroupID: user.GroupID.String(), Username: user.Username, IsAdmin: user.IsAdmin, CreatedAt: formatTime(user.CreatedAt)}
}

func groupDTO(group model.Group) groupResponse {
	return groupResponse{ID: group.ID.String(), Name: group.Name, CreatedAt: formatTime(group.CreatedAt)}
}

func videoDTO(read videos.Read) videoResponse {
	return videoResponse{
		ID: read.Video.ID.String(), GroupID: read.Video.GroupID.String(), Title: read.Video.Title,
		Description: read.Video.Description, OriginalFilename: read.Video.OriginalFilename,
		ContentType: read.Video.ContentType, SizeBytes: read.Video.SizeBytes, PlaybackURL: read.PlaybackURL,
		ProcessingStatus: string(read.Video.ProcessingStatus), ProcessingError: read.Video.ProcessingError,
		CreatedAt: formatTime(read.Video.CreatedAt), UpdatedAt: formatOptionalTime(read.Video.UpdatedAt),
	}
}

func annotationDTO(annotation model.Annotation) annotationResponse {
	return annotationResponse{
		ID: annotation.ID.String(), VideoID: annotation.VideoID.String(), TimestampSeconds: annotation.TimestampSeconds,
		DurationSeconds: annotation.DurationSeconds, PositionX: annotation.PositionX, PositionY: annotation.PositionY,
		RegionX: annotation.RegionX, RegionY: annotation.RegionY, RegionWidth: annotation.RegionWidth,
		RegionHeight: annotation.RegionHeight, Shape: annotation.Shape, DisplayMode: annotation.DisplayMode,
		Interactive: annotation.Interactive, Content: annotation.Content, Kind: annotation.Kind,
		Color: annotation.Color, CustomData: model.NormalizeJSONMap(annotation.CustomData),
		CreatedAt: formatTime(annotation.CreatedAt), UpdatedAt: formatOptionalTime(annotation.UpdatedAt),
	}
}

func annotationCommentDTO(comment model.AnnotationComment) annotationCommentResponse {
	return annotationCommentResponse{
		ID: comment.ID.String(), AnnotationID: comment.AnnotationID.String(), UserID: comment.UserID.String(),
		AuthorUsername: comment.AuthorUsername, Body: comment.Body, CreatedAt: formatTime(comment.CreatedAt),
		UpdatedAt: formatOptionalTime(comment.UpdatedAt),
	}
}

func annotationCreateInput(request createAnnotationRequest) (annotations.CreateInput, bool) {
	if request.TimestampSeconds == nil {
		return annotations.CreateInput{}, false
	}
	duration := 6.0
	if request.DurationSeconds != nil {
		duration = *request.DurationSeconds
	}
	shape := "marker"
	if request.Shape != nil {
		shape = *request.Shape
	}
	displayMode := "card"
	if request.DisplayMode != nil {
		displayMode = *request.DisplayMode
	}
	interactive := true
	if request.Interactive != nil {
		interactive = *request.Interactive
	}
	kind := "note"
	if request.Kind != nil {
		kind = *request.Kind
	}
	color := "#2563eb"
	if request.Color != nil {
		color = *request.Color
	}
	return annotations.CreateInput{
		TimestampSeconds: *request.TimestampSeconds, DurationSeconds: duration,
		PositionX: request.PositionX, PositionY: request.PositionY, RegionX: request.RegionX,
		RegionY: request.RegionY, RegionWidth: request.RegionWidth, RegionHeight: request.RegionHeight,
		Shape: shape, DisplayMode: displayMode, Interactive: interactive, Content: request.Content,
		Kind: kind, Color: color, CustomData: request.CustomData,
	}, true
}

func formatTime(value time.Time) string { return value.Format("2006-01-02T15:04:05.999999") }

func formatOptionalTime(value *time.Time) *string {
	if value == nil {
		return nil
	}
	formatted := formatTime(*value)
	return &formatted
}

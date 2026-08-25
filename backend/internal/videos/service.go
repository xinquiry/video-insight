package videos

import (
	"context"
	"fmt"
	"io"
	"math"
	"net/http"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/shared/optional"
)

type Store interface {
	GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error)
	ListVideosForGroup(ctx context.Context, groupID uuid.UUID, offset, limit int) ([]model.Video, int64, error)
	CreateVideo(ctx context.Context, video model.Video) (model.Video, error)
	UpdateVideo(ctx context.Context, video model.Video) (model.Video, error)
	DeleteVideo(ctx context.Context, videoID, groupID uuid.UUID) (bool, error)
}

type Storage interface {
	CreateMultipartUpload(ctx context.Context, objectKey, contentType string) (string, error)
	PresignUploadPart(ctx context.Context, objectKey, uploadID string, partNumber int, expires time.Duration) (string, error)
	CompleteMultipartUpload(ctx context.Context, objectKey, uploadID string, parts []CompletedPart) error
	AbortMultipartUpload(ctx context.Context, objectKey, uploadID string) error
	PresignGet(ctx context.Context, objectKey string, expires time.Duration) (string, error)
	OpenObject(ctx context.Context, objectKey string) (io.ReadCloser, error)
	DeleteObject(ctx context.Context, objectKey string) error
}

type Config struct {
	PartSize          int64
	MaxParts          int
	URLTTL            time.Duration
	Concurrency       int
	ProcessingEnabled bool
}

type Service struct {
	store   Store
	storage Storage
	config  Config
}

type UploadInit struct {
	ObjectKey   string
	UploadID    string
	PartSize    int64
	Parts       []UploadPart
	ExpiresIn   int
	Concurrency int
}

type UploadPart struct {
	PartNumber int
	URL        string
}

type CompletedPart struct {
	PartNumber int
	ETag       string
}

type CompleteInput struct {
	ObjectKey   string
	UploadID    string
	Title       string
	Description *string
	Filename    string
	ContentType string
	SizeBytes   int64
	Parts       []CompletedPart
}

type UpdateInput struct {
	Title       optional.Value[string]
	Description optional.Value[string]
}

type Read struct {
	Video       model.Video
	PlaybackURL *string
}

type Export struct {
	Video    model.Video
	Filename string
	Media    io.ReadCloser
}

func NewService(store Store, storage Storage, config Config) *Service {
	return &Service{store: store, storage: storage, config: config}
}

func (s *Service) InitUpload(ctx context.Context, filename, contentType string, sizeBytes int64) (UploadInit, error) {
	if filename == "" || len(filename) > 512 || sizeBytes <= 0 {
		return UploadInit{}, apperror.New(http.StatusUnprocessableEntity, "Invalid upload data")
	}
	if !strings.HasPrefix(contentType, "video/") {
		return UploadInit{}, apperror.New(http.StatusBadRequest, "Uploaded file must be a video")
	}
	partCount := max(1, int(math.Ceil(float64(sizeBytes)/float64(s.config.PartSize))))
	if partCount > s.config.MaxParts {
		return UploadInit{}, apperror.New(http.StatusRequestEntityTooLarge, fmt.Sprintf("File would require %d parts (limit %d)", partCount, s.config.MaxParts))
	}
	safeName := strings.ReplaceAll(filename, "/", "_")
	objectKey := fmt.Sprintf("videos/%s-%s", uuid.New(), safeName)
	uploadID, err := s.storage.CreateMultipartUpload(ctx, objectKey, contentType)
	if err != nil {
		return UploadInit{}, err
	}
	parts := make([]UploadPart, 0, partCount)
	for number := 1; number <= partCount; number++ {
		url, err := s.storage.PresignUploadPart(ctx, objectKey, uploadID, number, s.config.URLTTL)
		if err != nil {
			_ = s.storage.AbortMultipartUpload(ctx, objectKey, uploadID)
			return UploadInit{}, err
		}
		parts = append(parts, UploadPart{PartNumber: number, URL: url})
	}
	return UploadInit{
		ObjectKey: objectKey, UploadID: uploadID, PartSize: s.config.PartSize,
		Parts: parts, ExpiresIn: int(s.config.URLTTL.Seconds()), Concurrency: max(1, s.config.Concurrency),
	}, nil
}

func (s *Service) CompleteUpload(ctx context.Context, input CompleteInput, groupID uuid.UUID) (Read, error) {
	if !strings.HasPrefix(input.ContentType, "video/") {
		return Read{}, apperror.New(http.StatusBadRequest, "Uploaded file must be a video")
	}
	if !strings.HasPrefix(input.ObjectKey, "videos/") {
		return Read{}, apperror.New(http.StatusBadRequest, "Invalid object key")
	}
	if input.UploadID == "" || input.Title == "" || len(input.Title) > 200 || input.Filename == "" || input.SizeBytes <= 0 || len(input.Parts) == 0 {
		return Read{}, apperror.New(http.StatusUnprocessableEntity, "Invalid upload data")
	}
	parts := append([]CompletedPart(nil), input.Parts...)
	sort.Slice(parts, func(i, j int) bool { return parts[i].PartNumber < parts[j].PartNumber })
	if err := s.storage.CompleteMultipartUpload(ctx, input.ObjectKey, input.UploadID, parts); err != nil {
		return Read{}, apperror.Wrap(http.StatusBadRequest, "Failed to finalize upload", err)
	}
	processingStatus := model.VideoProcessingReady
	if s.config.ProcessingEnabled {
		processingStatus = model.VideoProcessingPending
	}
	video, err := s.store.CreateVideo(ctx, model.Video{
		GroupID: groupID, Title: input.Title, Description: input.Description,
		ObjectKey: input.ObjectKey, OriginalFilename: input.Filename,
		ContentType: input.ContentType, SizeBytes: input.SizeBytes,
		ProcessingStatus: processingStatus,
	})
	if err != nil {
		_ = s.storage.DeleteObject(ctx, input.ObjectKey)
		return Read{}, err
	}
	return s.read(ctx, video)
}

func (s *Service) AbortUpload(ctx context.Context, objectKey, uploadID string) error {
	if !strings.HasPrefix(objectKey, "videos/") {
		return apperror.New(http.StatusBadRequest, "Invalid object key")
	}
	_ = s.storage.AbortMultipartUpload(ctx, objectKey, uploadID)
	return nil
}

func (s *Service) Get(ctx context.Context, videoID, groupID uuid.UUID) (Read, error) {
	video, err := s.get(ctx, videoID, groupID)
	if err != nil {
		return Read{}, err
	}
	return s.read(ctx, video)
}

func (s *Service) OpenExport(ctx context.Context, videoID, groupID uuid.UUID) (Export, error) {
	video, err := s.get(ctx, videoID, groupID)
	if err != nil {
		return Export{}, err
	}
	if video.ProcessingStatus != model.VideoProcessingReady {
		return Export{}, apperror.New(http.StatusConflict, "Video is not ready for export")
	}
	filename := safeExportFilename(video.OriginalFilename, video.ID)
	media, err := s.storage.OpenObject(ctx, video.ObjectKey)
	if err != nil {
		return Export{}, err
	}
	return Export{Video: video, Filename: filename, Media: media}, nil
}

func (s *Service) List(ctx context.Context, groupID uuid.UUID, page, pageSize int) ([]Read, int64, error) {
	if page < 1 || pageSize < 1 || pageSize > 100 {
		return nil, 0, apperror.New(http.StatusUnprocessableEntity, "Invalid pagination")
	}
	videos, total, err := s.store.ListVideosForGroup(ctx, groupID, (page-1)*pageSize, pageSize)
	if err != nil {
		return nil, 0, err
	}
	result := make([]Read, 0, len(videos))
	for _, video := range videos {
		item, err := s.read(ctx, video)
		if err != nil {
			return nil, 0, err
		}
		result = append(result, item)
	}
	return result, total, nil
}

func (s *Service) Update(ctx context.Context, videoID, groupID uuid.UUID, input UpdateInput) (Read, error) {
	video, err := s.get(ctx, videoID, groupID)
	if err != nil {
		return Read{}, err
	}
	if input.Title.Set {
		if input.Title.Null || input.Title.Value == "" || len(input.Title.Value) > 200 {
			return Read{}, apperror.New(http.StatusUnprocessableEntity, "Invalid video title")
		}
		video.Title = input.Title.Value
	}
	if input.Description.Set {
		if input.Description.Null {
			video.Description = nil
		} else {
			video.Description = &input.Description.Value
		}
	}
	video, err = s.store.UpdateVideo(ctx, video)
	if err != nil {
		return Read{}, err
	}
	return s.read(ctx, video)
}

func (s *Service) Delete(ctx context.Context, videoID, groupID uuid.UUID) error {
	video, err := s.get(ctx, videoID, groupID)
	if err != nil {
		return err
	}
	if video.ProcessingStatus == model.VideoProcessingProcessing {
		return apperror.New(http.StatusConflict, "Video is currently being processed")
	}
	deleted, err := s.store.DeleteVideo(ctx, videoID, groupID)
	if err != nil {
		return err
	}
	if !deleted {
		current, found, getErr := s.store.GetVideoByIDForGroup(ctx, videoID, groupID)
		if getErr != nil {
			return getErr
		}
		if found && current.ProcessingStatus == model.VideoProcessingProcessing {
			return apperror.New(http.StatusConflict, "Video is currently being processed")
		}
		return apperror.New(http.StatusNotFound, "Video not found")
	}
	return s.storage.DeleteObject(ctx, video.ObjectKey)
}

func (s *Service) get(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, error) {
	video, found, err := s.store.GetVideoByIDForGroup(ctx, videoID, groupID)
	if err != nil {
		return model.Video{}, err
	}
	if !found {
		return model.Video{}, apperror.New(http.StatusNotFound, "Video not found")
	}
	return video, nil
}

func (s *Service) read(ctx context.Context, video model.Video) (Read, error) {
	if video.ProcessingStatus != model.VideoProcessingReady {
		return Read{Video: video}, nil
	}
	url, err := s.storage.PresignGet(ctx, video.ObjectKey, 2*time.Hour)
	if err != nil {
		return Read{}, err
	}
	return Read{Video: video, PlaybackURL: &url}, nil
}

func safeExportFilename(filename string, videoID uuid.UUID) string {
	filename = strings.ReplaceAll(filename, "\\", "/")
	parts := strings.Split(filename, "/")
	filename = parts[len(parts)-1]
	filename = strings.Map(func(char rune) rune {
		if char < 0x20 || char == 0x7f {
			return -1
		}
		if strings.ContainsRune(`<>:"|?*`, char) {
			return '_'
		}
		return char
	}, filename)
	filename = strings.TrimRight(strings.TrimSpace(filename), ". ")
	if filename == "" || filename == "." || filename == ".." {
		return "video-" + videoID.String() + ".mp4"
	}
	extension := path.Ext(filename)
	stem := strings.TrimSuffix(filename, extension)
	upperStem := strings.ToUpper(stem)
	reserved := upperStem == "CON" || upperStem == "PRN" || upperStem == "AUX" || upperStem == "NUL" ||
		(len(upperStem) == 4 && (strings.HasPrefix(upperStem, "COM") || strings.HasPrefix(upperStem, "LPT")) && upperStem[3] >= '1' && upperStem[3] <= '9')
	if reserved {
		filename = "_" + filename
	}
	return truncateUTF8(filename, 240)
}

func truncateUTF8(value string, maximumBytes int) string {
	if len(value) <= maximumBytes {
		return value
	}
	end := 0
	for index := range value {
		if index > maximumBytes {
			break
		}
		end = index
	}
	if end == 0 {
		return ""
	}
	return value[:end]
}

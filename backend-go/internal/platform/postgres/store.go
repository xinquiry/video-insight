package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/xinquiry/video-insight/backend-go/internal/model"
	"github.com/xinquiry/video-insight/backend-go/internal/platform/postgres/db"
	"github.com/xinquiry/video-insight/backend-go/internal/shared/storeerr"
)

type Store struct {
	pool    *pgxpool.Pool
	queries *db.Queries
}

func Open(ctx context.Context, databaseURL string) (*Store, error) {
	config, err := pgxpool.ParseConfig(databaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse database config: %w", err)
	}
	config.ConnConfig.RuntimeParams["timezone"] = "UTC"
	pool, err := pgxpool.NewWithConfig(ctx, config)
	if err != nil {
		return nil, fmt.Errorf("create database pool: %w", err)
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return &Store{pool: pool, queries: db.New(pool)}, nil
}

func (s *Store) Close() { s.pool.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.pool.Ping(ctx) }

func (s *Store) GetUserByID(ctx context.Context, id uuid.UUID) (model.User, bool, error) {
	value, err := s.queries.GetUserByID(ctx, id)
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.User{}, ok, foundErr
	}
	return userModel(value), true, nil
}

func (s *Store) GetUserByUsername(ctx context.Context, username string) (model.User, bool, error) {
	value, err := s.queries.GetUserByUsername(ctx, username)
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.User{}, ok, foundErr
	}
	return userModel(value), true, nil
}

func (s *Store) CreateUser(ctx context.Context, user model.User) (model.User, error) {
	value, err := s.queries.CreateUser(ctx, db.CreateUserParams{
		Username: user.Username, PasswordHash: user.PasswordHash, GroupID: user.GroupID, IsAdmin: user.IsAdmin,
	})
	return userModel(value), mapConflict(err)
}

func (s *Store) UpdateUser(ctx context.Context, user model.User) (model.User, error) {
	value, err := s.queries.UpdateUser(ctx, db.UpdateUserParams{
		ID: user.ID, PasswordHash: user.PasswordHash, GroupID: user.GroupID, IsAdmin: user.IsAdmin,
	})
	return userModel(value), err
}

func (s *Store) GetGroupByID(ctx context.Context, id uuid.UUID) (model.Group, bool, error) {
	value, err := s.queries.GetGroupByID(ctx, id)
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.Group{}, ok, foundErr
	}
	return groupModel(value), true, nil
}

func (s *Store) GetGroupByName(ctx context.Context, name string) (model.Group, bool, error) {
	value, err := s.queries.GetGroupByName(ctx, name)
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.Group{}, ok, foundErr
	}
	return groupModel(value), true, nil
}

func (s *Store) ListGroups(ctx context.Context) ([]model.Group, error) {
	values, err := s.queries.ListGroups(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]model.Group, 0, len(values))
	for _, value := range values {
		result = append(result, groupModel(value))
	}
	return result, nil
}

func (s *Store) CreateGroup(ctx context.Context, group model.Group) (model.Group, error) {
	value, err := s.queries.CreateGroup(ctx, group.Name)
	return groupModel(value), mapConflict(err)
}

func (s *Store) GetVideoByIDForGroup(ctx context.Context, videoID, groupID uuid.UUID) (model.Video, bool, error) {
	value, err := s.queries.GetVideoByIDForGroup(ctx, db.GetVideoByIDForGroupParams{ID: videoID, GroupID: groupID})
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.Video{}, ok, foundErr
	}
	return videoModel(value), true, nil
}

func (s *Store) ListVideosForGroup(ctx context.Context, groupID uuid.UUID, offset, limit int) ([]model.Video, int64, error) {
	total, err := s.queries.CountVideosForGroup(ctx, groupID)
	if err != nil {
		return nil, 0, err
	}
	values, err := s.queries.ListVideosForGroup(ctx, db.ListVideosForGroupParams{
		GroupID: groupID, Offset: int32(offset), Limit: int32(limit),
	})
	if err != nil {
		return nil, 0, err
	}
	result := make([]model.Video, 0, len(values))
	for _, value := range values {
		result = append(result, videoModel(value))
	}
	return result, total, nil
}

func (s *Store) CreateVideo(ctx context.Context, video model.Video) (model.Video, error) {
	if video.SizeBytes > math.MaxInt32 {
		return model.Video{}, fmt.Errorf("video size %d exceeds current database integer limit", video.SizeBytes)
	}
	value, err := s.queries.CreateVideo(ctx, db.CreateVideoParams{
		GroupID: video.GroupID, Title: video.Title, Description: video.Description,
		ObjectKey: video.ObjectKey, OriginalFilename: video.OriginalFilename,
		ContentType: video.ContentType, SizeBytes: int32(video.SizeBytes),
	})
	return videoModel(value), mapConflict(err)
}

func (s *Store) UpdateVideo(ctx context.Context, video model.Video) (model.Video, error) {
	value, err := s.queries.UpdateVideo(ctx, db.UpdateVideoParams{
		ID: video.ID, GroupID: video.GroupID, Title: video.Title, Description: video.Description,
	})
	return videoModel(value), err
}

func (s *Store) DeleteVideo(ctx context.Context, videoID, groupID uuid.UUID) (bool, error) {
	rows, err := s.queries.DeleteVideo(ctx, db.DeleteVideoParams{ID: videoID, GroupID: groupID})
	return rows > 0, err
}

func (s *Store) GetAnnotationByID(ctx context.Context, id uuid.UUID) (model.Annotation, bool, error) {
	value, err := s.queries.GetAnnotationByID(ctx, id)
	if ok, foundErr := found(err); !ok || foundErr != nil {
		return model.Annotation{}, ok, foundErr
	}
	result, err := annotationModel(value)
	return result, err == nil, err
}

func (s *Store) ListAnnotationsForVideo(ctx context.Context, videoID uuid.UUID) ([]model.Annotation, error) {
	values, err := s.queries.ListAnnotationsForVideo(ctx, videoID)
	if err != nil {
		return nil, err
	}
	result := make([]model.Annotation, 0, len(values))
	for _, value := range values {
		annotation, err := annotationModel(value)
		if err != nil {
			return nil, err
		}
		result = append(result, annotation)
	}
	return result, nil
}

func (s *Store) CreateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error) {
	customData, err := json.Marshal(model.NormalizeJSONMap(annotation.CustomData))
	if err != nil {
		return model.Annotation{}, err
	}
	value, err := s.queries.CreateAnnotation(ctx, db.CreateAnnotationParams{
		VideoID: annotation.VideoID, TimestampSeconds: annotation.TimestampSeconds,
		DurationSeconds: annotation.DurationSeconds, PositionX: annotation.PositionX, PositionY: annotation.PositionY,
		RegionX: annotation.RegionX, RegionY: annotation.RegionY, RegionWidth: annotation.RegionWidth,
		RegionHeight: annotation.RegionHeight, Shape: annotation.Shape, DisplayMode: annotation.DisplayMode,
		Interactive: annotation.Interactive, Title: annotation.Title, Body: annotation.Body,
		Kind: annotation.Kind, Color: annotation.Color, CustomData: customData,
	})
	if err != nil {
		return model.Annotation{}, err
	}
	return annotationModel(value)
}

func (s *Store) UpdateAnnotation(ctx context.Context, annotation model.Annotation) (model.Annotation, error) {
	customData, err := json.Marshal(model.NormalizeJSONMap(annotation.CustomData))
	if err != nil {
		return model.Annotation{}, err
	}
	value, err := s.queries.UpdateAnnotation(ctx, db.UpdateAnnotationParams{
		ID: annotation.ID, TimestampSeconds: annotation.TimestampSeconds, DurationSeconds: annotation.DurationSeconds,
		PositionX: annotation.PositionX, PositionY: annotation.PositionY, RegionX: annotation.RegionX,
		RegionY: annotation.RegionY, RegionWidth: annotation.RegionWidth, RegionHeight: annotation.RegionHeight,
		Shape: annotation.Shape, DisplayMode: annotation.DisplayMode, Interactive: annotation.Interactive,
		Title: annotation.Title, Body: annotation.Body, Kind: annotation.Kind, Color: annotation.Color,
		CustomData: customData,
	})
	if err != nil {
		return model.Annotation{}, err
	}
	return annotationModel(value)
}

func (s *Store) DeleteAnnotation(ctx context.Context, id uuid.UUID) (bool, error) {
	rows, err := s.queries.DeleteAnnotation(ctx, id)
	return rows > 0, err
}

func found(err error) (bool, error) {
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return err == nil, err
}

func userModel(value db.User) model.User {
	return model.User{
		ID: value.ID, GroupID: value.GroupID, Username: value.Username,
		PasswordHash: value.PasswordHash, IsAdmin: value.IsAdmin,
		CreatedAt: value.CreatedAt.Time, UpdatedAt: optionalTime(value.UpdatedAt),
	}
}

func groupModel(value db.Group) model.Group {
	return model.Group{ID: value.ID, Name: value.Name, CreatedAt: value.CreatedAt.Time, UpdatedAt: optionalTime(value.UpdatedAt)}
}

func videoModel(value db.Video) model.Video {
	return model.Video{
		ID: value.ID, GroupID: value.GroupID, Title: value.Title, Description: value.Description,
		ObjectKey: value.ObjectKey, OriginalFilename: value.OriginalFilename,
		ContentType: value.ContentType, SizeBytes: int64(value.SizeBytes),
		CreatedAt: value.CreatedAt.Time, UpdatedAt: optionalTime(value.UpdatedAt),
	}
}

func annotationModel(value db.Annotation) (model.Annotation, error) {
	customData, err := model.DecodeJSONMap(value.CustomData)
	if err != nil {
		return model.Annotation{}, err
	}
	return model.Annotation{
		ID: value.ID, VideoID: value.VideoID, TimestampSeconds: value.TimestampSeconds,
		DurationSeconds: value.DurationSeconds, PositionX: value.PositionX, PositionY: value.PositionY,
		RegionX: value.RegionX, RegionY: value.RegionY, RegionWidth: value.RegionWidth,
		RegionHeight: value.RegionHeight, Shape: value.Shape, DisplayMode: value.DisplayMode,
		Interactive: value.Interactive, Title: value.Title, Body: value.Body, Kind: value.Kind,
		Color: value.Color, CustomData: customData, CreatedAt: value.CreatedAt.Time,
		UpdatedAt: optionalTime(value.UpdatedAt),
	}, nil
}

func optionalTime(value pgtype.Timestamp) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}

func mapConflict(err error) error {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) && pgErr.Code == "23505" {
		return fmt.Errorf("%w: %s", storeerr.ErrConflict, pgErr.ConstraintName)
	}
	return err
}

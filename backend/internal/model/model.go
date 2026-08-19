package model

import (
	"encoding/json"
	"time"

	"github.com/google/uuid"
)

type User struct {
	ID           uuid.UUID
	GroupID      uuid.UUID
	Username     string
	PasswordHash string
	IsAdmin      bool
	CreatedAt    time.Time
	UpdatedAt    *time.Time
}

type Group struct {
	ID        uuid.UUID
	Name      string
	CreatedAt time.Time
	UpdatedAt *time.Time
}

type Video struct {
	ID               uuid.UUID
	GroupID          uuid.UUID
	Title            string
	Description      *string
	ObjectKey        string
	OriginalFilename string
	ContentType      string
	SizeBytes        int64
	CreatedAt        time.Time
	UpdatedAt        *time.Time
}

type Annotation struct {
	ID               uuid.UUID
	VideoID          uuid.UUID
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
	CreatedAt        time.Time
	UpdatedAt        *time.Time
}

func NormalizeJSONMap(value map[string]any) map[string]any {
	if value == nil {
		return map[string]any{}
	}
	return value
}

func DecodeJSONMap(data []byte) (map[string]any, error) {
	value := map[string]any{}
	if len(data) == 0 {
		return value, nil
	}
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return value, nil
}

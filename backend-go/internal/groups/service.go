package groups

import (
	"context"
	"errors"
	"net/http"
	"strings"

	"github.com/xinquiry/video-insight/backend-go/internal/model"
	"github.com/xinquiry/video-insight/backend-go/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend-go/internal/shared/storeerr"
)

type Store interface {
	ListGroups(ctx context.Context) ([]model.Group, error)
	CreateGroup(ctx context.Context, group model.Group) (model.Group, error)
}

type Service struct{ store Store }

func NewService(store Store) *Service { return &Service{store: store} }

func (s *Service) List(ctx context.Context) ([]model.Group, error) {
	return s.store.ListGroups(ctx)
}

func (s *Service) Create(ctx context.Context, name string) (model.Group, error) {
	name = strings.TrimSpace(name)
	if name == "" || len(name) > 120 {
		return model.Group{}, apperror.New(http.StatusUnprocessableEntity, "Invalid group name")
	}
	group, err := s.store.CreateGroup(ctx, model.Group{Name: name})
	if errors.Is(err, storeerr.ErrConflict) {
		return model.Group{}, apperror.New(http.StatusConflict, "Group already exists")
	}
	return group, err
}

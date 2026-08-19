package auth

import (
	"context"
	"errors"
	"net/http"

	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/shared/storeerr"
)

type Store interface {
	GetUserByID(ctx context.Context, id uuid.UUID) (model.User, bool, error)
	GetUserByUsername(ctx context.Context, username string) (model.User, bool, error)
	CreateUser(ctx context.Context, user model.User) (model.User, error)
	UpdateUser(ctx context.Context, user model.User) (model.User, error)
	GetGroupByID(ctx context.Context, id uuid.UUID) (model.Group, bool, error)
	GetGroupByName(ctx context.Context, name string) (model.Group, bool, error)
	CreateGroup(ctx context.Context, group model.Group) (model.Group, error)
}

type Service struct {
	store  Store
	tokens *TokenManager
}

type LoginResult struct {
	AccessToken string
	User        model.User
}

func NewService(store Store, tokens *TokenManager) *Service {
	return &Service{store: store, tokens: tokens}
}

func (s *Service) CurrentUser(ctx context.Context, id uuid.UUID) (model.User, error) {
	user, found, err := s.store.GetUserByID(ctx, id)
	if err != nil {
		return model.User{}, err
	}
	if !found {
		return model.User{}, apperror.New(http.StatusUnauthorized, "Could not validate credentials")
	}
	return user, nil
}

func (s *Service) Login(ctx context.Context, username, password string) (LoginResult, error) {
	user, found, err := s.store.GetUserByUsername(ctx, username)
	if err != nil {
		return LoginResult{}, err
	}
	if !found || !VerifyPassword(password, user.PasswordHash) {
		return LoginResult{}, apperror.New(http.StatusUnauthorized, "Invalid username or password")
	}
	token, err := s.tokens.Create(user.ID, user.Username)
	if err != nil {
		return LoginResult{}, err
	}
	return LoginResult{AccessToken: token, User: user}, nil
}

func (s *Service) CreateUser(ctx context.Context, username, password string, groupID uuid.UUID) (model.User, error) {
	if len(username) < 3 || len(username) > 80 || len(password) < 8 || len(password) > 256 {
		return model.User{}, apperror.New(http.StatusUnprocessableEntity, "Invalid user data")
	}
	if _, found, err := s.store.GetGroupByID(ctx, groupID); err != nil {
		return model.User{}, err
	} else if !found {
		return model.User{}, apperror.New(http.StatusNotFound, "Group not found")
	}
	hash, err := HashPassword(password)
	if err != nil {
		return model.User{}, err
	}
	user, err := s.store.CreateUser(ctx, model.User{
		Username: username, PasswordHash: hash, GroupID: groupID, IsAdmin: false,
	})
	if errors.Is(err, storeerr.ErrConflict) {
		return model.User{}, apperror.New(http.StatusConflict, "Username already exists")
	}
	return user, err
}

func (s *Service) EnsureAdmin(ctx context.Context, username, password, defaultGroupName string) error {
	group, found, err := s.store.GetGroupByName(ctx, defaultGroupName)
	if err != nil {
		return err
	}
	if !found {
		group, err = s.store.CreateGroup(ctx, model.Group{Name: defaultGroupName})
		if err != nil {
			return err
		}
	}
	hash, err := HashPassword(password)
	if err != nil {
		return err
	}
	user, found, err := s.store.GetUserByUsername(ctx, username)
	if err != nil {
		return err
	}
	if !found {
		_, err = s.store.CreateUser(ctx, model.User{
			Username: username, PasswordHash: hash, GroupID: group.ID, IsAdmin: true,
		})
		return err
	}
	user.PasswordHash = hash
	user.GroupID = group.ID
	user.IsAdmin = true
	_, err = s.store.UpdateUser(ctx, user)
	return err
}

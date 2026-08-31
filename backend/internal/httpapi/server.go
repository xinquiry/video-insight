package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/google/uuid"

	"github.com/xinquiry/video-insight/backend/internal/annotations"
	"github.com/xinquiry/video-insight/backend/internal/auth"
	"github.com/xinquiry/video-insight/backend/internal/groups"
	"github.com/xinquiry/video-insight/backend/internal/model"
	"github.com/xinquiry/video-insight/backend/internal/portable"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
	"github.com/xinquiry/video-insight/backend/internal/videos"
)

type Pinger interface{ Ping(context.Context) error }

type Server struct {
	auth        *auth.Service
	groups      *groups.Service
	videos      *videos.Service
	annotations *annotations.Service
	tokens      *auth.TokenManager
	ready       Pinger
	logger      *slog.Logger
	origins     map[string]struct{}
}

type contextKey string

const currentUserKey contextKey = "current-user"

const (
	maxJSONRequestBytes       int64 = 5 << 20
	maxAnnotationRequestBytes int64 = 72 << 20
)

func New(
	authService *auth.Service,
	groupService *groups.Service,
	videoService *videos.Service,
	annotationService *annotations.Service,
	tokens *auth.TokenManager,
	ready Pinger,
	logger *slog.Logger,
	corsOrigins []string,
) http.Handler {
	server := &Server{
		auth: authService, groups: groupService, videos: videoService, annotations: annotationService,
		tokens: tokens, ready: ready, logger: logger, origins: make(map[string]struct{}, len(corsOrigins)),
	}
	for _, origin := range corsOrigins {
		server.origins[origin] = struct{}{}
	}

	router := chi.NewRouter()
	router.Use(middleware.RequestID)
	router.Use(middleware.Recoverer)
	router.Use(server.requestTimeout)
	router.Use(server.cors)
	router.Use(server.accessLog)
	router.Route("/api", func(api chi.Router) {
		api.Get("/health", server.health)
		api.Get("/health/ready", server.readiness)
		api.Post("/auth/login", server.login)
		api.Group(func(protected chi.Router) {
			protected.Use(server.authenticate)
			protected.Get("/auth/me", server.me)
			protected.With(server.requireAdmin).Post("/auth/users", server.createUser)
			protected.With(server.requireAdmin).Get("/groups", server.listGroups)
			protected.With(server.requireAdmin).Post("/groups", server.createGroup)
			protected.Get("/videos", server.listVideos)
			protected.Post("/videos/uploads", server.initUpload)
			protected.Post("/videos/uploads/abort", server.abortUpload)
			protected.Post("/videos", server.completeUpload)
			protected.Get("/videos/{videoID}", server.getVideo)
			protected.Get("/videos/{videoID}/export", server.exportVideo)
			protected.Patch("/videos/{videoID}", server.updateVideo)
			protected.Delete("/videos/{videoID}", server.deleteVideo)
			protected.Get("/videos/{videoID}/annotations", server.listAnnotations)
			protected.Post("/videos/{videoID}/annotations", server.createAnnotation)
			protected.Patch("/annotations/{annotationID}", server.updateAnnotation)
			protected.Delete("/annotations/{annotationID}", server.deleteAnnotation)
			protected.Get("/annotations/{annotationID}/comments", server.listAnnotationComments)
			protected.Post("/annotations/{annotationID}/comments", server.createAnnotationComment)
		})
	})
	return router
}

func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *Server) readiness(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	if err := s.ready.Ping(ctx); err != nil {
		s.writeError(w, r, apperror.Wrap(http.StatusServiceUnavailable, "Database unavailable", err))
		return
	}
	writeJSON(w, http.StatusOK, healthResponse{Status: "ok"})
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var request loginRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.auth.Login(r.Context(), request.Username, request.Password)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, tokenResponse{AccessToken: result.AccessToken, TokenType: "bearer", User: userDTO(result.User)})
}

func (s *Server) me(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, userDTO(currentUser(r)))
}

func (s *Server) createUser(w http.ResponseWriter, r *http.Request) {
	var request createUserRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	groupID, ok := parseUUID(w, request.GroupID)
	if !ok {
		return
	}
	user, err := s.auth.CreateUser(r.Context(), request.Username, request.Password, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, userDTO(user))
}

func (s *Server) listGroups(w http.ResponseWriter, r *http.Request) {
	items, err := s.groups.List(r.Context())
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	response := make([]groupResponse, 0, len(items))
	for _, item := range items {
		response = append(response, groupDTO(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) createGroup(w http.ResponseWriter, r *http.Request) {
	var request createGroupRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	group, err := s.groups.Create(r.Context(), request.Name)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, groupDTO(group))
}

func (s *Server) listVideos(w http.ResponseWriter, r *http.Request) {
	page, ok := queryInt(w, r, "page", 1)
	if !ok {
		return
	}
	pageSize, ok := queryInt(w, r, "page_size", 20)
	if !ok {
		return
	}
	items, total, err := s.videos.List(r.Context(), currentUser(r).GroupID, page, pageSize)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	response := make([]videoResponse, 0, len(items))
	for _, item := range items {
		response = append(response, videoDTO(item))
	}
	writeJSON(w, http.StatusOK, paginatedVideosResponse{Items: response, Total: total, Page: page, PageSize: pageSize})
}

func (s *Server) initUpload(w http.ResponseWriter, r *http.Request) {
	var request initUploadRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.videos.InitUpload(r.Context(), request.Filename, request.ContentType, request.SizeBytes)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	parts := make([]uploadPartURLResponse, 0, len(result.Parts))
	for _, part := range result.Parts {
		parts = append(parts, uploadPartURLResponse{PartNumber: part.PartNumber, URL: part.URL})
	}
	writeJSON(w, http.StatusCreated, uploadInitResponse{
		ObjectKey: result.ObjectKey, UploadID: result.UploadID, PartSize: result.PartSize,
		Parts: parts, ExpiresIn: result.ExpiresIn, Concurrency: result.Concurrency,
	})
}

func (s *Server) abortUpload(w http.ResponseWriter, r *http.Request) {
	var request abortUploadRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	if err := s.videos.AbortUpload(r.Context(), request.ObjectKey, request.UploadID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	var request completeUploadRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	parts := make([]videos.CompletedPart, 0, len(request.Parts))
	for _, part := range request.Parts {
		if part.PartNumber < 1 || part.PartNumber > 10000 || part.ETag == "" || len(part.ETag) > 512 {
			writeValidation(w, "Invalid upload part")
			return
		}
		parts = append(parts, videos.CompletedPart{PartNumber: part.PartNumber, ETag: part.ETag})
	}
	result, err := s.videos.CompleteUpload(r.Context(), videos.CompleteInput{
		ObjectKey: request.ObjectKey, UploadID: request.UploadID, Title: request.Title,
		Description: request.Description, Filename: request.Filename, ContentType: request.ContentType,
		SizeBytes: request.SizeBytes, Parts: parts,
	}, currentUser(r).GroupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, videoDTO(result))
}

func (s *Server) getVideo(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	result, err := s.videos.Get(r.Context(), videoID, currentUser(r).GroupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, videoDTO(result))
}

func (s *Server) exportVideo(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	groupID := currentUser(r).GroupID
	result, err := s.videos.OpenExport(r.Context(), videoID, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	defer func() { _ = result.Media.Close() }()
	items, err := s.annotations.List(r.Context(), videoID, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	portableVideo := result.Video
	portableVideo.OriginalFilename = result.Filename
	mediaPath := "media/" + result.Filename
	bundle, err := portable.NewBundle(portableVideo, mediaPath, items, time.Now())
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	packageStem := strings.TrimSuffix(result.Filename, path.Ext(result.Filename))
	if packageStem == "" {
		packageStem = "video-" + videoID.String()
	}
	packageName := packageStem + portable.PackageExtension
	w.Header().Set("Cache-Control", "private, no-store")
	w.Header().Set("Content-Type", portable.PackageMIME)
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": packageName}))
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.WriteHeader(http.StatusOK)
	if err := portable.WritePackage(w, bundle, result.Media); err != nil {
		s.logger.Error("stream video export", "request_id", middleware.GetReqID(r.Context()), "video_id", videoID, "error", err)
	}
}

func (s *Server) updateVideo(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	var request updateVideoRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	result, err := s.videos.Update(r.Context(), videoID, currentUser(r).GroupID, videos.UpdateInput{
		Title: request.Title, Description: request.Description,
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, videoDTO(result))
}

func (s *Server) deleteVideo(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	if err := s.videos.Delete(r.Context(), videoID, currentUser(r).GroupID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listAnnotations(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	items, err := s.annotations.List(r.Context(), videoID, currentUser(r).GroupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	response := make([]annotationResponse, 0, len(items))
	for _, item := range items {
		response = append(response, annotationDTO(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) createAnnotation(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	var request createAnnotationRequest
	if !decodeJSONLimit(w, r, &request, maxAnnotationRequestBytes) {
		return
	}
	input, ok := annotationCreateInput(request)
	if !ok {
		writeProblem(w, http.StatusUnprocessableEntity, "annotation_timestamp_invalid", "Annotation timestamp is required")
		return
	}
	annotation, err := s.annotations.Create(r.Context(), videoID, currentUser(r).GroupID, input)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, annotationDTO(annotation))
}

func (s *Server) updateAnnotation(w http.ResponseWriter, r *http.Request) {
	annotationID, ok := pathUUID(w, r, "annotationID")
	if !ok {
		return
	}
	var request updateAnnotationRequest
	if !decodeJSONLimit(w, r, &request, maxAnnotationRequestBytes) {
		return
	}
	annotation, err := s.annotations.Update(r.Context(), annotationID, currentUser(r).GroupID, annotations.UpdateInput{
		TimestampSeconds: request.TimestampSeconds, DurationSeconds: request.DurationSeconds,
		PositionX: request.PositionX, PositionY: request.PositionY, RegionX: request.RegionX, RegionY: request.RegionY,
		RegionWidth: request.RegionWidth, RegionHeight: request.RegionHeight, Shape: request.Shape,
		DisplayMode: request.DisplayMode, Interactive: request.Interactive, Content: request.Content,
		Kind: request.Kind, Color: request.Color, CustomData: request.CustomData,
	})
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusOK, annotationDTO(annotation))
}

func (s *Server) listAnnotationComments(w http.ResponseWriter, r *http.Request) {
	annotationID, ok := pathUUID(w, r, "annotationID")
	if !ok {
		return
	}
	items, err := s.annotations.ListComments(r.Context(), annotationID, currentUser(r).GroupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	response := make([]annotationCommentResponse, 0, len(items))
	for _, item := range items {
		response = append(response, annotationCommentDTO(item))
	}
	writeJSON(w, http.StatusOK, response)
}

func (s *Server) createAnnotationComment(w http.ResponseWriter, r *http.Request) {
	annotationID, ok := pathUUID(w, r, "annotationID")
	if !ok {
		return
	}
	var request createAnnotationCommentRequest
	if !decodeJSON(w, r, &request) {
		return
	}
	user := currentUser(r)
	comment, err := s.annotations.CreateComment(r.Context(), annotationID, user.GroupID, user.ID, request.Body)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	writeJSON(w, http.StatusCreated, annotationCommentDTO(comment))
}

func (s *Server) deleteAnnotation(w http.ResponseWriter, r *http.Request) {
	annotationID, ok := pathUUID(w, r, "annotationID")
	if !ok {
		return
	}
	if err := s.annotations.Delete(r.Context(), annotationID, currentUser(r).GroupID); err != nil {
		s.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			s.writeError(w, r, apperror.New(http.StatusUnauthorized, "Could not validate credentials"))
			return
		}
		userID, err := s.tokens.Parse(strings.TrimSpace(strings.TrimPrefix(header, "Bearer ")))
		if err != nil {
			s.writeError(w, r, apperror.New(http.StatusUnauthorized, "Could not validate credentials"))
			return
		}
		user, err := s.auth.CurrentUser(r.Context(), userID)
		if err != nil {
			s.writeError(w, r, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), currentUserKey, user)))
	})
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !currentUser(r).IsAdmin {
			s.writeError(w, r, apperror.New(http.StatusForbidden, "Admin privileges required"))
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if _, allowed := s.origins[origin]; allowed {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
			w.Header().Add("Vary", "Origin")
		}
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization,Content-Type")
			w.WriteHeader(http.StatusOK)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) requestTimeout(next http.Handler) http.Handler {
	regular := middleware.Timeout(60 * time.Second)(next)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/api/videos/") && strings.HasSuffix(r.URL.Path, "/export") {
			// The API server's normal WriteTimeout is intentionally short. An
			// annotated-video export can stream gigabytes, so let the downstream
			// proxy's inactivity timeout govern this one authenticated route.
			if err := http.NewResponseController(w).SetWriteDeadline(time.Time{}); err != nil && !errors.Is(err, http.ErrNotSupported) {
				s.logger.Warn("disable export write deadline", "request_id", middleware.GetReqID(r.Context()), "error", err)
			}
			next.ServeHTTP(w, r)
			return
		}
		regular.ServeHTTP(w, r)
	})
}

func (s *Server) accessLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		wrapped := middleware.NewWrapResponseWriter(w, r.ProtoMajor)
		started := time.Now()
		next.ServeHTTP(wrapped, r)
		s.logger.Info("request", "request_id", middleware.GetReqID(r.Context()), "method", r.Method,
			"path", r.URL.Path, "status", wrapped.Status(), "bytes", wrapped.BytesWritten(), "duration_ms", time.Since(started).Milliseconds())
	})
}

func (s *Server) writeError(w http.ResponseWriter, r *http.Request, err error) {
	if appErr, ok := apperror.As(err); ok {
		if appErr.Status == http.StatusUnauthorized {
			w.Header().Set("WWW-Authenticate", "Bearer")
		}
		if appErr.Status >= 500 {
			s.logger.Error("request failed", "request_id", middleware.GetReqID(r.Context()), "error", err)
		} else if appErr.Code != "" {
			s.logger.Warn("request rejected", "request_id", middleware.GetReqID(r.Context()),
				"status", appErr.Status, "code", appErr.Code)
		}
		writeJSON(w, appErr.Status, detailResponse{Code: appErr.Code, Detail: appErr.Detail})
		return
	}
	if errors.Is(err, context.DeadlineExceeded) {
		writeJSON(w, http.StatusGatewayTimeout, detailResponse{Detail: "Request timed out"})
		return
	}
	s.logger.Error("request failed", "request_id", middleware.GetReqID(r.Context()), "error", err)
	writeJSON(w, http.StatusInternalServerError, detailResponse{Detail: "Internal server error"})
}

func currentUser(r *http.Request) model.User { return r.Context().Value(currentUserKey).(model.User) }

func decodeJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	return decodeJSONLimit(w, r, target, maxJSONRequestBytes)
}

func decodeJSONLimit(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) bool {
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	if err := decoder.Decode(target); err != nil {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge, "request_too_large", "Request body is too large")
			return false
		}
		writeValidation(w, "Invalid request body")
		return false
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		var tooLarge *http.MaxBytesError
		if errors.As(err, &tooLarge) {
			writeProblem(w, http.StatusRequestEntityTooLarge, "request_too_large", "Request body is too large")
			return false
		}
		writeValidation(w, "Invalid request body")
		return false
	}
	return true
}

func pathUUID(w http.ResponseWriter, r *http.Request, name string) (uuid.UUID, bool) {
	return parseUUID(w, chi.URLParam(r, name))
}

func parseUUID(w http.ResponseWriter, value string) (uuid.UUID, bool) {
	parsed, err := uuid.Parse(value)
	if err != nil {
		writeValidation(w, "Invalid UUID")
		return uuid.Nil, false
	}
	return parsed, true
}

func queryInt(w http.ResponseWriter, r *http.Request, name string, fallback int) (int, bool) {
	value := r.URL.Query().Get(name)
	if value == "" {
		return fallback, true
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		writeValidation(w, "Invalid query parameter")
		return 0, false
	}
	return parsed, true
}

func writeValidation(w http.ResponseWriter, detail string) {
	writeProblem(w, http.StatusUnprocessableEntity, "invalid_request_body", detail)
}

func writeProblem(w http.ResponseWriter, status int, code, detail string) {
	writeJSON(w, status, detailResponse{Code: code, Detail: detail})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

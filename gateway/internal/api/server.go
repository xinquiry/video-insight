// Package api exposes the gateway REST surface. The design mirrors the six
// operations of video-insight's videos.Storage interface so the backend
// adapter is a thin client, but the API is project-agnostic.
package api

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"path"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/xinquiry/video-insight/gateway/internal/auth"
	"github.com/xinquiry/video-insight/gateway/internal/smh"
)

type Server struct {
	auth *auth.Store
	smh  *smh.Client
	log  *slog.Logger
}

func NewServer(store *auth.Store, client *smh.Client, logger *slog.Logger) *Server {
	return &Server{auth: store, smh: client, log: logger}
}

func (s *Server) Routes() chi.Router {
	r := chi.NewRouter()
	r.Get("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	r.Group(func(r chi.Router) {
		r.Use(s.authenticate)
		r.Post("/v1/uploads", s.startUpload)
		r.Post("/v1/uploads/renew", s.renewUpload)
		r.Post("/v1/uploads/complete", s.completeUpload)
		r.Post("/v1/uploads/abort", s.abortUpload)
		r.Get("/v1/objects/download-url", s.downloadURL)
		r.Get("/v1/objects/stat", s.statObject)
		r.Delete("/v1/objects", s.deleteObject)
	})
	return r
}

// ---- middleware ---------------------------------------------------------------

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		key, secret, ok := r.BasicAuth()
		if !ok {
			w.Header().Set("WWW-Authenticate", `Basic realm="sjtu-oss-gateway"`)
			writeError(w, http.StatusUnauthorized, "missing credentials")
			return
		}
		project, err := s.auth.Verify(key, secret)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "invalid credentials")
			return
		}
		next.ServeHTTP(w, r.WithContext(withProject(r.Context(), project)))
	})
}

type projectKey struct{}

func withProject(ctx context.Context, project auth.Project) context.Context {
	return context.WithValue(ctx, projectKey{}, project)
}

func projectFrom(ctx context.Context) (auth.Project, error) {
	project, ok := ctx.Value(projectKey{}).(auth.Project)
	if !ok {
		return auth.Project{}, errors.New("no project in context")
	}
	return project, nil
}

// ---- handlers -----------------------------------------------------------------

type partOut struct {
	PartNumber int               `json:"partNumber"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
}

type startUploadRequest struct {
	ObjectKey string `json:"objectKey"`
	PartCount int    `json:"partCount"`
	PartFrom  int    `json:"partFrom,omitempty"` // for renew-style partial fetches
	PartTo    int    `json:"partTo,omitempty"`
}

type startUploadResponse struct {
	UploadID   string    `json:"uploadId"`
	ConfirmKey string    `json:"confirmKey"`
	PartSize   int64     `json:"partSize"`
	Parts      []partOut `json:"parts"`
	ExpiresIn  int       `json:"expiresIn"` // seconds until part signatures expire
}

func (s *Server) startUpload(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var req startUploadRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	if req.PartCount < 1 || req.PartCount > 10000 {
		writeError(w, http.StatusBadRequest, "partCount must be 1..10000")
		return
	}
	fullPath, err := project.ObjectKey(req.ObjectKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// SMH needs the parent directory to exist.
	if err := s.smh.EnsureDirectory(r.Context(), path.Dir(fullPath)); err != nil {
		s.log.Error("ensure directory", "project", project.Name, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend failed to prepare directory")
		return
	}
	first, last := 1, req.PartCount
	if req.PartFrom > 0 && req.PartTo >= req.PartFrom {
		first, last = req.PartFrom, req.PartTo
	}
	// SMH signs part ranges; keep each call to <= 1000 parts.
	numbers := make([]int, 0, last-first+1)
	for n := first; n <= last; n++ {
		numbers = append(numbers, n)
	}
	session, err := s.smh.StartUpload(r.Context(), fullPath, numbers)
	if err != nil {
		s.log.Error("start upload", "project", project.Name, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend failed to start upload")
		return
	}
	parts := make([]partOut, 0, len(session.Parts))
	for n := first; n <= last; n++ {
		part, ok := session.Parts[strconv.Itoa(n)]
		if !ok {
			writeError(w, http.StatusBadGateway, "storage backend omitted part signatures")
			return
		}
		parts = append(parts, partOut{
			PartNumber: n,
			URL:        "https://" + session.Domain + session.Path,
			Headers:    part.Headers,
		})
	}
	expiresIn := int(time.Until(session.Expiration).Seconds())
	if expiresIn < 0 {
		expiresIn = 0
	}
	writeJSON(w, http.StatusCreated, startUploadResponse{
		UploadID:   session.UploadID + "|" + session.ConfirmKey, // composite id: backend only needs one opaque token
		ConfirmKey: session.ConfirmKey,
		PartSize:   smh.ChunkSize(),
		Parts:      parts,
		ExpiresIn:  max(expiresIn, 0),
	})
}

type renewRequest struct {
	ObjectKey string `json:"objectKey"`
	UploadID  string `json:"uploadId"`
	PartFrom  int    `json:"partFrom"`
	PartTo    int    `json:"partTo"`
}

func (s *Server) renewUpload(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var req renewRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	confirmKey := confirmKeyFromUploadID(req.UploadID)
	if confirmKey == "" {
		writeError(w, http.StatusBadRequest, "invalid uploadId")
		return
	}
	first, last := req.PartFrom, req.PartTo
	if first < 1 || last < first {
		first, last = 1, 50
	}
	// RenewChunkUpload re-signs existing parts for the confirmKey.
	numbers := make([]int, 0, last-first+1)
	for n := first; n <= last; n++ {
		numbers = append(numbers, n)
	}
	session, err := s.smh.RenewUpload(r.Context(), confirmKey, numbers)
	if err != nil {
		s.log.Error("renew upload", "project", project.Name, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend failed to renew upload")
		return
	}
	parts := make([]partOut, 0, len(session.Parts))
	for n := first; n <= last; n++ {
		part, ok := session.Parts[strconv.Itoa(n)]
		if !ok {
			continue
		}
		parts = append(parts, partOut{
			PartNumber: n,
			URL:        "https://" + session.Domain + session.Path,
			Headers:    part.Headers,
		})
	}
	writeJSON(w, http.StatusOK, startUploadResponse{
		UploadID:  req.UploadID,
		PartSize:  smh.ChunkSize(),
		Parts:     parts,
		ExpiresIn: int(time.Until(session.Expiration).Seconds()),
	})
}

type completeRequest struct {
	ObjectKey string `json:"objectKey"`
	UploadID  string `json:"uploadId"`
}

func (s *Server) completeUpload(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	var req completeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	fullPath, err := project.ObjectKey(req.ObjectKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	confirmKey := confirmKeyFromUploadID(req.UploadID)
	if confirmKey == "" {
		writeError(w, http.StatusBadRequest, "invalid uploadId")
		return
	}
	size, etag, err := s.smh.Confirm(r.Context(), confirmKey, "")
	if err != nil {
		s.log.Error("complete upload", "project", project.Name, "key", fullPath, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend failed to complete upload")
		return
	}
	s.log.Info("upload completed", "project", project.Name, "key", fullPath, "bytes", size)
	writeJSON(w, http.StatusOK, map[string]any{
		"objectKey": req.ObjectKey,
		"sizeBytes": size,
		"etag":      etag,
	})
}

func (s *Server) abortUpload(w http.ResponseWriter, r *http.Request) {
	var req completeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid JSON body")
		return
	}
	// SMH sessions expire server-side; abort is a no-op acknowledgement.
	writeJSON(w, http.StatusOK, map[string]string{"status": "aborted"})
}

func (s *Server) downloadURL(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	objectKey := r.URL.Query().Get("key")
	if objectKey == "" {
		writeError(w, http.StatusBadRequest, "missing key parameter")
		return
	}
	fullPath, err := project.ObjectKey(objectKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	url, err := s.smh.DownloadURL(r.Context(), fullPath)
	if err != nil {
		s.log.Error("download url", "project", project.Name, "key", fullPath, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend failed to sign download")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"url": url})
}

func (s *Server) statObject(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	objectKey := r.URL.Query().Get("key")
	if objectKey == "" {
		writeError(w, http.StatusBadRequest, "missing key parameter")
		return
	}
	fullPath, err := project.ObjectKey(objectKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	size, found, err := s.smh.Stat(r.Context(), fullPath)
	if err != nil {
		s.log.Error("stat", "project", project.Name, "key", fullPath, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend stat failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"objectKey": objectKey, "sizeBytes": size, "found": found})
}

func (s *Server) deleteObject(w http.ResponseWriter, r *http.Request) {
	project, err := projectFrom(r.Context())
	if err != nil {
		writeError(w, http.StatusInternalServerError, err.Error())
		return
	}
	objectKey := r.URL.Query().Get("key")
	if objectKey == "" {
		writeError(w, http.StatusBadRequest, "missing key parameter")
		return
	}
	fullPath, err := project.ObjectKey(objectKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if err := s.smh.Delete(r.Context(), fullPath); err != nil {
		s.log.Error("delete", "project", project.Name, "key", fullPath, "error", err)
		writeError(w, http.StatusBadGateway, "storage backend delete failed")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "deleted"})
}

// ---- helpers ------------------------------------------------------------------

// confirmKeyFromUploadID extracts the confirmKey half of the composite
// "uploadId|confirmKey" token issued by startUpload.
func confirmKeyFromUploadID(uploadID string) string {
	if idx := strings.Index(uploadID, "|"); idx >= 0 {
		return uploadID[idx+1:]
	}
	return ""
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}

// Package auth maps per-project access keys to rooted SMH prefixes.
// Keys live in a single JSON file mounted from a k8s Secret; the gateway
// reloads it on change (fsnotify-free: mtime check per request is enough
// for this scale).
package auth

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path"
	"strings"
	"sync"
	"time"
)

var ErrUnauthorized = errors.New("invalid access key or secret")

type Project struct {
	Name   string `json:"name"`
	Prefix string `json:"prefix"` // e.g. "projects/videoinsight" (no leading slash)
	Secret string `json:"secret"`
}

type keysFile struct {
	Projects []Project `json:"projects"`
}

type Store struct {
	path string

	mu    sync.RWMutex
	mtime time.Time
	byKey map[string]Project
}

func NewStore(path string) (*Store, error) {
	s := &Store{path: path, byKey: map[string]Project{}}
	if err := s.reload(); err != nil {
		return nil, err
	}
	return s, nil
}

func (s *Store) reload() error {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return fmt.Errorf("read access keys: %w", err)
	}
	var file keysFile
	if err := json.Unmarshal(raw, &file); err != nil {
		return fmt.Errorf("decode access keys: %w", err)
	}
	byKey := map[string]Project{}
	for _, project := range file.Projects {
		project.Prefix = strings.Trim(project.Prefix, "/")
		if project.Name == "" || project.Prefix == "" || project.Secret == "" {
			return fmt.Errorf("access key entry %q is incomplete", project.Name)
		}
		byKey[project.Name] = project
	}
	s.byKey = byKey
	if info, err := os.Stat(s.path); err == nil {
		s.mtime = info.ModTime()
	}
	return nil
}

func (s *Store) maybeReload() {
	info, err := os.Stat(s.path)
	if err != nil {
		return
	}
	s.mu.RLock()
	changed := !info.ModTime().Equal(s.mtime)
	s.mu.RUnlock()
	if !changed {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.reload(); err == nil {
		// best effort: keep old keys on parse failure
	}
}

// Verify checks an access key/secret pair and returns the project.
func (s *Store) Verify(accessKey, secret string) (Project, error) {
	s.maybeReload()
	s.mu.RLock()
	defer s.mu.RUnlock()
	project, ok := s.byKey[accessKey]
	if !ok {
		return Project{}, ErrUnauthorized
	}
	if subtle.ConstantTimeCompare([]byte(project.Secret), []byte(secret)) != 1 {
		return Project{}, ErrUnauthorized
	}
	return project, nil
}

// ObjectKey resolves a project-relative object key to the SMH path
// ("projects/<prefix>/<key>") and rejects traversal.
func (p Project) ObjectKey(objectKey string) (string, error) {
	objectKey = strings.Trim(objectKey, "/")
	if objectKey == "" || strings.Contains(objectKey, "..") || strings.Contains(objectKey, "\\") {
		return "", errors.New("invalid object key")
	}
	return path.Join(p.Prefix, objectKey), nil
}

package driveexports

import (
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"
	"time"
)

func TestWebDAVUploadCreatesDirectoriesAndVerifiesSize(t *testing.T) {
	t.Parallel()
	content := []byte("portable package")
	var methods []string
	server := httptest.NewServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		username, password, ok := request.BasicAuth()
		if !ok || username != "videoinsight" || password != "secret" {
			response.WriteHeader(http.StatusUnauthorized)
			return
		}
		methods = append(methods, request.Method+" "+request.URL.EscapedPath())
		switch request.Method {
		case "MKCOL":
			response.WriteHeader(http.StatusCreated)
		case http.MethodPut:
			if request.ContentLength != int64(len(content)) {
				t.Errorf("content length = %d", request.ContentLength)
			}
			body, err := io.ReadAll(request.Body)
			if err != nil {
				t.Error(err)
			}
			if !reflect.DeepEqual(body, content) {
				t.Errorf("body = %q", body)
			}
			response.WriteHeader(http.StatusOK)
		case http.MethodHead:
			response.Header().Set("Content-Length", "16")
			response.WriteHeader(http.StatusOK)
		}
	}))
	defer server.Close()

	tempDir := t.TempDir()
	localPath := filepath.Join(tempDir, "lesson.vinsight")
	if err := os.WriteFile(localPath, content, 0o600); err != nil {
		t.Fatal(err)
	}
	client, err := NewWebDAVClient(WebDAVConfig{
		BaseURL: server.URL + "/dav", Username: "videoinsight", Password: "secret", Timeout: time.Minute,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Upload(t.Context(), "VideoInsight/group/Lesson 1.vinsight", localPath, "application/test"); err != nil {
		t.Fatal(err)
	}
	want := []string{
		"MKCOL /dav/VideoInsight",
		"MKCOL /dav/VideoInsight/group",
		"PUT /dav/VideoInsight/group/Lesson%201.vinsight",
		"HEAD /dav/VideoInsight/group/Lesson%201.vinsight",
	}
	if !reflect.DeepEqual(methods, want) {
		t.Fatalf("requests = %#v, want %#v", methods, want)
	}
}

package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

type fakePinger struct{ err error }

func (f fakePinger) Ping(context.Context) error { return f.err }

func TestHealthContract(t *testing.T) {
	t.Parallel()
	handler := New(nil, nil, nil, nil, nil, fakePinger{}, slog.New(slog.NewTextHandler(io.Discard, nil)), nil)
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("status %d", response.Code)
	}
	if strings.TrimSpace(response.Body.String()) != `{"status":"ok"}` {
		t.Fatalf("body %q", response.Body.String())
	}
}

func TestDecodeJSONLimitReturnsStructuredTooLargeError(t *testing.T) {
	t.Parallel()
	request := httptest.NewRequest(http.MethodPost, "/api/test", strings.NewReader(`{"value":"too large"}`))
	response := httptest.NewRecorder()
	var target map[string]any
	if decodeJSONLimit(response, request, &target, 8) {
		t.Fatal("expected request to be rejected")
	}
	if response.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("status %d", response.Code)
	}
	var body detailResponse
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Code != "request_too_large" || body.Detail == "" {
		t.Fatalf("unexpected error body: %+v", body)
	}
}

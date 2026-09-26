// Package smh implements the reverse-engineered SJTU Drive (Tencent SMH)
// API client: credential refresh, directory management, presigned multipart
// uploads, and download URLs. The wire contract was verified against
// pan.sjtu.edu.cn on 2026-09-26 (spike notes in the repo README).
package smh

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

const (
	baseURL         = "https://pan.sjtu.edu.cn"
	chunkSize       = 4 * 1024 * 1024 // SMH enforces 4 MiB parts
	tokenHTTPClient = 30 * time.Second
)

// PartHeaders is the presigned SigV4 header set SMH returns per part.
// The browser PUTs these headers verbatim to Domain+Path.
type PartHeaders struct {
	Date   string `json:"x-amz-date"`
	SHA256 string `json:"x-amz-content-sha256"`
	Auth   string `json:"authorization"`
}

// Part presign info for one part number.
type Part struct {
	PartNumber int         `json:"partNumber"`
	Headers    PartHeaders `json:"headers"`
}

// UploadSession is the result of starting a chunk upload.
type UploadSession struct {
	ConfirmKey string          `json:"confirmKey"`
	UploadID   string          `json:"uploadId"`
	Domain     string          `json:"domain"`
	Path       string          `json:"path"`
	Parts      map[string]Part `json:"parts"` // keyed by part number as string
	Expiration time.Time       `json:"expiration"`
}

// Client talks to pan.sjtu.edu.cn. It refreshes the space access token
// automatically; the UserToken is long-lived (30 days) and must be rotated
// out-of-band when it expires.
type Client struct {
	userToken string
	http      *http.Client

	mu        sync.Mutex
	creds     *spaceCred
	credsFrom time.Time
}

type spaceCred struct {
	LibraryID   string `json:"libraryId"`
	SpaceID     string `json:"spaceId"`
	AccessToken string `json:"accessToken"`
	ExpiresIn   int    `json:"expiresIn"`
}

type apiError struct {
	Status  int    `json:"status"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

func (e *apiError) Error() string {
	return fmt.Sprintf("smh: %s (%s, status %d)", e.Message, e.Code, e.Status)
}

func NewClient(userToken string) *Client {
	return &Client{
		userToken: userToken,
		http:      &http.Client{Timeout: tokenHTTPClient},
	}
}

// ChunkSize is the fixed part size SMH requires.
func ChunkSize() int64 { return chunkSize }

// ---- credential handling -----------------------------------------------------

func (c *Client) cred(ctx context.Context) (*spaceCred, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.creds != nil && time.Since(c.credsFrom) < time.Duration(c.creds.ExpiresIn-60)*time.Second {
		return c.creds, nil
	}
	body, err := c.call(ctx, http.MethodPost, "/user/v1/space/1/personal", nil, url.Values{
		"user_token": {c.userToken},
	})
	if err != nil {
		return nil, fmt.Errorf("refresh space credentials: %w", err)
	}
	creds := &spaceCred{}
	if err := json.Unmarshal(body, creds); err != nil {
		return nil, fmt.Errorf("decode space credentials: %w", err)
	}
	if creds.AccessToken == "" {
		return nil, errors.New("smh: empty access token in space credentials")
	}
	c.creds = creds
	c.credsFrom = time.Now()
	return creds, nil
}

// ---- core API ----------------------------------------------------------------

// EnsureDirectory creates dir (recursively implied by SMH full-path PUT)
// if it does not exist. Idempotent.
func (c *Client) EnsureDirectory(ctx context.Context, dir string) error {
	creds, err := c.cred(ctx)
	if err != nil {
		return err
	}
	_, err = c.call(ctx, http.MethodPut, fmt.Sprintf("/api/v1/directory/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(dir)), nil, url.Values{
		"conflict_resolution_strategy": {"ask"},
		"access_token":                 {creds.AccessToken},
	})
	return err
}

// StartUpload requests presigned part headers for the given part numbers.
func (c *Client) StartUpload(ctx context.Context, path string, partNumbers []int) (*UploadSession, error) {
	creds, err := c.cred(ctx)
	if err != nil {
		return nil, err
	}
	// partNumberRange uses "first,last" for contiguous ranges.
	first, last := partNumbers[0], partNumbers[len(partNumbers)-1]
	body := fmt.Sprintf(`{"partNumberRange":["%d,%d"]}`, first, last)
	raw, err := c.call(ctx, http.MethodPost, fmt.Sprintf("/api/v1/file/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(path)), strings.NewReader(body), url.Values{
		"multipart":                    nil,
		"conflict_resolution_strategy": {"rename"},
		"access_token":                 {creds.AccessToken},
	})
	if err != nil {
		return nil, err
	}
	var rawSession struct {
		UploadSession
		ExpirationJSON string `json:"expiration"`
	}
	if err := json.Unmarshal(raw, &rawSession); err != nil {
		return nil, fmt.Errorf("decode upload session: %w", err)
	}
	session := rawSession.UploadSession
	if t, err := time.Parse(time.RFC3339, rawSession.ExpirationJSON); err == nil {
		session.Expiration = t
	}
	if session.ConfirmKey == "" || session.UploadID == "" {
		return nil, fmt.Errorf("smh: incomplete upload session response")
	}
	return &session, nil
}

// RenewUpload re-requests part headers for an in-flight confirmKey.
func (c *Client) RenewUpload(ctx context.Context, confirmKey string, partNumbers []int) (*UploadSession, error) {
	creds, err := c.cred(ctx)
	if err != nil {
		return nil, err
	}
	first, last := partNumbers[0], partNumbers[len(partNumbers)-1]
	body := fmt.Sprintf(`{"partNumberRange":["%d,%d"]}`, first, last)
	raw, err := c.call(ctx, http.MethodPost, fmt.Sprintf("/api/v1/file/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(confirmKey)), strings.NewReader(body), url.Values{
		"multipart":    nil,
		"access_token": {creds.AccessToken},
	})
	if err != nil {
		return nil, err
	}
	var session UploadSession
	if err := json.Unmarshal(raw, &session); err != nil {
		return nil, fmt.Errorf("decode renew response: %w", err)
	}
	return &session, nil
}

// Confirm finalizes an upload. SMH verifies the assembled object's crc64 when
// provided.
func (c *Client) Confirm(ctx context.Context, confirmKey, crc64 string) (size int64, etag string, err error) {
	creds, err := c.cred(ctx)
	if err != nil {
		return 0, "", err
	}
	q := url.Values{
		"confirm":                      nil,
		"conflict_resolution_strategy": {"overwrite"},
		"access_token":                 {creds.AccessToken},
	}
	if crc64 != "" {
		q.Set("crc64", crc64)
	}
	raw, err := c.call(ctx, http.MethodPost, fmt.Sprintf("/api/v1/file/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(confirmKey)), strings.NewReader("{}"), q)
	if err != nil {
		return 0, "", err
	}
	var result struct {
		Size string `json:"size"`
		ETag string `json:"eTag"`
	}
	if err := json.Unmarshal(raw, &result); err != nil {
		return 0, "", fmt.Errorf("decode confirm response: %w", err)
	}
	var n int64
	fmt.Sscanf(result.Size, "%d", &n)
	return n, result.ETag, nil
}

// DownloadURL returns the presigned COS URL for a stored object (2h validity,
// follows a 302 from the API).
func (c *Client) DownloadURL(ctx context.Context, path string) (string, error) {
	creds, err := c.cred(ctx)
	if err != nil {
		return "", err
	}
	endpoint := fmt.Sprintf("%s/api/v1/file/%s/%s/%s?download&access_token=%s",
		baseURL, creds.LibraryID, creds.SpaceID, escapePath(path), url.QueryEscape(creds.AccessToken))
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	// Do NOT follow the redirect: the Location header is the presigned URL.
	noRedirect := func(req *http.Request, via []*http.Request) error {
		return http.ErrUseLastResponse
	}
	client := &http.Client{Timeout: tokenHTTPClient, CheckRedirect: noRedirect}
	response, err := client.Do(req)
	if err != nil {
		return "", fmt.Errorf("request download url: %w", err)
	}
	defer func() { _, _ = io.Copy(io.Discard, response.Body); _ = response.Body.Close() }()
	if response.StatusCode != http.StatusFound {
		return "", fmt.Errorf("smh: download url returned %d", response.StatusCode)
	}
	location := response.Header.Get("Location")
	if location == "" {
		return "", errors.New("smh: empty download redirect")
	}
	return location, nil
}

// Stat returns object metadata; found=false when missing.
func (c *Client) Stat(ctx context.Context, path string) (size int64, found bool, err error) {
	creds, err := c.cred(ctx)
	if err != nil {
		return 0, false, err
	}
	raw, err := c.call(ctx, http.MethodGet, fmt.Sprintf("/api/v1/file/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(path)), nil, url.Values{
		"info":         nil,
		"access_token": {creds.AccessToken},
	})
	if err != nil {
		var ae *apiError
		if errors.As(err, &ae) && ae.Code == "NotFound" {
			return 0, false, nil
		}
		return 0, false, err
	}
	var info struct {
		Size string `json:"size"`
	}
	if err := json.Unmarshal(raw, &info); err != nil {
		return 0, false, fmt.Errorf("decode stat response: %w", err)
	}
	fmt.Sscanf(info.Size, "%d", &size)
	return size, true, nil
}

// Delete removes an object or directory.
func (c *Client) Delete(ctx context.Context, path string) error {
	creds, err := c.cred(ctx)
	if err != nil {
		return err
	}
	_, err = c.call(ctx, http.MethodDelete, fmt.Sprintf("/api/v1/file/%s/%s/%s", creds.LibraryID, creds.SpaceID, escapePath(path)), nil, url.Values{
		"access_token": {creds.AccessToken},
	})
	return err
}

// ---- plumbing ----------------------------------------------------------------

// call performs one API request and returns the decoded body. A nil error
// implies HTTP 2xx.
func (c *Client) call(ctx context.Context, method, path string, body io.Reader, query url.Values) ([]byte, error) {
	endpoint := baseURL + path
	if len(query) > 0 {
		endpoint += "?" + query.Encode()
	}
	req, err := http.NewRequestWithContext(ctx, method, endpoint, body)
	if err != nil {
		return nil, err
	}
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	response, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("smh request %s %s: %w", method, path, err)
	}
	defer func() { _, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10)); _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("read smh response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		ae := &apiError{Status: response.StatusCode}
		if jsonErr := json.Unmarshal(raw, ae); jsonErr != nil || ae.Code == "" {
			ae.Code = "HTTPError"
			ae.Message = string(raw[:min(len(raw), 200)])
		}
		return nil, ae
	}
	return raw, nil
}

func escapePath(path string) string {
	segments := strings.Split(strings.Trim(path, "/"), "/")
	escaped := make([]string, 0, len(segments))
	for _, segment := range segments {
		escaped = append(escaped, url.PathEscape(segment))
	}
	return strings.Join(escaped, "/")
}

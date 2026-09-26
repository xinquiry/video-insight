package driveexports

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strings"
	"time"
)

// GatewayUploader implements Uploader against the sjtu-oss-gateway presign
// broker (gateway/ in this repository, deployed in the infra namespace).
// Package bytes are PUT directly from this server to COS using presigned
// part headers; the gateway itself never carries object data, so the
// export traffic never crosses the public application tunnel.
type GatewayConfig struct {
	BaseURL   string
	AccessKey string
	Secret    string
	Timeout   time.Duration
}

type GatewayUploader struct {
	config GatewayConfig
	client *http.Client
}

func NewGatewayUploader(config GatewayConfig) (*GatewayUploader, error) {
	if !strings.HasPrefix(config.BaseURL, "http://") && !strings.HasPrefix(config.BaseURL, "https://") {
		return nil, fmt.Errorf("gateway URL must be an absolute http or https URL")
	}
	if config.Timeout <= 0 {
		config.Timeout = 10 * time.Minute
	}
	return &GatewayUploader{
		config: config,
		client: &http.Client{Timeout: config.Timeout},
	}, nil
}

type gatewayPart struct {
	PartNumber int               `json:"partNumber"`
	URL        string            `json:"url"`
	Headers    map[string]string `json:"headers"`
}

type gatewayUploadResponse struct {
	UploadID  string        `json:"uploadId"`
	PartSize  int64         `json:"partSize"`
	Parts     []gatewayPart `json:"parts"`
	ExpiresIn int           `json:"expiresIn"`
}

// renewBatchLimit matches the SMH RenewChunkUpload restriction of at most 50
// part numbers per call.
const renewBatchLimit = 50

// Upload streams the package file to the drive in fixed-size presigned
// parts. Signatures expire (15 minutes by default); parts are renewed in
// batches of 50 shortly before the deadline.
func (u *GatewayUploader) Upload(ctx context.Context, destinationPath, localPath, contentType string) error {
	info, err := os.Stat(localPath)
	if err != nil {
		return fmt.Errorf("stat drive export package: %w", err)
	}
	if info.Size() <= 0 {
		return fmt.Errorf("drive export package is empty")
	}
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open drive export package: %w", err)
	}
	defer func() { _ = file.Close() }()

	session, err := u.startUpload(ctx, destinationPath, info.Size())
	if err != nil {
		return err
	}
	partSize := session.PartSize
	if partSize <= 0 {
		return fmt.Errorf("gateway returned an invalid part size")
	}
	totalParts := (info.Size() + partSize - 1) / partSize
	parts := partIndex(session.Parts)
	expiry := time.Now().Add(time.Duration(session.ExpiresIn) * time.Second)

	for number := int64(1); number <= totalParts; number++ {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		if part, ok := parts[int(number)]; ok && time.Now().Before(expiry) {
			if err := u.putPart(ctx, part, file, (number-1)*partSize, partSize, info.Size(), contentType); err != nil {
				return fmt.Errorf("upload drive export part %d: %w", number, err)
			}
			continue
		}
		renewed, renewedExpiry, renewErr := u.renewUpload(ctx, destinationPath, session.UploadID, int(number), int(totalParts))
		if renewErr != nil {
			return renewErr
		}
		for _, refreshed := range renewed {
			parts[refreshed.PartNumber] = refreshed
		}
		part, ok := parts[int(number)]
		if !ok {
			return fmt.Errorf("gateway did not renew part %d", number)
		}
		expiry = renewedExpiry
		if err := u.putPart(ctx, part, file, (number-1)*partSize, partSize, info.Size(), contentType); err != nil {
			return fmt.Errorf("upload drive export part %d: %w", number, err)
		}
	}

	completed, err := u.completeUpload(ctx, destinationPath, session.UploadID)
	if err != nil {
		return err
	}
	if completed != info.Size() {
		return fmt.Errorf("drive export assembled %d bytes on the drive, expected %d", completed, info.Size())
	}
	return nil
}

func (u *GatewayUploader) startUpload(ctx context.Context, objectKey string, sizeBytes int64) (*gatewayUploadResponse, error) {
	// The gateway fixes the part size (SMH: 4 MiB) and derives the total
	// part count itself; estimate only for the request contract.
	estimated := (sizeBytes + 4*1024*1024 - 1) / (4 * 1024 * 1024)
	if estimated < 1 {
		estimated = 1
	}
	var response gatewayUploadResponse
	err := u.call(ctx, http.MethodPost, "/v1/uploads", map[string]any{
		"objectKey": objectKey, "partCount": estimated,
	}, &response)
	if err != nil {
		return nil, fmt.Errorf("start drive export upload: %w", err)
	}
	return &response, nil
}

func (u *GatewayUploader) renewUpload(ctx context.Context, objectKey, uploadID string, fromPart, totalParts int) ([]gatewayPart, time.Time, error) {
	toPart := min(fromPart+renewBatchLimit-1, totalParts)
	var response gatewayUploadResponse
	err := u.call(ctx, http.MethodPost, "/v1/uploads/renew", map[string]any{
		"objectKey": objectKey, "uploadId": uploadID,
		"partFrom": fromPart, "partTo": toPart,
	}, &response)
	if err != nil {
		return nil, time.Time{}, fmt.Errorf("renew drive export parts %d-%d: %w", fromPart, toPart, err)
	}
	return response.Parts, time.Now().Add(time.Duration(response.ExpiresIn) * time.Second), nil
}

func (u *GatewayUploader) completeUpload(ctx context.Context, objectKey, uploadID string) (int64, error) {
	var response struct {
		SizeBytes int64 `json:"sizeBytes"`
	}
	err := u.call(ctx, http.MethodPost, "/v1/uploads/complete", map[string]any{
		"objectKey": objectKey, "uploadId": uploadID,
	}, &response)
	if err != nil {
		return 0, fmt.Errorf("complete drive export upload: %w", err)
	}
	return response.SizeBytes, nil
}

func (u *GatewayUploader) putPart(ctx context.Context, part gatewayPart, file *os.File, offset, partSize, totalSize int64, contentType string) error {
	length := min(partSize, totalSize-offset)
	req, err := http.NewRequestWithContext(ctx, http.MethodPut, part.URL, io.NewSectionReader(file, offset, length))
	if err != nil {
		return fmt.Errorf("create part request: %w", err)
	}
	for name, value := range part.Headers {
		req.Header.Set(name, value)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	response, err := u.client.Do(req)
	if err != nil {
		return fmt.Errorf("send part: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("part PUT returned %s", response.Status)
	}
	return nil
}

// DownloadURL signs a short-lived download URL for an exported object via
// the gateway. The browser fetches it directly from COS; the bytes never
// cross the application tunnel.
func (u *GatewayUploader) DownloadURL(ctx context.Context, objectKey string) (string, error) {
	var response struct {
		URL string `json:"url"`
	}
	err := u.call(ctx, http.MethodGet, "/v1/objects/download-url?key="+url.QueryEscape(objectKey), nil, &response)
	if err != nil {
		return "", fmt.Errorf("sign drive export download: %w", err)
	}
	if response.URL == "" {
		return "", fmt.Errorf("gateway returned an empty download URL")
	}
	return response.URL, nil
}

func (u *GatewayUploader) call(ctx context.Context, method, path string, payload any, result any) error {
	var body io.Reader
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		body = strings.NewReader(string(encoded))
	}
	req, err := http.NewRequestWithContext(ctx, method, u.config.BaseURL+path, body)
	if err != nil {
		return err
	}
	req.SetBasicAuth(u.config.AccessKey, u.config.Secret)
	req.Header.Set("Content-Type", "application/json")
	response, err := u.client.Do(req)
	if err != nil {
		return err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 16<<20))
	if err != nil {
		return fmt.Errorf("read response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s %s returned %s: %s", method, path, response.Status, truncate(string(raw), 200))
	}
	if result == nil {
		return nil
	}
	if err := json.Unmarshal(raw, result); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

func partIndex(parts []gatewayPart) map[int]gatewayPart {
	index := make(map[int]gatewayPart, len(parts))
	for _, part := range parts {
		index[part.PartNumber] = part
	}
	return index
}

func truncate(value string, maximum int) string {
	if len(value) <= maximum {
		return value
	}
	return value[len(value)-maximum:]
}

var _ Uploader = (*GatewayUploader)(nil)

package driveexports

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

type WebDAVConfig struct {
	BaseURL  string
	Username string
	Password string
	Timeout  time.Duration
}

type WebDAVClient struct {
	baseURL  *url.URL
	username string
	password string
	client   *http.Client
}

func NewWebDAVClient(config WebDAVConfig) (*WebDAVClient, error) {
	baseURL, err := url.Parse(config.BaseURL)
	if err != nil {
		return nil, fmt.Errorf("parse WebDAV URL: %w", err)
	}
	if baseURL.Scheme != "http" && baseURL.Scheme != "https" {
		return nil, fmt.Errorf("WebDAV URL must use http or https")
	}
	if baseURL.Host == "" {
		return nil, fmt.Errorf("WebDAV URL must include a host")
	}
	return &WebDAVClient{
		baseURL: baseURL, username: config.Username, password: config.Password,
		client: &http.Client{Timeout: config.Timeout},
	}, nil
}

func (c *WebDAVClient) Upload(ctx context.Context, destinationPath, localPath, contentType string) error {
	if err := c.ensureDirectories(ctx, path.Dir(destinationPath)); err != nil {
		return err
	}
	file, err := os.Open(localPath)
	if err != nil {
		return fmt.Errorf("open WebDAV upload source: %w", err)
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return fmt.Errorf("stat WebDAV upload source: %w", err)
	}
	req, err := c.request(ctx, http.MethodPut, destinationPath, file)
	if err != nil {
		return err
	}
	req.ContentLength = info.Size()
	req.Header.Set("Content-Type", contentType)
	response, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("send WebDAV upload: %w", err)
	}
	if err := closeResponse(response); err != nil {
		return fmt.Errorf("read WebDAV upload response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("WebDAV upload returned %s", response.Status)
	}
	return c.verifySize(ctx, destinationPath, info.Size())
}

func (c *WebDAVClient) ensureDirectories(ctx context.Context, directory string) error {
	directory = strings.Trim(directory, "/")
	if directory == "" || directory == "." {
		return nil
	}
	current := ""
	for _, part := range strings.Split(directory, "/") {
		if part == "" || part == "." {
			continue
		}
		current = path.Join(current, part)
		req, err := c.request(ctx, "MKCOL", current, nil)
		if err != nil {
			return err
		}
		response, err := c.client.Do(req)
		if err != nil {
			return fmt.Errorf("create WebDAV directory %q: %w", current, err)
		}
		if err := closeResponse(response); err != nil {
			return fmt.Errorf("read WebDAV directory response for %q: %w", current, err)
		}
		switch response.StatusCode {
		case http.StatusOK, http.StatusCreated, http.StatusNoContent, http.StatusMethodNotAllowed:
			continue
		default:
			return fmt.Errorf("create WebDAV directory %q returned %s", current, response.Status)
		}
	}
	return nil
}

func (c *WebDAVClient) verifySize(ctx context.Context, destinationPath string, expected int64) error {
	req, err := c.request(ctx, http.MethodHead, destinationPath, nil)
	if err != nil {
		return err
	}
	response, err := c.client.Do(req)
	if err != nil {
		return fmt.Errorf("verify WebDAV upload: %w", err)
	}
	if err := closeResponse(response); err != nil {
		return fmt.Errorf("read WebDAV verification response: %w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("verify WebDAV upload returned %s", response.Status)
	}
	if response.ContentLength != expected {
		return fmt.Errorf("WebDAV upload size is %d bytes, expected %d", response.ContentLength, expected)
	}
	return nil
}

func (c *WebDAVClient) request(ctx context.Context, method, remotePath string, body io.Reader) (*http.Request, error) {
	destination := *c.baseURL
	destination.Path = path.Join(c.baseURL.Path, remotePath)
	req, err := http.NewRequestWithContext(ctx, method, destination.String(), body)
	if err != nil {
		return nil, fmt.Errorf("create WebDAV request: %w", err)
	}
	req.SetBasicAuth(c.username, c.password)
	return req, nil
}

func closeResponse(response *http.Response) error {
	_, err := io.Copy(io.Discard, io.LimitReader(response.Body, 64<<10))
	closeErr := response.Body.Close()
	if err != nil {
		return err
	}
	return closeErr
}

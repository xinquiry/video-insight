package config

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	Address            string
	DatabaseURL        string
	CORSOrigins        []string
	SecretKey          string
	AccessTokenTTL     time.Duration
	AdminUsername      string
	AdminPassword      string
	DefaultGroupName   string
	SeedAdminOnStartup bool
	S3Endpoint         string
	S3PublicEndpoint   string
	S3AccessKey        string
	S3SecretKey        string
	S3Bucket           string
	S3Secure           bool
	S3PublicSecure     bool
	S3Region           string
	UploadPartSize     int64
	UploadURLTTL       time.Duration
	UploadMaxParts     int
	UploadConcurrency  int
}

func Load() (Config, error) {
	secure, err := envBool("MINIO_SECURE", false)
	if err != nil {
		return Config{}, err
	}
	publicSecure, err := envOptionalBool("MINIO_PUBLIC_SECURE", secure)
	if err != nil {
		return Config{}, err
	}
	partSize, err := envInt64("UPLOAD_PART_SIZE_BYTES", 5*1024*1024)
	if err != nil {
		return Config{}, err
	}
	expires, err := envInt64("UPLOAD_URL_EXPIRES_SECONDS", 6*60*60)
	if err != nil {
		return Config{}, err
	}
	maxParts, err := envInt("UPLOAD_MAX_PARTS", 10000)
	if err != nil {
		return Config{}, err
	}
	concurrency, err := envInt("UPLOAD_CONCURRENCY", 1)
	if err != nil {
		return Config{}, err
	}
	tokenMinutes, err := envInt64("ACCESS_TOKEN_EXPIRE_MINUTES", 24*60)
	if err != nil {
		return Config{}, err
	}
	seedAdmin, err := envBool("GO_SEED_ADMIN_ON_STARTUP", true)
	if err != nil {
		return Config{}, err
	}

	endpoint := env("MINIO_ENDPOINT", "localhost:9000")
	publicEndpoint := env("MINIO_PUBLIC_ENDPOINT", endpoint)
	cfg := Config{
		Address:            env("GO_BACKEND_ADDRESS", ":8000"),
		DatabaseURL:        env("GO_DATABASE_URL", "postgres://videoinsight:videoinsight@localhost:5432/videoinsight"),
		CORSOrigins:        parseOrigins(env("CORS_ORIGINS", `["http://localhost:5173"]`)),
		SecretKey:          env("SECRET_KEY", "dev-secret-change-me"),
		AccessTokenTTL:     time.Duration(tokenMinutes) * time.Minute,
		AdminUsername:      env("ADMIN_USERNAME", "admin"),
		AdminPassword:      env("ADMIN_PASSWORD", "admin"),
		DefaultGroupName:   env("DEFAULT_GROUP_NAME", "Default"),
		SeedAdminOnStartup: seedAdmin,
		S3Endpoint:         endpointURL(endpoint, secure),
		S3PublicEndpoint:   endpointURL(publicEndpoint, publicSecure),
		S3AccessKey:        env("MINIO_ACCESS_KEY", "minioadmin"),
		S3SecretKey:        env("MINIO_SECRET_KEY", "minioadmin"),
		S3Bucket:           env("MINIO_BUCKET", "videos"),
		S3Secure:           secure,
		S3PublicSecure:     publicSecure,
		S3Region:           env("MINIO_REGION", "us-east-1"),
		UploadPartSize:     partSize,
		UploadURLTTL:       time.Duration(expires) * time.Second,
		UploadMaxParts:     maxParts,
		UploadConcurrency:  max(1, concurrency),
	}
	if err := cfg.Validate(); err != nil {
		return Config{}, err
	}
	return cfg, nil
}

func (c Config) Validate() error {
	if c.DatabaseURL == "" || c.SecretKey == "" {
		return errors.New("GO_DATABASE_URL and SECRET_KEY must not be empty")
	}
	if c.UploadPartSize < 5*1024*1024 {
		return errors.New("UPLOAD_PART_SIZE_BYTES must be at least 5 MiB")
	}
	if c.UploadMaxParts < 1 || c.UploadMaxParts > 10000 {
		return errors.New("UPLOAD_MAX_PARTS must be between 1 and 10000")
	}
	return nil
}

func parseOrigins(value string) []string {
	var origins []string
	if json.Unmarshal([]byte(value), &origins) == nil {
		return origins
	}
	for _, origin := range strings.Split(value, ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins = append(origins, trimmed)
		}
	}
	return origins
}

func endpointURL(endpoint string, secure bool) string {
	if strings.HasPrefix(endpoint, "http://") || strings.HasPrefix(endpoint, "https://") {
		return endpoint
	}
	scheme := "http"
	if secure {
		scheme = "https"
	}
	return scheme + "://" + endpoint
}

func env(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) (bool, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseBool(value)
	if err != nil {
		return false, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func envOptionalBool(key string, fallback bool) (bool, error) {
	return envBool(key, fallback)
}

func envInt(key string, fallback int) (int, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

func envInt64(key string, fallback int64) (int64, error) {
	value := os.Getenv(key)
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseInt(value, 10, 64)
	if err != nil {
		return 0, fmt.Errorf("parse %s: %w", key, err)
	}
	return parsed, nil
}

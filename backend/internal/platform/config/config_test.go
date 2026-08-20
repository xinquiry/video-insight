package config

import "testing"

func TestLoadUsesGoDatabaseURL(t *testing.T) {
	t.Setenv("GO_DATABASE_URL", "postgres://user:pass@db:5432/app")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.DatabaseURL != "postgres://user:pass@db:5432/app" {
		t.Fatalf("got %q", cfg.DatabaseURL)
	}
}

func TestLoadParsesJSONOriginsAndEndpoints(t *testing.T) {
	t.Setenv("CORS_ORIGINS", `["https://app.example.com"]`)
	t.Setenv("MINIO_ENDPOINT", "account.r2.cloudflarestorage.com")
	t.Setenv("MINIO_SECURE", "true")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if len(cfg.CORSOrigins) != 1 || cfg.CORSOrigins[0] != "https://app.example.com" {
		t.Fatalf("origins: %#v", cfg.CORSOrigins)
	}
	if cfg.S3Endpoint != "https://account.r2.cloudflarestorage.com" {
		t.Fatalf("endpoint: %q", cfg.S3Endpoint)
	}
}

func TestLoadCanDisableStartupAdminSeed(t *testing.T) {
	t.Setenv("GO_SEED_ADMIN_ON_STARTUP", "false")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SeedAdminOnStartup {
		t.Fatal("startup admin seed should be disabled")
	}
}

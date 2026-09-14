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

func TestLoadDriveExportConfiguration(t *testing.T) {
	t.Setenv("DRIVE_EXPORT_ENABLED", "true")
	t.Setenv("DRIVE_EXPORT_WEBDAV_URL", "http://tbox-webdav:65472")
	t.Setenv("DRIVE_EXPORT_USERNAME", "videoinsight")
	t.Setenv("DRIVE_EXPORT_PASSWORD", "drive-secret")
	cfg, err := Load()
	if err != nil {
		t.Fatal(err)
	}
	if !cfg.DriveExportEnabled || cfg.DriveExportDestinationRoot != "VideoInsight" {
		t.Fatalf("drive export config: %+v", cfg)
	}
}

func TestLoadRejectsIncompleteDriveExportConfiguration(t *testing.T) {
	t.Setenv("DRIVE_EXPORT_ENABLED", "true")
	if _, err := Load(); err == nil {
		t.Fatal("expected missing drive export password to fail validation")
	}
}

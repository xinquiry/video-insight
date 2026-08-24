package media

import (
	"context"
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
)

type unusedObjectStorage struct{}

func (unusedObjectStorage) DownloadObject(context.Context, string, string) error { return nil }
func (unusedObjectStorage) UploadObject(context.Context, string, string, string) (int64, error) {
	return 0, nil
}

func TestNewFFmpegOptimizerRemovesInterruptedWorkDirectories(t *testing.T) {
	t.Parallel()
	tempDir := t.TempDir()
	staleDir := filepath.Join(tempDir, "video-stale")
	if err := os.Mkdir(staleDir, 0o750); err != nil {
		t.Fatal(err)
	}
	keepPath := filepath.Join(tempDir, "keep")
	if err := os.WriteFile(keepPath, []byte("keep"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := NewFFmpegOptimizer(unusedObjectStorage{}, "true", tempDir); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(staleDir); !os.IsNotExist(err) {
		t.Fatalf("interrupted work directory still exists: %v", err)
	}
	if _, err := os.Stat(keepPath); err != nil {
		t.Fatalf("unrelated temp file was removed: %v", err)
	}
}

func TestHasFastStart(t *testing.T) {
	t.Parallel()
	for _, test := range []struct {
		name    string
		boxes   []string
		want    bool
		wantErr bool
	}{
		{name: "moov before media", boxes: []string{"ftyp", "moov", "mdat"}, want: true},
		{name: "moov after media", boxes: []string{"ftyp", "mdat", "moov"}, want: false},
		{name: "missing media", boxes: []string{"ftyp", "moov"}, wantErr: true},
		{name: "missing metadata", boxes: []string{"ftyp", "mdat"}, wantErr: true},
	} {
		t.Run(test.name, func(t *testing.T) {
			t.Parallel()
			path := filepath.Join(t.TempDir(), "video.mp4")
			file, err := os.Create(path)
			if err != nil {
				t.Fatal(err)
			}
			for _, boxType := range test.boxes {
				header := make([]byte, 8)
				binary.BigEndian.PutUint32(header[:4], 8)
				copy(header[4:], boxType)
				if _, err := file.Write(header); err != nil {
					t.Fatal(err)
				}
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			got, err := hasFastStart(path)
			if test.wantErr {
				if err == nil {
					t.Fatal("expected an MP4 layout error")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if got != test.want {
				t.Fatalf("got %v, want %v", got, test.want)
			}
		})
	}
}

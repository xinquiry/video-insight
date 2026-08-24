package media

import (
	"context"
	"encoding/binary"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

type ObjectStorage interface {
	DownloadObject(ctx context.Context, objectKey, destination string) error
	UploadObject(ctx context.Context, objectKey, contentType, source string) (int64, error)
}

type FFmpegOptimizer struct {
	storage    ObjectStorage
	ffmpegPath string
	tempDir    string
}

func NewFFmpegOptimizer(storage ObjectStorage, ffmpegPath, tempDir string) (*FFmpegOptimizer, error) {
	path, err := exec.LookPath(ffmpegPath)
	if err != nil {
		return nil, fmt.Errorf("find ffmpeg: %w", err)
	}
	if err := os.MkdirAll(tempDir, 0o750); err != nil {
		return nil, fmt.Errorf("create video processing directory: %w", err)
	}
	workDirs, err := filepath.Glob(filepath.Join(tempDir, "video-*"))
	if err != nil {
		return nil, fmt.Errorf("find interrupted video work directories: %w", err)
	}
	for _, workDir := range workDirs {
		if err := os.RemoveAll(workDir); err != nil {
			return nil, fmt.Errorf("remove interrupted video work directory: %w", err)
		}
	}
	return &FFmpegOptimizer{storage: storage, ffmpegPath: path, tempDir: tempDir}, nil
}

func (o *FFmpegOptimizer) Optimize(ctx context.Context, video model.Video) (int64, error) {
	if !isMP4(video) {
		return video.SizeBytes, nil
	}

	workDir, err := os.MkdirTemp(o.tempDir, "video-")
	if err != nil {
		return 0, fmt.Errorf("create video work directory: %w", err)
	}
	defer func() { _ = os.RemoveAll(workDir) }()

	inputPath := filepath.Join(workDir, "input.mp4")
	outputPath := filepath.Join(workDir, "faststart.mp4")
	if err := o.storage.DownloadObject(ctx, video.ObjectKey, inputPath); err != nil {
		return 0, err
	}
	ready, err := hasFastStart(inputPath)
	if err != nil {
		return 0, fmt.Errorf("inspect MP4 layout: %w", err)
	}
	if ready {
		info, err := os.Stat(inputPath)
		if err != nil {
			return 0, fmt.Errorf("stat optimized video: %w", err)
		}
		return info.Size(), nil
	}

	command := exec.CommandContext(ctx, o.ffmpegPath,
		"-hide_banner", "-loglevel", "error", "-nostdin", "-y",
		"-i", inputPath,
		"-map", "0", "-map_metadata", "0", "-map_chapters", "0",
		"-c", "copy", "-movflags", "+faststart", outputPath,
	)
	output, err := command.CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(output))
		if len(message) > 2000 {
			message = message[len(message)-2000:]
		}
		return 0, fmt.Errorf("ffmpeg fast-start remux: %w: %s", err, message)
	}
	ready, err = hasFastStart(outputPath)
	if err != nil {
		return 0, fmt.Errorf("verify optimized MP4: %w", err)
	}
	if !ready {
		return 0, fmt.Errorf("verify optimized MP4: moov atom is not before media data")
	}
	return o.storage.UploadObject(ctx, video.ObjectKey, "video/mp4", outputPath)
}

func isMP4(video model.Video) bool {
	return strings.EqualFold(video.ContentType, "video/mp4") ||
		strings.EqualFold(filepath.Ext(video.OriginalFilename), ".mp4")
}

func hasFastStart(path string) (bool, error) {
	file, err := os.Open(path)
	if err != nil {
		return false, err
	}
	defer func() { _ = file.Close() }()
	info, err := file.Stat()
	if err != nil {
		return false, err
	}

	var offset int64
	var moovOffset, mdatOffset int64 = -1, -1
	header := make([]byte, 16)
	for offset+8 <= info.Size() {
		if _, err := file.ReadAt(header[:8], offset); err != nil {
			return false, err
		}
		boxSize := int64(binary.BigEndian.Uint32(header[:4]))
		boxType := string(header[4:8])
		headerSize := int64(8)
		switch boxSize {
		case 0:
			boxSize = info.Size() - offset
		case 1:
			if _, err := file.ReadAt(header[8:16], offset+8); err != nil {
				return false, err
			}
			boxSize = int64(binary.BigEndian.Uint64(header[8:16]))
			headerSize = 16
		}
		if boxSize < headerSize || offset+boxSize > info.Size() {
			return false, fmt.Errorf("invalid %q box size %d at offset %d", boxType, boxSize, offset)
		}
		switch boxType {
		case "moov":
			if moovOffset < 0 {
				moovOffset = offset
			}
		case "mdat":
			if mdatOffset < 0 {
				mdatOffset = offset
			}
		}
		offset += boxSize
	}
	if moovOffset < 0 {
		return false, fmt.Errorf("no moov atom found")
	}
	if mdatOffset < 0 {
		return false, fmt.Errorf("no mdat atom found")
	}
	return moovOffset < mdatOffset, nil
}

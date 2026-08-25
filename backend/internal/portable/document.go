package portable

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"path"
	"sort"
	"strings"
	"time"

	"github.com/xinquiry/video-insight/backend/internal/model"
)

const (
	DocumentFormat         = "videoinsight.annotated-video"
	DocumentFormatVersion  = 1
	AnnotationTrackFormat  = "videoinsight.annotation-track"
	AnnotationTrackVersion = 1
	PackageMIME            = "application/vnd.videoinsight.package+zip"
	PackageExtension       = ".vinsight"
	ManifestPath           = "manifest.json"
	AssetScheme            = "vinsight-asset://"
	MaxPackageAssets       = 4_093
	MaxPackageAssetBytes   = 64 * 1024 * 1024
)

// Document is the stable, portable package-manifest contract. It is intentionally
// separate from HTTP and database DTOs so either can evolve independently.
type Document struct {
	Format          string          `json:"format"`
	FormatVersion   int             `json:"format_version"`
	ExportedAt      time.Time       `json:"exported_at"`
	Video           VideoMetadata   `json:"video"`
	AnnotationTrack AnnotationTrack `json:"annotation_track"`
	Extensions      map[string]any  `json:"extensions"`
}

type VideoMetadata struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Description *string `json:"description"`
	Filename    string  `json:"filename"`
	MediaPath   string  `json:"media_path"`
	ContentType string  `json:"content_type"`
	SizeBytes   int64   `json:"size_bytes"`
}

type AnnotationTrack struct {
	Format        string         `json:"format"`
	FormatVersion int            `json:"format_version"`
	Annotations   []Annotation   `json:"annotations"`
	Extensions    map[string]any `json:"extensions"`
}

type Annotation struct {
	ID               string         `json:"id"`
	TimestampSeconds float64        `json:"timestamp_seconds"`
	DurationSeconds  float64        `json:"duration_seconds"`
	PositionX        *float64       `json:"position_x"`
	PositionY        *float64       `json:"position_y"`
	RegionX          *float64       `json:"region_x"`
	RegionY          *float64       `json:"region_y"`
	RegionWidth      *float64       `json:"region_width"`
	RegionHeight     *float64       `json:"region_height"`
	Shape            string         `json:"shape"`
	DisplayMode      string         `json:"display_mode"`
	Interactive      bool           `json:"interactive"`
	Content          map[string]any `json:"content"`
	Kind             string         `json:"kind"`
	Color            string         `json:"color"`
	CustomData       map[string]any `json:"custom_data"`
	CreatedAt        time.Time      `json:"created_at"`
	UpdatedAt        *time.Time     `json:"updated_at"`
}

type Asset struct {
	Path string
	Data []byte
}

type Bundle struct {
	Document Document
	Assets   []Asset
}

func NewDocument(video model.Video, mediaPath string, annotations []model.Annotation, exportedAt time.Time) Document {
	items := make([]Annotation, 0, len(annotations))
	for _, annotation := range annotations {
		items = append(items, Annotation{
			ID: annotation.ID.String(), TimestampSeconds: annotation.TimestampSeconds,
			DurationSeconds: annotation.DurationSeconds, PositionX: annotation.PositionX,
			PositionY: annotation.PositionY, RegionX: annotation.RegionX, RegionY: annotation.RegionY,
			RegionWidth: annotation.RegionWidth, RegionHeight: annotation.RegionHeight,
			Shape: annotation.Shape, DisplayMode: annotation.DisplayMode, Interactive: annotation.Interactive,
			Content: annotation.Content, Kind: annotation.Kind, Color: annotation.Color,
			CustomData: model.NormalizeJSONMap(annotation.CustomData), CreatedAt: annotation.CreatedAt,
			UpdatedAt: annotation.UpdatedAt,
		})
	}
	return Document{
		Format: DocumentFormat, FormatVersion: DocumentFormatVersion, ExportedAt: exportedAt.UTC(),
		Video: VideoMetadata{
			ID: video.ID.String(), Title: video.Title, Description: video.Description,
			Filename: video.OriginalFilename, MediaPath: mediaPath,
			ContentType: video.ContentType, SizeBytes: video.SizeBytes,
		},
		AnnotationTrack: AnnotationTrack{
			Format: AnnotationTrackFormat, FormatVersion: AnnotationTrackVersion,
			Annotations: items, Extensions: map[string]any{},
		},
		Extensions: map[string]any{},
	}
}

func NewBundle(video model.Video, mediaPath string, annotations []model.Annotation, exportedAt time.Time) (Bundle, error) {
	document := NewDocument(video, mediaPath, annotations, exportedAt)
	assets := map[string]Asset{}
	for index := range document.AnnotationTrack.Annotations {
		content, err := cloneJSONMap(document.AnnotationTrack.Annotations[index].Content)
		if err != nil {
			return Bundle{}, fmt.Errorf("clone annotation content: %w", err)
		}
		if err := externalizeImages(content, assets); err != nil {
			return Bundle{}, err
		}
		document.AnnotationTrack.Annotations[index].Content = content
	}
	paths := make([]string, 0, len(assets))
	totalAssetBytes := 0
	for assetPath := range assets {
		paths = append(paths, assetPath)
		totalAssetBytes += len(assets[assetPath].Data)
	}
	if len(paths) > MaxPackageAssets {
		return Bundle{}, fmt.Errorf("package contains too many annotation assets")
	}
	if totalAssetBytes > MaxPackageAssetBytes {
		return Bundle{}, fmt.Errorf("package annotation assets exceed 64 MiB")
	}
	sort.Strings(paths)
	result := make([]Asset, 0, len(paths))
	for _, assetPath := range paths {
		result = append(result, assets[assetPath])
	}
	return Bundle{Document: document, Assets: result}, nil
}

// WritePackage streams a portable package without buffering the video in
// memory. Video is stored because codecs are already compressed; JSON is
// deflated. The MIME marker is first and uncompressed for cheap identification.
func WritePackage(output io.Writer, bundle Bundle, media io.Reader) error {
	document := bundle.Document
	archive := zip.NewWriter(output)
	writeEntry := func(name string, method uint16, content io.Reader) error {
		header := &zip.FileHeader{Name: name, Method: method}
		header.SetModTime(document.ExportedAt)
		entry, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		_, err = io.Copy(entry, content)
		return err
	}

	if err := writeEntry("mimetype", zip.Store, strings.NewReader(PackageMIME)); err != nil {
		_ = archive.Close()
		return fmt.Errorf("write package MIME marker: %w", err)
	}
	manifest, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		_ = archive.Close()
		return fmt.Errorf("encode package manifest: %w", err)
	}
	manifest = append(manifest, '\n')
	if err := writeEntry(ManifestPath, zip.Deflate, bytes.NewReader(manifest)); err != nil {
		_ = archive.Close()
		return fmt.Errorf("write package manifest: %w", err)
	}
	for _, asset := range bundle.Assets {
		if err := writeEntry(asset.Path, zip.Store, bytes.NewReader(asset.Data)); err != nil {
			_ = archive.Close()
			return fmt.Errorf("write package asset %s: %w", asset.Path, err)
		}
	}
	if path.Clean(document.Video.MediaPath) != document.Video.MediaPath || path.IsAbs(document.Video.MediaPath) {
		_ = archive.Close()
		return fmt.Errorf("invalid package media path %q", document.Video.MediaPath)
	}
	if err := writeEntry(document.Video.MediaPath, zip.Store, media); err != nil {
		_ = archive.Close()
		return fmt.Errorf("write package media: %w", err)
	}
	if err := archive.Close(); err != nil {
		return fmt.Errorf("finalize package: %w", err)
	}
	return nil
}

func cloneJSONMap(value map[string]any) (map[string]any, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	cloned := map[string]any{}
	if err := json.Unmarshal(encoded, &cloned); err != nil {
		return nil, err
	}
	return cloned, nil
}

func externalizeImages(value any, assets map[string]Asset) error {
	switch node := value.(type) {
	case map[string]any:
		if node["type"] == "image" {
			attrs, _ := node["attrs"].(map[string]any)
			source, _ := attrs["src"].(string)
			if source != "" {
				asset, ok, err := assetFromDataURL(source)
				if err != nil {
					return err
				}
				if ok {
					assets[asset.Path] = asset
					attrs["src"] = AssetScheme + asset.Path
				}
			}
		}
		for _, child := range node {
			if err := externalizeImages(child, assets); err != nil {
				return err
			}
		}
	case []any:
		for _, child := range node {
			if err := externalizeImages(child, assets); err != nil {
				return err
			}
		}
	}
	return nil
}

func assetFromDataURL(source string) (Asset, bool, error) {
	types := []struct {
		prefix      string
		contentType string
		extension   string
	}{
		{"data:image/png;base64,", "image/png", ".png"},
		{"data:image/jpeg;base64,", "image/jpeg", ".jpg"},
		{"data:image/gif;base64,", "image/gif", ".gif"},
		{"data:image/webp;base64,", "image/webp", ".webp"},
	}
	for _, imageType := range types {
		if !strings.HasPrefix(source, imageType.prefix) {
			continue
		}
		data, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(source, imageType.prefix))
		if err != nil {
			return Asset{}, false, fmt.Errorf("decode annotation image: %w", err)
		}
		if len(data) > 3*1024*1024 {
			return Asset{}, false, fmt.Errorf("annotation image exceeds package limit")
		}
		if !validImageSignature(imageType.contentType, data) {
			return Asset{}, false, fmt.Errorf("annotation image content does not match %s", imageType.contentType)
		}
		digest := sha256.Sum256(data)
		assetPath := fmt.Sprintf("assets/%x%s", digest, imageType.extension)
		return Asset{Path: assetPath, Data: data}, true, nil
	}
	return Asset{}, false, nil
}

func validImageSignature(contentType string, data []byte) bool {
	switch contentType {
	case "image/png":
		return bytes.HasPrefix(data, []byte("\x89PNG\r\n\x1a\n"))
	case "image/jpeg":
		return bytes.HasPrefix(data, []byte("\xff\xd8\xff"))
	case "image/gif":
		return bytes.HasPrefix(data, []byte("GIF87a")) || bytes.HasPrefix(data, []byte("GIF89a"))
	case "image/webp":
		return len(data) >= 12 && bytes.Equal(data[:4], []byte("RIFF")) && bytes.Equal(data[8:12], []byte("WEBP"))
	default:
		return false
	}
}

package httpapi

import (
	"net/http"
	"time"

	"github.com/xinquiry/video-insight/backend/internal/portable"
	"github.com/xinquiry/video-insight/backend/internal/shared/apperror"
)

// packageManifest returns everything the browser needs to assemble a
// .vinsight package client-side: the portable document (video metadata plus
// annotations from PostgreSQL, generated now) and the presigned download
// URL for the published video object on the drive. The browser streams the
// video directly from COS and zips the parts together.
func (s *Server) packageManifest(w http.ResponseWriter, r *http.Request) {
	videoID, ok := pathUUID(w, r, "videoID")
	if !ok {
		return
	}
	groupID := currentUser(r).GroupID

	result, err := s.videos.Get(r.Context(), videoID, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	video := result.Video
	items, err := s.annotations.List(r.Context(), videoID, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	publish, err := s.driveExports.Status(r.Context(), videoID, groupID)
	if err != nil {
		s.writeError(w, r, err)
		return
	}
	if publish.DownloadURL == "" {
		s.writeError(w, r, apperror.NewCode(
			http.StatusConflict, "drive_export_not_published", "This video has no published copy yet"))
		return
	}

	// media path matches the portable contract: media/<original filename>
	mediaPath := "media/" + video.OriginalFilename
	document := portable.NewDocument(video, mediaPath, items, time.Now())

	response := packageManifestResponse{
		Document:    document,
		VideoURL:    publish.DownloadURL,
		PackageMIME: portable.PackageMIME,
		VideoBytes:  video.SizeBytes,
		Filename:    video.OriginalFilename,
	}
	writeJSON(w, http.StatusOK, response)
}

type packageManifestResponse struct {
	Document    any    `json:"document"`
	VideoURL    string `json:"video_url"`
	PackageMIME string `json:"package_mime"`
	VideoBytes  int64  `json:"video_bytes"`
	Filename    string `json:"filename"`
}

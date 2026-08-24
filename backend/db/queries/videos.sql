-- name: GetVideoByIDForGroup :one
SELECT * FROM videos WHERE id = $1 AND group_id = $2;

-- name: CountVideosForGroup :one
SELECT count(*) FROM videos WHERE group_id = $1;

-- name: ListVideosForGroup :many
SELECT * FROM videos
WHERE group_id = $1
ORDER BY created_at DESC
OFFSET $2 LIMIT $3;

-- name: CreateVideo :one
INSERT INTO videos (
    group_id, title, description, object_key, original_filename, content_type, size_bytes,
    processing_status
) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
RETURNING *;

-- name: UpdateVideo :one
UPDATE videos
SET title = $3, description = $4, updated_at = now()
WHERE id = $1 AND group_id = $2
RETURNING *;

-- name: DeleteVideo :execrows
DELETE FROM videos
WHERE id = $1 AND group_id = $2 AND processing_status <> 'processing';

-- name: RequeueInterruptedVideoProcessing :execrows
UPDATE videos
SET
    processing_status = 'pending',
    processing_started_at = NULL,
    processing_available_at = now(),
    updated_at = now()
WHERE processing_status = 'processing';

-- name: ClaimVideoForProcessing :one
WITH candidate AS (
    SELECT id
    FROM videos
    WHERE
        (processing_status = 'pending' AND processing_available_at <= now())
        OR (
            processing_status = 'processing'
            AND processing_started_at < now() - interval '6 hours'
        )
    ORDER BY processing_available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE videos
SET
    processing_status = 'processing',
    processing_error = NULL,
    processing_attempts = processing_attempts + 1,
    processing_started_at = now(),
    updated_at = now()
WHERE id = (SELECT id FROM candidate)
RETURNING *;

-- name: MarkVideoProcessingReady :execrows
UPDATE videos
SET
    processing_status = 'ready',
    processing_error = NULL,
    processing_started_at = NULL,
    size_bytes = $2,
    updated_at = now()
WHERE id = $1 AND processing_status = 'processing';

-- name: MarkVideoProcessingFailed :execrows
UPDATE videos
SET
    processing_status = $2,
    processing_error = $3,
    processing_started_at = NULL,
    processing_available_at = $4,
    updated_at = now()
WHERE id = $1 AND processing_status = 'processing';

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
    group_id, title, description, object_key, original_filename, content_type, size_bytes
) VALUES ($1, $2, $3, $4, $5, $6, $7)
RETURNING *;

-- name: UpdateVideo :one
UPDATE videos
SET title = $3, description = $4, updated_at = now()
WHERE id = $1 AND group_id = $2
RETURNING *;

-- name: DeleteVideo :execrows
DELETE FROM videos WHERE id = $1 AND group_id = $2;

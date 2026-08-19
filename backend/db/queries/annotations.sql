-- name: GetAnnotationByID :one
SELECT * FROM annotations WHERE id = $1;

-- name: ListAnnotationsForVideo :many
SELECT * FROM annotations
WHERE video_id = $1
ORDER BY timestamp_seconds ASC, created_at ASC;

-- name: CreateAnnotation :one
INSERT INTO annotations (
    video_id, timestamp_seconds, duration_seconds, position_x, position_y,
    region_x, region_y, region_width, region_height, shape, display_mode,
    interactive, title, body, kind, color, custom_data
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17
)
RETURNING *;

-- name: UpdateAnnotation :one
UPDATE annotations SET
    timestamp_seconds = $2,
    duration_seconds = $3,
    position_x = $4,
    position_y = $5,
    region_x = $6,
    region_y = $7,
    region_width = $8,
    region_height = $9,
    shape = $10,
    display_mode = $11,
    interactive = $12,
    title = $13,
    body = $14,
    kind = $15,
    color = $16,
    custom_data = $17,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteAnnotation :execrows
DELETE FROM annotations WHERE id = $1;

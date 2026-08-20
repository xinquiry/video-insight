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
    interactive, content, kind, color, custom_data
) VALUES (
    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16
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
    content = $13,
    kind = $14,
    color = $15,
    custom_data = $16,
    updated_at = now()
WHERE id = $1
RETURNING *;

-- name: DeleteAnnotation :execrows
DELETE FROM annotations WHERE id = $1;

-- name: ListAnnotationComments :many
SELECT annotation_comments.*, users.username AS author_username
FROM annotation_comments
JOIN users ON users.id = annotation_comments.user_id
WHERE annotation_comments.annotation_id = $1
ORDER BY annotation_comments.created_at ASC;

-- name: CreateAnnotationComment :one
WITH inserted AS (
    INSERT INTO annotation_comments (annotation_id, user_id, body)
    VALUES ($1, $2, $3)
    RETURNING *
)
SELECT inserted.*, users.username AS author_username
FROM inserted
JOIN users ON users.id = inserted.user_id;

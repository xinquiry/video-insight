-- name: GetDriveExportByVideoForGroup :one
SELECT * FROM drive_exports WHERE video_id = $1 AND group_id = $2;

-- name: QueueDriveExport :one
INSERT INTO drive_exports (
    video_id, group_id, requested_by, status, destination_path
) VALUES ($1, $2, $3, 'pending', $4)
ON CONFLICT (video_id) DO UPDATE SET
    group_id = EXCLUDED.group_id,
    requested_by = EXCLUDED.requested_by,
    status = 'pending',
    destination_path = EXCLUDED.destination_path,
    size_bytes = NULL,
    error = NULL,
    attempts = 0,
    started_at = NULL,
    available_at = now(),
    completed_at = NULL,
    updated_at = now()
RETURNING *;

-- name: RequeueInterruptedDriveExports :execrows
UPDATE drive_exports
SET
    status = 'pending',
    started_at = NULL,
    available_at = now(),
    updated_at = now()
WHERE status IN ('preparing', 'uploading');

-- name: ClaimDriveExport :one
WITH candidate AS (
    SELECT id
    FROM drive_exports
    WHERE
        (status = 'pending' AND available_at <= now())
        OR (
            status IN ('preparing', 'uploading')
            AND started_at < now() - interval '12 hours'
        )
    ORDER BY available_at ASC, created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT 1
)
UPDATE drive_exports
SET
    status = 'preparing',
    error = NULL,
    attempts = attempts + 1,
    started_at = now(),
    updated_at = now()
WHERE id = (SELECT id FROM candidate)
RETURNING *;

-- name: MarkDriveExportUploading :execrows
UPDATE drive_exports
SET status = 'uploading', size_bytes = $2, updated_at = now()
WHERE id = $1 AND status = 'preparing';

-- name: MarkDriveExportCompleted :execrows
UPDATE drive_exports
SET
    status = 'completed',
    error = NULL,
    started_at = NULL,
    completed_at = now(),
    updated_at = now()
WHERE id = $1 AND status = 'uploading';

-- name: MarkDriveExportFailed :execrows
UPDATE drive_exports
SET
    status = $2,
    error = $3,
    started_at = NULL,
    available_at = $4,
    updated_at = now()
WHERE id = $1 AND status IN ('preparing', 'uploading');

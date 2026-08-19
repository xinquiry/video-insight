-- name: GetUserByID :one
SELECT * FROM users WHERE id = $1;

-- name: GetUserByUsername :one
SELECT * FROM users WHERE username = $1;

-- name: CreateUser :one
INSERT INTO users (username, password_hash, group_id, is_admin)
VALUES ($1, $2, $3, $4)
RETURNING *;

-- name: UpdateUser :one
UPDATE users
SET password_hash = $2, group_id = $3, is_admin = $4, updated_at = now()
WHERE id = $1
RETURNING *;

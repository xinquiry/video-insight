-- name: GetGroupByID :one
SELECT * FROM groups WHERE id = $1;

-- name: GetGroupByName :one
SELECT * FROM groups WHERE name = $1;

-- name: ListGroups :many
SELECT * FROM groups ORDER BY name ASC;

-- name: CreateGroup :one
INSERT INTO groups (name) VALUES ($1) RETURNING *;

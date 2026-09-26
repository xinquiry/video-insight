# sjtu-oss-gateway

Presign-broker turning the SJTU Drive (Tencent SMH) into OSS-like object
storage for the matrix k3s cluster. Go 1.27 + chi, no database, all state
lives in pan.sjtu.edu.cn.

## Layout

- `cmd/gateway/` — process entrypoint, flags, graceful shutdown.
- `internal/smh/` — reverse-engineered SMH API client: UserToken →
  accessToken refresh, directory creation, presigned multipart uploads
  (4 MiB fixed parts), confirm, download URLs (302 → COS presigned),
  stat, delete. Wire contract verified 2026-09-26 (see README).
- `internal/auth/` — per-project access keys (JSON Secret, hot-reloaded),
  prefix namespacing, path traversal rejection.
- `internal/api/` — REST surface (chi), Basic auth. `uploadId` is an opaque
  composite `"<smhId>|<confirmKey>"`.

## Commands

```sh
go build ./...
go test -race ./...
go vet ./...
gofmt -l .        # must print nothing
go run ./cmd/gateway -address :8200 \
  -user-token-file <file> -keys-file access-keys.json
```

## Conventions

- The gateway never touches object bytes: presign only. If a handler is
  moving bytes, the design broke.
- All SMH specifics stay in `internal/smh/`; `internal/api/` speaks only
  in object keys and part numbers.
- Secrets (UserToken, project secrets) are files mounted from k8s
  Secrets; nothing secret in the repo.
- Deploy manifests are NOT here: they live in `~/Projects/Lab/deploy/
  sjtu-oss-gateway/` (infra namespace) — deployment-wise this is shared
  cluster infra, code-wise it lives in this monorepo. Projects beyond
  video-insight consume it through the deploy repo's gateway Service.
- CI: built and pushed as ghcr.io/xinquiry/video-insight-gateway by the
  matrix job in .github/workflows/build-images.yaml (repo root).
- When editing the SMH client, re-verify against the live API with curl
  before shipping (pan tokens live in the k8s Secret `smh-credentials`
  in the infra namespace).

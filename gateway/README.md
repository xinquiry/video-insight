# sjtu-oss-gateway

A presign-broker that turns the SJTU Drive (上海交大网盘 / Tencent SMH)
into an OSS-like object storage service for self-hosted projects.

```
project backend ──(access key + secret, small JSON)──> gateway (k8s, matrix)
                                                        │ control plane
                                                        ▼
                                            pan.sjtu.edu.cn (SMH API)
                                                        │ signs
                                                        ▼
                                            s3pan*.jcloud.sjtu.edu.cn (COS)
                                                        ▲
browser ────────── video bytes, direct PUT/GET ─────────┘  data plane
```

The frp tunnel only carries the control-plane JSON; all object bytes flow
directly between the browser and COS. Verified by spike on 2026-09-26:
multipart presign, CORS (origin echo), 4 MiB parts, 2 h download URLs,
Range requests all work.

## API (Basic auth: access key / secret)

| Endpoint | Purpose |
| --- | --- |
| `POST /v1/uploads` `{objectKey, partCount}` → `{uploadId, parts:[{partNumber, url, headers}]}` | Start multipart upload; parts carry SigV4 headers the browser PUTs verbatim |
| `POST /v1/uploads/renew` `{objectKey, uploadId, partFrom, partTo}` | Re-sign parts for an in-flight upload (≤ 50 part numbers per call, per SMH) |
| `POST /v1/uploads/complete` `{objectKey, uploadId}` | Confirm the upload (assembles the object) |
| `POST /v1/uploads/abort` `{objectKey, uploadId}` | Acknowledge abort (SMH sessions expire server-side) |
| `GET /v1/objects/download-url?key=...` → `{url}` | Presigned COS URL (2 h validity) |
| `GET /v1/objects/stat?key=...` | Object size / existence |
| `DELETE /v1/objects?key=...` | Delete object |
| `GET /healthz` | Liveness |

`uploadId` is an opaque composite `"<smh uploadId>|<confirmKey>"`.
`partSize` is fixed at 4 MiB (SMH requirement) and returned in every
upload response.

## Configuration

- `SMH_USER_TOKEN` (file, k8s Secret): 128-hex SJTU Drive UserToken,
  ~30-day validity, rotated out-of-band. The gateway exchanges it for a
  30-minute accessToken automatically.
- `access-keys.json` (file, k8s Secret): per-project credentials and SMH
  prefix mapping:

  ```json
  {
    "projects": [
      {"name": "videoinsight", "prefix": "projects/videoinsight", "secret": "<random>"}
    ]
  }
  ```

  Object keys are namespaced under the project prefix; traversal is
  rejected. The file is hot-reloaded (mtime check).

## Deployment

`deploy/` manifests live in the deploy repo (`~/Projects/Lab/deploy/sjtu-oss-gateway/`),
namespace `infra`, reachable in-cluster as
`http://sjtu-oss-gateway.infra.svc:8200`.

## Limitations

- Single SJTU account: 1 TB shared quota, all projects share it.
- SMH API is unofficial; the contract was verified 2026-09-26 and may change.
- No bucket listing yet (add when a project needs it).
- 4 MiB fixed part size; ~5,000 parts for a 20 GB video. Upload client
  should renew signatures for slow transfers (15 min validity).

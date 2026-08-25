# Portable annotated-video export

VideoInsight exports one `.vinsight` file. It is a standard streaming ZIP
container with this layout:

```text
lesson.vinsight
├── mimetype
├── manifest.json
├── media/
│   └── lesson.mp4
└── assets/
    └── <sha256>.png
```

`mimetype` is the first entry, stored without compression, and contains
`application/vnd.videoinsight.package+zip`. Video entries also use ZIP Store
because video codecs are already compressed. JSON is deflated, and image
assets use content-addressed names so repeated images are included only once.

The SaaS streams the package from `GET /api/videos/{video_id}/export`, keeping
server memory bounded. Browsers with the File System Access API also write
directly to the chosen destination. The compatibility fallback buffers a Blob,
so very large exports are best performed in a current Chromium-based browser.

## Version 1 contract

The manifest uses `format: "videoinsight.annotated-video"` and
`format_version: 1`. Its `video` object describes the local media file and its
`media_path` inside the container. The
`annotation_track` is versioned separately as
`videoinsight.annotation-track` version 1 and contains annotations ordered by
timestamp and creation time. The machine-readable contract is
[`schemas/videoinsight-annotated-video-v1.schema.json`](schemas/videoinsight-annotated-video-v1.schema.json).
The shared producer/consumer compatibility fixture is
[`schemas/fixtures/annotated-video-v1-rich.json`](schemas/fixtures/annotated-video-v1-rich.json).

Embedded rich-text images are moved to `assets/` and their `attrs.src` becomes
`vinsight-asset://assets/<sha256>.<extension>`. The desktop package adapter
resolves these references while building the presentation model. Repeated
references share one decoded byte buffer; package assets are limited to 3 MiB
each and 64 MiB total.

`custom_data` is application data attached to an annotation. `extensions` is
reserved for namespaced format extensions; extension keys should use a stable
reverse-domain or URI-like prefix to avoid collisions.

## Evolution rules

- Readers must ignore unknown properties within a format version.
- Writers may add optional properties without increasing a version.
- Removing a property, changing its type or meaning, or moving data to a new
  structure requires increasing the version of the affected document or track.
- Readers must not silently interpret an unsupported structural version. They
  should continue playing the video, skip its annotations, and ask for a player
  update.
- A new player should keep explicit adapters for older versions and normalize
  them to its internal annotation model.
- Normalized presentation blocks retain document order; readers must not group
  all text separately from images or future block types.

The desktop player currently normalizes v1 packages, the legacy top-level
annotation array, and the legacy `{ "annotations": [...] }` sidecar envelope.
This migration boundary keeps playback and UI code independent of wire shape.

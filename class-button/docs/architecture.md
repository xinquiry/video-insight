# Makepad desktop architecture

The desktop application is organized around boundaries that can be reused by
future Makepad products:

1. `portable_contract.rs` owns format/version identifiers and the shared image
   codec/signature rules used by package and legacy-sidecar adapters.
2. `package.rs` owns container validation, safe extraction, asset resolution,
   and temporary-file lifetime. UI code never reads ZIP entries directly.
3. `annotations.rs` owns wire-format adapters and the normalized annotation
   model. It accepts current packages and legacy sidecars, and resolves package
   assets through an injected reader rather than expanding them into JSON.
4. `annotation_content.rs` is a reusable native presentation widget. It maps
   normalized text and image blocks into recycled Makepad rows and caches image
   bindings by content revision.
5. `annotation_timeline.rs` is a reusable presentational timeline. It draws
   colored annotation-duration markers and emits seek actions without owning
   video state.
6. `app.rs` is an orchestration shell: media lifecycle, playback position,
   Class Button events, and high-level screen state. It does not define the
   player layout.
7. `ui/theme.rs` extends Makepad's light theme with VideoInsight design tokens.
   It is registered after `makepad_widgets::theme_mod` and before
   `makepad_widgets::widgets_mod`, so every standard and custom widget sees the
   same selected theme.
8. `ui/primitives.rs` owns reusable visual components (panels, typography,
   badges, timeline rows, and button variants). `ui/player_screen.rs` composes
   those primitives into the read-only classroom player.

## UI system

The player mirrors the SaaS information architecture: a paper/surface header,
black video stage, and a light current-annotation panel. Shared visual tokens
come from the SaaS palette (`paper #faf7f2`, `surface #fffdf9`, `ink #1c1a17`,
`muted #8a817a`, `accent #c0512f`). New desktop screens should reuse these
tokens and the same hierarchy before introducing product-specific decoration.

Rich content is rendered with native Makepad widgets. A future block type
(audio, quiz, code, attachment) should be added first to the normalized
presentation model, then as a new recycled row template. It should not add
format-specific branching to `app.rs`.

The stage overlay and sidebar each own an `AnnotationContent` instance. This
keeps text/image behavior consistent while allowing different light and dark
presentations. Playback and selection state remain centralized in `App`; the
screen and primitives are presentational projections of that state.

Presentation blocks retain source order, so `text → image → text` renders in
the same order as the SaaS editor. The stage also includes the SaaS interaction
model's annotation scrubber: markers use each annotation's color and duration,
and clicking or dragging seeks the native `Video` widget directly.

## Evolution

- Container changes remain backward-compatible ZIP additions.
- Semantic document or annotation-track changes require their own version bump
  and an adapter in `annotations.rs`.
- An unknown document or track version disables annotations with an upgrade
  warning but still opens a unique stored `media/` entry when it can be selected
  safely.
- Package paths are never trusted: readers reject absolute paths, parent
  traversal, excessive entry counts, oversized manifests/assets, compressed
  video entries, and media-size mismatches.
- Extracted media is owned by an RAII package lease so cleanup follows playback
  lifecycle even on errors or replacement.

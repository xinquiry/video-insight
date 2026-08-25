use makepad_widgets::*;

// VideoInsight extends Makepad's light theme instead of maintaining a parallel
// styling mechanism. The vi_* tokens are intentionally product-neutral enough
// to move into a shared workspace UI crate when another Makepad app needs them.
script_mod! {
    mod.themes.video_insight = mod.themes.light{
        space_factor: 6.0
        corner_radius: 8.0
        beveling: 1.0
        font_size_base: 11.0

        color_bg_app: #xfaf7f2
        color_fg_app: #xfffffdf9
        color_bg_container: #xfffffdf9
        color_label_inner: #x1c1a17
        color_label_inner_hover: #x1c1a17
        color_label_inner_down: #x1c1a17
        color_label_inner_focus: #x1c1a17
        color_label_inner_inactive: #x8a817a
        color_label_outer: #x1c1a17
        color_label_outer_off: #x8a817a
        color_text: #x1c1a17
        color_text_hl: #x1c1a17
        color_text_meta: #x8a817a
        color_highlight: #xc0512f
        color_cursor: #xc0512f
        color_cursor_focus: #xc0512f

        vi_paper: #xfaf7f2
        vi_surface: #xfffffdf9
        vi_ink: #x1c1a17
        vi_muted: #x8a817a
        vi_accent: #xc0512f
        vi_accent_hover: #x9f3f25
        vi_forest: #x2f5b4f
        vi_rule: #x1c1a171f
        vi_rule_strong: #x1c1a1738
        vi_rule_soft: #x1c1a170f
        vi_stage: #x080b10
        vi_stage_soft: #x111720
        vi_stage_text: #xf8fafc
        vi_stage_muted: #x94a3b8
        vi_danger: #x9f2f24
    }
}

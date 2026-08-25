use makepad_widgets::*;

script_mod! {
    use mod.prelude.widgets.*
    use mod.widgets.*

    mod.widgets.ViPaper = SolidView{
        show_bg: true
        new_batch: true
        draw_bg.color: theme.vi_paper
    }
    mod.widgets.ViSurface = SolidView{
        show_bg: true
        new_batch: true
        draw_bg.color: theme.vi_surface
    }
    mod.widgets.ViStage = SolidView{
        show_bg: true
        new_batch: true
        draw_bg.color: theme.vi_stage
    }
    mod.widgets.ViPanel = RoundedView{
        show_bg: true
        new_batch: true
        draw_bg +: {
            color: theme.vi_surface
            border_color: theme.vi_rule
            border_size: 1.0
            border_radius: 8.0
        }
    }
    mod.widgets.ViPanelPaper = RoundedView{
        show_bg: true
        new_batch: true
        draw_bg +: {
            color: theme.vi_paper
            border_color: theme.vi_rule
            border_size: 1.0
            border_radius: 8.0
        }
    }
    mod.widgets.ViMediaFrame = RoundedView{
        show_bg: true
        new_batch: true
        clip_x: true
        clip_y: true
        draw_bg +: {
            color: #xebe6df
            border_color: theme.vi_rule
            border_size: 1.0
            border_radius: 7.0
        }
    }
    mod.widgets.ViRule = SolidView{
        width: Fill
        height: 1
        draw_bg.color: theme.vi_rule
    }

    mod.widgets.ViDisplayTitle = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_ink
        draw_text.text_style: theme.font_bold{font_size: 20.0}
    }
    mod.widgets.ViPanelTitle = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_ink
        draw_text.text_style: theme.font_bold{font_size: 16.0}
    }
    mod.widgets.ViSectionTitle = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_ink
        draw_text.text_style: theme.font_bold{font_size: 12.0}
    }
    mod.widgets.ViKicker = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_muted
        draw_text.text_style: theme.font_bold{font_size: 9.0}
    }
    mod.widgets.ViBody = Label{
        width: Fill
        height: Fit
        draw_text.color: theme.vi_ink
        draw_text.text_style: theme.font_regular{font_size: 13.0}
    }
    mod.widgets.ViMeta = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_muted
        draw_text.text_style: theme.font_regular{font_size: 10.0}
    }
    mod.widgets.ViStageMeta = Label{
        width: Fit
        height: Fit
        draw_text.color: theme.vi_stage_muted
        draw_text.text_style: theme.font_regular{font_size: 11.0}
    }

    mod.widgets.ViBadge = RoundedView{
        width: Fit
        height: 28
        flow: Right
        spacing: theme.space_1
        padding: Inset{left: 10 right: 10}
        align: Align{y: 0.5}
        show_bg: true
        new_batch: true
        draw_bg +: {
            color: theme.vi_rule_soft
            border_color: theme.vi_rule
            border_size: 1.0
            border_radius: 7.0
        }
    }
    mod.widgets.ViTimelineRow = RoundedView{
        width: Fill
        height: 50
        flow: Right
        spacing: 10
        padding: Inset{left: 11 right: 11 top: 8 bottom: 8}
        align: Align{y: 0.5}
        show_bg: true
        new_batch: true
        draw_bg +: {
            color: theme.vi_surface
            border_color: theme.vi_rule
            border_size: 1.0
            border_radius: 7.0
        }
    }

    mod.widgets.ViButtonPrimary = ButtonFlat{
        height: 38
        margin: 0.0
        padding: Inset{left: 15 right: 15 top: 0 bottom: 0}
        draw_bg +: {
            color: theme.vi_accent
            color_hover: theme.vi_accent_hover
            color_down: theme.vi_accent_hover
            color_focus: theme.vi_accent
            color_disabled: theme.vi_rule_strong
            border_color: theme.vi_accent
            border_color_hover: theme.vi_accent_hover
            border_color_down: theme.vi_accent_hover
            border_color_focus: theme.vi_ink
            border_color_disabled: theme.vi_rule
            border_radius: 8.0
            border_size: 1.0
        }
        draw_text +: {
            color: theme.vi_paper
            color_hover: theme.vi_paper
            color_down: theme.vi_paper
            color_focus: theme.vi_paper
            color_disabled: theme.vi_muted
            text_style: theme.font_bold{font_size: 11.0}
        }
    }
    mod.widgets.ViButtonSecondary = ButtonFlat{
        height: 38
        margin: 0.0
        padding: Inset{left: 14 right: 14 top: 0 bottom: 0}
        draw_bg +: {
            color: theme.vi_surface
            color_hover: theme.vi_ink
            color_down: theme.vi_ink
            color_focus: theme.vi_surface
            color_disabled: theme.vi_rule_soft
            border_color: theme.vi_rule_strong
            border_color_hover: theme.vi_ink
            border_color_down: theme.vi_ink
            border_color_focus: theme.vi_accent
            border_color_disabled: theme.vi_rule
            border_radius: 8.0
            border_size: 1.0
        }
        draw_text +: {
            color: theme.vi_ink
            color_hover: theme.vi_paper
            color_down: theme.vi_paper
            color_focus: theme.vi_ink
            color_disabled: theme.vi_muted
            text_style: theme.font_bold{font_size: 11.0}
        }
    }
}

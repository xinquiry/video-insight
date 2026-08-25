use makepad_widgets::*;

use crate::annotations::Annotation;

script_mod! {
    use mod.prelude.widgets_internal.*
    use mod.widgets.*

    mod.widgets.AnnotationTimelineBase = #(AnnotationTimeline::register_widget(vm))
    mod.widgets.AnnotationTimeline = set_type_default() do mod.widgets.AnnotationTimelineBase{
        width: Fill
        height: 28
        draw_track +: {color: #xffffff38}
        draw_progress +: {color: #xf7f3e8}
        draw_marker +: {color: #xd96745}
        draw_playhead +: {color: #xf7f3e8}
    }
}

#[derive(Clone, Debug)]
pub struct TimelineSeekAction {
    pub seconds: f64,
}

#[derive(Clone, Debug)]
struct TimelineMarker {
    timestamp_seconds: f64,
    duration_seconds: f64,
    color: Vec4f,
}

#[derive(Script, ScriptHook, Widget)]
pub struct AnnotationTimeline {
    #[uid]
    uid: WidgetUid,
    #[source]
    source: ScriptObjectRef,
    #[walk]
    walk: Walk,
    #[layout]
    layout: Layout,
    #[redraw]
    #[live]
    draw_track: DrawColor,
    #[redraw]
    #[live]
    draw_progress: DrawColor,
    #[redraw]
    #[live]
    draw_marker: DrawColor,
    #[redraw]
    #[live]
    draw_playhead: DrawColor,
    #[redraw]
    #[rust]
    area: Area,
    #[rust]
    current_seconds: f64,
    #[rust]
    duration_seconds: f64,
    #[rust]
    markers: Vec<TimelineMarker>,
    #[rust]
    scrubbing: bool,
}

impl AnnotationTimeline {
    pub fn set_annotations(&mut self, cx: &mut Cx, annotations: &[Annotation]) {
        self.markers = annotations
            .iter()
            .map(|annotation| TimelineMarker {
                timestamp_seconds: annotation.timestamp_seconds.max(0.0),
                duration_seconds: annotation.duration_seconds.max(0.0),
                color: parse_hex_color(&annotation.color).unwrap_or(vec4(0.85, 0.40, 0.27, 1.0)),
            })
            .collect();
        self.area.redraw(cx);
    }

    pub fn set_progress(&mut self, cx: &mut Cx, current_seconds: f64, duration_seconds: f64) {
        self.current_seconds = current_seconds.max(0.0);
        self.duration_seconds = duration_seconds.max(0.0);
        self.area.redraw(cx);
    }

    fn seek_from_x(&self, cx: &mut Cx, x: f64) {
        let rect = self.area.rect(cx);
        if rect.size.x <= 0.0 || self.duration_seconds <= 0.0 {
            return;
        }
        let ratio = ((x - rect.pos.x) / rect.size.x).clamp(0.0, 1.0);
        cx.action(TimelineSeekAction {
            seconds: ratio * self.duration_seconds,
        });
    }
}

impl Widget for AnnotationTimeline {
    fn draw_walk(&mut self, cx: &mut Cx2d, _scope: &mut Scope, walk: Walk) -> DrawStep {
        cx.begin_turtle(walk, self.layout);
        let rect = cx.turtle().rect();
        let center_y = rect.pos.y + rect.size.y * 0.5;
        let track = Rect {
            pos: dvec2(rect.pos.x, center_y - 2.0),
            size: dvec2(rect.size.x, 4.0),
        };
        self.draw_track.draw_abs(cx, track);

        if self.duration_seconds > 0.0 {
            let progress = (self.current_seconds / self.duration_seconds).clamp(0.0, 1.0);
            self.draw_progress.draw_abs(
                cx,
                Rect {
                    pos: track.pos,
                    size: dvec2(track.size.x * progress, track.size.y),
                },
            );
            for marker in &self.markers {
                let start = (marker.timestamp_seconds / self.duration_seconds).clamp(0.0, 1.0);
                let width = (marker.duration_seconds / self.duration_seconds * rect.size.x)
                    .max(3.0)
                    .min(rect.size.x * (1.0 - start));
                self.draw_marker.color = marker.color;
                self.draw_marker.draw_abs(
                    cx,
                    Rect {
                        pos: dvec2(rect.pos.x + rect.size.x * start, center_y - 5.0),
                        size: dvec2(width, 10.0),
                    },
                );
            }
            self.draw_playhead.draw_abs(
                cx,
                Rect {
                    pos: dvec2(rect.pos.x + rect.size.x * progress - 1.0, center_y - 7.0),
                    size: dvec2(2.0, 14.0),
                },
            );
        }
        cx.end_turtle_with_area(&mut self.area);
        DrawStep::done()
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event, _scope: &mut Scope) {
        match event.hits(cx, self.area) {
            Hit::FingerDown(event) => {
                self.scrubbing = true;
                self.seek_from_x(cx, event.abs.x);
            }
            Hit::FingerMove(event) if self.scrubbing => self.seek_from_x(cx, event.abs.x),
            Hit::FingerUp(event) if self.scrubbing => {
                self.seek_from_x(cx, event.abs.x);
                self.scrubbing = false;
            }
            Hit::FingerHoverIn(_) | Hit::FingerHoverOver(_) => cx.set_cursor(MouseCursor::Hand),
            Hit::FingerHoverOut(_) => cx.set_cursor(MouseCursor::Default),
            _ => {}
        }
    }
}

fn parse_hex_color(value: &str) -> Option<Vec4f> {
    let hex = value.strip_prefix('#')?;
    if hex.len() != 6 {
        return None;
    }
    let rgb = u32::from_str_radix(hex, 16).ok()?;
    Some(vec4(
        ((rgb >> 16) & 0xff) as f32 / 255.0,
        ((rgb >> 8) & 0xff) as f32 / 255.0,
        (rgb & 0xff) as f32 / 255.0,
        1.0,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_saas_annotation_colors() {
        assert_eq!(
            parse_hex_color("#ff8000"),
            Some(vec4(1.0, 128.0 / 255.0, 0.0, 1.0))
        );
        assert_eq!(parse_hex_color("invalid"), None);
    }
}

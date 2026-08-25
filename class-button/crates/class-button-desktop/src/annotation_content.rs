use std::collections::HashMap;

use makepad_widgets::*;

use crate::annotations::{Annotation, PresentationBlock};

fn is_content_row(item_id: usize, block_count: usize) -> bool {
    item_id < block_count
}

script_mod! {
    use mod.prelude.widgets.*
    use mod.widgets.*

    mod.widgets.AnnotationContentBase = #(AnnotationContent::register_widget(vm))
    mod.widgets.AnnotationContent = set_type_default() do mod.widgets.AnnotationContentBase{
        width: Fill
        height: Fill
        dark: false
        list := PortalList{
            width: Fill
            height: Fill
            flow: Down
            drag_scrolling: false
            scroll_bar: ScrollBar{}

            TextBlock := View{
                width: Fill
                height: Fit
                padding: Inset{left: 16 right: 16 top: 14 bottom: 12}
                text := ViBody{
                    width: Fill
                    height: Fit
                    text: ""
                    draw_text.text_style.font_size: 15
                }
            }

            DarkTextBlock := View{
                width: Fill
                height: Fit
                padding: Inset{left: 4 right: 4 top: 4 bottom: 10}
                text := Label{
                    width: Fill
                    height: Fit
                    text: ""
                    draw_text.color: theme.vi_stage_text
                    draw_text.text_style: theme.font_regular{font_size: 14.0}
                }
            }

            ImageBlock := View{
                width: Fill
                height: 238
                padding: Inset{left: 14 right: 14 top: 6 bottom: 10}
                frame := ViMediaFrame{
                    width: Fill
                    height: Fill
                    flow: Overlay
                    annotation_image := Image{
                        width: Fill
                        height: Fill
                        fit: ImageFit.Smallest
                    }
                    caption_layer := View{
                        width: Fill
                        height: Fill
                        padding: 8
                        align: Align{x: 0.0 y: 1.0}
                        image_alt := ViKicker{
                            width: Fit
                            height: Fit
                            text: ""
                        }
                    }
                }
            }

            DarkImageBlock := RoundedView{
                width: Fill
                height: 168
                flow: Overlay
                show_bg: true
                new_batch: true
                clip_x: true
                clip_y: true
                draw_bg +: {
                    color: theme.vi_stage_soft
                    border_color: #xffffff26
                    border_size: 1.0
                    border_radius: 7.0
                }
                annotation_image := Image{
                    width: Fill
                    height: Fill
                    fit: ImageFit.Smallest
                }
                caption_layer := View{
                    width: Fill
                    height: Fill
                    padding: 8
                    align: Align{x: 0.0 y: 1.0}
                    image_alt := Label{
                        width: Fit
                        height: Fit
                        text: ""
                        draw_text.color: theme.vi_stage_muted
                        draw_text.text_style: theme.font_bold{font_size: 9.0}
                    }
                }
            }
        }
    }
}

#[derive(Script, ScriptHook, Widget)]
pub struct AnnotationContent {
    #[deref]
    view: View,
    #[rust]
    #[rust]
    blocks: Vec<PresentationBlock>,
    #[live]
    dark: bool,
    #[rust]
    revision: u64,
    #[rust]
    bindings: HashMap<WidgetUid, (u64, usize)>,
}

impl AnnotationContent {
    pub fn set_annotation(&mut self, cx: &mut Cx, annotation: Option<&Annotation>) {
        match annotation {
            Some(annotation) => self.blocks = annotation.presentation_blocks(),
            None => self.blocks = vec![PresentationBlock::Text("当前时间没有批注".into())],
        }
        self.revision = self.revision.wrapping_add(1);
        self.bindings.clear();
        self.redraw(cx);
    }

    fn bind_image(&mut self, cx: &mut Cx, item: &WidgetRef, index: usize) {
        let Some(PresentationBlock::Image(image)) = self.blocks.get(index).cloned() else {
            return;
        };
        let uid = item.widget_uid();
        if self.bindings.get(&uid) == Some(&(self.revision, index)) {
            return;
        }
        let image_ref = item.image(cx, ids!(annotation_image));
        if let Err(error) = image_ref.load_image_from_data(cx, &image.data) {
            item.label(cx, ids!(image_alt))
                .set_text(cx, &format!("图片无法显示：{error:?}"));
        } else {
            let caption = if image.alt.is_empty() {
                image.mime_type.clone()
            } else {
                image.alt.clone()
            };
            item.label(cx, ids!(image_alt)).set_text(cx, &caption);
        }
        self.bindings.insert(uid, (self.revision, index));
    }
}

impl Widget for AnnotationContent {
    fn draw_walk(&mut self, cx: &mut Cx2d, scope: &mut Scope, walk: Walk) -> DrawStep {
        while let Some(item) = self.view.draw_walk(cx, scope, walk).step() {
            if let Some(mut list) = item.as_portal_list().borrow_mut() {
                let row_count = self.blocks.len();
                list.set_item_range(cx, 0, row_count);
                while let Some(item_id) = list.next_visible_item(cx) {
                    // PortalList probes beyond the declared range while
                    // filling its viewport. Those ids must not be rendered.
                    if !is_content_row(item_id, self.blocks.len()) {
                        continue;
                    }
                    let template = match (&self.blocks[item_id], self.dark) {
                        (PresentationBlock::Text(_), true) => live_id!(DarkTextBlock),
                        (PresentationBlock::Text(_), false) => live_id!(TextBlock),
                        (PresentationBlock::Image(_), true) => live_id!(DarkImageBlock),
                        (PresentationBlock::Image(_), false) => live_id!(ImageBlock),
                    };
                    let row = list.item(cx, item_id, template);
                    match &self.blocks[item_id] {
                        PresentationBlock::Text(text) => {
                            row.label(cx, ids!(text)).set_text(cx, text);
                        }
                        PresentationBlock::Image(_) => self.bind_image(cx, &row, item_id),
                    }
                    row.draw_all(cx, &mut Scope::empty());
                }
            }
        }
        DrawStep::done()
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event, scope: &mut Scope) {
        self.view.handle_event(cx, event, scope);
    }
}

#[cfg(test)]
mod tests {
    use super::is_content_row;

    #[test]
    fn portal_rows_beyond_annotation_content_are_ignored() {
        assert!(!is_content_row(0, 0));
        assert!(is_content_row(0, 3));
        assert!(is_content_row(2, 3));
        assert!(!is_content_row(3, 3));
    }
}

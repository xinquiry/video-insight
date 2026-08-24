use std::path::Path;

use clap::Parser;
use makepad_widgets::*;

use crate::{
    annotations::{self, Annotation},
    load_classroom,
    picker::{pick_local_video, PickedMediaAction},
    runtime::{self, UiEvent},
    Args,
};

script_mod! {
    use mod.prelude.widgets.*
    use mod.widgets.*

    startup() do #(App::script_component(vm)){
        ui: Root{
            main_window := Window{
                window.title: "Class Button · VideoInsight Player"
                window.inner_size: vec2(1180, 760)
                pass.clear_color: #x08111f
                body +: {
                    View{
                        width: Fill
                        height: Fill
                        flow: Down
                        show_bg: true
                        draw_bg.color: #x08111f

                        View{
                            width: Fill
                            height: 78
                            flow: Right
                            spacing: 12
                            padding: Inset{left: 20, right: 20, top: 12, bottom: 12}
                            align: Align{x: 0.0, y: 0.5}
                            show_bg: true
                            draw_bg.color: #x0f1b2d

                            View{
                                width: Fill
                                height: Fit
                                flow: Down
                                spacing: 2
                                title_label := Label{
                                    text: "Class Button"
                                    draw_text.color: #xf8fafc
                                    draw_text.text_style.font_size: 19
                                }
                                classroom_label := Label{
                                    text: "正在读取课堂配置…"
                                    draw_text.color: #x91a4bd
                                    draw_text.text_style.font_size: 11
                                }
                            }

                            hub_status := Label{
                                text: "Hub · 正在查找"
                                draw_text.color: #xfbbf24
                                draw_text.text_style.font_size: 11
                            }
                            open_video_button := Button{text: "打开视频" height: 36}
                            fullscreen_button := Button{text: "全屏" height: 36}
                        }

                        View{
                            width: Fill
                            height: Fill
                            flow: Right
                            spacing: 1

                            View{
                                width: Fill
                                height: Fill
                                flow: Overlay
                                show_bg: true
                                draw_bg.color: #x000000

                                video := Video{
                                    width: Fill
                                    height: Fill
                                    show_controls: true
                                    is_looping: false
                                }

                                empty_state := View{
                                    width: Fill
                                    height: Fill
                                    flow: Down
                                    spacing: 12
                                    align: Align{x: 0.5, y: 0.35}
                                    show_bg: true
                                    draw_bg.color: #x08111f
                                    Label{
                                        text: "打开本地视频开始课堂播放"
                                        draw_text.color: #xe2e8f0
                                        draw_text.text_style.font_size: 20
                                    }
                                    Label{
                                        text: "同目录的 VideoInsight 批注侧车文件会自动载入"
                                        draw_text.color: #x7890ad
                                        draw_text.text_style.font_size: 12
                                    }
                                    open_empty_button := Button{text: "选择视频" height: 38}
                                }

                                annotation_card := View{
                                    width: 520
                                    height: Fit
                                    margin: Inset{left: 24, bottom: 56}
                                    padding: 16
                                    flow: Down
                                    spacing: 6
                                    align: Align{x: 0.0, y: 1.0}
                                    visible: false
                                    show_bg: true
                                    draw_bg.color: #x0f1b2dee
                                    annotation_meta := Label{
                                        text: "批注"
                                        draw_text.color: #x7dd3fc
                                        draw_text.text_style.font_size: 11
                                    }
                                    annotation_text := Label{
                                        width: Fill
                                        height: Fit
                                        text: ""
                                        draw_text.color: #xf8fafc
                                        draw_text.text_style.font_size: 16
                                    }
                                }

                                student_overlay := View{
                                    width: Fill
                                    height: Fill
                                    flow: Down
                                    spacing: 14
                                    padding: 24
                                    align: Center
                                    visible: false
                                    show_bg: true
                                    draw_bg.color: #x020617d9
                                    Label{
                                        text: "学生请求暂停"
                                        draw_text.color: #x7dd3fc
                                        draw_text.text_style.font_size: 15
                                    }
                                    student_name := Label{
                                        text: ""
                                        draw_text.color: #xffffff
                                        draw_text.text_style.font_size: 34
                                    }
                                    student_seat := Label{
                                        text: ""
                                        draw_text.color: #xcbd5e1
                                        draw_text.text_style.font_size: 18
                                    }
                                    handled_button := Button{text: "已处理" width: 120 height: 40}
                                }
                            }

                            View{
                                width: 328
                                height: Fill
                                flow: Down
                                spacing: 16
                                padding: 20
                                show_bg: true
                                draw_bg.color: #x0f1b2d

                                Label{
                                    text: "VideoInsight 批注"
                                    draw_text.color: #xf8fafc
                                    draw_text.text_style.font_size: 17
                                }
                                video_name := Label{
                                    width: Fill
                                    height: Fit
                                    text: "尚未打开视频"
                                    draw_text.color: #x91a4bd
                                    draw_text.text_style.font_size: 11
                                }
                                annotation_count := Label{
                                    text: "0 条批注"
                                    draw_text.color: #x7dd3fc
                                    draw_text.text_style.font_size: 11
                                }

                                View{
                                    width: Fill
                                    height: Fit
                                    flow: Down
                                    spacing: 7
                                    padding: 14
                                    show_bg: true
                                    draw_bg.color: #x16253a
                                    Label{
                                        text: "当前"
                                        draw_text.color: #x7890ad
                                        draw_text.text_style.font_size: 10
                                    }
                                    current_annotation := Label{
                                        width: Fill
                                        height: Fit
                                        text: "等待播放…"
                                        draw_text.color: #xf1f5f9
                                        draw_text.text_style.font_size: 14
                                    }
                                }

                                Label{
                                    text: "接下来"
                                    draw_text.color: #x7890ad
                                    draw_text.text_style.font_size: 10
                                }
                                next_annotation_1 := Label{
                                    width: Fill
                                    height: Fit
                                    text: "—"
                                    draw_text.color: #xcbd5e1
                                    draw_text.text_style.font_size: 12
                                }
                                next_annotation_2 := Label{
                                    width: Fill
                                    height: Fit
                                    text: "—"
                                    draw_text.color: #xcbd5e1
                                    draw_text.text_style.font_size: 12
                                }

                                View{width: Fill height: Fill}
                                View{
                                    width: Fill
                                    height: Fit
                                    flow: Right
                                    spacing: 10
                                    previous_annotation_button := Button{
                                        text: "上一条"
                                        width: Fill
                                        height: 36
                                    }
                                    next_annotation_button := Button{
                                        text: "下一条"
                                        width: Fill
                                        height: 36
                                    }
                                }
                                runtime_error := Label{
                                    width: Fill
                                    height: Fit
                                    text: ""
                                    draw_text.color: #xfca5a5
                                    draw_text.text_style.font_size: 10
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

#[derive(Script, ScriptHook)]
pub struct App {
    #[live]
    ui: WidgetRef,
    #[rust]
    annotations: Vec<Annotation>,
    #[rust]
    active_annotation: Option<usize>,
    #[rust]
    tick_timer: Timer,
    #[rust]
    pending_video: Option<String>,
    #[rust(false)]
    is_fullscreen: bool,
}

impl MatchEvent for App {
    fn handle_startup(&mut self, cx: &mut Cx) {
        self.tick_timer = cx.start_interval(0.2);
        let args = Args::parse();
        let startup_video = args.video.clone();
        match load_classroom(&args) {
            Ok(config) => {
                self.ui
                    .label(cx, ids!(classroom_label))
                    .set_text(cx, &format!("{} · 本地课堂播放器", config.classroom));
                runtime::spawn(args, config);
            }
            Err(error) => self.show_error(cx, &error),
        }
        if let Some(path) = startup_video {
            self.open_media(cx, &path.to_string_lossy());
        }
    }

    fn handle_actions(&mut self, cx: &mut Cx, actions: &Actions) {
        for action in actions {
            if let Some(event) = action.downcast_ref::<UiEvent>() {
                self.handle_runtime_event(cx, event);
            }
            if let Some(picked) = action.downcast_ref::<PickedMediaAction>() {
                if let Some(error) = &picked.error {
                    self.show_error(cx, &format!("无法打开视频：{error}"));
                } else if let Some(path) = &picked.path_or_uri {
                    self.open_media(cx, path);
                }
            }
        }

        if self.ui.button(cx, ids!(open_video_button)).clicked(actions)
            || self.ui.button(cx, ids!(open_empty_button)).clicked(actions)
        {
            pick_local_video();
        }
        if self.ui.button(cx, ids!(handled_button)).clicked(actions) {
            self.ui
                .view(cx, ids!(student_overlay))
                .set_visible(cx, false);
            self.ui.redraw(cx);
        }
        if self.ui.button(cx, ids!(fullscreen_button)).clicked(actions) {
            self.is_fullscreen = !self.is_fullscreen;
            let window = self.ui.window(cx, ids!(main_window));
            if self.is_fullscreen {
                window.fullscreen(cx);
            } else {
                window.disable_fullscreen(cx);
            }
            self.ui.button(cx, ids!(fullscreen_button)).set_text(
                cx,
                if self.is_fullscreen {
                    "退出全屏"
                } else {
                    "全屏"
                },
            );
        }
        if self
            .ui
            .button(cx, ids!(previous_annotation_button))
            .clicked(actions)
        {
            self.seek_annotation(cx, false);
        }
        if self
            .ui
            .button(cx, ids!(next_annotation_button))
            .clicked(actions)
        {
            self.seek_annotation(cx, true);
        }
    }
}

impl App {
    fn handle_runtime_event(&mut self, cx: &mut Cx, event: &UiEvent) {
        match event {
            UiEvent::ReceiverStatus { online, port } => {
                let status = if *online {
                    format!("Hub · 已连接 {}", port.as_deref().unwrap_or(""))
                } else {
                    "Hub · 正在查找".into()
                };
                self.ui.label(cx, ids!(hub_status)).set_text(cx, &status);
                if *online {
                    self.ui.label(cx, ids!(runtime_error)).set_text(cx, "");
                }
            }
            UiEvent::Press(press) => {
                self.ui.video(cx, ids!(video)).pause_playback(cx);
                self.ui
                    .label(cx, ids!(student_name))
                    .set_text(cx, &press.student);
                let seat = press
                    .seat
                    .as_deref()
                    .map(|seat| format!("座位 {seat}"))
                    .unwrap_or_else(|| format!("设备 {}", press.device_id));
                self.ui.label(cx, ids!(student_seat)).set_text(cx, &seat);
                self.ui
                    .view(cx, ids!(student_overlay))
                    .set_visible(cx, true);
                self.ui.redraw(cx);
            }
            UiEvent::Error(error) => self.show_error(cx, error),
        }
    }

    fn open_media(&mut self, cx: &mut Cx, source: &str) {
        let source = source.trim();
        if source.is_empty() {
            return;
        }
        let video = self.ui.video(cx, ids!(video));
        if video.is_unprepared() {
            self.start_media(cx, source);
        } else {
            self.pending_video = Some(source.to_owned());
            video.stop_and_cleanup_resources(cx);
        }
    }

    fn start_media(&mut self, cx: &mut Cx, source: &str) {
        let (path, is_network) = parse_media_ref(source);
        let video = self.ui.video(cx, ids!(video));
        video.set_source(if is_network {
            VideoDataSource::Network { url: path.clone() }
        } else {
            VideoDataSource::Filesystem { path: path.clone() }
        });
        video.begin_playback(cx);
        self.ui.view(cx, ids!(empty_state)).set_visible(cx, false);

        let name = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path);
        self.ui.label(cx, ids!(video_name)).set_text(cx, name);
        self.active_annotation = None;

        if is_network {
            self.annotations.clear();
            self.set_annotation_source_status(cx, "网络视频暂未关联本地批注");
        } else {
            match annotations::load_sidecar(Path::new(&path)) {
                Ok((items, sidecar)) => {
                    self.annotations = items;
                    let status = sidecar
                        .as_ref()
                        .and_then(|path| path.file_name())
                        .and_then(|name| name.to_str())
                        .map(|name| format!("{} 条批注 · {name}", self.annotations.len()))
                        .unwrap_or_else(|| "0 条批注 · 未找到侧车文件".into());
                    self.set_annotation_source_status(cx, &status);
                }
                Err(error) => {
                    self.annotations.clear();
                    self.set_annotation_source_status(cx, "0 条批注");
                    self.show_error(cx, &error);
                }
            }
        }
        self.refresh_annotations(cx);
    }

    fn try_open_pending(&mut self, cx: &mut Cx) {
        let Some(source) = self.pending_video.clone() else {
            return;
        };
        if !self.ui.video(cx, ids!(video)).is_unprepared() {
            return;
        }
        self.pending_video = None;
        self.start_media(cx, &source);
    }

    fn refresh_annotations(&mut self, cx: &mut Cx) {
        let seconds = self.ui.video(cx, ids!(video)).current_position_ms() as f64 / 1000.0;
        let active = self
            .annotations
            .iter()
            .position(|annotation| annotation.is_active(seconds));
        if active != self.active_annotation {
            self.active_annotation = active;
            let card = self.ui.view(cx, ids!(annotation_card));
            if let Some(index) = active {
                let annotation = &self.annotations[index];
                self.ui.label(cx, ids!(annotation_meta)).set_text(
                    cx,
                    &format!(
                        "{} · {}",
                        fmt_time(annotation.timestamp_seconds),
                        annotation.kind
                    ),
                );
                self.ui
                    .label(cx, ids!(annotation_text))
                    .set_text(cx, &annotation.text());
                card.set_visible(cx, true);
            } else {
                card.set_visible(cx, false);
            }
        }

        let current_text = active
            .map(|index| self.timeline_text(index))
            .unwrap_or_else(|| "当前时间没有批注".into());
        self.ui
            .label(cx, ids!(current_annotation))
            .set_text(cx, &current_text);

        let next_start = active.map_or_else(
            || {
                self.annotations
                    .iter()
                    .position(|annotation| annotation.timestamp_seconds >= seconds)
                    .unwrap_or(self.annotations.len())
            },
            |index| index + 1,
        );
        let next_one = self
            .annotations
            .get(next_start)
            .map(|_| self.timeline_text(next_start))
            .unwrap_or_else(|| "—".into());
        let next_two = self
            .annotations
            .get(next_start + 1)
            .map(|_| self.timeline_text(next_start + 1))
            .unwrap_or_else(|| "—".into());
        self.ui
            .label(cx, ids!(next_annotation_1))
            .set_text(cx, &next_one);
        self.ui
            .label(cx, ids!(next_annotation_2))
            .set_text(cx, &next_two);
    }

    fn seek_annotation(&mut self, cx: &mut Cx, forward: bool) {
        if self.annotations.is_empty() {
            return;
        }
        let position = self.ui.video(cx, ids!(video)).current_position_ms() as f64 / 1000.0;
        let index = if forward {
            self.annotations
                .iter()
                .position(|item| item.timestamp_seconds > position + 0.25)
                .unwrap_or(self.annotations.len() - 1)
        } else {
            self.annotations
                .iter()
                .rposition(|item| item.timestamp_seconds < position - 0.25)
                .unwrap_or(0)
        };
        let millis = (self.annotations[index].timestamp_seconds.max(0.0) * 1000.0) as u64;
        self.ui.video(cx, ids!(video)).seek_to(cx, millis);
    }

    fn timeline_text(&self, index: usize) -> String {
        let annotation = &self.annotations[index];
        format!(
            "{}  {}",
            fmt_time(annotation.timestamp_seconds),
            annotation.text()
        )
    }

    fn set_annotation_source_status(&self, cx: &mut Cx, status: &str) {
        self.ui
            .label(cx, ids!(annotation_count))
            .set_text(cx, status);
    }

    fn show_error(&self, cx: &mut Cx, error: &str) {
        self.ui.label(cx, ids!(runtime_error)).set_text(cx, error);
    }
}

impl AppMain for App {
    fn script_mod(vm: &mut ScriptVm) -> ScriptValue {
        crate::makepad_widgets::script_mod(vm);
        self::script_mod(vm)
    }

    fn handle_event(&mut self, cx: &mut Cx, event: &Event) {
        if self.tick_timer.is_event(event).is_some() {
            self.try_open_pending(cx);
            self.refresh_annotations(cx);
        }
        if let Event::Drop(drop) = event {
            for item in drop.items.iter() {
                if let DragItem::FilePath { path, .. } = item {
                    self.open_media(cx, path);
                    break;
                }
            }
        }
        self.match_event(cx, event);
        self.ui.handle_event(cx, event, &mut Scope::empty());
    }
}

fn parse_media_ref(source: &str) -> (String, bool) {
    let is_network = source.starts_with("http://") || source.starts_with("https://");
    if let Some(path) = source.strip_prefix("file://") {
        let path = path
            .strip_prefix('/')
            .filter(|rest| rest.as_bytes().get(1) == Some(&b':'))
            .unwrap_or(path);
        return (path.into(), false);
    }
    (source.into(), is_network)
}

fn fmt_time(seconds: f64) -> String {
    let total = seconds.max(0.0).round() as u64;
    format!("{:02}:{:02}", total / 60, total % 60)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_local_and_network_media_references() {
        assert_eq!(parse_media_ref("/tmp/a.mp4"), ("/tmp/a.mp4".into(), false));
        assert_eq!(
            parse_media_ref("https://example.com/a.mp4"),
            ("https://example.com/a.mp4".into(), true)
        );
        assert_eq!(
            parse_media_ref("file:///tmp/a.mp4"),
            ("/tmp/a.mp4".into(), false)
        );
    }

    #[test]
    fn formats_annotation_timestamps() {
        assert_eq!(fmt_time(0.0), "00:00");
        assert_eq!(fmt_time(65.2), "01:05");
    }
}

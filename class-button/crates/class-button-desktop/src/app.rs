use std::{
    path::Path,
    sync::{Arc, Mutex},
    thread,
};

use clap::Parser;
use makepad_widgets::*;

use crate::{
    annotation_timeline::{AnnotationTimeline, TimelineSeekAction},
    annotations::{self, Annotation},
    load_classroom,
    package::{self, OpenedPackage},
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
                window.inner_size: vec2(1220, 780)
                pass.clear_color: theme.vi_paper
                body +: {
                    PlayerScreen{}
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
    overlay_annotation: Option<usize>,
    #[rust]
    current_annotation: Option<usize>,
    #[rust]
    tick_timer: Timer,
    #[rust]
    pending_media: Option<PreparedMedia>,
    #[rust]
    active_package: Option<OpenedPackage>,
    #[rust]
    media_request_id: u64,
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
            if let Some(prepared) = action.downcast_ref::<PreparedMediaAction>() {
                if prepared.request_id != self.media_request_id {
                    continue;
                }
                let result = prepared
                    .result
                    .lock()
                    .ok()
                    .and_then(|mut result| result.take());
                match result {
                    Some(Ok(media)) => self.accept_prepared_media(cx, media),
                    Some(Err(error)) => self.show_error(cx, &error),
                    None => {}
                }
            }
            if let Some(seek) = action.downcast_ref::<TimelineSeekAction>() {
                let millis = (seek.seconds.max(0.0) * 1000.0) as u64;
                self.ui.video(cx, ids!(video)).seek_to(cx, millis);
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
                    format!("HUB · 已连接 {}", port.as_deref().unwrap_or(""))
                } else {
                    "HUB · 正在查找".into()
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
        self.media_request_id = self.media_request_id.wrapping_add(1);
        let request_id = self.media_request_id;
        self.set_annotation_source_status(cx, "正在打开视频包…");
        let source = source.to_owned();
        if let Err(error) = thread::Builder::new()
            .name("videoinsight-package-loader".into())
            .spawn(move || {
                Cx::post_action(PreparedMediaAction {
                    request_id,
                    result: Arc::new(Mutex::new(Some(PreparedMedia::open(&source)))),
                });
            })
        {
            self.show_error(cx, &format!("无法启动课程包加载线程：{error}"));
        }
    }

    fn accept_prepared_media(&mut self, cx: &mut Cx, prepared: PreparedMedia) {
        let video = self.ui.video(cx, ids!(video));
        if video.is_unprepared() {
            self.start_media(cx, prepared);
        } else {
            self.pending_media = Some(prepared);
            video.stop_and_cleanup_resources(cx);
        }
    }

    fn start_media(&mut self, cx: &mut Cx, prepared: PreparedMedia) {
        let PreparedMedia {
            path,
            is_network,
            display_name,
            annotations,
            annotation_status,
            package,
        } = prepared;
        self.active_package = package;
        let video = self.ui.video(cx, ids!(video));
        video.set_source(if is_network {
            VideoDataSource::Network { url: path.clone() }
        } else {
            VideoDataSource::Filesystem { path: path.clone() }
        });
        video.begin_playback(cx);
        self.ui.view(cx, ids!(empty_state)).set_visible(cx, false);

        self.ui
            .label(cx, ids!(video_name))
            .set_text(cx, &display_name);
        // Force the reusable annotation view to rebind even when both the old
        // and new videos start outside an annotation window.
        self.overlay_annotation = Some(usize::MAX);
        self.current_annotation = Some(usize::MAX);
        self.annotations = annotations;
        if let Some(mut timeline) = self
            .ui
            .widget(cx, ids!(annotation_timeline))
            .borrow_mut::<AnnotationTimeline>()
        {
            timeline.set_annotations(cx, &self.annotations);
        }
        self.ui
            .label(cx, ids!(annotation_count))
            .set_text(cx, &format!("{} 条", self.annotations.len()));
        self.set_annotation_source_status(cx, &annotation_status);
        self.refresh_annotations(cx);
    }

    fn try_open_pending(&mut self, cx: &mut Cx) {
        if self.pending_media.is_none() {
            return;
        }
        if !self.ui.video(cx, ids!(video)).is_unprepared() {
            return;
        }
        let prepared = self
            .pending_media
            .take()
            .expect("pending media checked above");
        self.start_media(cx, prepared);
    }

    fn refresh_annotations(&mut self, cx: &mut Cx) {
        let video = self.ui.video(cx, ids!(video));
        let seconds = video.current_position_ms() as f64 / 1000.0;
        let duration = video.total_duration_ms() as f64 / 1000.0;
        if let Some(mut timeline) = self
            .ui
            .widget(cx, ids!(annotation_timeline))
            .borrow_mut::<AnnotationTimeline>()
        {
            timeline.set_progress(cx, seconds, duration);
        }
        let active = self
            .annotations
            .iter()
            .position(|annotation| annotation.is_active(seconds));

        if active != self.overlay_annotation {
            self.overlay_annotation = active;
            let card = self.ui.view(cx, ids!(annotation_card));
            if let Some(index) = active {
                let annotation = &self.annotations[index];
                self.ui.label(cx, ids!(annotation_meta)).set_text(
                    cx,
                    &format!(
                        "{} · {}",
                        fmt_time(annotation.timestamp_seconds),
                        annotation.kind.to_uppercase()
                    ),
                );
                if let Some(mut content) =
                    self.ui
                        .widget(cx, ids!(overlay_annotation_content))
                        .borrow_mut::<crate::annotation_content::AnnotationContent>()
                {
                    content.set_annotation(cx, Some(annotation));
                }
                card.set_visible(cx, true);
            } else {
                card.set_visible(cx, false);
            }
        }

        // Match the SaaS playback panel: retain the most recently reached note
        // in the sidebar while the stage overlay still honors its duration.
        let current = self
            .annotations
            .iter()
            .rposition(|annotation| annotation.timestamp_seconds <= seconds + 0.12);
        if current != self.current_annotation {
            self.current_annotation = current;
            let annotation = current.map(|index| &self.annotations[index]);
            if let Some(mut content) = self
                .ui
                .widget(cx, ids!(annotation_content))
                .borrow_mut::<crate::annotation_content::AnnotationContent>()
            {
                content.set_annotation(cx, annotation);
            }

            if let Some(index) = current {
                let annotation = &self.annotations[index];
                self.ui
                    .label(cx, ids!(current_annotation_meta))
                    .set_text(cx, &fmt_time(annotation.timestamp_seconds));
                self.ui
                    .label(cx, ids!(current_annotation_kind))
                    .set_text(cx, &annotation.kind.to_uppercase());
                self.ui
                    .label(cx, ids!(current_annotation_position))
                    .set_text(cx, &format!("{} / {}", index + 1, self.annotations.len()));
            } else {
                self.ui
                    .label(cx, ids!(current_annotation_meta))
                    .set_text(cx, "等待播放");
                self.ui
                    .label(cx, ids!(current_annotation_kind))
                    .set_text(cx, "NOTE");
                self.ui
                    .label(cx, ids!(current_annotation_position))
                    .set_text(cx, &format!("— / {}", self.annotations.len()));
            }
        }

        let next_start = current.map_or_else(
            || {
                self.annotations
                    .iter()
                    .position(|annotation| annotation.timestamp_seconds >= seconds)
                    .unwrap_or(self.annotations.len())
            },
            |index| index + 1,
        );
        self.set_upcoming_row(
            cx,
            next_start,
            ids!(next_annotation_1_time),
            ids!(next_annotation_1),
            "没有后续批注",
        );
        self.set_upcoming_row(
            cx,
            next_start + 1,
            ids!(next_annotation_2_time),
            ids!(next_annotation_2),
            "—",
        );
    }

    fn set_upcoming_row(
        &self,
        cx: &mut Cx,
        index: usize,
        time_path: &[LiveId],
        text_path: &[LiveId],
        empty_text: &str,
    ) {
        if let Some(annotation) = self.annotations.get(index) {
            self.ui
                .label(cx, time_path)
                .set_text(cx, &fmt_time(annotation.timestamp_seconds));
            self.ui
                .label(cx, text_path)
                .set_text(cx, &annotation.text());
        } else {
            self.ui.label(cx, time_path).set_text(cx, "—");
            self.ui.label(cx, text_path).set_text(cx, empty_text);
        }
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

    fn set_annotation_source_status(&self, cx: &mut Cx, status: &str) {
        self.ui
            .label(cx, ids!(annotation_source))
            .set_text(cx, status);
    }

    fn show_error(&self, cx: &mut Cx, error: &str) {
        self.ui.label(cx, ids!(runtime_error)).set_text(cx, error);
    }
}

#[derive(Debug, Clone)]
struct PreparedMediaAction {
    request_id: u64,
    result: Arc<Mutex<Option<Result<PreparedMedia, String>>>>,
}

#[derive(Debug)]
struct PreparedMedia {
    path: String,
    is_network: bool,
    display_name: String,
    annotations: Vec<Annotation>,
    annotation_status: String,
    package: Option<OpenedPackage>,
}

impl PreparedMedia {
    fn open(source: &str) -> Result<Self, String> {
        let (path, is_network) = parse_media_ref(source);
        if !is_network && package::is_package(Path::new(&path)) {
            let package = package::open(Path::new(&path))?;
            let display_name = package.display_name.clone();
            let annotations = package.annotations.clone();
            let annotation_status = package
                .annotation_warning
                .clone()
                .unwrap_or_else(|| format!("{} 条批注 · VideoInsight 便携包", annotations.len()));
            return Ok(Self {
                path: package.video_path.to_string_lossy().into_owned(),
                is_network: false,
                display_name,
                annotations,
                annotation_status,
                package: Some(package),
            });
        }

        let display_name = Path::new(&path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or(&path)
            .to_owned();
        if is_network {
            return Ok(Self {
                path,
                is_network,
                display_name,
                annotations: Vec::new(),
                annotation_status: "网络视频暂未关联本地批注".into(),
                package: None,
            });
        }
        let (annotations, sidecar) = annotations::load_sidecar(Path::new(&path))?;
        let annotation_status = sidecar
            .as_ref()
            .and_then(|path| path.file_name())
            .and_then(|name| name.to_str())
            .map(|name| format!("{} 条批注 · {name}", annotations.len()))
            .unwrap_or_else(|| "0 条批注 · 未找到侧车文件".into());
        Ok(Self {
            path,
            is_network,
            display_name,
            annotations,
            annotation_status,
            package: None,
        })
    }
}

impl AppMain for App {
    fn script_mod(vm: &mut ScriptVm) -> ScriptValue {
        crate::makepad_widgets::theme_mod(vm);
        crate::ui::theme_mod(vm);
        script_eval!(vm, {
            mod.theme = mod.themes.video_insight
        });
        crate::makepad_widgets::widgets_mod(vm);
        crate::ui::primitives_mod(vm);
        crate::annotation_content::script_mod(vm);
        crate::annotation_timeline::script_mod(vm);
        crate::ui::screen_mod(vm);
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

    #[test]
    fn makepad_design_modules_evaluate_headlessly() {
        let mut cx = Cx::new(Box::new(|_, _| {}));
        let _ = cx.with_vm(|vm| <App as AppMain>::script_mod(vm));
    }
}

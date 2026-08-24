use makepad_widgets::*;
use robius_file_picker::FileDialog;

#[derive(Clone, Debug, Default)]
pub struct PickedMediaAction {
    pub path_or_uri: Option<String>,
    pub error: Option<String>,
}

pub fn pick_local_video() {
    let filters: Vec<(String, Vec<String>)> = vec![
        (
            "Video".into(),
            vec![
                "mp4".into(),
                "mkv".into(),
                "webm".into(),
                "avi".into(),
                "mov".into(),
                "m4v".into(),
                "wmv".into(),
                "mpg".into(),
                "mpeg".into(),
                "m3u8".into(),
            ],
        ),
        ("All Files".into(), vec!["*".into()]),
    ];
    let dialog = FileDialog::new()
        .set_title("打开课堂视频")
        .set_filters(filters);
    let result = dialog.pick_video(|result| {
        let action = match result {
            Ok(Some(file)) => PickedMediaAction {
                path_or_uri: file
                    .path()
                    .map(|path| path.to_string_lossy().into_owned())
                    .or_else(|| file.uri().map(ToString::to_string)),
                error: None,
            },
            Ok(None) => PickedMediaAction::default(),
            Err(error) => PickedMediaAction {
                path_or_uri: None,
                error: Some(error.to_string()),
            },
        };
        Cx::post_action(action);
    });
    if let Err(error) = result {
        Cx::post_action(PickedMediaAction {
            path_or_uri: None,
            error: Some(error.to_string()),
        });
    }
}

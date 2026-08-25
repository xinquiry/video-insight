use std::path::Path;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;

use crate::{
    annotations::{self, Annotation, PresentationBlock},
    package::{self, OpenedPackage},
};

#[derive(Debug, Serialize)]
pub struct PlayerMedia {
    pub source: PlayerMediaSource,
    pub display_name: String,
    pub annotations: Vec<PlayerAnnotation>,
    pub annotation_status: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PlayerMediaSource {
    Local { path: String },
    Network { url: String },
}

#[derive(Debug, Serialize)]
pub struct PlayerAnnotation {
    pub timestamp_seconds: f64,
    pub duration_seconds: f64,
    pub kind: String,
    pub color: String,
    pub blocks: Vec<PlayerAnnotationBlock>,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum PlayerAnnotationBlock {
    Text { text: String },
    Image { src: String, alt: String },
}

#[derive(Debug)]
pub struct OpenedMedia {
    pub media: PlayerMedia,
    pub package: Option<OpenedPackage>,
}

pub fn open(source: &str) -> Result<OpenedMedia, String> {
    let (path, is_network) = parse_media_ref(source.trim());
    if path.is_empty() {
        return Err("视频路径不能为空".into());
    }

    if !is_network && package::is_package(Path::new(&path)) {
        let package = package::open(Path::new(&path))?;
        let annotation_status = package.annotation_warning.clone().unwrap_or_else(|| {
            format!("{} 条批注 · VideoInsight 便携包", package.annotations.len())
        });
        let media = PlayerMedia {
            source: PlayerMediaSource::Local {
                path: package.video_path.to_string_lossy().into_owned(),
            },
            display_name: package.display_name.clone(),
            annotations: package
                .annotations
                .iter()
                .map(to_player_annotation)
                .collect(),
            annotation_status,
        };
        return Ok(OpenedMedia {
            media,
            package: Some(package),
        });
    }

    let display_name = Path::new(&path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or(&path)
        .to_owned();
    if is_network {
        return Ok(OpenedMedia {
            media: PlayerMedia {
                source: PlayerMediaSource::Network { url: path },
                display_name,
                annotations: Vec::new(),
                annotation_status: "网络视频暂未关联本地批注".into(),
            },
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
    Ok(OpenedMedia {
        media: PlayerMedia {
            source: PlayerMediaSource::Local { path },
            display_name,
            annotations: annotations.iter().map(to_player_annotation).collect(),
            annotation_status,
        },
        package: None,
    })
}

fn to_player_annotation(annotation: &Annotation) -> PlayerAnnotation {
    let blocks = annotation
        .presentation_blocks()
        .into_iter()
        .map(|block| match block {
            PresentationBlock::Text(text) => PlayerAnnotationBlock::Text { text },
            PresentationBlock::Image(image) => PlayerAnnotationBlock::Image {
                src: format!(
                    "data:{};base64,{}",
                    image.mime_type,
                    STANDARD.encode(&*image.data)
                ),
                alt: image.alt,
            },
        })
        .collect();
    PlayerAnnotation {
        timestamp_seconds: annotation.timestamp_seconds,
        duration_seconds: annotation.duration_seconds,
        kind: annotation.kind.clone(),
        color: annotation.color.clone(),
        text: annotation.text(),
        blocks,
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
}

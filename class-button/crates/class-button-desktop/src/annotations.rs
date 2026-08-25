use std::{
    fs,
    path::{Path, PathBuf},
    sync::Arc,
};

use serde::Deserialize;

use crate::portable_contract::{
    decode_image_data_url, DOCUMENT_FORMAT, DOCUMENT_VERSION, TRACK_FORMAT, TRACK_VERSION,
};

#[derive(Debug, Clone, Deserialize)]
pub struct Annotation {
    pub timestamp_seconds: f64,
    #[serde(default = "default_duration")]
    pub duration_seconds: f64,
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default = "default_kind")]
    pub kind: String,
    #[serde(default = "default_color")]
    pub color: String,
    #[serde(skip)]
    presentation: Option<AnnotationPresentation>,
}

#[derive(Debug, Clone)]
struct AnnotationPresentation {
    blocks: Vec<PresentationBlock>,
}

#[derive(Debug, Clone)]
pub enum PresentationBlock {
    Text(String),
    Image(AnnotationImage),
}

impl Annotation {
    pub fn text(&self) -> String {
        let presentation = self
            .presentation
            .clone()
            .or_else(|| build_presentation(&self.content, &mut |_| Ok(None)).ok());
        let Some(presentation) = presentation else {
            return "（批注内容无法显示）".into();
        };
        let text = presentation
            .blocks
            .iter()
            .filter_map(|block| match block {
                PresentationBlock::Text(text) => Some(text.as_str()),
                PresentationBlock::Image(_) => None,
            })
            .collect::<Vec<_>>()
            .join(" ");
        if text.is_empty() {
            "（无文字内容）".into()
        } else {
            text
        }
    }

    pub fn presentation_blocks(&self) -> Vec<PresentationBlock> {
        if let Some(presentation) = &self.presentation {
            return presentation.blocks.clone();
        }
        build_presentation(&self.content, &mut |_| Ok(None))
            .map(|presentation| presentation.blocks)
            .unwrap_or_else(|_| vec![PresentationBlock::Text("（批注内容无法显示）".into())])
    }

    fn normalize(&mut self, resolver: &mut AssetResolver<'_>) -> Result<(), String> {
        self.presentation = Some(build_presentation(&self.content, resolver)?);
        Ok(())
    }

    pub fn is_active(&self, seconds: f64) -> bool {
        seconds + 0.12 >= self.timestamp_seconds
            && seconds <= self.timestamp_seconds + self.duration_seconds.max(0.0)
    }
}

#[derive(Debug, Clone)]
pub struct AnnotationImage {
    pub mime_type: String,
    pub data: Arc<[u8]>,
    pub alt: String,
}

#[derive(Debug, Clone)]
pub(crate) struct ResolvedImage {
    pub mime_type: String,
    pub data: Arc<[u8]>,
}

type AssetResolver<'a> = dyn FnMut(&str) -> Result<Option<ResolvedImage>, String> + 'a;

pub fn load_sidecar(video_path: &Path) -> Result<(Vec<Annotation>, Option<PathBuf>), String> {
    for candidate in sidecar_candidates(video_path) {
        if !candidate.is_file() {
            continue;
        }
        let input = fs::read_to_string(&candidate)
            .map_err(|error| format!("无法读取批注文件 {}：{error}", candidate.display()))?;
        let mut annotations = parse_document(&input)
            .map_err(|error| format!("批注文件 {} 格式无效：{error}", candidate.display()))?;
        annotations
            .sort_by(|left, right| left.timestamp_seconds.total_cmp(&right.timestamp_seconds));
        return Ok((annotations, Some(candidate)));
    }
    Ok((Vec::new(), None))
}

pub(crate) fn parse_document(input: &str) -> Result<Vec<Annotation>, String> {
    parse_document_with_assets(input, &mut |_| Ok(None))
}

pub(crate) fn parse_document_with_assets(
    input: &str,
    resolver: &mut AssetResolver<'_>,
) -> Result<Vec<Annotation>, String> {
    let value: serde_json::Value =
        serde_json::from_str(input).map_err(|error| error.to_string())?;
    if value.is_array() {
        return decode_annotations(value, resolver);
    }
    let object = value
        .as_object()
        .ok_or_else(|| "顶层必须是批注数组或对象".to_owned())?;

    // Legacy exports used a simple { "annotations": [...] } envelope.
    if !object.contains_key("format") {
        let annotations = object
            .get("annotations")
            .ok_or_else(|| "缺少 annotations".to_owned())?;
        return decode_annotations(annotations.clone(), resolver);
    }

    require_format_version(object, DOCUMENT_FORMAT, DOCUMENT_VERSION, "导出文档")?;
    let track = object
        .get("annotation_track")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| "缺少 annotation_track".to_owned())?;
    require_format_version(track, TRACK_FORMAT, TRACK_VERSION, "批注轨道")?;
    let annotations = track
        .get("annotations")
        .ok_or_else(|| "批注轨道缺少 annotations".to_owned())?;
    decode_annotations(annotations.clone(), resolver)
}

fn decode_annotations(
    value: serde_json::Value,
    resolver: &mut AssetResolver<'_>,
) -> Result<Vec<Annotation>, String> {
    let mut annotations: Vec<Annotation> =
        serde_json::from_value(value).map_err(|error| error.to_string())?;
    for annotation in &mut annotations {
        annotation.normalize(resolver)?;
    }
    Ok(annotations)
}

fn build_presentation(
    content: &serde_json::Value,
    resolver: &mut AssetResolver<'_>,
) -> Result<AnnotationPresentation, String> {
    let mut blocks = Vec::new();
    collect_blocks(content, &mut blocks, resolver)?;
    if blocks.is_empty() {
        blocks.push(PresentationBlock::Text("（无文字内容）".into()));
    }
    Ok(AnnotationPresentation { blocks })
}

fn collect_blocks(
    value: &serde_json::Value,
    output: &mut Vec<PresentationBlock>,
    resolver: &mut AssetResolver<'_>,
) -> Result<(), String> {
    match value {
        serde_json::Value::Object(object) => {
            if object.get("type").and_then(serde_json::Value::as_str) == Some("image") {
                if let Some(attrs) = object.get("attrs").and_then(serde_json::Value::as_object) {
                    if let Some(src) = attrs.get("src").and_then(serde_json::Value::as_str) {
                        let resolved = if let Some(decoded) = decode_image_data_url(src)? {
                            Some(ResolvedImage {
                                mime_type: decoded.mime_type.into(),
                                data: decoded.data.into(),
                            })
                        } else {
                            resolver(src)?
                        };
                        if let Some(image) = resolved {
                            output.push(PresentationBlock::Image(AnnotationImage {
                                mime_type: image.mime_type,
                                data: image.data,
                                alt: attrs
                                    .get("alt")
                                    .and_then(serde_json::Value::as_str)
                                    .unwrap_or("")
                                    .to_owned(),
                            }));
                        }
                    }
                }
                return Ok(());
            }
            if let Some(text) = object.get("text").and_then(serde_json::Value::as_str) {
                push_text_block(output, text);
            }
            if let Some(content) = object.get("content") {
                collect_blocks(content, output, resolver)?;
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_blocks(value, output, resolver)?;
            }
        }
        serde_json::Value::String(text) => push_text_block(output, text),
        _ => {}
    }
    Ok(())
}

fn push_text_block(output: &mut Vec<PresentationBlock>, text: &str) {
    let text = text.trim();
    if text.is_empty() {
        return;
    }
    if let Some(PresentationBlock::Text(previous)) = output.last_mut() {
        previous.push(' ');
        previous.push_str(text);
    } else {
        output.push(PresentationBlock::Text(text.to_owned()));
    }
}

fn require_format_version(
    object: &serde_json::Map<String, serde_json::Value>,
    expected_format: &str,
    supported_version: u64,
    label: &str,
) -> Result<(), String> {
    let format = object
        .get("format")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| format!("{label}缺少 format"))?;
    if format != expected_format {
        return Err(format!("不支持的{label}格式：{format}"));
    }
    let version = object
        .get("format_version")
        .and_then(serde_json::Value::as_u64)
        .ok_or_else(|| format!("{label}缺少 format_version"))?;
    if version != supported_version {
        return Err(format!(
            "不支持的{label}版本 {version}；当前播放器支持版本 {supported_version}，请升级播放器"
        ));
    }
    Ok(())
}

pub fn sidecar_candidates(video_path: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::with_capacity(3);
    if let Some(file_name) = video_path.file_name().and_then(|name| name.to_str()) {
        candidates.push(video_path.with_file_name(format!("{file_name}.annotations.json")));
    }
    candidates.push(video_path.with_extension("annotations.json"));
    if let Some(parent) = video_path.parent() {
        candidates.push(parent.join("annotations.json"));
    }
    candidates.dedup();
    candidates
}

const fn default_duration() -> f64 {
    6.0
}

fn default_kind() -> String {
    "note".into()
}

fn default_color() -> String {
    "#2563eb".into()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_from_video_insight_rich_text() {
        let annotation: Annotation = serde_json::from_value(serde_json::json!({
            "timestamp_seconds": 12.5,
            "duration_seconds": 4.0,
            "content": {
                "type": "doc",
                "content": [{
                    "type": "paragraph",
                    "content": [{"type": "text", "text": "Key idea"}]
                }]
            }
        }))
        .unwrap();

        assert_eq!(annotation.text(), "Key idea");
        assert!(annotation.is_active(14.0));
        assert!(!annotation.is_active(17.0));
    }

    #[test]
    fn preserves_text_and_image_block_order() {
        let annotation: Annotation = serde_json::from_value(serde_json::json!({
            "timestamp_seconds": 1,
            "content": {
                "type": "doc",
                "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "Before"}]},
                    {"type": "image", "attrs": {
                        "src": "data:image/png;base64,iVBORw0KGgo=",
                        "alt": "A diagram"
                    }},
                    {"type": "paragraph", "content": [{"type": "text", "text": "After"}]}
                ]
            }
        }))
        .unwrap();
        assert_eq!(annotation.text(), "Before After");
        let blocks = annotation.presentation_blocks();
        assert!(matches!(&blocks[0], PresentationBlock::Text(text) if text == "Before"));
        assert!(
            matches!(&blocks[1], PresentationBlock::Image(image) if image.mime_type == "image/png" && image.alt == "A diagram")
        );
        assert!(matches!(&blocks[2], PresentationBlock::Text(text) if text == "After"));
    }

    #[test]
    fn derives_specific_then_general_sidecar_names() {
        let paths = sidecar_candidates(Path::new("/lesson/demo.mp4"));
        assert_eq!(paths[0], PathBuf::from("/lesson/demo.mp4.annotations.json"));
        assert_eq!(paths[1], PathBuf::from("/lesson/demo.annotations.json"));
        assert_eq!(paths[2], PathBuf::from("/lesson/annotations.json"));
    }

    #[test]
    fn reads_versioned_portable_export_and_ignores_additive_fields() {
        let annotations = parse_document(
            &serde_json::json!({
                "format": DOCUMENT_FORMAT,
                "format_version": 1,
                "future_document_field": true,
                "video": {"filename": "lesson.mp4"},
                "annotation_track": {
                    "format": TRACK_FORMAT,
                    "format_version": 1,
                    "annotations": [{
                        "timestamp_seconds": 2.0,
                        "duration_seconds": 3.0,
                        "content": "Portable note",
                        "future_annotation_field": {"value": 1}
                    }],
                    "extensions": {}
                },
                "extensions": {}
            })
            .to_string(),
        )
        .unwrap();
        assert_eq!(annotations.len(), 1);
        assert_eq!(annotations[0].text(), "Portable note");
    }

    #[test]
    fn reads_shared_v1_contract_fixture_in_block_order() {
        let input = include_str!("../../../../docs/schemas/fixtures/annotated-video-v1-rich.json");
        let annotations = parse_document_with_assets(input, &mut |source| {
            if source == "vinsight-asset://assets/shared.png" {
                Ok(Some(ResolvedImage {
                    mime_type: "image/png".into(),
                    data: Arc::from(&b"\x89PNG\r\n\x1a\n"[..]),
                }))
            } else {
                Ok(None)
            }
        })
        .unwrap();
        let blocks = annotations[0].presentation_blocks();
        assert!(matches!(&blocks[0], PresentationBlock::Text(text) if text == "Before image"));
        assert!(
            matches!(&blocks[1], PresentationBlock::Image(image) if image.alt == "Shared contract image")
        );
        assert!(matches!(&blocks[2], PresentationBlock::Text(text) if text == "After image"));
    }

    #[test]
    fn rejects_unknown_structural_version_with_upgrade_message() {
        let error = parse_document(
            &serde_json::json!({
                "format": DOCUMENT_FORMAT,
                "format_version": 2,
                "annotation_track": {}
            })
            .to_string(),
        )
        .unwrap_err();
        assert!(error.contains("请升级播放器"));
    }
}

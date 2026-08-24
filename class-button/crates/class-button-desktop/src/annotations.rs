use std::{
    fs,
    path::{Path, PathBuf},
};

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Annotation {
    pub timestamp_seconds: f64,
    #[serde(default = "default_duration")]
    pub duration_seconds: f64,
    #[serde(default)]
    pub content: serde_json::Value,
    #[serde(default = "default_kind")]
    pub kind: String,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum AnnotationDocument {
    List(Vec<Annotation>),
    Package { annotations: Vec<Annotation> },
}

impl Annotation {
    pub fn text(&self) -> String {
        let mut fragments = Vec::new();
        collect_text(&self.content, &mut fragments);
        let text = fragments.join(" ");
        if text.trim().is_empty() {
            "（无文字内容）".into()
        } else {
            text
        }
    }

    pub fn is_active(&self, seconds: f64) -> bool {
        seconds + 0.12 >= self.timestamp_seconds
            && seconds <= self.timestamp_seconds + self.duration_seconds.max(0.0)
    }
}

pub fn load_sidecar(video_path: &Path) -> Result<(Vec<Annotation>, Option<PathBuf>), String> {
    for candidate in sidecar_candidates(video_path) {
        if !candidate.is_file() {
            continue;
        }
        let input = fs::read_to_string(&candidate)
            .map_err(|error| format!("无法读取批注文件 {}：{error}", candidate.display()))?;
        let document: AnnotationDocument = serde_json::from_str(&input)
            .map_err(|error| format!("批注文件 {} 格式无效：{error}", candidate.display()))?;
        let mut annotations = match document {
            AnnotationDocument::List(annotations) | AnnotationDocument::Package { annotations } => {
                annotations
            }
        };
        annotations
            .sort_by(|left, right| left.timestamp_seconds.total_cmp(&right.timestamp_seconds));
        return Ok((annotations, Some(candidate)));
    }
    Ok((Vec::new(), None))
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

fn collect_text(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::Object(object) => {
            if let Some(text) = object.get("text").and_then(serde_json::Value::as_str) {
                let text = text.trim();
                if !text.is_empty() {
                    output.push(text.to_owned());
                }
            }
            if let Some(content) = object.get("content") {
                collect_text(content, output);
            }
        }
        serde_json::Value::Array(values) => {
            for value in values {
                collect_text(value, output);
            }
        }
        serde_json::Value::String(text) if !text.trim().is_empty() => {
            output.push(text.trim().to_owned());
        }
        _ => {}
    }
}

const fn default_duration() -> f64 {
    6.0
}

fn default_kind() -> String {
    "note".into()
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
    fn derives_specific_then_general_sidecar_names() {
        let paths = sidecar_candidates(Path::new("/lesson/demo.mp4"));
        assert_eq!(paths[0], PathBuf::from("/lesson/demo.mp4.annotations.json"));
        assert_eq!(paths[1], PathBuf::from("/lesson/demo.annotations.json"));
        assert_eq!(paths[2], PathBuf::from("/lesson/annotations.json"));
    }
}

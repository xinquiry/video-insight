use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{self, Read},
    path::{Component, Path, PathBuf},
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use zip::{CompressionMethod, ZipArchive};

use crate::{
    annotations::{self, Annotation, ResolvedImage},
    portable_contract::{
        ImageFormat, ASSET_SCHEME, DOCUMENT_FORMAT, DOCUMENT_VERSION, MAX_IMAGE_BYTES, PACKAGE_MIME,
    },
};

const MAX_MANIFEST_BYTES: u64 = 64 * 1024 * 1024;
const MAX_ENTRIES: usize = 4_096;
const MAX_TOTAL_ASSET_BYTES: u64 = 64 * 1024 * 1024;

#[derive(Debug, Deserialize)]
struct PackageEnvelope {
    format: String,
    format_version: u64,
}

#[derive(Debug, Deserialize)]
struct PackageManifest {
    video: PackageVideo,
}

#[derive(Debug, Deserialize)]
struct PackageVideo {
    filename: String,
    media_path: String,
    size_bytes: u64,
}

#[derive(Debug)]
pub struct OpenedPackage {
    pub video_path: PathBuf,
    pub display_name: String,
    pub annotations: Vec<Annotation>,
    pub annotation_warning: Option<String>,
    work_dir: PathBuf,
}

impl Drop for OpenedPackage {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.work_dir);
    }
}

pub fn is_package(path: &Path) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("vinsight"))
}

pub fn open(path: &Path) -> Result<OpenedPackage, String> {
    let file = File::open(path).map_err(|error| format!("无法打开课程包：{error}"))?;
    let mut archive =
        ZipArchive::new(file).map_err(|error| format!("课程包不是有效 ZIP：{error}"))?;
    validate_archive_structure(&mut archive)?;

    let mime = read_entry_limited(&mut archive, "mimetype", 256)?;
    if mime != PACKAGE_MIME.as_bytes() {
        return Err("课程包 MIME 标记无效".into());
    }
    let manifest_data = read_entry_limited(&mut archive, "manifest.json", MAX_MANIFEST_BYTES)?;
    let manifest_text = std::str::from_utf8(&manifest_data)
        .map_err(|_| "课程包 manifest.json 不是 UTF-8".to_owned())?;
    let envelope: PackageEnvelope =
        serde_json::from_str(manifest_text).map_err(|error| format!("课程包清单无效：{error}"))?;
    if envelope.format != DOCUMENT_FORMAT {
        return Err(format!("不支持的课程包格式 {}", envelope.format));
    }

    let (video, annotation_result) = if envelope.format_version == DOCUMENT_VERSION {
        let manifest: PackageManifest = serde_json::from_str(manifest_text)
            .map_err(|error| format!("课程包清单无效：{error}"))?;
        validate_media_path(&manifest.video.media_path)?;
        let mut asset_cache = HashMap::<String, ResolvedImage>::new();
        let mut total_asset_bytes = 0_u64;
        let annotations = annotations::parse_document_with_assets(manifest_text, &mut |source| {
            let Some(asset_path) = source.strip_prefix(ASSET_SCHEME) else {
                return Ok(None);
            };
            validate_asset_path(asset_path)?;
            if let Some(image) = asset_cache.get(asset_path) {
                return Ok(Some(image.clone()));
            }
            let data = read_entry_limited(&mut archive, asset_path, MAX_IMAGE_BYTES)?;
            total_asset_bytes = total_asset_bytes
                .checked_add(data.len() as u64)
                .ok_or_else(|| "课程包图片资源总大小无效".to_owned())?;
            if total_asset_bytes > MAX_TOTAL_ASSET_BYTES {
                return Err("课程包图片资源总大小超过 64 MiB".into());
            }
            let format = ImageFormat::from_asset_path(asset_path)
                .ok_or_else(|| format!("不支持的课程包图片格式：{asset_path}"))?;
            if !format.has_valid_signature(&data) {
                return Err(format!("课程包图片内容与格式不匹配：{asset_path}"));
            }
            let image = ResolvedImage {
                mime_type: format.mime_type().into(),
                data: Arc::from(data),
            };
            asset_cache.insert(asset_path.to_owned(), image.clone());
            Ok(Some(image))
        });
        (manifest.video, annotations)
    } else {
        let video = resolve_future_media(&mut archive, manifest_text)?;
        (
            video,
            Err(format!(
                "不支持的导出文档版本 {}；当前播放器支持版本 {}，请升级播放器",
                envelope.format_version, DOCUMENT_VERSION
            )),
        )
    };
    let (annotations, annotation_warning) = match annotation_result {
        Ok(annotations) => (annotations, None),
        Err(error) => (
            Vec::new(),
            Some(format!("批注无法载入（{error}）；视频仍可播放")),
        ),
    };

    let mut media = archive
        .by_name(&video.media_path)
        .map_err(|error| format!("课程包缺少视频 {}：{error}", video.media_path))?;
    if media.compression() != CompressionMethod::Stored {
        return Err("课程包视频必须使用 ZIP Store 模式".into());
    }
    if media.size() != video.size_bytes {
        return Err(format!(
            "课程包视频大小不匹配：清单 {}，实际 {}",
            video.size_bytes,
            media.size()
        ));
    }

    let work_dir = create_work_dir()?;
    let video_path = work_dir.join(safe_file_name(&video.filename)?);
    let mut output = File::create(&video_path).map_err(|error| {
        let _ = fs::remove_dir_all(&work_dir);
        format!("无法创建临时视频：{error}")
    })?;
    if let Err(error) = io::copy(&mut media, &mut output) {
        let _ = fs::remove_dir_all(&work_dir);
        return Err(format!("无法解压课程包视频：{error}"));
    }

    Ok(OpenedPackage {
        video_path,
        display_name: video.filename,
        annotations,
        annotation_warning,
        work_dir,
    })
}

fn validate_archive_structure(archive: &mut ZipArchive<File>) -> Result<(), String> {
    if archive.is_empty() {
        return Err("课程包是空文件".into());
    }
    if archive.len() > MAX_ENTRIES {
        return Err(format!("课程包包含过多文件（最多 {MAX_ENTRIES} 个）"));
    }
    {
        let marker = archive
            .by_index(0)
            .map_err(|error| format!("无法读取课程包 MIME 标记：{error}"))?;
        if marker.name() != "mimetype" || marker.compression() != CompressionMethod::Stored {
            return Err("课程包首个文件必须是未压缩的 mimetype".into());
        }
    }
    let mut names = HashSet::with_capacity(archive.len());
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取课程包目录：{error}"))?;
        if !names.insert(entry.name().to_owned()) {
            return Err(format!("课程包包含重复路径：{}", entry.name()));
        }
    }
    Ok(())
}

fn validate_asset_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.is_absolute()
        || !path.starts_with("assets")
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("课程包资源路径不安全".into());
    }
    Ok(())
}

fn read_entry_limited(
    archive: &mut ZipArchive<File>,
    name: &str,
    maximum: u64,
) -> Result<Vec<u8>, String> {
    let entry = archive
        .by_name(name)
        .map_err(|error| format!("课程包缺少 {name}：{error}"))?;
    if entry.size() > maximum {
        return Err(format!("课程包 {name} 超过大小限制"));
    }
    let mut data = Vec::with_capacity(entry.size() as usize);
    entry
        .take(maximum + 1)
        .read_to_end(&mut data)
        .map_err(|error| format!("无法读取课程包 {name}：{error}"))?;
    if data.len() as u64 > maximum {
        return Err(format!("课程包 {name} 超过大小限制"));
    }
    Ok(data)
}

fn resolve_future_media(
    archive: &mut ZipArchive<File>,
    manifest_text: &str,
) -> Result<PackageVideo, String> {
    if let Some(video) = serde_json::from_str::<serde_json::Value>(manifest_text)
        .ok()
        .and_then(|manifest| manifest.get("video").cloned())
        .and_then(|video| serde_json::from_value::<PackageVideo>(video).ok())
    {
        validate_media_path(&video.media_path)?;
        return Ok(video);
    }

    let mut candidate = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|error| format!("无法读取课程包目录：{error}"))?;
        let name = entry.name().to_owned();
        if entry.is_dir() || validate_media_path(&name).is_err() {
            continue;
        }
        if candidate.is_some() {
            return Err("未知版本课程包包含多个视频，无法安全选择".into());
        }
        let filename = safe_file_name(&name)?.to_owned();
        candidate = Some(PackageVideo {
            filename,
            media_path: name,
            size_bytes: entry.size(),
        });
    }
    candidate.ok_or_else(|| "未知版本课程包没有可播放的 media/ 视频".into())
}

fn validate_media_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.is_absolute()
        || !path.starts_with("media")
        || path.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err("课程包视频路径不安全".into());
    }
    Ok(())
}

fn safe_file_name(name: &str) -> Result<&str, String> {
    Path::new(name)
        .file_name()
        .and_then(|name| name.to_str())
        .filter(|safe| !safe.is_empty() && *safe != "." && *safe != "..")
        .ok_or_else(|| "课程包视频文件名无效".to_owned())
}

fn create_work_dir() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join("videoinsight-player");
    fs::create_dir_all(&root).map_err(|error| format!("无法创建播放器临时目录：{error}"))?;
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    for attempt in 0..100_u32 {
        let candidate = root.join(format!("{}-{timestamp}-{attempt}", std::process::id()));
        match fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("无法创建播放器临时目录：{error}")),
        }
    }
    Err("无法分配播放器临时目录".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, ZipWriter};

    #[test]
    fn rejects_zip_slip_media_paths() {
        for path in ["../video.mp4", "/media/video.mp4", "media/../../video.mp4"] {
            assert!(validate_media_path(path).is_err(), "accepted {path}");
        }
        assert!(validate_media_path("media/video.mp4").is_ok());
    }

    #[test]
    fn rejects_zip_slip_asset_paths() {
        assert!(validate_asset_path("assets/image.png").is_ok());
        assert!(validate_asset_path("assets/../../image.png").is_err());
        assert!(validate_asset_path("media/image.png").is_err());
    }

    #[test]
    fn opens_single_file_package_and_shares_image_assets() {
        let source_dir = create_work_dir().unwrap();
        let package_path = source_dir.join("lesson.vinsight");
        let file = File::create(&package_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        let deflated = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer.start_file("mimetype", stored).unwrap();
        writer.write_all(PACKAGE_MIME.as_bytes()).unwrap();
        writer.start_file("manifest.json", deflated).unwrap();
        writer
            .write_all(
                serde_json::json!({
                    "format": DOCUMENT_FORMAT,
                    "format_version": 1,
                    "video": {
                        "filename": "lesson.mp4",
                        "media_path": "media/lesson.mp4",
                        "size_bytes": 5
                    },
                    "annotation_track": {
                        "format": "videoinsight.annotation-track",
                        "format_version": 1,
                        "annotations": [{
                            "timestamp_seconds": 1,
                            "content": {"type": "doc", "content": [{
                                "type": "image",
                                "attrs": {"src": "vinsight-asset://assets/image.png"}
                            }, {
                                "type": "image",
                                "attrs": {"src": "vinsight-asset://assets/image.png"}
                            }]}
                        }]
                    }
                })
                .to_string()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file("assets/image.png", stored).unwrap();
        writer.write_all(b"\x89PNG\r\n\x1a\n").unwrap();
        writer.start_file("media/lesson.mp4", stored).unwrap();
        writer.write_all(b"video").unwrap();
        writer.finish().unwrap();

        let opened = open(&package_path).unwrap();
        assert_eq!(opened.display_name, "lesson.mp4");
        let images = opened.annotations[0]
            .presentation_blocks()
            .into_iter()
            .filter_map(|block| match block {
                crate::annotations::PresentationBlock::Image(image) => Some(image),
                crate::annotations::PresentationBlock::Text(_) => None,
            })
            .collect::<Vec<_>>();
        assert_eq!(images.len(), 2);
        assert!(Arc::ptr_eq(&images[0].data, &images[1].data));
        assert!(opened.annotation_warning.is_none());
        assert_eq!(fs::read(&opened.video_path).unwrap(), b"video");
        let extracted_dir = opened.work_dir.clone();
        drop(opened);
        assert!(!extracted_dir.exists());
        fs::remove_dir_all(source_dir).unwrap();
    }

    #[test]
    fn plays_video_when_annotation_track_requires_a_newer_player() {
        let source_dir = create_work_dir().unwrap();
        let package_path = source_dir.join("future.vinsight");
        let file = File::create(&package_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("mimetype", stored).unwrap();
        writer.write_all(PACKAGE_MIME.as_bytes()).unwrap();
        writer.start_file("manifest.json", stored).unwrap();
        writer
            .write_all(
                serde_json::json!({
                    "format": DOCUMENT_FORMAT,
                    "format_version": 1,
                    "video": {
                        "filename": "future.mp4",
                        "media_path": "media/future.mp4",
                        "size_bytes": 5
                    },
                    "annotation_track": {
                        "format": "videoinsight.annotation-track",
                        "format_version": 99,
                        "annotations": []
                    }
                })
                .to_string()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file("media/future.mp4", stored).unwrap();
        writer.write_all(b"video").unwrap();
        writer.finish().unwrap();

        let opened = open(&package_path).unwrap();
        assert!(opened.annotations.is_empty());
        assert!(opened.annotation_warning.as_deref().is_some_and(|warning| {
            warning.contains("不支持的批注轨道版本 99") && warning.contains("视频仍可播放")
        }));
        assert_eq!(fs::read(&opened.video_path).unwrap(), b"video");
        drop(opened);
        fs::remove_dir_all(source_dir).unwrap();
    }

    #[test]
    fn plays_video_when_document_requires_a_newer_player() {
        let source_dir = create_work_dir().unwrap();
        let package_path = source_dir.join("future-document.vinsight");
        let file = File::create(&package_path).unwrap();
        let mut writer = ZipWriter::new(file);
        let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
        writer.start_file("mimetype", stored).unwrap();
        writer.write_all(PACKAGE_MIME.as_bytes()).unwrap();
        writer.start_file("manifest.json", stored).unwrap();
        writer
            .write_all(
                serde_json::json!({
                    "format": DOCUMENT_FORMAT,
                    "format_version": DOCUMENT_VERSION + 1,
                    "future_media_descriptor": true,
                    "annotation_track": {"format_version": 99}
                })
                .to_string()
                .as_bytes(),
            )
            .unwrap();
        writer.start_file("media/future.mp4", stored).unwrap();
        writer.write_all(b"video").unwrap();
        writer.finish().unwrap();

        let opened = open(&package_path).unwrap();
        assert_eq!(opened.display_name, "future.mp4");
        assert!(opened.annotations.is_empty());
        assert!(opened
            .annotation_warning
            .as_deref()
            .is_some_and(|warning| warning.contains("不支持的导出文档版本 2")));
        assert_eq!(fs::read(&opened.video_path).unwrap(), b"video");
        drop(opened);
        fs::remove_dir_all(source_dir).unwrap();
    }
}

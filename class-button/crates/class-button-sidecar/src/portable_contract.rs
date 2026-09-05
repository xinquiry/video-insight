use base64::{engine::general_purpose::STANDARD, Engine as _};

pub const PACKAGE_MIME: &str = "application/vnd.videoinsight.package+zip";
pub const DOCUMENT_FORMAT: &str = "videoinsight.annotated-video";
pub const DOCUMENT_VERSION: u64 = 1;
pub const TRACK_FORMAT: &str = "videoinsight.annotation-track";
pub const TRACK_VERSION: u64 = 1;
pub const ASSET_SCHEME: &str = "vinsight-asset://";
// 与 backend/internal/annotations MaxEmbeddedImageBytes(50 MiB)对齐:
// 写入端放行的图片,读取端必须也能载入,否则导出包批注会被拒。
pub const MAX_IMAGE_BYTES: u64 = 50 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ImageFormat {
    Png,
    Jpeg,
    Gif,
    Webp,
}

impl ImageFormat {
    pub fn from_asset_path(path: &str) -> Option<Self> {
        match std::path::Path::new(path)
            .extension()
            .and_then(|extension| extension.to_str())
            .map(str::to_ascii_lowercase)
            .as_deref()
        {
            Some("png") => Some(Self::Png),
            Some("jpg" | "jpeg") => Some(Self::Jpeg),
            Some("gif") => Some(Self::Gif),
            Some("webp") => Some(Self::Webp),
            _ => None,
        }
    }

    pub const fn mime_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
            Self::Gif => "image/gif",
            Self::Webp => "image/webp",
        }
    }

    pub fn has_valid_signature(self, data: &[u8]) -> bool {
        match self {
            Self::Png => data.starts_with(b"\x89PNG\r\n\x1a\n"),
            Self::Jpeg => data.starts_with(b"\xff\xd8\xff"),
            Self::Gif => data.starts_with(b"GIF87a") || data.starts_with(b"GIF89a"),
            Self::Webp => {
                data.len() >= 12 && data.starts_with(b"RIFF") && data.get(8..12) == Some(b"WEBP")
            }
        }
    }

    fn data_url_prefix(self) -> &'static str {
        match self {
            Self::Png => "data:image/png;base64,",
            Self::Jpeg => "data:image/jpeg;base64,",
            Self::Gif => "data:image/gif;base64,",
            Self::Webp => "data:image/webp;base64,",
        }
    }
}

pub struct DecodedImage {
    pub mime_type: &'static str,
    pub data: Vec<u8>,
}

pub fn decode_image_data_url(source: &str) -> Result<Option<DecodedImage>, String> {
    for format in [
        ImageFormat::Png,
        ImageFormat::Jpeg,
        ImageFormat::Gif,
        ImageFormat::Webp,
    ] {
        let Some(encoded) = source.strip_prefix(format.data_url_prefix()) else {
            continue;
        };
        let data = STANDARD
            .decode(encoded)
            .map_err(|error| format!("图片数据不是有效 Base64：{error}"))?;
        if data.len() as u64 > MAX_IMAGE_BYTES {
            return Err("批注图片超过 50 MiB".into());
        }
        if !format.has_valid_signature(&data) {
            return Err(format!("批注图片内容与 {} 不匹配", format.mime_type()));
        }
        return Ok(Some(DecodedImage {
            mime_type: format.mime_type(),
            data,
        }));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_embedded_image_signatures() {
        assert!(decode_image_data_url("data:image/png;base64,iVBORw0KGgo=")
            .unwrap()
            .is_some());
        assert!(decode_image_data_url("data:image/png;base64,aW52YWxpZA==").is_err());
    }
}

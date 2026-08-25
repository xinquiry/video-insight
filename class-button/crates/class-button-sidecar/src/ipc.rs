use class_button_core::ProcessedPress;
use serde::{Deserialize, Serialize};

use crate::media::PlayerMedia;

pub const PROTOCOL_VERSION: u8 = 1;

#[derive(Debug, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Command {
    OpenMedia { request_id: u64, source: String },
    Shutdown,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum SidecarEvent {
    Ready {
        protocol: u8,
        classroom: String,
    },
    ReceiverStatus {
        online: bool,
        port: Option<String>,
    },
    Press {
        press: ProcessedPress,
    },
    MediaOpened {
        request_id: u64,
        media: PlayerMedia,
    },
    Error {
        message: String,
        request_id: Option<u64>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn command_contract_is_tagged_and_versioned() {
        let command: Command =
            serde_json::from_str(r#"{"type":"open_media","request_id":7,"source":"lesson.mp4"}"#)
                .unwrap();
        assert!(matches!(command, Command::OpenMedia { request_id: 7, .. }));
        assert_eq!(PROTOCOL_VERSION, 1);
    }
}

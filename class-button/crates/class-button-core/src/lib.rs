use std::collections::{HashMap, HashSet, VecDeque};

use class_button_protocol::{Message, MessageKind};
use serde::{Deserialize, Serialize};
use thiserror::Error;

const DEFAULT_DEDUPLICATION_WINDOW: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClassroomConfig {
    pub classroom: String,
    pub devices: Vec<StudentDevice>,
}

impl ClassroomConfig {
    pub fn from_json(input: &str) -> Result<Self, ConfigError> {
        let config: Self = serde_json::from_str(input)?;
        config.validate()?;
        Ok(config)
    }

    pub fn validate(&self) -> Result<(), ConfigError> {
        if self.classroom.trim().is_empty() {
            return Err(ConfigError::EmptyClassroom);
        }

        let mut ids = HashSet::new();
        for device in &self.devices {
            if device.student.trim().is_empty() {
                return Err(ConfigError::EmptyStudent(device.device_id));
            }
            if !ids.insert(device.device_id) {
                return Err(ConfigError::DuplicateDevice(device.device_id));
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct StudentDevice {
    pub device_id: u32,
    pub student: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub seat: Option<String>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("invalid classroom JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("classroom name cannot be empty")]
    EmptyClassroom,
    #[error("student name for device {0} cannot be empty")]
    EmptyStudent(u32),
    #[error("device id {0} is configured more than once")]
    DuplicateDevice(u32),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ProcessedPress {
    pub classroom: String,
    pub student: String,
    pub seat: Option<String>,
    pub device_id: u32,
    pub session_id: u32,
    pub sequence: u32,
    pub battery_mv: u16,
    pub received_at_ms: u64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProcessOutcome {
    Accepted(ProcessedPress),
    Duplicate {
        device_id: u32,
        session_id: u32,
        sequence: u32,
    },
    UnknownDevice(Message),
    Ignored(Message),
}

#[derive(Debug)]
pub struct EventProcessor {
    classroom: String,
    devices: HashMap<u32, StudentDevice>,
    history: HashMap<u32, DeviceHistory>,
    deduplication_window: usize,
}

impl EventProcessor {
    pub fn new(config: ClassroomConfig) -> Self {
        Self::with_window(config, DEFAULT_DEDUPLICATION_WINDOW)
    }

    pub fn with_window(config: ClassroomConfig, deduplication_window: usize) -> Self {
        let devices = config
            .devices
            .into_iter()
            .map(|device| (device.device_id, device))
            .collect();
        Self {
            classroom: config.classroom,
            devices,
            history: HashMap::new(),
            deduplication_window: deduplication_window.max(1),
        }
    }

    pub fn process(&mut self, message: Message, received_at_ms: u64) -> ProcessOutcome {
        if message.kind != MessageKind::Press {
            return ProcessOutcome::Ignored(message);
        }

        let Some(device) = self.devices.get(&message.device_id) else {
            return ProcessOutcome::UnknownDevice(message);
        };

        let history = self
            .history
            .entry(message.device_id)
            .or_insert_with(|| DeviceHistory::new(message.session_id, self.deduplication_window));
        if !history.insert(message.session_id, message.sequence) {
            return ProcessOutcome::Duplicate {
                device_id: message.device_id,
                session_id: message.session_id,
                sequence: message.sequence,
            };
        }

        ProcessOutcome::Accepted(ProcessedPress {
            classroom: self.classroom.clone(),
            student: device.student.clone(),
            seat: device.seat.clone(),
            device_id: message.device_id,
            session_id: message.session_id,
            sequence: message.sequence,
            battery_mv: message.battery_mv,
            received_at_ms,
        })
    }
}

#[derive(Debug)]
struct DeviceHistory {
    session_id: u32,
    sequences: VecDeque<u32>,
    capacity: usize,
}

impl DeviceHistory {
    fn new(session_id: u32, capacity: usize) -> Self {
        Self {
            session_id,
            sequences: VecDeque::with_capacity(capacity),
            capacity,
        }
    }

    fn insert(&mut self, session_id: u32, sequence: u32) -> bool {
        if self.session_id != session_id {
            self.session_id = session_id;
            self.sequences.clear();
        } else if self.sequences.contains(&sequence) {
            return false;
        }

        if self.sequences.len() == self.capacity {
            self.sequences.pop_front();
        }
        self.sequences.push_back(sequence);
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn processor() -> EventProcessor {
        EventProcessor::new(ClassroomConfig {
            classroom: "六年级一班".into(),
            devices: vec![StudentDevice {
                device_id: 1001,
                student: "张同学".into(),
                seat: Some("A1".into()),
            }],
        })
    }

    #[test]
    fn maps_known_device_to_student() {
        let outcome = processor().process(Message::press(1001, 5, 1, 3920), 1234);
        let ProcessOutcome::Accepted(press) = outcome else {
            panic!("expected accepted press");
        };
        assert_eq!(press.student, "张同学");
        assert_eq!(press.seat.as_deref(), Some("A1"));
        assert_eq!(press.received_at_ms, 1234);
    }

    #[test]
    fn rejects_retry_as_duplicate() {
        let mut processor = processor();
        let message = Message::press(1001, 5, 9, 3900);
        assert!(matches!(
            processor.process(message, 1),
            ProcessOutcome::Accepted(_)
        ));
        assert!(matches!(
            processor.process(message, 2),
            ProcessOutcome::Duplicate { sequence: 9, .. }
        ));
    }

    #[test]
    fn new_boot_session_can_reuse_sequence() {
        let mut processor = processor();
        assert!(matches!(
            processor.process(Message::press(1001, 5, 1, 3900), 1),
            ProcessOutcome::Accepted(_)
        ));
        assert!(matches!(
            processor.process(Message::press(1001, 6, 1, 3900), 2),
            ProcessOutcome::Accepted(_)
        ));
    }

    #[test]
    fn reports_unknown_device() {
        assert!(matches!(
            processor().process(Message::press(9999, 1, 1, 3900), 1),
            ProcessOutcome::UnknownDevice(_)
        ));
    }

    #[test]
    fn validates_unique_device_ids() {
        let input = r#"{
            "classroom": "test",
            "devices": [
                {"device_id": 1, "student": "A"},
                {"device_id": 1, "student": "B"}
            ]
        }"#;
        assert!(matches!(
            ClassroomConfig::from_json(input),
            Err(ConfigError::DuplicateDevice(1))
        ));
    }
}

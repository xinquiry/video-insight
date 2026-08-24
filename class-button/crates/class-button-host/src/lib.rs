use class_button_protocol::{decode_hex, DecodeError, Message};
use thiserror::Error;
use tokio_serial::{available_ports, SerialPortType};

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReceiverLine<'a> {
    Event(Message),
    Info(&'a str),
    Error(&'a str),
}

#[derive(Debug, Error)]
pub enum ReceiverLineError {
    #[error("receiver emitted an empty line")]
    Empty,
    #[error("unsupported receiver line: {0}")]
    Unsupported(String),
    #[error("invalid event frame: {0}")]
    InvalidFrame(DecodeError),
}

impl From<DecodeError> for ReceiverLineError {
    fn from(error: DecodeError) -> Self {
        Self::InvalidFrame(error)
    }
}

pub fn parse_receiver_line(line: &str) -> Result<ReceiverLine<'_>, ReceiverLineError> {
    let line = line.trim();
    if line.is_empty() {
        return Err(ReceiverLineError::Empty);
    }
    if let Some(hex) = line.strip_prefix("EV ") {
        let frame = decode_hex(hex.as_bytes())?;
        return Ok(ReceiverLine::Event(Message::decode(&frame)?));
    }
    if let Some(info) = line.strip_prefix("INFO ") {
        return Ok(ReceiverLine::Info(info));
    }
    if let Some(error) = line.strip_prefix("ERR ") {
        return Ok(ReceiverLine::Error(error));
    }
    Err(ReceiverLineError::Unsupported(line.to_owned()))
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PortInfo {
    pub name: String,
    pub kind: String,
    pub vid: Option<u16>,
    pub pid: Option<u16>,
    pub serial_number: Option<String>,
}

pub fn list_serial_ports() -> std::io::Result<Vec<PortInfo>> {
    available_ports()
        .map(|ports| {
            ports
                .into_iter()
                .map(|port| match port.port_type {
                    SerialPortType::UsbPort(usb) => PortInfo {
                        name: port.port_name,
                        kind: "usb".into(),
                        vid: Some(usb.vid),
                        pid: Some(usb.pid),
                        serial_number: usb.serial_number,
                    },
                    SerialPortType::BluetoothPort => PortInfo {
                        name: port.port_name,
                        kind: "bluetooth".into(),
                        vid: None,
                        pid: None,
                        serial_number: None,
                    },
                    SerialPortType::PciPort => PortInfo {
                        name: port.port_name,
                        kind: "pci".into(),
                        vid: None,
                        pid: None,
                        serial_number: None,
                    },
                    SerialPortType::Unknown => PortInfo {
                        name: port.port_name,
                        kind: "unknown".into(),
                        vid: None,
                        pid: None,
                        serial_number: None,
                    },
                })
                .collect()
        })
        .map_err(std::io::Error::other)
}

#[cfg(test)]
mod tests {
    use class_button_protocol::{encode_hex, Message};

    use super::*;

    #[test]
    fn parses_event_line() {
        let message = Message::press(1001, 2, 3, 3880);
        let hex = encode_hex(&message.encode());
        let line = format!("EV {}", str::from_utf8(&hex).unwrap());
        assert_eq!(
            parse_receiver_line(&line).unwrap(),
            ReceiverLine::Event(message)
        );
    }

    #[test]
    fn parses_diagnostic_lines() {
        assert_eq!(
            parse_receiver_line("INFO receiver-ready").unwrap(),
            ReceiverLine::Info("receiver-ready")
        );
        assert_eq!(
            parse_receiver_line("ERR bad-frame").unwrap(),
            ReceiverLine::Error("bad-frame")
        );
    }
}

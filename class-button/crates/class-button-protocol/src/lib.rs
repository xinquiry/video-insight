#![no_std]

use core::fmt;

pub const MAGIC: [u8; 2] = *b"CB";
pub const PROTOCOL_VERSION: u8 = 1;
pub const FRAME_LEN: usize = 22;
pub const FRAME_HEX_LEN: usize = FRAME_LEN * 2;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum MessageKind {
    Press = 1,
    Ack = 2,
    Heartbeat = 3,
}

impl TryFrom<u8> for MessageKind {
    type Error = DecodeError;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        match value {
            1 => Ok(Self::Press),
            2 => Ok(Self::Ack),
            3 => Ok(Self::Heartbeat),
            value => Err(DecodeError::UnknownMessageKind(value)),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Message {
    pub kind: MessageKind,
    pub device_id: u32,
    pub session_id: u32,
    pub sequence: u32,
    pub battery_mv: u16,
    pub flags: u16,
}

impl Message {
    pub const fn press(device_id: u32, session_id: u32, sequence: u32, battery_mv: u16) -> Self {
        Self {
            kind: MessageKind::Press,
            device_id,
            session_id,
            sequence,
            battery_mv,
            flags: 0,
        }
    }

    pub fn encode(&self) -> [u8; FRAME_LEN] {
        let mut frame = [0_u8; FRAME_LEN];
        frame[0..2].copy_from_slice(&MAGIC);
        frame[2] = PROTOCOL_VERSION;
        frame[3] = self.kind as u8;
        frame[4..8].copy_from_slice(&self.device_id.to_le_bytes());
        frame[8..12].copy_from_slice(&self.session_id.to_le_bytes());
        frame[12..16].copy_from_slice(&self.sequence.to_le_bytes());
        frame[16..18].copy_from_slice(&self.battery_mv.to_le_bytes());
        frame[18..20].copy_from_slice(&self.flags.to_le_bytes());

        let checksum = crc16_ccitt(&frame[..FRAME_LEN - 2]);
        frame[FRAME_LEN - 2..].copy_from_slice(&checksum.to_le_bytes());
        frame
    }

    pub fn decode(frame: &[u8]) -> Result<Self, DecodeError> {
        if frame.len() != FRAME_LEN {
            return Err(DecodeError::InvalidLength {
                expected: FRAME_LEN,
                actual: frame.len(),
            });
        }
        if frame[0..2] != MAGIC {
            return Err(DecodeError::InvalidMagic);
        }
        if frame[2] != PROTOCOL_VERSION {
            return Err(DecodeError::UnsupportedVersion(frame[2]));
        }

        let expected = u16::from_le_bytes([frame[20], frame[21]]);
        let actual = crc16_ccitt(&frame[..20]);
        if actual != expected {
            return Err(DecodeError::ChecksumMismatch { expected, actual });
        }

        Ok(Self {
            kind: MessageKind::try_from(frame[3])?,
            device_id: u32::from_le_bytes(frame[4..8].try_into().unwrap()),
            session_id: u32::from_le_bytes(frame[8..12].try_into().unwrap()),
            sequence: u32::from_le_bytes(frame[12..16].try_into().unwrap()),
            battery_mv: u16::from_le_bytes(frame[16..18].try_into().unwrap()),
            flags: u16::from_le_bytes(frame[18..20].try_into().unwrap()),
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DecodeError {
    InvalidLength { expected: usize, actual: usize },
    InvalidHexLength { expected: usize, actual: usize },
    InvalidHex { index: usize },
    InvalidMagic,
    UnsupportedVersion(u8),
    UnknownMessageKind(u8),
    ChecksumMismatch { expected: u16, actual: u16 },
}

impl fmt::Display for DecodeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidLength { expected, actual } => {
                write!(f, "invalid frame length: expected {expected}, got {actual}")
            }
            Self::InvalidHexLength { expected, actual } => {
                write!(f, "invalid hex length: expected {expected}, got {actual}")
            }
            Self::InvalidHex { index } => write!(f, "invalid hex digit at index {index}"),
            Self::InvalidMagic => f.write_str("invalid frame magic"),
            Self::UnsupportedVersion(version) => {
                write!(f, "unsupported protocol version {version}")
            }
            Self::UnknownMessageKind(kind) => write!(f, "unknown message kind {kind}"),
            Self::ChecksumMismatch { expected, actual } => write!(
                f,
                "checksum mismatch: frame has {expected:#06x}, calculated {actual:#06x}"
            ),
        }
    }
}

pub fn encode_hex(frame: &[u8; FRAME_LEN]) -> [u8; FRAME_HEX_LEN] {
    const HEX: &[u8; 16] = b"0123456789ABCDEF";
    let mut output = [0_u8; FRAME_HEX_LEN];
    for (index, byte) in frame.iter().copied().enumerate() {
        output[index * 2] = HEX[(byte >> 4) as usize];
        output[index * 2 + 1] = HEX[(byte & 0x0f) as usize];
    }
    output
}

pub fn decode_hex(input: &[u8]) -> Result<[u8; FRAME_LEN], DecodeError> {
    if input.len() != FRAME_HEX_LEN {
        return Err(DecodeError::InvalidHexLength {
            expected: FRAME_HEX_LEN,
            actual: input.len(),
        });
    }

    let mut output = [0_u8; FRAME_LEN];
    for index in 0..FRAME_LEN {
        let high =
            decode_nibble(input[index * 2]).ok_or(DecodeError::InvalidHex { index: index * 2 })?;
        let low = decode_nibble(input[index * 2 + 1]).ok_or(DecodeError::InvalidHex {
            index: index * 2 + 1,
        })?;
        output[index] = (high << 4) | low;
    }
    Ok(output)
}

const fn decode_nibble(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

pub fn crc16_ccitt(bytes: &[u8]) -> u16 {
    let mut crc = 0xffff_u16;
    for byte in bytes {
        crc ^= (*byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Message {
        Message {
            kind: MessageKind::Press,
            device_id: 1001,
            session_id: 7,
            sequence: 42,
            battery_mv: 3910,
            flags: 0x0001,
        }
    }

    #[test]
    fn frame_round_trip() {
        let message = sample();
        assert_eq!(Message::decode(&message.encode()), Ok(message));
    }

    #[test]
    fn hex_round_trip_accepts_lowercase() {
        let frame = sample().encode();
        let mut hex = encode_hex(&frame);
        hex.make_ascii_lowercase();
        assert_eq!(decode_hex(&hex), Ok(frame));
    }

    #[test]
    fn damaged_frame_is_rejected() {
        let mut frame = sample().encode();
        frame[12] ^= 0x01;
        assert!(matches!(
            Message::decode(&frame),
            Err(DecodeError::ChecksumMismatch { .. })
        ));
    }

    #[test]
    fn invalid_hex_reports_position() {
        let mut hex = encode_hex(&sample().encode());
        hex[5] = b'Z';
        assert_eq!(decode_hex(&hex), Err(DecodeError::InvalidHex { index: 5 }));
    }
}

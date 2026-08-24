use std::{
    fs, io,
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

use clap::{Parser, Subcommand};
use class_button_core::{ClassroomConfig, EventProcessor, ProcessOutcome};
use class_button_host::{list_serial_ports, parse_receiver_line, ReceiverLine};
use class_button_protocol::{encode_hex, Message};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio_serial::SerialPortBuilderExt;

#[derive(Debug, Parser)]
#[command(
    name = "class-button",
    version,
    about = "Class Button host diagnostics"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// List serial ports visible to the host.
    Ports,
    /// Listen for receiver lines and map button events to students.
    Listen {
        #[arg(long)]
        port: String,
        #[arg(long, default_value_t = 115_200)]
        baud: u32,
        #[arg(long, default_value = "config/classroom.example.json")]
        config: PathBuf,
    },
    /// Run one event through the full protocol/parser/core path without hardware.
    Simulate {
        #[arg(long, default_value = "config/classroom.example.json")]
        config: PathBuf,
        #[arg(long, default_value_t = 1001)]
        device_id: u32,
        #[arg(long, default_value_t = 1)]
        session_id: u32,
        #[arg(long, default_value_t = 1)]
        sequence: u32,
        #[arg(long, default_value_t = 3900)]
        battery_mv: u16,
    },
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    match Cli::parse().command {
        Command::Ports => print_ports()?,
        Command::Listen { port, baud, config } => listen(&port, baud, &config).await?,
        Command::Simulate {
            config,
            device_id,
            session_id,
            sequence,
            battery_mv,
        } => simulate(&config, device_id, session_id, sequence, battery_mv)?,
    }
    Ok(())
}

fn print_ports() -> io::Result<()> {
    for port in list_serial_ports()? {
        match (port.vid, port.pid) {
            (Some(vid), Some(pid)) => println!(
                "{}\tkind={}\tvid={vid:04x}\tpid={pid:04x}\tserial={}",
                port.name,
                port.kind,
                port.serial_number.as_deref().unwrap_or("-")
            ),
            _ => println!("{}\tkind={}", port.name, port.kind),
        }
    }
    Ok(())
}

async fn listen(
    port: &str,
    baud: u32,
    config_path: &Path,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut processor = load_processor(config_path)?;
    let serial = tokio_serial::new(port, baud).open_native_async()?;
    let mut lines = BufReader::new(serial).lines();
    eprintln!("listening on {port} at {baud} baud");

    while let Some(line) = lines.next_line().await? {
        match parse_receiver_line(&line) {
            Ok(ReceiverLine::Event(message)) => {
                print_outcome(processor.process(message, now_ms()))?
            }
            Ok(ReceiverLine::Info(info)) => eprintln!("receiver: {info}"),
            Ok(ReceiverLine::Error(error)) => eprintln!("receiver error: {error}"),
            Err(error) => eprintln!("ignored serial line: {error}"),
        }
    }
    Ok(())
}

fn simulate(
    config_path: &Path,
    device_id: u32,
    session_id: u32,
    sequence: u32,
    battery_mv: u16,
) -> Result<(), Box<dyn std::error::Error>> {
    let mut processor = load_processor(config_path)?;
    let message = Message::press(device_id, session_id, sequence, battery_mv);
    let hex = encode_hex(&message.encode());
    let line = format!("EV {}", std::str::from_utf8(&hex)?);
    eprintln!("simulated receiver line: {line}");

    let ReceiverLine::Event(decoded) = parse_receiver_line(&line)? else {
        unreachable!("simulated line must contain an event")
    };
    print_outcome(processor.process(decoded, now_ms()))?;
    Ok(())
}

fn load_processor(path: &Path) -> Result<EventProcessor, Box<dyn std::error::Error>> {
    let input = fs::read_to_string(path)?;
    Ok(EventProcessor::new(ClassroomConfig::from_json(&input)?))
}

fn print_outcome(outcome: ProcessOutcome) -> Result<(), serde_json::Error> {
    match outcome {
        ProcessOutcome::Accepted(press) => println!("{}", serde_json::to_string(&press)?),
        ProcessOutcome::Duplicate {
            device_id,
            session_id,
            sequence,
        } => eprintln!(
            "duplicate event ignored: device={device_id} session={session_id} sequence={sequence}"
        ),
        ProcessOutcome::UnknownDevice(message) => {
            eprintln!("unknown device ignored: {}", message.device_id)
        }
        ProcessOutcome::Ignored(message) => {
            eprintln!("non-press message ignored: {:?}", message.kind)
        }
    }
    Ok(())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

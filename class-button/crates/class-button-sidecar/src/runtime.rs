use std::time::Duration;

use class_button_core::{ClassroomConfig, EventProcessor, ProcessOutcome, ProcessedPress};
use class_button_host::{list_serial_ports, parse_receiver_line, ReceiverLine};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::{broadcast, mpsc};
use tokio::task::JoinHandle;
use tokio_serial::SerialPortBuilderExt;

use crate::{ipc::SidecarEvent, server, Args};

pub struct RuntimeHandle {
    serial: JoinHandle<()>,
    server: JoinHandle<()>,
    demo: Option<JoinHandle<()>>,
}

impl RuntimeHandle {
    pub fn shutdown(self) {
        self.serial.abort();
        self.server.abort();
        if let Some(demo) = self.demo {
            demo.abort();
        }
    }
}

pub fn spawn(
    args: &Args,
    config: ClassroomConfig,
    events: mpsc::UnboundedSender<SidecarEvent>,
) -> RuntimeHandle {
    let (player_tx, _) = broadcast::channel::<ProcessedPress>(32);
    let demo = args.demo.then(|| {
        let player_tx = player_tx.clone();
        let events = events.clone();
        let classroom = config.classroom.clone();
        let delay = args.demo_delay_ms;
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            let press = ProcessedPress {
                classroom,
                student: "测试学生 1".into(),
                seat: Some("A1".into()),
                device_id: 1001,
                session_id: 1,
                sequence: 1,
                battery_mv: 3900,
                received_at_ms: now_ms(),
            };
            let _ = player_tx.send(press.clone());
            let _ = events.send(SidecarEvent::Press { press });
        })
    });

    let serial = tokio::spawn(serial_loop(
        args.port.clone(),
        args.baud,
        config,
        player_tx.clone(),
        events.clone(),
    ));
    let address = args.listen;
    let server = tokio::spawn(async move {
        if let Err(message) = server::serve(address, player_tx).await {
            let _ = events.send(SidecarEvent::Error {
                message,
                request_id: None,
            });
        }
    });

    RuntimeHandle {
        serial,
        server,
        demo,
    }
}

async fn serial_loop(
    configured_port: Option<String>,
    baud: u32,
    config: ClassroomConfig,
    player_tx: broadcast::Sender<ProcessedPress>,
    events: mpsc::UnboundedSender<SidecarEvent>,
) {
    let mut processor = EventProcessor::new(config);

    loop {
        let port = match configured_port.clone().or_else(discover_receiver) {
            Some(port) => port,
            None => {
                let _ = events.send(SidecarEvent::ReceiverStatus {
                    online: false,
                    port: None,
                });
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        match tokio_serial::new(&port, baud).open_native_async() {
            Ok(serial) => {
                let _ = events.send(SidecarEvent::ReceiverStatus {
                    online: true,
                    port: Some(port.clone()),
                });
                let mut lines = BufReader::new(serial).lines();
                loop {
                    match lines.next_line().await {
                        Ok(Some(line)) => {
                            if let Ok(ReceiverLine::Event(message)) = parse_receiver_line(&line) {
                                if let ProcessOutcome::Accepted(press) =
                                    processor.process(message, now_ms())
                                {
                                    let _ = player_tx.send(press.clone());
                                    let _ = events.send(SidecarEvent::Press { press });
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            let _ = events.send(SidecarEvent::Error {
                                message: format!("接收器串口读取失败：{error}"),
                                request_id: None,
                            });
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                let _ = events.send(SidecarEvent::Error {
                    message: format!("无法打开接收器 {port}：{error}"),
                    request_id: None,
                });
            }
        }

        let _ = events.send(SidecarEvent::ReceiverStatus {
            online: false,
            port: Some(port),
        });
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
}

fn discover_receiver() -> Option<String> {
    let ports = list_serial_ports().ok()?;
    ports
        .iter()
        .find(|port| port.vid == Some(0x1a86) && port.pid == Some(0x55d3))
        .or_else(|| ports.iter().find(|port| port.vid == Some(0x1a86)))
        .or_else(|| ports.iter().find(|port| port.name.contains("usbmodem")))
        .map(|port| port.name.clone())
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

use std::{thread, time::Duration};

use class_button_core::{ClassroomConfig, EventProcessor, ProcessOutcome, ProcessedPress};
use class_button_host::{list_serial_ports, parse_receiver_line, ReceiverLine};
use makepad_widgets::Cx;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::broadcast;
use tokio_serial::SerialPortBuilderExt;

use crate::{server, Args};

#[derive(Debug, Clone)]
pub enum UiEvent {
    ReceiverStatus { online: bool, port: Option<String> },
    Press(ProcessedPress),
    Error(String),
}

pub fn spawn(args: Args, config: ClassroomConfig) {
    thread::Builder::new()
        .name("class-button-runtime".into())
        .spawn(move || {
            let runtime = tokio::runtime::Runtime::new().expect("create Tokio runtime");
            runtime.block_on(async move {
                let (player_tx, _) = broadcast::channel::<ProcessedPress>(32);
                if args.demo {
                    let demo_players = player_tx.clone();
                    let classroom = config.classroom.clone();
                    let demo_delay = args.demo_delay_ms;
                    tokio::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(demo_delay)).await;
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
                        let _ = demo_players.send(press.clone());
                        Cx::post_action(UiEvent::Press(press));
                    });
                }

                let serial_task =
                    tokio::spawn(serial_loop(args.port, args.baud, config, player_tx.clone()));
                if let Err(error) = server::serve(args.listen, player_tx).await {
                    Cx::post_action(UiEvent::Error(error));
                }
                serial_task.abort();
            });
        })
        .expect("spawn Class Button runtime");
}

async fn serial_loop(
    configured_port: Option<String>,
    baud: u32,
    config: ClassroomConfig,
    player_tx: broadcast::Sender<ProcessedPress>,
) -> Result<(), String> {
    let mut processor = EventProcessor::new(config);

    loop {
        let port = match configured_port.clone().or_else(discover_receiver) {
            Some(port) => port,
            None => {
                Cx::post_action(UiEvent::ReceiverStatus {
                    online: false,
                    port: None,
                });
                tokio::time::sleep(Duration::from_secs(2)).await;
                continue;
            }
        };

        match tokio_serial::new(&port, baud).open_native_async() {
            Ok(serial) => {
                Cx::post_action(UiEvent::ReceiverStatus {
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
                                    Cx::post_action(UiEvent::Press(press));
                                }
                            }
                        }
                        Ok(None) => break,
                        Err(error) => {
                            Cx::post_action(UiEvent::Error(format!("接收器串口读取失败：{error}")));
                            break;
                        }
                    }
                }
            }
            Err(error) => {
                Cx::post_action(UiEvent::Error(format!("无法打开接收器 {port}：{error}")))
            }
        }

        Cx::post_action(UiEvent::ReceiverStatus {
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

mod annotations;
mod ipc;
mod media;
mod package;
mod portable_contract;
mod runtime;
mod server;

use std::{fs, net::SocketAddr, path::PathBuf};

use clap::Parser;
use class_button_core::ClassroomConfig;
use ipc::{Command, SidecarEvent};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, BufWriter};
use tokio::sync::mpsc;

#[derive(Debug, Clone, Parser)]
#[command(
    name = "class-button-sidecar",
    version,
    about = "Class Button hardware and media sidecar for the Electron player"
)]
pub(crate) struct Args {
    /// Receiver serial port. Omit to auto-detect the WCH receiver.
    #[arg(long)]
    pub(crate) port: Option<String>,

    #[arg(long, default_value_t = 115_200)]
    pub(crate) baud: u32,

    #[arg(long)]
    pub(crate) config: Option<PathBuf>,

    /// Open this local .vinsight package or video immediately.
    #[arg(long)]
    pub(crate) video: Option<PathBuf>,

    /// Optional localhost event endpoint for browser-player compatibility.
    #[arg(long, default_value = "127.0.0.1:9842")]
    pub(crate) listen: SocketAddr,

    /// Emit one local sample event after startup for UI and player testing.
    #[arg(long)]
    pub(crate) demo: bool,

    #[arg(long, default_value_t = 2_500, hide = true)]
    pub(crate) demo_delay_ms: u64,
}

#[tokio::main]
async fn main() {
    let args = Args::parse();
    let (event_tx, event_rx) = mpsc::unbounded_channel();
    let writer = tokio::spawn(write_events(event_rx));

    let config = match load_classroom(&args) {
        Ok(config) => config,
        Err(message) => {
            let _ = event_tx.send(SidecarEvent::Error {
                message,
                request_id: None,
            });
            drop(event_tx);
            let _ = writer.await;
            return;
        }
    };

    let _ = event_tx.send(SidecarEvent::Ready {
        protocol: ipc::PROTOCOL_VERSION,
        classroom: config.classroom.clone(),
    });
    let runtime = runtime::spawn(&args, config, event_tx.clone());
    let mut active_package = None;

    if let Some(path) = &args.video {
        if let Some(package) = open_media(0, &path.to_string_lossy(), &event_tx) {
            active_package = package;
        }
    }

    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    loop {
        match lines.next_line().await {
            Ok(Some(line)) => match serde_json::from_str::<Command>(&line) {
                Ok(Command::OpenMedia { request_id, source }) => {
                    if let Some(package) = open_media(request_id, &source, &event_tx) {
                        active_package = package;
                    }
                }
                Ok(Command::Shutdown) => break,
                Err(error) => {
                    let _ = event_tx.send(SidecarEvent::Error {
                        message: format!("播放器命令无效：{error}"),
                        request_id: None,
                    });
                }
            },
            Ok(None) => break,
            Err(error) => {
                let _ = event_tx.send(SidecarEvent::Error {
                    message: format!("播放器命令通道异常：{error}"),
                    request_id: None,
                });
                break;
            }
        }
    }

    runtime.shutdown();
    drop(active_package);
    drop(event_tx);
    let _ = writer.await;
}

fn open_media(
    request_id: u64,
    source: &str,
    events: &mpsc::UnboundedSender<SidecarEvent>,
) -> Option<Option<package::OpenedPackage>> {
    match media::open(source) {
        Ok(opened) => {
            let media::OpenedMedia { media, package } = opened;
            let _ = events.send(SidecarEvent::MediaOpened { request_id, media });
            Some(package)
        }
        Err(message) => {
            let _ = events.send(SidecarEvent::Error {
                message,
                request_id: Some(request_id),
            });
            None
        }
    }
}

async fn write_events(mut events: mpsc::UnboundedReceiver<SidecarEvent>) {
    let mut output = BufWriter::new(tokio::io::stdout());
    while let Some(event) = events.recv().await {
        let Ok(line) = serde_json::to_vec(&event) else {
            continue;
        };
        if output.write_all(&line).await.is_err()
            || output.write_all(b"\n").await.is_err()
            || output.flush().await.is_err()
        {
            break;
        }
    }
}

pub(crate) fn load_classroom(args: &Args) -> Result<ClassroomConfig, String> {
    let path = resolve_config_path(args.config.as_deref());
    let json = fs::read_to_string(&path)
        .map_err(|error| format!("无法读取课堂配置 {}：{error}", path.display()))?;
    ClassroomConfig::from_json(&json)
        .map_err(|error| format!("课堂配置 {} 无效：{error}", path.display()))
}

fn resolve_config_path(configured: Option<&std::path::Path>) -> PathBuf {
    if let Some(path) = configured {
        return path.to_owned();
    }

    if let Ok(executable) = std::env::current_exe() {
        for path in bundled_config_candidates(&executable) {
            if path.is_file() {
                return path;
            }
        }
    }
    PathBuf::from("config/classroom.example.json")
}

fn bundled_config_candidates(executable: &std::path::Path) -> Vec<PathBuf> {
    let Some(binary_dir) = executable.parent() else {
        return Vec::new();
    };

    let mut candidates = Vec::with_capacity(5);
    if let Some(parent_dir) = binary_dir.parent() {
        candidates.push(parent_dir.join("Resources/classroom.json"));
        candidates.push(parent_dir.join("classroom.json"));
    }
    candidates.push(binary_dir.join("classroom.json"));
    candidates.push(binary_dir.join("config/classroom.json"));
    candidates
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_package_finds_config_next_to_executable() {
        let paths = bundled_config_candidates(std::path::Path::new("/package/Class Button.exe"));
        assert!(paths.contains(&PathBuf::from("/package/classroom.json")));
    }

    #[test]
    fn mac_bundle_finds_resources_config() {
        let paths = bundled_config_candidates(std::path::Path::new(
            "/Class Button.app/Contents/MacOS/class-button-sidecar",
        ));
        assert!(paths.contains(&PathBuf::from(
            "/Class Button.app/Contents/Resources/classroom.json"
        )));
    }

    #[test]
    fn electron_resources_find_config_above_bin_directory() {
        let paths = bundled_config_candidates(std::path::Path::new(
            "/Class Button.app/Contents/Resources/bin/class-button-sidecar",
        ));
        assert!(paths.contains(&PathBuf::from(
            "/Class Button.app/Contents/Resources/classroom.json"
        )));
    }
}

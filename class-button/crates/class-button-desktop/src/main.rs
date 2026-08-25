#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]

mod annotation_content;
mod annotation_timeline;
mod annotations;
mod app;
mod package;
mod picker;
mod portable_contract;
mod runtime;
mod server;
mod ui;

use std::{fs, net::SocketAddr, path::PathBuf};

use clap::Parser;
use class_button_core::ClassroomConfig;
pub use makepad_widgets;
use makepad_widgets::*;

use crate::app::App;

app_main!(App);

#[derive(Debug, Clone, Parser)]
#[command(
    name = "class-button-desktop",
    version,
    about = "Class Button classroom player for VideoInsight"
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

    let mut candidates = Vec::with_capacity(3);
    if let Some(contents_dir) = binary_dir.parent() {
        candidates.push(contents_dir.join("Resources/classroom.json"));
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
            "/Class Button.app/Contents/MacOS/class-button-desktop",
        ));
        assert!(paths.contains(&PathBuf::from(
            "/Class Button.app/Contents/Resources/classroom.json"
        )));
    }
}

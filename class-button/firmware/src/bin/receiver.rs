use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

use class_button_protocol::{encode_hex, Message, MessageKind};
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    espnow::{EspNow, PeerInfo, ReceiveInfo},
    hal::peripherals::Peripherals,
    nvs::EspDefaultNvsPartition,
    sys::{esp_mac_type_t_ESP_MAC_WIFI_STA, esp_read_mac, esp_wifi_set_channel},
    wifi::{ClientConfiguration, Configuration, EspWifi, WifiEvent},
};

const CHANNEL: u8 = 1;
const WIFI_START_TIMEOUT: Duration = Duration::from_secs(5);

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let system_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop.clone(), Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    start_wifi_and_wait(&mut wifi, &system_loop)?;

    let mac = station_mac()?;
    set_radio_channel()?;

    let espnow = Arc::new(EspNow::take()?);
    let (tx, rx) = mpsc::channel::<([u8; 6], Vec<u8>)>();
    espnow.register_recv_cb(move |info: &ReceiveInfo, data: &[u8]| {
        let mut source = [0_u8; 6];
        source.copy_from_slice(&info.src_addr[..6]);
        let _ = tx.send((source, data.to_vec()));
    })?;
    register_tx_status_cb(&espnow)?;

    println!(
        "INFO receiver-ready mac={} channel={CHANNEL}",
        mac_hex(&mac)
    );

    loop {
        let (source, frame) = match rx.recv_timeout(Duration::from_secs(30)) {
            Ok(received) => received,
            Err(mpsc::RecvTimeoutError::Timeout) => {
                println!("INFO receiver-alive mac={}", mac_hex(&mac));
                continue;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => anyhow::bail!("ESP-NOW callback stopped"),
        };

        match Message::decode(&frame) {
            Ok(message) if message.kind == MessageKind::Press => {
                // 单播回 ACK：把发送方 MAC 加为 peer（首次见到自动学习，
                // 已存在则按当前信道刷新），单播帧有 MAC 层重传，比广播可靠。
                let ack = Message {
                    kind: MessageKind::Ack,
                    ..message
                };
                ensure_peer(&espnow, source)?;
                if let Err(error) = espnow.send(source, &ack.encode()) {
                    println!("ERR ack-send source={} error={error:?}", mac_hex(&source));
                }

                let encoded = message.encode();
                let hex = encode_hex(&encoded);
                let text = core::str::from_utf8(&hex).expect("hex is always UTF-8");
                println!("EV {text}");
            }
            Ok(message) => println!(
                "INFO ignored-kind source={} kind={:?}",
                mac_hex(&source),
                message.kind
            ),
            Err(error) => println!(
                "ERR invalid-frame source={} length={} error={error}",
                mac_hex(&source),
                frame.len()
            ),
        }
    }
}

fn start_wifi_and_wait(wifi: &mut EspWifi<'_>, system_loop: &EspSystemEventLoop) -> anyhow::Result<()> {
    // 订阅必须在 wifi.start() 之前：esp_wifi_start 返回前 STA 可能已经启动，
    // 事件先于订阅会永久错过（阻塞主线程）。再叠加 is_started() 兑底，
    // 覆盖事件在订阅前已发出的罕见窗口。
    let (tx, rx) = mpsc::channel::<()>();
    let subscription = system_loop
        .subscribe::<WifiEvent, _>(move |event: WifiEvent| {
            if matches!(event, WifiEvent::StaStarted) {
                let _ = tx.send(());
            }
        })
        .map_err(|e| anyhow::anyhow!("subscribe WIFI event: {e}"))?;

    wifi.start()
        .map_err(|e| anyhow::anyhow!("esp_wifi_start: {e}"))?;

    let result = rx.recv_timeout(WIFI_START_TIMEOUT);
    drop(subscription);
    match result {
        Ok(()) => Ok(()),
        Err(_) => {
            // 事件错过时的兑底：EspWifi 自身从 new() 起就在跟踪状态。
            if wifi
                .is_started()
                .map_err(|e| anyhow::anyhow!("is_started: {e}"))?
            {
                Ok(())
            } else {
                anyhow::bail!("timeout waiting for WIFI_STA_START")
            }
        }
    }
}

// ESP-NOW 发送回调：esp_now_send 只是把帧入队，真实发送结果在这里。
// 失败帧（队列满 / 空中失败后硬件重传耗尽）只有此回调可见，打印便于排查。
fn register_tx_status_cb(espnow: &EspNow<'_>) -> anyhow::Result<()> {
    espnow
        .register_send_cb(|mac: &[u8], status: esp_idf_svc::espnow::SendStatus| {
            let status = match status {
                esp_idf_svc::espnow::SendStatus::SUCCESS => "ok",
                esp_idf_svc::espnow::SendStatus::FAIL => "fail",
            };
            println!("INFO tx-status mac={} status={status}", mac_hex(mac));
        })
        .map_err(|e| anyhow::anyhow!("register send cb: {e}"))?;
    Ok(())
}

fn ensure_peer(espnow: &EspNow<'_>, addr: [u8; 6]) -> anyhow::Result<()> {
    if espnow
        .peer_exists(addr)
        .map_err(|e| anyhow::anyhow!("peer_exists: {e}"))?
    {
        // 已学习过的按钮：把 peer 信道刷成 0（跟随当前信道），防两端漂移。
        let mut peer = PeerInfo::default();
        peer.peer_addr = addr;
        peer.channel = 0;
        peer.encrypt = false;
        espnow
            .mod_peer(peer)
            .map_err(|e| anyhow::anyhow!("mod_peer: {e}"))?;
    } else {
        let mut peer = PeerInfo::default();
        peer.peer_addr = addr;
        peer.channel = 0;
        peer.encrypt = false;
        espnow
            .add_peer(peer)
            .map_err(|e| anyhow::anyhow!("add_peer: {e}"))?;
        println!("INFO peer-learned mac={}", mac_hex(&addr));
    }
    Ok(())
}

fn set_radio_channel() -> anyhow::Result<()> {
    unsafe {
        let result = esp_wifi_set_channel(
            CHANNEL,
            esp_idf_svc::sys::wifi_second_chan_t_WIFI_SECOND_CHAN_NONE,
        );
        // 信道决定两端能否互通，失败必须硬报错而不是 warn 后继续。
        esp_idf_svc::sys::esp!(result)?;
    }
    Ok(())
}

fn station_mac() -> anyhow::Result<[u8; 6]> {
    let mut mac = [0_u8; 6];
    unsafe {
        esp_idf_svc::sys::esp!(esp_read_mac(
            mac.as_mut_ptr(),
            esp_mac_type_t_ESP_MAC_WIFI_STA
        ))?;
    }
    Ok(mac)
}

fn mac_hex(mac: &[u8]) -> String {
    format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}

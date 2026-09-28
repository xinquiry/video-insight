use std::{
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc, Arc, Mutex,
    },
    time::{Duration, Instant},
};

use class_button_protocol::{encode_hex, Message, MessageKind};
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    espnow::{EspNow, PeerInfo, ReceiveInfo},
    hal::peripherals::Peripherals,
    nvs::EspDefaultNvsPartition,
    sys::{
        esp_mac_type_t_ESP_MAC_WIFI_STA, esp_read_mac, esp_wifi_set_channel,
        esp_wifi_set_ps, wifi_ps_type_t_WIFI_PS_NONE,
    },
    wifi::{ClientConfiguration, Configuration, EspWifi, WifiEvent},
};

const CHANNEL: u8 = 1;
const WIFI_START_TIMEOUT: Duration = Duration::from_secs(5);

// ===== 诊断：混杂模式抓包（定位按钮帧）=====
// 按实际到达信道归因的总帧数。14 个信道槽。
static SNIFF_CH_TOTAL: [AtomicUsize; 16] = [const { AtomicUsize::new(0) }; 16];
// 来自已知按钮 MAC 的帧数，同样按信道归因。
static SNIFF_CH_BUTTON: [AtomicUsize; 16] = [const { AtomicUsize::new(0) }; 16];
// 首个「Espressif vendor action 帧」转储（不管源 MAC 是谁）。
static VENDOR_DUMP: Mutex<Option<String>> = Mutex::new(None);
// 全部已知按钮 MAC（含 1004）。Addr2/发送侧 STA MAC。
const BUTTON_MACS: [[u8; 6]; 4] = [
    [0x90, 0xda, 0x72, 0x88, 0xcc, 0xc8], // 1001
    [0x90, 0xda, 0x72, 0x88, 0xbe, 0xc8], // 1002
    [0x48, 0xf6, 0xee, 0x17, 0x36, 0xbc], // 1003
    [0x90, 0xda, 0x72, 0x89, 0x74, 0xf8], // 1004
];

unsafe extern "C" fn promiscuous_cb(
    buf: *mut core::ffi::c_void,
    _kind: esp_idf_svc::sys::wifi_promiscuous_pkt_type_t,
) {
    let pkt = buf as *const esp_idf_svc::sys::wifi_promiscuous_pkt_t;
    let rx_ctrl = &(*pkt).rx_ctrl;
    let ch = rx_ctrl.channel() as usize;
    let sig_len = rx_ctrl.sig_len() as usize;
    if ch < SNIFF_CH_TOTAL.len() {
        SNIFF_CH_TOTAL[ch].fetch_add(1, Ordering::Relaxed);
    }
    if sig_len < 28 {
        return;
    }
    let payload = (*pkt).payload.as_ptr();
    // 802.11 MAC 头：FC(2) dur(2) addr1(6) addr2(6) → 源地址在偏移 10。
    let src: [u8; 6] = [
        *payload.add(10),
        *payload.add(11),
        *payload.add(12),
        *payload.add(13),
        *payload.add(14),
        *payload.add(15),
    ];
    if BUTTON_MACS.contains(&src) && ch < SNIFF_CH_BUTTON.len() {
        SNIFF_CH_BUTTON[ch].fetch_add(1, Ordering::Relaxed);
    }
    // 任何 vendor-specific action 帧（FC 子类型 0xD，偏移 24 起是
    // category=127 + OUI）。不区分 OUI，任何厂商的都转储，绝不漏。
    let fc = *payload;
    let category = *payload.add(24);
    if fc & 0xf0 == 0xd0 {
        let oui = [
            *payload.add(25),
            *payload.add(26),
            *payload.add(27),
        ];
        let dump_len = sig_len.min(48);
        let mut dump = String::with_capacity(dump_len * 3);
        for i in 0..dump_len {
            dump.push_str(&format!("{:02x} ", *payload.add(i)));
        }
        let text = format!(
            "cat={} oui={:02x}:{:02x}:{:02x} src={} rssi={} ch={} len={} hex={}",
            category,
            oui[0],
            oui[1],
            oui[2],
            mac_hex(&src),
            rx_ctrl.rssi(),
            ch,
            sig_len,
            dump
        );
        if let Ok(mut slot) = VENDOR_DUMP.lock() {
            if slot.is_none() {
                *slot = Some(text);
            }
        }
    }
}

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let system_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop.clone(), Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    start_wifi_and_wait(&mut wifi, &system_loop)?;

    // 与 button.rs 顺序完全一致：先设信道、后关 modem 省电。
    // esp_wifi_set_ps 在不同状态下可能重置信道，顺序必须与发送端对齐。
    set_radio_channel()?;
    unsafe {
        esp_wifi_set_ps(wifi_ps_type_t_WIFI_PS_NONE);
    }
    let mac = station_mac()?;

    let espnow = Arc::new(EspNow::take()?);
    let (tx, rx) = mpsc::channel::<([u8; 6], Vec<u8>)>();
    espnow.register_recv_cb(move |info: &ReceiveInfo, data: &[u8]| {
        let mut source = [0_u8; 6];
        source.copy_from_slice(&info.src_addr[..6]);
        let _ = tx.send((source, data.to_vec()));
    })?;
    register_tx_status_cb(&espnow)?;

    // 诊断：开混杂模式抓空口帧（espnow 初始化后注册，避免被覆盖）。
    unsafe {
        esp_idf_svc::sys::esp!(esp_idf_svc::sys::esp_wifi_set_promiscuous(true))?;
        esp_idf_svc::sys::esp!(esp_idf_svc::sys::esp_wifi_set_promiscuous_rx_cb(
            Some(promiscuous_cb)
        ))?;
    }
    let mut last_total: [usize; 16] = [0; 16];
    let mut last_button: [usize; 16] = [0; 16];

    println!(
        "INFO receiver-ready mac={} channel-sweep 1-13",
        mac_hex(&mac)
    );

    // 诊断主循环：轮询 1-13 信道，每信道驻留 DWELL，期间非阻塞地处理
    // ESP-NOW 接收事件（若按钮就在当前驻留信道上，EV/ACK 全链路照常）。
    // 每轮扫完打印各信道帧数与按钮帧数增量，定位按钮实际所在信道。
    const DWELL: Duration = Duration::from_millis(700);
    loop {
        for ch in 1..=13u8 {
            unsafe {
                esp_idf_svc::sys::esp!(esp_idf_svc::sys::esp_wifi_set_channel(
                    ch,
                    esp_idf_svc::sys::wifi_second_chan_t_WIFI_SECOND_CHAN_NONE,
                ))?;
            }
            let deadline = Instant::now() + DWELL;
            while let Some(remaining) = deadline.checked_duration_since(Instant::now()) {
                match rx.recv_timeout(remaining.min(Duration::from_millis(50))) {
                    Ok((source, frame)) => handle_frame(&espnow, source, &frame)?,
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        anyhow::bail!("ESP-NOW callback stopped")
                    }
                }
                if let Ok(mut slot) = VENDOR_DUMP.lock() {
                    if let Some(dump) = slot.take() {
                        println!("INFO btn-frame {dump}");
                    }
                }
            }
        }
        let mut total_report = String::new();
        let mut button_report = String::new();
        for ch in 1..=13usize {
            let total = SNIFF_CH_TOTAL[ch].load(Ordering::Relaxed);
            let button = SNIFF_CH_BUTTON[ch].load(Ordering::Relaxed);
            total_report.push_str(&format!("{}:{:+} ", ch, total as isize - last_total[ch] as isize));
            button_report.push_str(&format!("{}:{:+} ", ch, button as isize - last_button[ch] as isize));
            last_total[ch] = total;
            last_button[ch] = button;
        }
        println!(
            "SWEEP tot {}| btn {}",
            total_report.trim_end(),
            button_report.trim_end()
        );
    }
}

fn handle_frame(espnow: &EspNow<'_>, source: [u8; 6], frame: &[u8]) -> anyhow::Result<()> {
    match Message::decode(frame) {
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
    Ok(())
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

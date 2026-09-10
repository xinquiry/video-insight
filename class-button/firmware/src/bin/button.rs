use std::{
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

use class_button_protocol::{Message, MessageKind};
use esp_idf_svc::{
    eventloop::EspSystemEventLoop,
    espnow::{EspNow, PeerInfo, ReceiveInfo},
    hal::{
        gpio::{PinDriver, Pull},
        peripherals::Peripherals,
    },
    nvs::EspDefaultNvsPartition,
    sys::{
        esp_deep_sleep_enable_gpio_wakeup, esp_deep_sleep_start, esp_mac_type_t_ESP_MAC_WIFI_STA,
        esp_random, esp_read_mac, esp_sleep_get_wakeup_cause, esp_wifi_set_channel, esp_wifi_set_ps,
        esp_deepsleep_gpio_wake_up_mode_t_ESP_GPIO_WAKEUP_GPIO_LOW,
        esp_sleep_source_t_ESP_SLEEP_WAKEUP_GPIO, wifi_ps_type_t_WIFI_PS_NONE,
    },
    wifi::{ClientConfiguration, Configuration, EspWifi, WifiEvent},
};

const CHANNEL: u8 = 1;
// 接收器 MAC 在烧录时经环境变量 RECEIVER_MAC 注入（见 scripts/flash-c3.sh），
// 形如 "90da7288ccc8"（12 位十六进制，冒号可选）。按钮向它单播 Press，
// 单播帧带 MAC 层重传，可靠性远高于广播盲发。未注入时回落到调试广播模式。
const RECEIVER_MAC: Option<[u8; 6]> = parse_receiver_mac();
// device_id 在烧录时经环境变量 DEVICE_ID 注入（见 scripts/flash-c3.sh），
// 未注入时回落到调试值 1001。
const DEVICE_ID: u32 = match option_env!("DEVICE_ID") {
    Some(raw) => match u32::from_str_radix(raw, 10) {
        Ok(id) => id,
        Err(_) => panic!("DEVICE_ID must be a decimal u32"),
    },
    None => 1001,
};
const BATTERY_UNKNOWN_MV: u16 = 0;
const MAX_ATTEMPTS: u8 = 4;
const ACK_TIMEOUT: Duration = Duration::from_millis(120);
const WIFI_START_TIMEOUT: Duration = Duration::from_secs(3);

// 按钮输入: C3 外接按键(GPIO3, 低电平按下), RTC IO, 可作深度睡眠唤醒源。
// 低电平唤醒时建议在 GPIO 到 3V3 间加 10kΩ 外部上拉。
const WAKEUP_GPIO: u8 = 3;

const BROADCAST: [u8; 6] = [0xff; 6];

const fn parse_receiver_mac() -> Option<[u8; 6]> {
    match option_env!("RECEIVER_MAC") {
        Some(raw) => match parse_mac_bytes(raw.as_bytes()) {
            Some(mac) => Some(mac),
            None => panic!("RECEIVER_MAC must be 12 hex digits, e.g. 90da7288ccc8"),
        },
        None => None,
    }
}

/// 解析 "90da7288ccc8" / "90:da:72:88:cc:c8" 为字节；const 上下文无法用 split，
/// 手写单遍扫描（跳过 ':' 或 '-' 分隔符）。
const fn parse_mac_bytes(raw: &[u8]) -> Option<[u8; 6]> {
    let mut out = [0_u8; 6];
    let mut byte_index = 0;
    let mut nibble_pair = [0_u8; 2];
    let mut nibble_index = 0;
    let mut i = 0;
    while i < raw.len() {
        let c = raw[i];
        if c == b':' || c == b'-' {
            i += 1;
            continue;
        }
        let nibble = match hex_value(c) {
            Some(v) => v,
            None => return None,
        };
        if byte_index >= 6 {
            return None;
        }
        nibble_pair[nibble_index] = nibble;
        nibble_index += 1;
        if nibble_index == 2 {
            out[byte_index] = (nibble_pair[0] << 4) | nibble_pair[1];
            byte_index += 1;
            nibble_index = 0;
        }
        i += 1;
    }
    if byte_index == 6 && nibble_index == 0 {
        Some(out)
    } else {
        None
    }
}

const fn hex_value(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
struct Ack {
    device_id: u32,
    session_id: u32,
    sequence: u32,
}

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    // 深度睡眠唤醒 = 复位重启。只有被按钮(GPIO 低电平)唤醒才发帧;
    // 冷启动(上电/烧录/普通复位)直接回去睡,从根上杜绝上电误触发。
    let wakeup_cause = unsafe { esp_sleep_get_wakeup_cause() };
    if wakeup_cause != esp_sleep_source_t_ESP_SLEEP_WAKEUP_GPIO {
        println!("INFO cold-boot cause={wakeup_cause:?} -> sleep");
        enter_deep_sleep();
    }

    let peripherals = Peripherals::take()?;
    let system_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut boot_button = PinDriver::input(peripherals.pins.gpio3, Pull::Up)?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop.clone(), Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    // 等 WIFI_STA_START 事件后再设信道，消除与 esp_wifi_set_channel 的竞态。
    start_wifi_and_wait(&mut wifi, &system_loop)?;
    set_radio_channel()?;
    // 唤醒是短促的「发一帧 + 等 ACK」,关掉 modem sleep 以压缩本次唤醒时长。
    unsafe {
        esp_wifi_set_ps(wifi_ps_type_t_WIFI_PS_NONE);
    }

    let mac = station_mac()?;
    // 每次唤醒随机 session、sequence=1。主机按 (session, sequence) 去重,
    // 新 session 会重置设备历史,因此无需 RTC 内存/NVS 持久化,也避开 flash 磨损。
    let session_id = unsafe { esp_random() };
    let espnow = Arc::new(EspNow::take()?);

    let destination = match RECEIVER_MAC {
        // 单播模式：向固定接收器发送（MAC 层自动重传）。
        Some(receiver) => {
            add_peer(&espnow, receiver)?;
            receiver
        }
        // 调试回落：未注入 RECEIVER_MAC 时维持广播盲发。
        None => {
            add_peer(&espnow, BROADCAST)?;
            BROADCAST
        }
    };

    let (ack_tx, ack_rx) = mpsc::channel::<Ack>();
    espnow.register_recv_cb(move |info: &ReceiveInfo, data: &[u8]| {
        // 只信来自目标接收器的帧，忽略信道上其他 ESP 设备噪声。
        if Some(&info.src_addr[..]) != RECEIVER_MAC.as_ref().map(|m| &m[..]) {
            return;
        }
        if let Ok(message) = Message::decode(data) {
            if message.kind == MessageKind::Ack {
                let _ = ack_tx.send(Ack {
                    device_id: message.device_id,
                    session_id: message.session_id,
                    sequence: message.sequence,
                });
            }
        }
    })?;
    register_tx_status_cb(&espnow)?;

    println!(
        "INFO woke-press device={DEVICE_ID} mac={} session={session_id} channel={CHANNEL} dest={}",
        mac_hex(&mac),
        mac_hex(&destination)
    );
    send_press(&espnow, &ack_rx, destination, session_id);

    // 释放去抖:发帧后等按键确实松开(GPIO 回到高电平并稳定)再睡,
    // 否则长按会在睡眠期间被电平反复唤醒、连发多帧。期间短暂等待,
    // 对一次点按只增加约一个去抖窗口的唤醒时长。
    wait_for_release(&mut boot_button);

    println!("INFO done -> sleep");
    enter_deep_sleep();
}

const RELEASE_STABLE: Duration = Duration::from_millis(60);

fn wait_for_release(boot_button: &mut PinDriver<'_, esp_idf_svc::hal::gpio::Input>) {
    // 先等到不再是低电平,再要求持续稳定 RELEASE_STABLE,覆盖机械抖动。
    loop {
        if boot_button.is_high() {
            std::thread::sleep(RELEASE_STABLE);
            if boot_button.is_high() {
                return;
            }
        } else {
            std::thread::sleep(Duration::from_millis(5));
        }
    }
}

fn send_press(
    espnow: &EspNow<'_>,
    ack_rx: &mpsc::Receiver<Ack>,
    destination: [u8; 6],
    session_id: u32,
) {
    const SEQUENCE: u32 = 1;
    while ack_rx.try_recv().is_ok() {}

    let message = Message::press(DEVICE_ID, session_id, SEQUENCE, BATTERY_UNKNOWN_MV);
    for attempt in 1..=MAX_ATTEMPTS {
        if let Err(error) = espnow.send(destination, &message.encode()) {
            println!("ERR press-send attempt={attempt} error={error:?}");
            continue;
        }
        println!("INFO press-sent attempt={attempt}");

        let deadline = Instant::now() + ACK_TIMEOUT;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match ack_rx.recv_timeout(remaining) {
                Ok(ack)
                    if ack.device_id == DEVICE_ID
                        && ack.session_id == session_id
                        && ack.sequence == SEQUENCE =>
                {
                    println!("INFO press-acked attempt={attempt}");
                    return;
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }
    println!("ERR press-unacked attempts={MAX_ATTEMPTS}");
}

fn start_wifi_and_wait(
    wifi: &mut EspWifi<'_>,
    system_loop: &EspSystemEventLoop,
) -> anyhow::Result<()> {
    // 订阅必须在 wifi.start() 之前：esp_wifi_start 返回前 STA 可能已经启动，
    // 事件先于订阅会永久错过。再叠加 is_started() 兑底覆盖罕见窗口。
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

// ESP-NOW 发送回调：esp_now_send 只入队，真实发送结果只在此回调可见
// （单播帧失败 = 硬件重传耗尽；广播帧失败 = 队列满）。
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

// 配置 GPIO 低电平唤醒并进入深度睡眠;此函数不返回。
fn enter_deep_sleep() -> ! {
    unsafe {
        let mask = 1_u64 << WAKEUP_GPIO;
        esp_deep_sleep_enable_gpio_wakeup(mask, esp_deepsleep_gpio_wake_up_mode_t_ESP_GPIO_WAKEUP_GPIO_LOW);
        esp_deep_sleep_start();
    }
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

fn add_peer(espnow: &EspNow<'_>, addr: [u8; 6]) -> anyhow::Result<()> {
    let mut peer = PeerInfo::default();
    peer.peer_addr = addr;
    // channel=0 表示跟随当前信道，与 set_radio_channel 单一来源，避免双处配置漂移。
    peer.channel = 0;
    peer.encrypt = false;
    espnow
        .add_peer(peer)
        .map_err(|e| anyhow::anyhow!("add_peer: {e}"))?;
    Ok(())
}

fn mac_hex(mac: &[u8]) -> String {
    let bytes: [u8; 6] = match mac.try_into() {
        Ok(b) => b,
        Err(_) => return "invalid-mac".to_string(),
    };
    format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5]
    )
}

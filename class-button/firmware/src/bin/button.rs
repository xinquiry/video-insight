use std::{
    sync::{mpsc, Arc},
    time::{Duration, Instant},
};

use class_button_protocol::{Message, MessageKind};
use esp_idf_svc::{
    espnow::{EspNow, PeerInfo, ReceiveInfo},
    eventloop::EspSystemEventLoop,
    hal::{
        gpio::{PinDriver, Pull},
        peripherals::Peripherals,
    },
    nvs::EspDefaultNvsPartition,
    sys::{
        esp_deep_sleep_enable_gpio_wakeup, esp_deep_sleep_start, esp_mac_type_t_ESP_MAC_WIFI_STA,
        esp_random, esp_read_mac, esp_sleep_get_wakeup_cause, esp_wifi_set_ps,
        esp_deepsleep_gpio_wake_up_mode_t_ESP_GPIO_WAKEUP_GPIO_LOW,
        esp_sleep_source_t_ESP_SLEEP_WAKEUP_GPIO, wifi_ps_type_t_WIFI_PS_NONE,
    },
    wifi::{ClientConfiguration, Configuration, EspWifi},
};

const CHANNEL: u8 = 1;
const BROADCAST: [u8; 6] = [0xff; 6];
const DEVICE_ID: u32 = 1001;
const BATTERY_UNKNOWN_MV: u16 = 0;
const MAX_ATTEMPTS: u8 = 4;
const ACK_TIMEOUT: Duration = Duration::from_millis(120);

// 按钮输入:C3 外接按键(GPIO3,低电平按下);S3 开发板用 BOOT 键(GPIO0)。
// 两者都是 RTC IO,可作深度睡眠唤醒源。低电平唤醒时建议在 GPIO 到 3V3 间
// 加 10kΩ 外部上拉(比内部上拉更省电、更抗干扰)。
#[cfg(feature = "board_esp32c3")]
const WAKEUP_GPIO: u8 = 3;
#[cfg(not(feature = "board_esp32c3"))]
const WAKEUP_GPIO: u8 = 0;

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

    #[cfg(feature = "board_esp32c3")]
    let mut boot_button = PinDriver::input(peripherals.pins.gpio3, Pull::Up)?;
    #[cfg(not(feature = "board_esp32c3"))]
    let mut boot_button = PinDriver::input(peripherals.pins.gpio0, Pull::Up)?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop, Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    wifi.start()?;
    set_radio_channel();
    // 唤醒是短促的「发一帧 + 等 ACK」,关掉 modem sleep 以压缩本次唤醒时长。
    unsafe {
        esp_wifi_set_ps(wifi_ps_type_t_WIFI_PS_NONE);
    }

    let mac = station_mac()?;
    // 每次唤醒随机 session、sequence=1。主机按 (session, sequence) 去重,
    // 新 session 会重置设备历史,因此无需 RTC 内存/NVS 持久化,也避开 flash 磨损。
    let session_id = unsafe { esp_random() };
    let espnow = Arc::new(EspNow::take()?);
    add_broadcast_peer(&espnow)?;

    let (ack_tx, ack_rx) = mpsc::channel::<Ack>();
    espnow.register_recv_cb(move |_info: &ReceiveInfo, data: &[u8]| {
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

    println!(
        "INFO woke-press device={DEVICE_ID} mac={} session={session_id} channel={CHANNEL}",
        mac_hex(&mac)
    );
    send_press(&espnow, &ack_rx, session_id);

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

fn send_press(espnow: &EspNow<'_>, ack_rx: &mpsc::Receiver<Ack>, session_id: u32) {
    const SEQUENCE: u32 = 1;
    while ack_rx.try_recv().is_ok() {}

    let message = Message::press(DEVICE_ID, session_id, SEQUENCE, BATTERY_UNKNOWN_MV);
    for attempt in 1..=MAX_ATTEMPTS {
        if let Err(error) = espnow.send(BROADCAST, &message.encode()) {
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

// 配置 GPIO 低电平唤醒并进入深度睡眠;此函数不返回。
fn enter_deep_sleep() -> ! {
    unsafe {
        let mask = 1_u64 << WAKEUP_GPIO;
        esp_deep_sleep_enable_gpio_wakeup(mask, esp_deepsleep_gpio_wake_up_mode_t_ESP_GPIO_WAKEUP_GPIO_LOW);
        esp_deep_sleep_start();
    }
}

fn set_radio_channel() {
    unsafe {
        let result = esp_idf_svc::sys::esp_wifi_set_channel(
            CHANNEL,
            esp_idf_svc::sys::wifi_second_chan_t_WIFI_SECOND_CHAN_NONE,
        );
        if result != 0 {
            log::warn!("esp_wifi_set_channel failed: {result}");
        }
    }
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

fn add_broadcast_peer(espnow: &EspNow<'_>) -> anyhow::Result<()> {
    let mut peer = PeerInfo::default();
    peer.peer_addr = BROADCAST;
    peer.channel = CHANNEL;
    peer.encrypt = false;
    espnow.add_peer(peer)?;
    Ok(())
}

fn mac_hex(mac: &[u8; 6]) -> String {
    format!(
        "{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}",
        mac[0], mac[1], mac[2], mac[3], mac[4], mac[5]
    )
}

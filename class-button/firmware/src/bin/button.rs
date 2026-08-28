use std::{
    sync::{mpsc, Arc},
    thread,
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
    sys::{esp_mac_type_t_ESP_MAC_WIFI_STA, esp_random, esp_read_mac},
    wifi::{ClientConfiguration, Configuration, EspWifi},
};

const CHANNEL: u8 = 1;
const BROADCAST: [u8; 6] = [0xff; 6];
const DEVICE_ID: u32 = 1001;
const BATTERY_UNKNOWN_MV: u16 = 0;
const MAX_ATTEMPTS: u8 = 4;
const ACK_TIMEOUT: Duration = Duration::from_millis(120);
const DEBOUNCE: Duration = Duration::from_millis(40);

// 按钮输入：C3 使用外接按键（GPIO3，低电平按下，板上拉）。
// S3 开发板仍使用 BOOT 键（GPIO0）。
#[cfg(feature = "board_esp32c3")]
const BOOT_BUTTON_GPIO: &str = "gpio3";
#[cfg(not(feature = "board_esp32c3"))]
const BOOT_BUTTON_GPIO: &str = "gpio0";

#[derive(Debug, Clone, Copy)]
struct Ack {
    device_id: u32,
    session_id: u32,
    sequence: u32,
}

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let system_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    #[cfg(feature = "board_esp32c3")]
    let boot_button = PinDriver::input(peripherals.pins.gpio3, Pull::Up)?;
    #[cfg(not(feature = "board_esp32c3"))]
    let boot_button = PinDriver::input(peripherals.pins.gpio0, Pull::Up)?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop, Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    wifi.start()?;
    set_radio_channel();

    let mac = station_mac()?;
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
        "INFO button-ready device={DEVICE_ID} mac={} session={session_id} channel={CHANNEL}",
        mac_hex(&mac)
    );
    println!("INFO trigger-with-boot-{BOOT_BUTTON_GPIO}");

    let mut sequence = 0_u32;
    let mut was_pressed = false;
    let mut pressed_since = None;
    let mut last_heartbeat = Instant::now();

    loop {
        let gpio_pressed = boot_button.is_low();
        if gpio_pressed != was_pressed {
            was_pressed = gpio_pressed;
            pressed_since = Some(Instant::now());
        }

        if last_heartbeat.elapsed() >= Duration::from_secs(30) {
            last_heartbeat = Instant::now();
            unsafe {
                println!(
                    "INFO heap free={} min={}",
                    esp_idf_svc::sys::esp_get_free_heap_size(),
                    esp_idf_svc::sys::esp_get_minimum_free_heap_size()
                );
            }
        }

        let stable_gpio_press = gpio_pressed
            && pressed_since.is_some_and(|changed_at| changed_at.elapsed() >= DEBOUNCE);
        if stable_gpio_press {
            sequence = sequence.wrapping_add(1);
            send_press(&espnow, &ack_rx, session_id, sequence);

            if stable_gpio_press {
                while boot_button.is_low() {
                    thread::sleep(Duration::from_millis(10));
                }
                was_pressed = false;
                pressed_since = None;
            }
        }

        thread::sleep(Duration::from_millis(10));
    }
}

fn send_press(espnow: &EspNow<'_>, ack_rx: &mpsc::Receiver<Ack>, session_id: u32, sequence: u32) {
    while ack_rx.try_recv().is_ok() {}

    let message = Message::press(DEVICE_ID, session_id, sequence, BATTERY_UNKNOWN_MV);
    for attempt in 1..=MAX_ATTEMPTS {
        if let Err(error) = espnow.send(BROADCAST, &message.encode()) {
            println!("ERR press-send sequence={sequence} attempt={attempt} error={error:?}");
            continue;
        }
        println!("INFO press-sent sequence={sequence} attempt={attempt}");

        let deadline = Instant::now() + ACK_TIMEOUT;
        while Instant::now() < deadline {
            let remaining = deadline.saturating_duration_since(Instant::now());
            match ack_rx.recv_timeout(remaining) {
                Ok(ack)
                    if ack.device_id == DEVICE_ID
                        && ack.session_id == session_id
                        && ack.sequence == sequence =>
                {
                    println!("INFO press-acked sequence={sequence} attempt={attempt}");
                    return;
                }
                Ok(_) => continue,
                Err(_) => break,
            }
        }
    }
    println!("ERR press-unacked sequence={sequence} attempts={MAX_ATTEMPTS}");
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

use std::{
    sync::{mpsc, Arc},
    time::Duration,
};

use class_button_protocol::{encode_hex, Message, MessageKind};
use esp_idf_svc::{
    espnow::{EspNow, PeerInfo, ReceiveInfo},
    eventloop::EspSystemEventLoop,
    hal::peripherals::Peripherals,
    nvs::EspDefaultNvsPartition,
    sys::{esp_mac_type_t_ESP_MAC_WIFI_STA, esp_read_mac},
    wifi::{ClientConfiguration, Configuration, EspWifi},
};

const CHANNEL: u8 = 1;
const BROADCAST: [u8; 6] = [0xff; 6];

fn main() -> anyhow::Result<()> {
    esp_idf_svc::sys::link_patches();
    esp_idf_svc::log::EspLogger::initialize_default();

    let peripherals = Peripherals::take()?;
    let system_loop = EspSystemEventLoop::take()?;
    let nvs = EspDefaultNvsPartition::take()?;

    let mut wifi = EspWifi::new(peripherals.modem, system_loop, Some(nvs))?;
    wifi.set_configuration(&Configuration::Client(ClientConfiguration::default()))?;
    wifi.start()?;
    set_radio_channel();

    let mac = station_mac()?;
    let espnow = Arc::new(EspNow::take()?);
    add_broadcast_peer(&espnow)?;

    let (tx, rx) = mpsc::channel::<([u8; 6], Vec<u8>)>();
    espnow.register_recv_cb(move |info: &ReceiveInfo, data: &[u8]| {
        let mut source = [0_u8; 6];
        source.copy_from_slice(&info.src_addr[..6]);
        let _ = tx.send((source, data.to_vec()));
    })?;

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
                let ack = Message {
                    kind: MessageKind::Ack,
                    ..message
                };
                if let Err(error) = espnow.send(BROADCAST, &ack.encode()) {
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

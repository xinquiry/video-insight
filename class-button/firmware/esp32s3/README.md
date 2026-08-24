# ESP32-S3 firmware

该独立 ESP-IDF 工程包含两个固件：

- `receiver`：Class Button Hub（教师接收器）固件，将有效 ESP-NOW 消息输出为 `EV <hex>`。
- `button`：Class Button Key（学生按钮）固件，GPIO0 低电平触发，带消抖、ACK 和四次重试。

构建：

```bash
source ~/export-esp.sh
cd firmware/esp32s3
rustup run esp cargo build --release --bin receiver
rustup run esp cargo build --release --bin button
```

当前调试角色：

| 角色 | 端口 | MAC |
| --- | --- | --- |
| receiver | `/dev/cu.usbmodem5C4C1417221` | `e8:3d:c1:f1:ad:24` |
| button | `/dev/cu.usbserial-A5069RR4` | `e0:72:a1:d2:62:d8` |

两个固件固定使用 ESP-NOW channel 1。按钮的调试 `device_id` 为 `1001`，与
`config/classroom.example.json` 对应。电池 ADC 尚未接入时上报 `0 mV`。

烧录：

```bash
espflash flash --port /dev/cu.usbmodem5C4C1417221 --flash-size 16mb \
  target/xtensa-esp32s3-espidf/release/receiver
espflash flash --port /dev/cu.usbserial-A5069RR4 --flash-size 16mb \
  target/xtensa-esp32s3-espidf/release/button
```

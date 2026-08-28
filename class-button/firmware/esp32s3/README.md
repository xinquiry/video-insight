# ESP32-S3 firmware

该独立 ESP-IDF 工程为 ESP32-S3（xtensa）目标构建两个固件，源码与
`../esp32c3` 共享，位于 `../src/bin`：

- `receiver`：Class Button Hub（教师接收器）固件，将有效 ESP-NOW 消息输出为 `EV <hex>`。
- `button`：Class Button Key（学生按钮）固件，BOOT 键（S3 为 GPIO0）低电平触发，带消抖、ACK 和四次重试。

构建：

```bash
source ~/export-esp.sh
cd firmware/esp32s3
cargo build --release --bin receiver
cargo build --release --bin button
```

若 ESP-IDF 安装在创建 Python venv 时失败，见 `esp32c3/README.md` 的 Python 注意事项。

当前调试角色（S3 目前只作为 receiver 使用，button 角色已切换到 ESP32-C3）：

| 角色 | 端口 | MAC |
| --- | --- | --- |
| receiver | `/dev/cu.usbserial-A5069RR4` | `e0:72:a1:d2:62:d8` |

两个固件固定使用 ESP-NOW channel 1。按钮的调试 `device_id` 为 `1001`，与
`config/classroom.example.json` 对应。电池 ADC 尚未接入时上报 `0 mV`。

烧录：

```bash
espflash flash --port /dev/cu.usbserial-A5069RR4 --flash-size 16mb \
  target/xtensa-esp32s3-espidf/release/receiver
```

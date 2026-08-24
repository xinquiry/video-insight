# 调试硬件

## 当前接入设备

2026-08-18 在开发机上通过 `espflash board-info` 确认两块开发板：

| 角色 | 芯片 | Flash | MAC | macOS 调试端口 |
| --- | --- | --- | --- | --- |
| Class Button Hub（教师接收器） | ESP32-S3 rev 0.2 | 16 MB | `e8:3d:c1:f1:ad:24` | `/dev/cu.usbmodem5C4C1417221` |
| Class Button Key（学生按钮） | ESP32-S3 rev 0.2 | 16 MB | `e0:72:a1:d2:62:d8` | `/dev/cu.usbserial-A5069RR4` |

第一块设备作为 Class Button Hub，第二块作为调试用 Class Button Key。端口名称可能因 USB
接口或电脑变化，程序不应硬编码；可使用 `class-button ports` 重新发现。

## 固件策略

双端固件作为独立的 ESP32-S3 Cargo 工程放在 `firmware/esp32s3`，沿用
OpenSDL 的 `esp-idf-svc` 技术路线。
它会依赖主 workspace 中的 `class-button-protocol`，但不会加入主 workspace，
避免 ESP-IDF 目标影响主机端的常规 `cargo test`。

## 2026-08-18 联调结果

- 接收器和按钮固件均以 release 模式成功构建并烧录。
- ESP-NOW 固定使用 channel 1。
- 按钮两次测试均在第 1 次发送后收到应用层 ACK。
- 接收器两次输出合法 `EV` 帧，主机均映射为设备 `1001`、学生“测试学生 1”。
- 按钮每次启动使用随机 session ID，sequence 从 1 开始；主机可正确区分重启与重发。
- 最终按钮固件只接受 BOOT/GPIO0 物理按键，已移除会造成控制台回显的串口触发入口。
- 电池 ADC 尚未连接，目前上报 `0 mV`。

主机监听：

```bash
cargo run --bin class-button -- listen \
  --port /dev/cu.usbmodem5C4C1417221 \
  --config config/classroom.example.json
```

监听启动后，在按钮板运行期间短按 BOOT 键即可产生事件。不要按住 BOOT 后复位，
否则芯片会进入下载模式而不是正常启动按钮固件。

## 调试接线

- Class Button Hub：通过 USB 连接教师 Mac 或 Windows 电脑，提供数据和供电。
- Class Button Key：不需要连接教师电脑，只需要供电；调试阶段可接普通 USB 充电器或移动电源。
- 只有重新烧录固件或查看 Key 端串口日志时，才需要把 Key 临时接回电脑。

当前调试板尚未接入电池采样和低功耗休眠，因此独立供电可以验证完整通信链路，
但续航数据不代表最终产品。

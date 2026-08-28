# 调试硬件

## 当前接入设备

2026-08-18 在开发机上通过 `espflash board-info` 确认两块 ESP32-S3 开发板；
2026-08-27 接入一块 ESP32-C3，将 button 角色迁移到 C3：

| 角色 | 芯片 | Flash | MAC | macOS 调试端口 |
| --- | --- | --- | --- | --- |
| Class Button Hub（教师接收器） | ESP32-S3 rev 0.2 | 16 MB | `e0:72:a1:d2:62:d8` | `/dev/cu.usbserial-A5069RR4` |
| Class Button Key（学生按钮） | ESP32-C3 rev 0.4 | 4 MB | `44:b1:76:01:f1:1c` | `/dev/cu.usbmodem101` |
| 备用 S3（原 receiver 调试板） | ESP32-S3 rev 0.2 | 16 MB | `e8:3d:c1:f1:ad:24` | `/dev/cu.usbmodem5C4C1417221` |

端口名称可能因 USB 接口或电脑变化，程序不应硬编码；可使用 `class-button ports` 重新发现。

## 固件策略

双端固件源码共享，放在 `firmware/src/bin`，由两个独立的 ESP-IDF Cargo 工程
分别构建：`firmware/esp32s3`（xtensa 目标）与 `firmware/esp32c3`
（riscv32imc 目标），沿用 OpenSDL 的 `esp-idf-svc` 技术路线。
它们依赖主 workspace 中的 `class-button-protocol`，但不会加入主 workspace，
避免 ESP-IDF 目标影响主机端的常规 `cargo test`。两块芯片的 ESP-NOW 帧互通，
按钮输入通过 cargo feature 区分：S3 使用板上 BOOT 键（GPIO0），C3 使用
外接按键（GPIO3，低电平按下，靠内部上拉）。

## 2026-08-18 联调结果

- 接收器和按钮固件均以 release 模式成功构建并烧录。
- ESP-NOW 固定使用 channel 1。
- 按钮两次测试均在第 1 次发送后收到应用层 ACK。
- 接收器两次输出合法 `EV` 帧，主机均映射为设备 `1001`、学生“测试学生 1”。
- 按钮每次启动使用随机 session ID，sequence 从 1 开始；主机可正确区分重启与重发。
- 最终按钮固件只接受物理按键输入（S3 为 BOOT/GPIO0，C3 为外接 GPIO3），已移除会造成控制台回显的串口触发入口。
- 电池 ADC 尚未连接，目前上报 `0 mV`。

## 2026-08-27 联调结果（S3 receiver + C3 button）

- 接收器改由备用 S3（`e0:72:a1:d2:62:d8`）担任，烧录 esp32s3 receiver 固件；
  C3 烧录 esp32c3 button 固件，按键改接 GPIO3（杜邦线 + 微动开关，低电平按下）。
- 8 次按键均在第 1 次发送后收到应用层 ACK，无重发。
- 主机 `class-button listen` 全部映射为设备 `1001`、学生“测试学生 1”，
  session/sequence 连续，跨芯片 ESP-NOW 互通验证通过。
- 测试环境 channel 1 上存在其他 ESP 设备广播噪声（两个陌生 MAC 的短帧），
  固件按预期拒收，不影响按钮链路。

主机监听：

```bash
cargo run --bin class-button -- listen \
  --port /dev/cu.usbserial-A5069RR4 \
  --config config/classroom.example.json
```

监听启动后，短按按钮即可产生事件（S3 板按 BOOT 键，C3 按外接 GPIO3 按键）。
不要按住 S3 的 BOOT 后复位，否则芯片会进入下载模式而不是正常启动固件。

## C3 串口观察

C3 调试板的控制台走内置 USB-Serial-JTAG（`cu.usbmodem*`，已在
`firmware/esp32c3/sdkconfig.defaults` 中配置）。启动日志只在复位后第一秒内打印，
而 USB 重新枚举约需 2 秒，因此先复位再打开串口会错过日志。用 pyserial
先开串口、再用 DTR/RTS 复位即可完整观察：

```python
import serial, time
s = serial.Serial('/dev/cu.usbmodem101', 115200, timeout=1)
s.setDTR(False); s.setRTS(True); time.sleep(0.1); s.setRTS(False)
print(s.read(4096).decode(errors='replace'))
```

## 固件构建对 Python 的要求

`esp-idf-sys` 构建 ESP-IDF 时会用 PATH 里的 `python3` 创建 venv 并安装依赖，
因此它必须能创建带 `pip` 的正常 venv。可先自检：

```bash
python3 -m venv /tmp/venv-check && /tmp/venv-check/bin/python3 -m ensurepip
```

部分可重定位（relocatable/standalone）发行版无法通过此检查，`ensurepip`
失败会让构建报 `Could not install esp-idf`。解决办法是把一个常规系统 Python
放到 PATH 最前面再构建：

```bash
export PATH=/usr/bin:$PATH
```

该改动只在当前 shell 生效，不影响其他工具。构建成功后 venv 缓存在
`.embuild/espressif/python_env/`，后续增量构建无需重复处理。

## 调试接线

- Class Button Hub：通过 USB 连接教师 Mac 或 Windows 电脑，提供数据和供电。
- Class Button Key：不需要连接教师电脑，只需要供电；调试阶段可接普通 USB 充电器或移动电源。
- 只有重新烧录固件或查看 Key 端串口日志时，才需要把 Key 临时接回电脑。

当前调试板尚未接入电池采样和低功耗休眠，因此独立供电可以验证完整通信链路，
但续航数据不代表最终产品。

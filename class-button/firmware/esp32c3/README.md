# ESP32-C3 firmware

该独立 ESP-IDF 工程为 ESP32-C3（riscv32imc）目标构建两个固件，源码位于
`../src/bin`：

- `receiver`：Class Button Hub（教师接收器）固件，将有效 ESP-NOW 消息输出为 `EV <hex>`。
- `button`：Class Button Key（学生按钮）固件，外接按键接 GPIO3（低电平按下，内部上拉），带消抖、ACK 和四次重试。

构建（首次会下载 ESP-IDF 工具链，约 4GB）：

```bash
source ~/export-esp.sh
cd firmware/esp32c3
cargo build --release --bin receiver
cargo build --release --bin button
```

> **Python 注意**：构建用的 `python3` 必须能创建带 `pip` 的正常 venv
> （`python3 -m venv /tmp/t && /tmp/t/bin/python3 -m ensurepip` 应成功）。
> 如果默认 `python3` 是可重定位/standalone 发行版，`ensurepip` 会失败并导致
> ESP-IDF 安装报 `Could not install esp-idf`。此时构建前把一个常规的
> 系统 Python 放到 PATH 最前面，例如：
>
> ```bash
> export PATH=/usr/bin:$PATH
> ```

当前调试角色（多块 C3：一块固定作 receiver，其余作 button）：

| 角色 | MAC |
| --- | --- |
| receiver | `44:b1:76:01:f1:1c` |
| button | `90:da:72:88:cc:c8` |
| button | `90:da:72:88:be:c8` |
| button | `48:f6:ee:17:36:bc` |

板卡为 ESP32-C3 rev 0.4、4MB flash。两个固件固定使用 ESP-NOW channel 1。
按钮向烧录时注入的接收器 MAC 单播发送 Press（`flash-c3.sh button <id> <mac>`，
单播帧享有 MAC 层重传），接收器从 Press 帧动态学习按钮 MAC 并单播回 ACK，
因此新增 button 无需配置接收器。未注入接收器 MAC 时按钮回落到广播盲发
（仅调试用）。按钮的调试 `device_id` 分别为 `1001`/`1002`/`1003`，与
`config/classroom.example.json` 对应。电池 ADC 尚未接入时上报 `0 mV`。

烧录（推荐走脚本，见 `scripts/flash-c3.sh`）：

```bash
# receiver
class-button/scripts/flash-c3.sh receiver --port /dev/cu.usbmodem101

# button（注入 device_id 与接收器 MAC；按钮睡眠中需先 BOOT+RST 进下载模式）
class-button/scripts/flash-c3.sh button 1001 44b17601f11c --port /dev/cu.usbmodemXXXX
```

手动烧录时按角色选择产物路径：

```bash
espflash flash --port /dev/cu.usbmodem101 \
  target/riscv32imc-esp-espidf/release/receiver
```

button 的 `device_id` 与接收器 MAC 在编译期注入，因此脚本为每套参数使用
独立的构建目录（`target/device-<id>/mcu-<mac>/`），互不覆盖。

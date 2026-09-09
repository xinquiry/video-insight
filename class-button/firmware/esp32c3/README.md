# ESP32-C3 firmware

该独立 ESP-IDF 工程为 ESP32-C3（riscv32imc）目标构建两个固件，源码与
`../esp32s3` 共享，位于 `../src/bin`：

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

板卡为 ESP32-C3 rev 0.4、4MB flash。两个固件固定使用 ESP-NOW channel 1，
与 S3 版本互通。按钮固件以 ESP-NOW 广播发送（无需配置 receiver MAC），
receiver 广播回 ACK，因此新增 button 直接烧录即可。按钮的调试 `device_id`
为 `1001`，与 `config/classroom.example.json` 对应。电池 ADC 尚未接入时
上报 `0 mV`。

烧录（按角色选择 `receiver` 或 `button`）：

```bash
espflash flash --port /dev/cu.usbmodem101 \
  target/riscv32imc-esp-espidf/release/receiver
```

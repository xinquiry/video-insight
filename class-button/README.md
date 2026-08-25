# Class Button

ClassButton 是一个课堂互动装置：全班 20 名学生人手一个无线按钮，观看带批注的播客视频时，任何人按下按钮即可暂停播放，系统同时告诉老师是谁按的 —— 把 "有疑问随时打断" 从口头约定变成一次物理动作。学生端称为 **Class Button Key（学生按钮）**，通过 ESP-NOW 点对点协议直连插在教师电脑上的 **Class Button Hub（教师接收器）**，不依赖教室 WiFi 或路由器；Hub 经 USB 串口把暂停信号转发给播放端，在线 SaaS 平台和本地播放器都可用。单台 Key 物料成本约 55–60 元，电池供电、可充电。

## 当前开发状态

项目当前以本地课堂播放器为主：教师在单个桌面应用窗口中选择并播放视频，
Class Button Key 触发后视频立即暂停，学生姓名和座位直接叠加在播放器中。界面
使用 Electron、React 19 和 Vite，硬件、课程包和批注逻辑保留在 Rust sidecar 中。

Rust workspace 包括：

- `class-button-protocol`：按钮、接收器和主机共享的 `no_std` 帧协议。
- `class-button-core`：学生映射、会话识别和重发事件去重。
- `class-button-host`：USB 串口发现与接收器行协议解析。
- `class-button-cli`：端口检查、真实串口监听和无硬件事件模拟。
- `class-button-sidecar`：Hub 串口、事件去重、课程包校验、批注规范化和浏览器
  兼容服务，通过私有 IPC 服务 Electron 播放器。
- `desktop/`：Electron main/preload 与 React 播放器、批注时间轴和学生提示界面。
- `player-adapter`：保留的在线网站兼容适配器，不是当前本地课堂主路径。

当前调试接收器为 ESP32-S3（16 MB Flash），详见
[`docs/hardware.md`](docs/hardware.md)。正式学生按钮仍以 XIAO ESP32-C3 为目标。

2026-08-18 已使用两块 ESP32-S3 完成真实 ESP-NOW 双向联调：按钮事件被接收器
接收，ACK 在第一次发送后返回，主机正确显示 `测试学生 1`。当前调试按钮使用
板载 BOOT/GPIO0，运行期间短按即可触发事件。

## 运行方式

教师可从 [GitHub Releases](https://github.com/xinquiry/video-insight/releases/latest)
直接下载最新的 macOS 或 Windows 桌面应用。

教师电脑只需连接 Class Button Hub。Class Button Key 不需要连接电脑的数据口，
可以由独立 USB 充电器、移动电源或后续电池模块供电；两者通过 ESP-NOW 直接通信。

从 monorepo 根目录启动本地播放器：

```bash
just run-desktop
just run-desktop-demo # 启动后模拟一次学生按键
```

首次运行前安装 Electron 依赖：

```bash
pnpm --dir class-button/desktop install
```

启动时打开指定视频：

```bash
just run-desktop "--video /path/to/lesson.mp4"
```

也可以打包成可双击运行的 macOS 应用：

```bash
./class-button/scripts/package-macos.sh
# 产物位于 class-button/dist/electron/
```

Windows 版本为免安装 `.exe` 便携包。在 Windows PowerShell 中执行：

```powershell
.\class-button\scripts\package-windows.ps1
```

详细接线、运行和驱动检查见 [`docs/windows.md`](docs/windows.md)。macOS 与 Windows
使用同一套 Rust、串口和播放器接口代码，平台包只负责字体、配置位置和打包形式。
在 macOS 上交叉构建可运行
`./class-button/scripts/package-windows-from-macos.sh`。

应用会自动发现当前 WCH USB Hub。点击“打开视频”可使用原生文件选择器打开
本地视频；Chromium 视频控件提供播放、暂停、进度跳转、音量和全屏。按下 Key
后视频暂停，学生提示覆盖在同一播放器窗口中；点击“已处理”只关闭提示，由老师
决定何时继续播放。

播放器可直接打开 SaaS 导出的单文件 `.vinsight` 课程包，并原生显示文字和图片
批注；旧视频旁的 JSON 批注侧车仍受支持。命名约定、数据格式和兼容策略见
[`docs/desktop.md`](docs/desktop.md)。
进程边界、IPC 与 UI 设计规则见 [`docs/architecture.md`](docs/architecture.md)。

应用仍在 `127.0.0.1:9842` 保留浏览器兼容事件接口。如果后续需要临时接回在线
网站，可以使用下面的 `player-adapter`：

自有网站把 [`player-adapter/class-button-player.js`](player-adapter/class-button-player.js)
加入播放器页面即可：

```js
import { ClassButtonPlayer } from "/class-button-player.js";

const classButton = new ClassButtonPlayer({
  media: () => document.querySelectorAll("video"),
}).connect();
```

页面收到按钮事件时会暂停视频；浏览器兼容模式不会收到学生身份。更完整的播放器
回调说明见 [`player-adapter/README.md`](player-adapter/README.md)。

## 本地验证

```bash
just check-class-button
just check-desktop
just class-button-cli ports
just class-button-cli simulate
just test-player-adapter
```

接收器固件输出格式为：

```text
EV <44 个十六进制字符>
INFO <诊断信息>
ERR <错误信息>
```

主机监听示例：

```bash
cargo run --bin class-button -- listen \
  --port /dev/cu.usbmodem5C4C1417221 \
  --config config/classroom.example.json
```

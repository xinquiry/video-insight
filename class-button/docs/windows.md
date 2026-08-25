# Windows 使用说明

## 硬件角色

- **Class Button Hub（教师接收器）**：通过 USB 插在教师 Windows 电脑上，同时获得
  供电并提供串口数据。
- **Class Button Key（学生按钮）**：只需要独立供电，通过 ESP-NOW 与 Hub 通信，
  不需要连接教师电脑，也不依赖教室 Wi-Fi。

当前两块 ESP32-S3 调试板已经分别烧录为 Hub 和 Key。Key 运行期间短按
BOOT/GPIO0 即可发送一次请求。

## 运行

1. 解压 `Class-Button-Windows-x64.zip`，不要只在压缩包预览中运行程序。
2. 把 Class Button Hub 插入电脑。
3. 双击 `Class Button.exe`。
4. 等待窗口顶部显示“Hub · 已连接”。
5. 点击“打开视频”，打开本地视频文件。
6. 给 Class Button Key 通电，短按按钮验证视频暂停和学生提示叠层。
7. 点击“已处理”关闭提示，由老师手动继续播放。

Electron 的 Chromium 播放控件支持播放/暂停、进度跳转、音量和全屏。视频只从本机读取，不会
由播放器上传到网络；同目录存在 VideoInsight 批注侧车时会自动读取并展示。

配置文件 `classroom.json` 必须与 `Class Button.exe` 放在同一个目录。修改学生映射
后重启应用即可生效。

## 串口与驱动

Windows 会把 Hub 显示为一个 `COM` 端口。应用优先按当前 Hub 的 WCH USB 标识
`VID 1A86 / PID 55D3` 自动发现，不依赖固定的 `COM3`、`COM4` 等端口号。

如果 Hub 已插入但一直显示离线：

1. 打开“设备管理器 → 端口（COM 和 LPT）”，确认 WCH 设备存在且没有黄色警告。
2. 拔插 Hub，然后重新启动 Class Button。
3. 如 Windows 没有自动安装驱动，再安装对应的 WCH USB 串口驱动。

Key 不应出现在 Windows 设备管理器中，因为正常使用时它只连接电源。

## 构建 Windows 包

在 Windows PowerShell 中运行：

```powershell
.\scripts\package-windows.ps1
```

默认在 `dist\electron` 生成 x64 便携程序和 ZIP。Windows on ARM 可以运行：

```powershell
.\scripts\package-windows.ps1 -Architecture arm64
```

也可以在配置好 `cargo-xwin` 的 macOS 开发机上交叉构建 x64 包：

```bash
./scripts/package-windows-from-macos.sh
```

当前产物是 Electron 免安装便携版；Windows 可能在首次运行未签名程序时显示
SmartScreen 提醒。播放器自带 Chromium，不要求系统安装 WebView2。正式分发前
应配置代码签名证书。推荐使用 MP4/H.264/AAC 或 WebM；其他格式需在打包产物中
验证 Chromium 编码支持。

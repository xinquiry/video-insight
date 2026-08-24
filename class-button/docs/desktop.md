# Makepad 课堂播放器

`class-button-desktop` 是 VideoInsight 的只读课堂播放端。批注仍由 SaaS 创建和
管理；课堂端负责可靠播放、展示已有批注，以及在学生按下 Class Button Key 时
立即暂停并显示学生身份。

## 技术边界

- UI 使用 Makepad 当前的 `script_mod!` DSL，避免已废弃的 `live_design!` 语法。
- 视频使用 Makepad `Video` widget 和平台原生解码后端，不嵌入 WebView。
- 文件选择使用 Makepad 官方示例采用的 `robius-file-picker`。
- Makepad 固定到提交 `152b11f20a8cf8e81bfd0086210cb9b0269c51e9`。
- 串口和 localhost 兼容服务在 Tokio 后台线程运行，通过 `Cx::post_action` 把
  状态和按键事件交回 UI 线程。
- ESP32-S3 固件仍是独立 Cargo workspace；桌面构建不需要 ESP-IDF 工具链。

## 视频与批注

打开 `/lessons/demo.mp4` 时，播放器按以下顺序查找首个存在的文件：

1. `/lessons/demo.mp4.annotations.json`
2. `/lessons/demo.annotations.json`
3. `/lessons/annotations.json`

文件内容可以直接是 SaaS `GET /api/videos/{id}/annotations` 返回的数组：

```json
[
  {
    "timestamp_seconds": 12.5,
    "duration_seconds": 6,
    "kind": "note",
    "content": {
      "type": "doc",
      "content": [
        {
          "type": "paragraph",
          "content": [{ "type": "text", "text": "观察这里的变量变化" }]
        }
      ]
    }
  }
]
```

也可以使用课程包形状：

```json
{ "annotations": [/* 相同的批注对象 */] }
```

播放器按 `timestamp_seconds` 排序，在 `duration_seconds` 时间窗内显示卡片，并把
富文本中的文字节点压平成适合课堂投影的纯文本。缺少 `duration_seconds` 时默认
显示 6 秒；没有侧车文件时视频仍可正常播放。

## 运行与验证

```sh
just run-desktop
just run-desktop-demo
just check-class-button
just test-player-adapter
```

`--config` 可覆盖课堂/设备映射，`--port` 可跳过自动发现，`--video` 可在启动时
直接打开视频。浏览器兼容接口仍监听 `127.0.0.1:9842`，供旧网页播放器适配器
使用。

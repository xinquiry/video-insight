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
- `ui/theme.rs`、`ui/primitives.rs` 和 `ui/player_screen.rs` 分别管理品牌 token、
  可复用控件和播放器组合；播放/课堂业务状态只保留在 `app.rs`。

## 视频与批注

打开 `/lessons/demo.mp4` 时，播放器按以下顺序查找首个存在的文件：

1. `/lessons/demo.mp4.annotations.json`
2. `/lessons/demo.annotations.json`
3. `/lessons/annotations.json`

SaaS 视频页面的“导出到本地播放器”会下载一个 `lesson.vinsight` 便携包。直接在
播放器中打开这个文件即可；播放器会在受控临时目录解压视频，并在替换课程包或退出
时清理。便携包是标准 ZIP，包含视频、带版本的 `manifest.json` 和批注图片资源：

```json
{
  "format": "videoinsight.annotated-video",
  "format_version": 1,
  "exported_at": "2026-08-24T04:00:00Z",
  "video": {
    "filename": "lesson.mp4",
    "media_path": "media/lesson.mp4"
  },
  "annotation_track": {
    "format": "videoinsight.annotation-track",
    "format_version": 1,
    "annotations": [],
    "extensions": {}
  },
  "extensions": {}
}
```

完整格式和兼容性规则见 [`docs/portable-export.md`](../../docs/portable-export.md)。
播放器忽略同版本中的未知字段，因此 SaaS 可以向 v1 增加可选数据；改变字段含义或
结构时必须提升对应的 `format_version`。播放器遇到未知结构版本会停止载入批注、
提示升级，并在能安全识别唯一 `media/` 视频时继续播放，而不会静默错误显示。

批注中的图片由原生 Makepad `Image` 控件显示，不经过 WebView。当前批注侧栏和视频
画面上的时效批注共用同一个富内容组件，因此文字和图片在两处遵循相同的数据适配
规则。文字和图片按 SaaS 文档中的原始顺序显示；重复图片按内容哈希去重保存在包内
`assets/`，播放器加载包时解析资源引用。视频舞台底部的批注时间轴按颜色和持续时间
显示标记，可点击或拖动直接跳转。

为兼容旧导出，播放器仍支持本地视频旁的 JSON 侧车；文件内容可以直接是 SaaS
`GET /api/videos/{id}/annotations` 返回的数组：

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

也可以使用旧课程包形状：

```json
{ "annotations": [/* 相同的批注对象 */] }
```

播放器按 `timestamp_seconds` 排序，在 `duration_seconds` 时间窗内显示卡片，并把
富内容规范化为有序的文字/图片块。缺少 `duration_seconds` 时默认显示 6 秒；没有
侧车文件时视频仍可正常播放。

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

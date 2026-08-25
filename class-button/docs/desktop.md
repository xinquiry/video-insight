# Electron 课堂播放器

Electron 桌面应用是 VideoInsight 的只读课堂播放端。批注仍由 SaaS 创建和
管理；课堂端负责可靠播放、展示已有批注，以及在学生按下 Class Button Key 时
立即暂停并显示学生身份。

## 技术边界

- UI 使用 React 19 和 Vite，由 Electron 提供桌面窗口与原生文件选择器。
- 视频使用 Chromium HTML `<video>`；推荐 MP4/H.264/AAC 或 WebM。其他容器和
  编码需要在目标平台的打包版本中验证。
- Rust sidecar 负责串口、localhost 兼容服务、课程包安全校验和批注规范化，
  通过带版本的 JSON-lines 协议把事件交给 Electron main。
- Electron renderer 开启 sandbox 与 context isolation，不启用 Node.js；preload
  只暴露打开文件、拖放文件、全屏和事件订阅 API。
- ESP32-S3 固件仍是独立 Cargo workspace；桌面构建不需要 ESP-IDF 工具链。
- React reducer 集中保存播放/课堂状态，组件只负责播放器、批注、时间轴和提示层
  的呈现。

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

批注中的图片由 React 渲染为经过 Rust 校验的数据 URL。当前批注侧栏和视频
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
just desktop
just desktop demo
just desktop open /path/to/lesson.mp4
just check desktop
just check unit
```

`--config` 可覆盖课堂/设备映射，`--port` 可跳过自动发现，`--video` 可在启动时
直接打开视频。浏览器兼容接口仍监听 `127.0.0.1:9842`，供旧网页播放器适配器
使用。

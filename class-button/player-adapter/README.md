# Class Button player adapter

该适配器是在线网站兼容入口，只负责暂停浏览器中的媒体，不显示学生信息。当前
推荐的课堂主路径是 Class Button Desktop 内置的本地 MP4 播放器。

```js
import { ClassButtonPlayer } from "./class-button-player.js";

const classButton = new ClassButtonPlayer({
  media: () => document.querySelectorAll("video"),
  onConnectionChange(connected) {
    console.log("Class Button:", connected ? "connected" : "offline");
  },
}).connect();
```

收到按钮事件时，适配器会：

1. 调用当前页面全部 `video`/`audio` 元素的 `pause()`。
2. 调用可选的 `onPause()`。
3. 在 `window` 上派发 `class-button:pause` 自定义事件。

暂停消息不包含学生姓名、座位或设备号；这些信息只在原生应用进程内使用和显示。

默认只连接本机 `ws://127.0.0.1:9842/events`，不会访问云端服务。

原生应用必须在教师 Mac 或 Windows 电脑上保持运行；Hub 状态、学生姓名和
“已处理”操作都在 Desktop 播放器窗口里完成。适配器不创建 DOM、弹窗或遮罩，
因此不会与网站播放器的布局耦合。

如网站使用自定义播放器 API，而不是原生 `<video>`，可以传入带 `pause()` 方法
的对象：

```js
new ClassButtonPlayer({
  media: () => [coursePlayer],
  onPause() {
    analytics.track("class_button_pause");
  },
}).connect();
```

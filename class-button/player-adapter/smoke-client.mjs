import { ClassButtonPlayer } from "./class-button-player.js";

globalThis.CustomEvent ??= class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = { dispatchEvent() {} };

let paused = false;
const adapter = new ClassButtonPlayer({
  media: () => [
    {
      pause() {
        paused = true;
      },
    },
  ],
  onPause() {
    console.log(JSON.stringify({ paused }));
    adapter.disconnect();
    process.exit(paused ? 0 : 1);
  },
}).connect();

setTimeout(() => {
  console.error("timed out waiting for Class Button pause event");
  adapter.disconnect();
  process.exit(1);
}, 12_000);

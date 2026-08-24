/**
 * Connects a browser video player to the local Class Button desktop app.
 * The teacher prompt is rendered by the native app, never by this adapter.
 */
export class ClassButtonPlayer {
  constructor({
    url = "ws://127.0.0.1:9842/events",
    media = () => document.querySelectorAll("video, audio"),
    onConnectionChange = () => {},
    onPause = () => {},
  } = {}) {
    this.url = url;
    this.media = media;
    this.onConnectionChange = onConnectionChange;
    this.onPause = onPause;
    this.socket = null;
    this.retryTimer = null;
    this.stopped = false;
  }

  connect() {
    this.stopped = false;
    this.#open();
    return this;
  }

  disconnect() {
    this.stopped = true;
    clearTimeout(this.retryTimer);
    this.socket?.close();
    this.socket = null;
  }

  #open() {
    if (this.stopped) return;
    const socket = new WebSocket(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => this.onConnectionChange(true));
    socket.addEventListener("message", (message) => {
      let payload;
      try {
        payload = JSON.parse(message.data);
      } catch {
        return;
      }
      if (payload.type !== "pause") return;

      const targets = Array.from(this.media() ?? []);
      for (const target of targets) {
        if (typeof target.pause === "function") target.pause();
      }
      this.onPause();
      window.dispatchEvent(new CustomEvent("class-button:pause"));
    });
    socket.addEventListener("close", () => {
      this.onConnectionChange(false);
      if (!this.stopped) this.retryTimer = setTimeout(() => this.#open(), 1500);
    });
    socket.addEventListener("error", () => socket.close());
  }
}

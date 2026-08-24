import assert from "node:assert/strict";
import test from "node:test";

import { ClassButtonPlayer } from "./class-button-player.js";

class FakeWebSocket {
  static latest;

  constructor(url) {
    this.url = url;
    this.listeners = new Map();
    FakeWebSocket.latest = this;
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  emit(type, payload = {}) {
    this.listeners.get(type)?.(payload);
  }

  close() {}
}

globalThis.WebSocket = FakeWebSocket;
globalThis.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type;
    this.detail = options.detail;
  }
};
globalThis.window = { dispatchEvent() {} };

test("pauses attached media when a pause event arrives", () => {
  let pauses = 0;
  const video = { pause: () => pauses++ };
  const adapter = new ClassButtonPlayer({ media: () => [video] }).connect();

  FakeWebSocket.latest.emit("message", {
    data: JSON.stringify({ type: "pause" }),
  });

  assert.equal(FakeWebSocket.latest.url, "ws://127.0.0.1:9842/events");
  assert.equal(pauses, 1);
  adapter.disconnect();
});

test("keeps student identity out of the browser protocol", () => {
  let receivedArguments = -1;
  const adapter = new ClassButtonPlayer({
    media: () => [],
    onPause(...args) {
      receivedArguments = args.length;
    },
  }).connect();

  FakeWebSocket.latest.emit("message", {
    data: JSON.stringify({ type: "pause" }),
  });

  assert.equal(receivedArguments, 0);
  adapter.disconnect();
});

test("ignores non-pause protocol messages", () => {
  let pauses = 0;
  const adapter = new ClassButtonPlayer({
    media: () => [{ pause: () => pauses++ }],
  }).connect();

  FakeWebSocket.latest.emit("message", {
    data: JSON.stringify({ type: "connected", protocol: 1 }),
  });

  assert.equal(pauses, 0);
  adapter.disconnect();
});

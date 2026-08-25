import { describe, expect, it } from "vitest";

import type { PlayerAnnotation } from "../../shared/contracts";
import { activeAnnotationIndex, currentAnnotationIndex, formatTime } from "./player-state";

const annotations: PlayerAnnotation[] = [
  {
    timestamp_seconds: 5,
    duration_seconds: 3,
    kind: "note",
    color: "#c0512f",
    blocks: [{ type: "text", text: "First" }],
    text: "First",
  },
  {
    timestamp_seconds: 12,
    duration_seconds: 2,
    kind: "note",
    color: "#2563eb",
    blocks: [{ type: "text", text: "Second" }],
    text: "Second",
  },
];

describe("annotation selection", () => {
  it("separates the active overlay from the latest sidebar annotation", () => {
    expect(activeAnnotationIndex(annotations, 7)).toBe(0);
    expect(activeAnnotationIndex(annotations, 9)).toBe(-1);
    expect(currentAnnotationIndex(annotations, 9)).toBe(0);
    expect(currentAnnotationIndex(annotations, 12)).toBe(1);
  });

  it("formats player timestamps", () => {
    expect(formatTime(0)).toBe("00:00");
    expect(formatTime(65.2)).toBe("01:05");
  });
});

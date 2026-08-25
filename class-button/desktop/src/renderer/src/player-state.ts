import type { DesktopEvent, PlayerAnnotation, PlayerMedia, ProcessedPress } from "../../shared/contracts";

export type PlayerState = {
  classroom: string;
  receiverOnline: boolean;
  receiverPort?: string;
  media?: PlayerMedia;
  currentSeconds: number;
  durationSeconds: number;
  student?: ProcessedPress;
  error?: string;
  fullscreen: boolean;
};

export type PlayerAction =
  | { type: "desktop_event"; event: DesktopEvent }
  | { type: "time"; currentSeconds: number; durationSeconds?: number }
  | { type: "dismiss_student" }
  | { type: "media_error"; message: string }
  | { type: "clear_error" };

export const initialPlayerState: PlayerState = {
  classroom: "课堂未连接",
  receiverOnline: false,
  currentSeconds: 0,
  durationSeconds: 0,
  fullscreen: false,
};

export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  if (action.type === "time") {
    return {
      ...state,
      currentSeconds: action.currentSeconds,
      durationSeconds: action.durationSeconds ?? state.durationSeconds,
    };
  }
  if (action.type === "dismiss_student") return { ...state, student: undefined };
  if (action.type === "media_error") return { ...state, error: action.message };
  if (action.type === "clear_error") return { ...state, error: undefined };

  const event = action.event;
  switch (event.type) {
    case "ready":
      return { ...state, classroom: event.classroom };
    case "receiver_status":
      return {
        ...state,
        receiverOnline: event.online,
        receiverPort: event.port,
        error: event.online ? undefined : state.error,
      };
    case "press":
      return { ...state, student: event.press };
    case "media_opened":
      return {
        ...state,
        media: event.media,
        currentSeconds: 0,
        durationSeconds: 0,
        student: undefined,
        error: undefined,
      };
    case "error":
      return { ...state, error: event.message };
    case "fullscreen_changed":
      return { ...state, fullscreen: event.fullscreen };
  }
}

export function activeAnnotationIndex(annotations: PlayerAnnotation[], seconds: number): number {
  return annotations.findIndex(
    (annotation) =>
      seconds + 0.12 >= annotation.timestamp_seconds &&
      seconds <= annotation.timestamp_seconds + Math.max(0, annotation.duration_seconds),
  );
}

export function currentAnnotationIndex(annotations: PlayerAnnotation[], seconds: number): number {
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    const annotation = annotations[index];
    if (annotation && annotation.timestamp_seconds <= seconds + 0.12) return index;
  }
  return -1;
}

export function formatTime(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

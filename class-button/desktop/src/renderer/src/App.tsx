import {
  type DragEvent,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";

import type { AnnotationBlock, PlayerAnnotation } from "../../shared/contracts";
import {
  activeAnnotationIndex,
  currentAnnotationIndex,
  formatTime,
  initialPlayerState,
  playerReducer,
} from "./player-state";

export function App() {
  const [state, dispatch] = useReducer(playerReducer, initialPlayerState);
  const videoRef = useRef<HTMLVideoElement>(null);
  const annotations = state.media?.annotations ?? [];
  const activeIndex = activeAnnotationIndex(annotations, state.currentSeconds);
  const currentIndex = currentAnnotationIndex(annotations, state.currentSeconds);
  const activeAnnotation = activeIndex >= 0 ? annotations[activeIndex] : undefined;
  const currentAnnotation = currentIndex >= 0 ? annotations[currentIndex] : undefined;
  const upcoming = useMemo(() => {
    const start = currentIndex >= 0
      ? currentIndex + 1
      : annotations.findIndex((annotation) => annotation.timestamp_seconds >= state.currentSeconds);
    if (start < 0) return [];
    return annotations.slice(start, start + 2);
  }, [annotations, currentIndex, state.currentSeconds]);

  useEffect(() => {
    window.classButton.onEvent((event) => {
      if (event.type === "press") videoRef.current?.pause();
      dispatch({ type: "desktop_event", event });
    });
    return () => window.classButton.clearEventListeners();
  }, []);

  useEffect(() => {
    if (!state.media || !videoRef.current) return;
    videoRef.current.load();
    void videoRef.current.play().catch(() => {
      // Browsers may require the teacher to press play for startup media.
    });
  }, [state.media]);

  const seek = (seconds: number) => {
    if (!videoRef.current) return;
    videoRef.current.currentTime = Math.max(0, seconds);
    dispatch({ type: "time", currentSeconds: videoRef.current.currentTime });
  };

  const seekAnnotation = (forward: boolean) => {
    if (annotations.length === 0) return;
    const position = videoRef.current?.currentTime ?? state.currentSeconds;
    let index: number;
    if (forward) {
      index = annotations.findIndex((annotation) => annotation.timestamp_seconds > position + 0.25);
      if (index < 0) index = annotations.length - 1;
    } else {
      index = 0;
      for (let candidate = annotations.length - 1; candidate >= 0; candidate -= 1) {
        const annotation = annotations[candidate];
        if (annotation && annotation.timestamp_seconds < position - 0.25) {
          index = candidate;
          break;
        }
      }
    }
    const annotation = annotations[index];
    if (annotation) seek(annotation.timestamp_seconds);
  };

  const handleDrop = async (event: DragEvent) => {
    event.preventDefault();
    const file = event.dataTransfer.files.item(0);
    if (file) await window.classButton.openDroppedFile(file);
  };

  return (
    <main
      className="app-shell"
      onDragEnter={(event) => event.preventDefault()}
      onDragOver={(event) => event.preventDefault()}
      onDrop={handleDrop}
    >
      <header className="app-header">
        <div>
          <p className="eyebrow">VIDEOINSIGHT · CLASS BUTTON</p>
          <h1>课堂播放器</h1>
          <p className="header-subtitle">{state.classroom} · 本地只读批注</p>
        </div>
        <div className="header-actions">
          <span className={`hub-status ${state.receiverOnline ? "online" : ""}`}>
            <span className="status-dot" />
            {state.receiverOnline ? `HUB · 已连接 ${state.receiverPort ?? ""}` : "HUB · 正在查找"}
          </span>
          <button className="button secondary" onClick={() => void window.classButton.openFile()}>
            打开视频
          </button>
          <button
            className="button primary"
            onClick={() => void window.classButton.setFullscreen(!state.fullscreen)}
          >
            {state.fullscreen ? "退出全屏" : "全屏"}
          </button>
        </div>
      </header>

      <section className="workspace">
        <section className="stage-column">
          <div className="video-stage">
            {state.media ? (
              <video
                ref={videoRef}
                className="video"
                src={state.media.source}
                controls
                onTimeUpdate={(event) =>
                  dispatch({
                    type: "time",
                    currentSeconds: event.currentTarget.currentTime,
                    durationSeconds: Number.isFinite(event.currentTarget.duration)
                      ? event.currentTarget.duration
                      : undefined,
                  })
                }
                onLoadedMetadata={(event) =>
                  dispatch({
                    type: "time",
                    currentSeconds: event.currentTarget.currentTime,
                    durationSeconds: event.currentTarget.duration,
                  })
                }
                onError={() =>
                  dispatch({
                    type: "media_error",
                    message: "视频无法播放；请确认编码受 Chromium 支持（推荐 MP4/H.264/AAC 或 WebM）",
                  })
                }
              />
            ) : (
              <EmptyState onOpen={() => void window.classButton.openFile()} />
            )}

            {activeAnnotation && !state.student ? (
              <div className="stage-annotation">
                <div className="annotation-meta dark">
                  {formatTime(activeAnnotation.timestamp_seconds)} · {activeAnnotation.kind.toUpperCase()}
                </div>
                <AnnotationContent blocks={activeAnnotation.blocks} dark />
              </div>
            ) : null}

            {state.student ? (
              <div className="student-overlay" role="alert" aria-live="assertive">
                <p className="eyebrow coral">CLASS BUTTON · 学生请求暂停</p>
                <strong>{state.student.student}</strong>
                <span>{state.student.seat ? `座位 ${state.student.seat}` : `设备 ${state.student.device_id}`}</span>
                <button className="button primary" onClick={() => dispatch({ type: "dismiss_student" })}>
                  已处理
                </button>
              </div>
            ) : null}
          </div>

          <Timeline
            annotations={annotations}
            currentSeconds={state.currentSeconds}
            durationSeconds={state.durationSeconds}
            onSeek={seek}
          />
        </section>

        <aside className="sidebar">
          <div className="sidebar-heading">
            <div>
              <p className="eyebrow">播放批注</p>
              <h2>{state.media?.display_name ?? "尚未打开视频"}</h2>
            </div>
            <span className="count-badge">{annotations.length} 条</span>
          </div>
          <p className="source-status">
            {state.media?.annotation_status ?? "打开课程包后会在这里显示批注来源"}
          </p>

          <div className="rule" />
          <div className="section-label-row">
            <p className="eyebrow">当前批注</p>
            <span>{currentIndex >= 0 ? currentIndex + 1 : "—"} / {annotations.length}</span>
          </div>
          <div className="current-meta">
            <strong>{currentAnnotation ? formatTime(currentAnnotation.timestamp_seconds) : "等待播放"}</strong>
            <span>{currentAnnotation?.kind.toUpperCase() ?? "NOTE"}</span>
          </div>
          <div className="annotation-paper">
            <AnnotationContent
              blocks={currentAnnotation?.blocks ?? [{ type: "text", text: "当前时间没有批注" }]}
            />
          </div>

          <div className="section-label-row upcoming-label">
            <p className="eyebrow">接下来</p>
            <span>时间轴</span>
          </div>
          <UpcomingRows annotations={upcoming} />

          <div className="navigation">
            <button className="button secondary" onClick={() => seekAnnotation(false)} disabled={!annotations.length}>
              上一条
            </button>
            <button className="button primary" onClick={() => seekAnnotation(true)} disabled={!annotations.length}>
              下一条
            </button>
          </div>
          {state.error ? (
            <button className="error-banner" onClick={() => dispatch({ type: "clear_error" })}>
              {state.error}
            </button>
          ) : null}
        </aside>
      </section>
    </main>
  );
}

function EmptyState({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">▶</span>
      <h2>打开课堂视频</h2>
      <p>支持 VideoInsight `.vinsight` 课程包、MP4 与 WebM。也可以把文件拖到这里。</p>
      <button className="button primary" onClick={onOpen}>选择视频</button>
    </div>
  );
}

function AnnotationContent({ blocks, dark = false }: { blocks: AnnotationBlock[]; dark?: boolean }) {
  return (
    <div className={`annotation-content ${dark ? "dark" : ""}`}>
      {blocks.map((block, index) =>
        block.type === "text" ? (
          <p key={`${index}-${block.text}`}>{block.text}</p>
        ) : (
          <figure key={`${index}-${block.src.slice(-24)}`}>
            <img src={block.src} alt={block.alt} />
            <figcaption>{block.alt || "批注图片"}</figcaption>
          </figure>
        ),
      )}
    </div>
  );
}

function Timeline({
  annotations,
  currentSeconds,
  durationSeconds,
  onSeek,
}: {
  annotations: PlayerAnnotation[];
  currentSeconds: number;
  durationSeconds: number;
  onSeek: (seconds: number) => void;
}) {
  const progress = durationSeconds > 0 ? Math.min(100, (currentSeconds / durationSeconds) * 100) : 0;
  return (
    <div className="timeline-wrap">
      <span>{formatTime(currentSeconds)}</span>
      <div className="timeline">
        <div className="timeline-progress" style={{ width: `${progress}%` }} />
        {durationSeconds > 0
          ? annotations.map((annotation, index) => {
              const left = Math.min(100, (annotation.timestamp_seconds / durationSeconds) * 100);
              const width = Math.max(0.4, (annotation.duration_seconds / durationSeconds) * 100);
              return (
                <span
                  className="timeline-marker"
                  key={`${annotation.timestamp_seconds}-${index}`}
                  style={{ left: `${left}%`, width: `${Math.min(width, 100 - left)}%`, background: annotation.color }}
                />
              );
            })
          : null}
        <input
          aria-label="视频时间轴"
          type="range"
          min={0}
          max={Math.max(durationSeconds, 0.01)}
          step={0.01}
          value={Math.min(currentSeconds, Math.max(durationSeconds, 0.01))}
          disabled={durationSeconds <= 0}
          onChange={(event) => onSeek(Number(event.currentTarget.value))}
        />
      </div>
      <span>{formatTime(durationSeconds)}</span>
    </div>
  );
}

function UpcomingRows({ annotations }: { annotations: PlayerAnnotation[] }) {
  return (
    <div className="upcoming-list">
      {[0, 1].map((index) => {
        const annotation = annotations[index];
        return (
          <div className="upcoming-row" key={index}>
            <strong>{annotation ? formatTime(annotation.timestamp_seconds) : "—"}</strong>
            <span>{annotation?.text ?? (index === 0 ? "没有后续批注" : "—")}</span>
          </div>
        );
      })}
    </div>
  );
}

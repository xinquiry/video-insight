use std::net::SocketAddr;

use axum::{
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        State,
    },
    response::IntoResponse,
    routing::get,
    Json, Router,
};
use class_button_core::ProcessedPress;
use futures_util::StreamExt;
use serde::Serialize;
use tokio::sync::broadcast;

#[derive(Clone)]
struct ServerState {
    events: broadcast::Sender<ProcessedPress>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PlayerEvent {
    Connected { protocol: u8 },
    Pause,
}

pub async fn serve(
    address: SocketAddr,
    events: broadcast::Sender<ProcessedPress>,
) -> Result<(), String> {
    let state = ServerState { events };
    let app = Router::new()
        .route("/health", get(health))
        .route("/events", get(events_socket))
        .with_state(state);
    let listener = tokio::net::TcpListener::bind(address)
        .await
        .map_err(|error| format!("无法启动播放器接口 {address}：{error}"))?;
    axum::serve(listener, app)
        .await
        .map_err(|error| format!("播放器接口异常退出：{error}"))
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "service": "class-button",
        "status": "ok",
        "protocol": 1
    }))
}

async fn events_socket(
    websocket: WebSocketUpgrade,
    State(state): State<ServerState>,
) -> impl IntoResponse {
    websocket.on_upgrade(move |socket| player_connection(socket, state))
}

async fn player_connection(mut socket: WebSocket, state: ServerState) {
    let connected = serde_json::to_string(&PlayerEvent::Connected { protocol: 1 })
        .expect("serialize connected event");
    if socket.send(Message::Text(connected.into())).await.is_ok() {
        let mut events = state.events.subscribe();
        loop {
            tokio::select! {
                event = events.recv() => match event {
                    Ok(_event) => {
                        // The browser only needs a command. Student identity stays in the
                        // native process and is never exposed to arbitrary web pages.
                        let payload = serde_json::to_string(&PlayerEvent::Pause)
                            .expect("serialize pause event");
                        if socket.send(Message::Text(payload.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                },
                incoming = socket.next() => match incoming {
                    Some(Ok(Message::Close(_))) | None | Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
}

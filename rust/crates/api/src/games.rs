//! Public table games: catalog/join REST and the `/ws/games` seat socket.
//! Room state is in memory; the rules run in the embedded Rust-owned JS engine.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::mpsc;
use std::time::{Duration, Instant};

use axum::Json;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::extract::{ConnectInfo, Query, Request, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use cafeflow_games::{
    GameFailure, JoinReply, JoinRequest, MoveReply, RoomManager, RoomUpdate, SeatFrame, manifest,
    manifest_list,
};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::Row;
use tokio::sync::{broadcast, oneshot};

use crate::error::{AppError, bad_request, conflict, forbidden, not_found};
use crate::public_menu::{module_enabled, resolve_device, with_device_cookie};
use crate::state::AppState;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JoinBody {
    qr_token: String,
    game_id: String,
    name_fa: Option<String>,
}

#[derive(Debug, Deserialize, Default)]
pub struct SeatQuery {
    seat: Option<String>,
}

enum Command {
    Join {
        input: JoinRequest,
        reply: oneshot::Sender<Result<JoinReply, GameFailure>>,
    },
    Resolve {
        token: String,
        reply: oneshot::Sender<Option<(String, usize)>>,
    },
    Snapshot {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<SeatFrame, GameFailure>>,
    },
    SocketOpen {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
    SocketClose {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
    Ready {
        room_id: String,
        seat: usize,
        ready: bool,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
    Start {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
    Restart {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
    Move {
        room_id: String,
        seat: usize,
        movement: Value,
        reply: oneshot::Sender<Result<MoveReply, GameFailure>>,
    },
    Leave {
        room_id: String,
        seat: usize,
        reply: oneshot::Sender<Result<(), GameFailure>>,
    },
}

#[derive(Clone)]
pub struct GamesHub {
    command: mpsc::Sender<Command>,
    events: broadcast::Sender<RoomUpdate>,
}

impl GamesHub {
    pub fn spawn() -> Self {
        let (command, receiver) = mpsc::channel();
        let (events, _) = broadcast::channel(128);
        let (ready_tx, ready_rx) = mpsc::channel();
        let event_sender = events.clone();
        std::thread::Builder::new()
            .name("cafeflow-games".to_string())
            .spawn(move || match RoomManager::new() {
                Ok(mut manager) => {
                    let _ = ready_tx.send(Ok(()));
                    run_rooms(&mut manager, receiver, event_sender);
                }
                Err(error) => {
                    tracing::error!("game engine did not start: {error}");
                    let _ = ready_tx.send(Err(error.to_string()));
                }
            })
            .expect("spawn games thread");
        match ready_rx.recv_timeout(Duration::from_secs(30)) {
            Ok(Ok(())) => {}
            Ok(Err(error)) => tracing::error!("games disabled: {error}"),
            Err(_) => tracing::error!("games engine startup timed out"),
        }
        Self { command, events }
    }

    async fn call<T>(
        &self,
        make: impl FnOnce(oneshot::Sender<T>) -> Command,
    ) -> Result<T, GameFailure> {
        let (reply, result) = oneshot::channel();
        self.command
            .send(make(reply))
            .map_err(|_| GameFailure::new("GAME_ERROR", "موتور بازی در دسترس نیست."))?;
        result
            .await
            .map_err(|_| GameFailure::new("GAME_ERROR", "موتور بازی پاسخ نداد."))
    }

    pub async fn join(&self, input: JoinRequest) -> Result<JoinReply, GameFailure> {
        self.call(|reply| Command::Join { input, reply }).await?
    }

    pub async fn resolve(&self, token: String) -> Option<(String, usize)> {
        self.call(|reply| Command::Resolve { token, reply })
            .await
            .ok()
            .flatten()
    }

    pub async fn snapshot(&self, room_id: String, seat: usize) -> Result<SeatFrame, GameFailure> {
        self.call(|reply| Command::Snapshot {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    pub async fn socket_open(&self, room_id: String, seat: usize) -> Result<(), GameFailure> {
        self.call(|reply| Command::SocketOpen {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    pub async fn socket_close(&self, room_id: String, seat: usize) -> Result<(), GameFailure> {
        self.call(|reply| Command::SocketClose {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    pub async fn ready(
        &self,
        room_id: String,
        seat: usize,
        ready: bool,
    ) -> Result<(), GameFailure> {
        self.call(|reply| Command::Ready {
            room_id,
            seat,
            ready,
            reply,
        })
        .await?
    }

    pub async fn start(&self, room_id: String, seat: usize) -> Result<(), GameFailure> {
        self.call(|reply| Command::Start {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    pub async fn restart(&self, room_id: String, seat: usize) -> Result<(), GameFailure> {
        self.call(|reply| Command::Restart {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    pub async fn apply_move(
        &self,
        room_id: String,
        seat: usize,
        movement: Value,
    ) -> Result<MoveReply, GameFailure> {
        self.call(|reply| Command::Move {
            room_id,
            seat,
            movement,
            reply,
        })
        .await?
    }

    pub async fn leave(&self, room_id: String, seat: usize) -> Result<(), GameFailure> {
        self.call(|reply| Command::Leave {
            room_id,
            seat,
            reply,
        })
        .await?
    }

    fn subscribe(&self) -> broadcast::Receiver<RoomUpdate> {
        self.events.subscribe()
    }
}

fn run_rooms(
    manager: &mut RoomManager,
    receiver: mpsc::Receiver<Command>,
    events: broadcast::Sender<RoomUpdate>,
) {
    let mut sockets: HashMap<(String, usize), usize> = HashMap::new();
    loop {
        match receiver.recv_timeout(Duration::from_millis(100)) {
            Ok(command) => {
                if let Some(updates) = handle(manager, &mut sockets, command) {
                    for update in updates {
                        let _ = events.send(update);
                    }
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                for update in manager.tick() {
                    let _ = events.send(update);
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
}

fn handle(
    manager: &mut RoomManager,
    sockets: &mut HashMap<(String, usize), usize>,
    command: Command,
) -> Option<Vec<RoomUpdate>> {
    match command {
        Command::Join { input, reply } => match manager.join(input) {
            Ok(joined) => {
                let updates = joined.updates.clone();
                let _ = reply.send(Ok(joined));
                Some(updates)
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                None
            }
        },
        Command::Resolve { token, reply } => {
            let _ = reply.send(manager.resolve(&token));
            None
        }
        Command::Snapshot {
            room_id,
            seat,
            reply,
        } => {
            let _ = reply.send(manager.snapshot(&room_id, seat));
            None
        }
        Command::SocketOpen {
            room_id,
            seat,
            reply,
        } => {
            let key = (room_id.clone(), seat);
            let count = sockets.entry(key.clone()).or_insert(0);
            *count += 1;
            if *count > 1 {
                let _ = reply.send(Ok(()));
                return None;
            }
            match manager.set_connected(&room_id, seat, true) {
                Ok(updates) => {
                    let _ = reply.send(Ok(()));
                    Some(updates)
                }
                Err(error) => {
                    sockets.remove(&key);
                    let _ = reply.send(Err(error));
                    None
                }
            }
        }
        Command::SocketClose {
            room_id,
            seat,
            reply,
        } => {
            let key = (room_id.clone(), seat);
            let remaining = sockets.get_mut(&key).map(|count| {
                *count = count.saturating_sub(1);
                *count
            });
            let Some(remaining) = remaining else {
                let _ = reply.send(Ok(()));
                return None;
            };
            if remaining > 0 {
                let _ = reply.send(Ok(()));
                return None;
            }
            sockets.remove(&key);
            match manager.set_connected(&room_id, seat, false) {
                Ok(updates) => {
                    let _ = reply.send(Ok(()));
                    Some(updates)
                }
                Err(error) => {
                    let _ = reply.send(Err(error));
                    None
                }
            }
        }
        Command::Ready {
            room_id,
            seat,
            ready,
            reply,
        } => match manager.set_ready(&room_id, seat, ready) {
            Ok(updates) => {
                let _ = reply.send(Ok(()));
                Some(updates)
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                None
            }
        },
        Command::Start {
            room_id,
            seat,
            reply,
        } => match manager.start(&room_id, seat) {
            Ok(updates) => {
                let _ = reply.send(Ok(()));
                Some(updates)
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                None
            }
        },
        Command::Restart {
            room_id,
            seat,
            reply,
        } => match manager.restart(&room_id, seat) {
            Ok(updates) => {
                let _ = reply.send(Ok(()));
                Some(updates)
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                None
            }
        },
        Command::Move {
            room_id,
            seat,
            movement,
            reply,
        } => match manager.apply_move(&room_id, seat, movement) {
            Ok(moved) => {
                let updates = moved.updates.clone();
                let _ = reply.send(Ok(moved));
                Some(updates)
            }
            Err(error) => {
                let _ = reply.send(Err(error));
                None
            }
        },
        Command::Leave {
            room_id,
            seat,
            reply,
        } => {
            sockets.remove(&(room_id.clone(), seat));
            match manager.leave(&room_id, seat) {
                Ok(updates) => {
                    let _ = reply.send(Ok(()));
                    if updates.is_empty() {
                        // The last seat took the room with it; an empty frame still
                        // tells every other tab of that seat to close.
                        Some(vec![RoomUpdate {
                            room_id,
                            seats: Vec::new(),
                        }])
                    } else {
                        Some(updates)
                    }
                }
                Err(error) => {
                    let _ = reply.send(Err(error));
                    None
                }
            }
        }
    }
}

fn module_blocked() -> AppError {
    forbidden(
        "ماژول «بازی‌ها» غیرفعال است. برای استفاده، آن را از تنظیمات ماژول‌ها فعال کنید.",
        "MODULE_DISABLED",
    )
}

pub async fn catalog(State(state): State<AppState>) -> Result<Json<Value>, AppError> {
    if !module_enabled(&state, "games", true).await? {
        return Err(module_blocked());
    }
    Ok(Json(json!({ "games": manifest_list() })))
}

async fn table_for_qr(
    state: &AppState,
    token: &str,
) -> Result<(String, String, Option<String>), AppError> {
    let row = sqlx::query(
        "SELECT t.id AS table_id, t.name_fa AS table_name_fa, t.status AS table_status,
                (SELECT s.id FROM table_sessions s
                  WHERE s.table_id = t.id AND s.status = 'open'
                  ORDER BY s.opened_at DESC LIMIT 1) AS session_id
           FROM qr_codes q
           JOIN dining_tables t
             ON t.id = q.table_id AND t.deleted_at IS NULL AND t.is_active = 1
          WHERE q.token = $1 AND q.kind = 'table' AND q.is_active = 1",
    )
    .bind(token)
    .fetch_optional(&state.db.pool)
    .await
    .map_err(db_error)?
    .ok_or_else(|| not_found("این کد QR معتبر نیست یا غیرفعال شده است.", "QR_NOT_FOUND"))?;
    let status: String = row.get("table_status");
    if status == "cleaning" || status == "unavailable" {
        return Err(conflict("این میز الان آمادهٔ بازی نیست.", "TABLE_NOT_READY"));
    }
    Ok((
        row.get("table_id"),
        row.get("table_name_fa"),
        row.get("session_id"),
    ))
}

pub async fn join(State(state): State<AppState>, request: Request) -> Result<Response, AppError> {
    let headers = request.headers().clone();
    let connection = request
        .extensions()
        .get::<ConnectInfo<SocketAddr>>()
        .cloned();
    let body = axum::body::to_bytes(request.into_body(), 2 * 1024 * 1024)
        .await
        .map_err(|_| crate::error::validation_failed("بدنهٔ درخواست معتبر نیست."))?;
    if !module_enabled(&state, "games", true).await? {
        return Err(module_blocked());
    }
    let input: JoinBody = serde_json::from_slice(&body)
        .map_err(|_| crate::error::validation_failed("اطلاعات ورود به بازی معتبر نیست."))?;
    if input.qr_token.trim().is_empty() {
        return Err(bad_request("کد QR الزامی است.", "VALIDATION_FAILED"));
    }
    if input.game_id.trim().is_empty() {
        return Err(bad_request("انتخاب بازی الزامی است.", "VALIDATION_FAILED"));
    }
    if input
        .name_fa
        .as_deref()
        .is_some_and(|name| name.trim().chars().count() > 24)
    {
        return Err(bad_request("نام حداکثر ۲۴ نویسه است.", "VALIDATION_FAILED"));
    }
    let Some(game) = manifest(&input.game_id) else {
        return Err(bad_request("این بازی در دسترس نیست.", "GAME_UNKNOWN"));
    };
    if !game.playable {
        return Err(bad_request(
            "این بازی هنوز روی این نسخه آماده نیست.",
            "GAME_NOT_READY",
        ));
    }

    let device = resolve_device(&state, &headers).await?;
    let ip = connection
        .map(|info| info.0.ip().to_string())
        .or_else(|| {
            headers
                .get("x-forwarded-for")
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.split(',').next())
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string)
        })
        .unwrap_or_else(|| "unknown".to_string());
    let device_allowed = state
        .games_device_limiter
        .lock()
        .map(|mut limiter| limiter.hit(&format!("games:{}", device.id)))
        .unwrap_or(true);
    let ip_allowed = state
        .games_ip_limiter
        .lock()
        .map(|mut limiter| limiter.hit(&format!("games:{ip}")))
        .unwrap_or(true);
    if !device_allowed || !ip_allowed {
        return Err(AppError::new(
            StatusCode::TOO_MANY_REQUESTS,
            "RATE_LIMITED",
            "تعداد تلاش‌ها زیاد بود؛ کمی بعد دوباره امتحان کنید.",
        ));
    }

    let (table_id, table_name_fa, session_id) = table_for_qr(&state, input.qr_token.trim()).await?;
    let joined = state
        .games
        .join(JoinRequest {
            table_id,
            table_name_fa,
            epoch: session_id.unwrap_or_else(|| "idle".to_string()),
            game_id: input.game_id,
            device_id: device.id.clone(),
            name_fa: input.name_fa,
        })
        .await
        .map_err(game_failure)?;

    let response = (StatusCode::CREATED, Json(joined.response)).into_response();
    Ok(with_device_cookie(response, &device, &state))
}

pub async fn ws_games(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Query(query): Query<SeatQuery>,
) -> Response {
    if !module_enabled(&state, "games", true).await.unwrap_or(false) {
        return AppError::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "MODULE_DISABLED",
            "ماژول بازی‌ها غیرفعال است.",
        )
        .into_response();
    }
    let Some((room_id, seat)) = state.games.resolve(query.seat.unwrap_or_default()).await else {
        return ws
            .max_message_size(64 * 1024)
            .on_upgrade(|mut socket| async move {
                let _ = socket
                    .send(Message::Close(Some(CloseFrame {
                        code: 4401,
                        reason: "seat-gone".into(),
                    })))
                    .await;
            })
            .into_response();
    };
    ws.max_message_size(64 * 1024)
        .on_upgrade(move |socket| socket_loop(socket, state, room_id, seat))
        .into_response()
}

struct TokenBucket {
    tokens: f64,
    last: Instant,
}

impl TokenBucket {
    fn new() -> Self {
        Self {
            tokens: 40.0,
            last: Instant::now(),
        }
    }

    fn allow(&mut self) -> bool {
        let now = Instant::now();
        let elapsed = now.duration_since(self.last).as_secs_f64();
        self.tokens = (self.tokens + elapsed * 20.0).min(40.0);
        self.last = now;
        if self.tokens < 1.0 {
            return false;
        }
        self.tokens -= 1.0;
        true
    }
}

async fn socket_loop(mut socket: WebSocket, state: AppState, room_id: String, seat: usize) {
    if state
        .games
        .socket_open(room_id.clone(), seat)
        .await
        .is_err()
    {
        let _ = socket
            .send(Message::Close(Some(CloseFrame {
                code: 4401,
                reason: "seat-gone".into(),
            })))
            .await;
        return;
    }
    let mut events = state.games.subscribe();
    if let Ok(frame) = state.games.snapshot(room_id.clone(), seat).await {
        let _ = socket
            .send(Message::Text(
                json!({"type": "room", "room": frame.room})
                    .to_string()
                    .into(),
            ))
            .await;
        if let Some(game_state) = frame.state {
            let _ = socket
                .send(Message::Text(
                    json!({"type": "state", "state": game_state})
                        .to_string()
                        .into(),
                ))
                .await;
        }
    }

    let mut bucket = TokenBucket::new();
    let mut last_seen = Instant::now();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(30));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            incoming = socket.recv() => {
                let Some(Ok(message)) = incoming else { break };
                last_seen = Instant::now();
                match message {
                    Message::Text(text) => {
                        if !bucket.allow() {
                            send_error(&mut socket, "RATE_LIMITED", "کمی آرام‌تر؛ پیام‌ها زیاد شد.").await;
                            continue;
                        }
                        if !handle_message(&mut socket, &state, &room_id, seat, text.as_str()).await {
                            break;
                        }
                    }
                    Message::Close(_) => break,
                    Message::Ping(payload) => {
                        if socket.send(Message::Pong(payload)).await.is_err() {
                            break;
                        }
                    }
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(update) if update.room_id == room_id => {
                        if let Some(frame) = update.seats.into_iter().find(|frame| frame.seat == seat) {
                            if socket.send(Message::Text(
                                json!({"type": "room", "room": frame.room}).to_string().into()
                            )).await.is_err() {
                                break;
                            }
                            if let Some(game_state) = frame.state
                                && socket
                                    .send(Message::Text(
                                        json!({"type": "state", "state": game_state})
                                            .to_string()
                                            .into(),
                                    ))
                                    .await
                                    .is_err()
                            {
                                break;
                            }
                        } else {
                            let _ = socket
                                .send(Message::Close(Some(CloseFrame {
                                    code: 4400,
                                    reason: "left".into(),
                                })))
                                .await;
                            break;
                        }
                    }
                    Ok(_) | Err(broadcast::error::RecvError::Lagged(_)) => {}
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                if last_seen.elapsed() > Duration::from_secs(65) {
                    break;
                }
                if socket.send(Message::Ping(Vec::new().into())).await.is_err() {
                    break;
                }
            }
        }
    }
    let _ = state.games.socket_close(room_id, seat).await;
}

async fn handle_message(
    socket: &mut WebSocket,
    state: &AppState,
    room_id: &str,
    seat: usize,
    raw: &str,
) -> bool {
    let Ok(message) = serde_json::from_str::<Value>(raw) else {
        send_error(socket, "BAD_MESSAGE", "پیام نامعتبر است.").await;
        return true;
    };
    let Some(kind) = message.get("type").and_then(Value::as_str) else {
        send_error(socket, "BAD_MESSAGE", "پیام نامعتبر است.").await;
        return true;
    };
    let result = match kind {
        "ready" => {
            state
                .games
                .ready(
                    room_id.to_string(),
                    seat,
                    message
                        .get("ready")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                )
                .await
        }
        "start" => state.games.start(room_id.to_string(), seat).await,
        "restart" => state.games.restart(room_id.to_string(), seat).await,
        "leave" => {
            let _ = state.games.leave(room_id.to_string(), seat).await;
            let _ = socket
                .send(Message::Close(Some(CloseFrame {
                    code: 4400,
                    reason: "left".into(),
                })))
                .await;
            return false;
        }
        "move" => {
            let movement = message.get("move").cloned().unwrap_or_else(|| json!({}));
            if !movement.is_object() {
                send_error(socket, "BAD_MESSAGE", "این حرکت معتبر نیست.").await;
                return true;
            }
            return match state
                .games
                .apply_move(room_id.to_string(), seat, movement)
                .await
            {
                Ok(moved) => {
                    if let Some(error) = moved.error {
                        send_error(socket, "MOVE_REFUSED", &error).await;
                    }
                    true
                }
                Err(error) => {
                    send_failure(socket, &error).await;
                    true
                }
            };
        }
        _ => {
            send_error(socket, "UNKNOWN_MESSAGE", "این فرمان شناخته نشد.").await;
            return true;
        }
    };
    if let Err(error) = result {
        send_failure(socket, &error).await;
    }
    true
}

async fn send_error(socket: &mut WebSocket, code: &str, message: &str) {
    let _ = socket
        .send(Message::Text(
            json!({"type": "error", "code": code, "message": message})
                .to_string()
                .into(),
        ))
        .await;
}

async fn send_failure(socket: &mut WebSocket, failure: &GameFailure) {
    send_error(socket, failure.code, &failure.message).await;
}

fn game_failure(failure: GameFailure) -> AppError {
    match failure.code {
        "GAME_UNKNOWN" => bad_request(failure.message, failure.code),
        "QR_NOT_FOUND" | "GAME_SEAT_NOT_FOUND" => not_found(failure.message, failure.code),
        "GAME_FULL"
        | "GAME_IN_PROGRESS"
        | "GAME_ALREADY_STARTED"
        | "TABLE_NOT_READY"
        | "GAME_NEEDS_PLAYERS"
        | "GAME_NOT_READY" => conflict(failure.message, failure.code),
        "HOST_ONLY" => forbidden(failure.message, failure.code),
        _ => AppError::internal(failure.message),
    }
}

fn db_error(error: sqlx::Error) -> AppError {
    tracing::error!("games database error: {error}");
    AppError::internal("خطای پایگاه داده رخ داد.")
}

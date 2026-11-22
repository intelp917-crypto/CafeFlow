//! In-memory game rooms. Rooms are deliberately ephemeral: a game lasts a few
//! minutes and never touches ordering data.

use std::collections::HashMap;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use uuid::Uuid;

use crate::engine::{EngineError, GameEngine, GameMeta, manifest};

const LOBBY_GRACE: Duration = Duration::from_secs(5 * 60);
const PLAYING_GRACE: Duration = Duration::from_secs(2 * 60);
const ROOM_IDLE: Duration = Duration::from_secs(60 * 60);
const FA_DIGITS: [char; 10] = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

#[derive(Debug, Clone)]
pub struct GameFailure {
    pub code: &'static str,
    pub message: String,
}

impl GameFailure {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct JoinRequest {
    pub table_id: String,
    pub table_name_fa: String,
    pub epoch: String,
    pub game_id: String,
    pub device_id: String,
    pub name_fa: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SeatView {
    pub index: usize,
    pub name_fa: String,
    pub ready: bool,
    pub connected: bool,
    pub is_host: bool,
    pub is_you: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomView {
    pub room_id: String,
    pub table_name_fa: String,
    pub game_id: String,
    pub game_name_fa: String,
    pub phase: String,
    pub host_seat: usize,
    pub min_players: i64,
    pub max_players: i64,
    pub seats: Vec<SeatView>,
    pub deadline: i64,
}

#[derive(Debug, Clone)]
pub struct SeatFrame {
    pub seat: usize,
    pub room: Value,
    pub state: Option<Value>,
}

#[derive(Debug, Clone)]
pub struct RoomUpdate {
    pub room_id: String,
    pub seats: Vec<SeatFrame>,
}

#[derive(Debug, Clone)]
pub struct JoinReply {
    pub response: Value,
    pub updates: Vec<RoomUpdate>,
}

#[derive(Debug, Clone)]
pub struct MoveReply {
    pub error: Option<String>,
    pub updates: Vec<RoomUpdate>,
}

#[derive(Debug, Clone)]
struct Seat {
    index: usize,
    device_id: String,
    name_fa: String,
    ready: bool,
    connected: bool,
    token_hash: String,
    removed: bool,
    disconnect_at: Option<Instant>,
}

struct Room {
    id: String,
    table_name_fa: String,
    game_id: String,
    phase: String,
    seats: Vec<Seat>,
    host_seat: usize,
    state: Option<String>,
    meta: Option<GameMeta>,
    deadline_ms: i64,
    next_tick: Option<Instant>,
    last_activity: Instant,
}

pub struct RoomManager {
    engine: GameEngine,
    rooms: HashMap<String, Room>,
    tokens: HashMap<String, (String, usize)>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn hash_token(token: &str) -> String {
    hex::encode(Sha256::digest(token.as_bytes()))
}

fn new_token() -> String {
    format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple())
}

fn fa_number(value: usize) -> String {
    value
        .to_string()
        .chars()
        .map(|digit| FA_DIGITS[digit.to_digit(10).unwrap_or(0) as usize])
        .collect()
}

fn winner(state: &str) -> Option<Value> {
    let value: Value = serde_json::from_str(state).ok()?;
    match value.get("winner") {
        None | Some(Value::Null) => None,
        Some(value) => Some(value.clone()),
    }
}

impl RoomManager {
    pub fn new() -> Result<Self, EngineError> {
        Ok(Self {
            engine: GameEngine::new()?,
            rooms: HashMap::new(),
            tokens: HashMap::new(),
        })
    }

    pub fn join(&mut self, input: JoinRequest) -> Result<JoinReply, GameFailure> {
        let game = manifest(&input.game_id)
            .ok_or_else(|| GameFailure::new("GAME_UNKNOWN", "این بازی در دسترس نیست."))?;
        if !game.playable {
            return Err(GameFailure::new(
                "GAME_NOT_READY",
                "این بازی هنوز روی این نسخه آماده نیست.",
            ));
        }
        let id = format!("{}:{}:{}", input.table_id, input.epoch, input.game_id);

        if !self.rooms.contains_key(&id) {
            self.rooms.insert(
                id.clone(),
                Room {
                    id: id.clone(),
                    table_name_fa: input.table_name_fa.clone(),
                    game_id: input.game_id.clone(),
                    phase: "lobby".to_string(),
                    seats: Vec::new(),
                    host_seat: 0,
                    state: None,
                    meta: None,
                    deadline_ms: 0,
                    next_tick: None,
                    last_activity: Instant::now(),
                },
            );
        }

        let existing = {
            let room = self.rooms.get(&id).expect("room just inserted");
            room.seats
                .iter()
                .find(|seat| seat.device_id == input.device_id && !seat.removed)
                .map(|seat| seat.index)
        };
        if let Some(index) = existing {
            let token = new_token();
            let room = self.rooms.get_mut(&id).expect("room exists");
            let seat = room
                .seats
                .iter_mut()
                .find(|seat| seat.index == index)
                .expect("seat exists");
            self.tokens.remove(&seat.token_hash);
            seat.token_hash = hash_token(&token);
            seat.disconnect_at = None;
            self.tokens
                .insert(seat.token_hash.clone(), (id.clone(), seat.index));
            room.last_activity = Instant::now();

            let updates = self.publish(&id).into_iter().collect::<Vec<_>>();
            let response = self.join_response(&id, index, &token)?;
            return Ok(JoinReply { response, updates });
        }

        {
            let room = self.rooms.get(&id).expect("room exists");
            if room.phase != "lobby" {
                return Err(GameFailure::new(
                    "GAME_IN_PROGRESS",
                    "این دست شروع شده است؛ برای بازی بعدی صبر کنید.",
                ));
            }
            let active = room.seats.iter().filter(|seat| !seat.removed).count();
            if active >= game.max_players as usize {
                return Err(GameFailure::new(
                    "GAME_FULL",
                    "صندلی‌های این بازی پر شده است.",
                ));
            }
        }

        let index = {
            let room = self.rooms.get(&id).expect("room exists");
            let taken = room
                .seats
                .iter()
                .filter(|seat| !seat.removed)
                .map(|seat| seat.index)
                .collect::<Vec<_>>();
            let mut index = 0;
            while taken.contains(&index) {
                index += 1;
            }
            index
        };
        let token = new_token();
        let seat = Seat {
            index,
            device_id: input.device_id,
            name_fa: input
                .name_fa
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| format!("بازیکن {}", fa_number(index + 1))),
            ready: false,
            connected: false,
            token_hash: hash_token(&token),
            removed: false,
            disconnect_at: None,
        };
        let token_hash = seat.token_hash.clone();
        {
            let room = self.rooms.get_mut(&id).expect("room exists");
            room.seats.push(seat);
            room.seats.sort_by_key(|seat| seat.index);
            if room.seats.len() == 1 {
                room.host_seat = index;
            }
            room.last_activity = Instant::now();
        }
        self.tokens.insert(token_hash, (id.clone(), index));

        let updates = self.publish(&id).into_iter().collect::<Vec<_>>();
        let response = self.join_response(&id, index, &token)?;
        Ok(JoinReply { response, updates })
    }

    fn join_response(
        &mut self,
        room_id: &str,
        seat: usize,
        token: &str,
    ) -> Result<Value, GameFailure> {
        let frame = self.snapshot(room_id, seat)?;
        let expires = OffsetDateTime::now_utc() + time::Duration::hours(1);
        Ok(json!({
            "seatToken": token,
            "seat": seat,
            "room": frame.room,
            "state": frame.state,
            "expiresAt": expires.format(&Rfc3339).unwrap_or_default(),
        }))
    }

    pub fn resolve(&self, token: &str) -> Option<(String, usize)> {
        self.tokens.get(&hash_token(token)).cloned()
    }

    pub fn snapshot(&mut self, room_id: &str, seat: usize) -> Result<SeatFrame, GameFailure> {
        let (view, game_id, state) = {
            let room = self
                .rooms
                .get(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            if !room
                .seats
                .iter()
                .any(|candidate| candidate.index == seat && !candidate.removed)
            {
                return Err(GameFailure::new(
                    "GAME_SEAT_NOT_FOUND",
                    "صندلی بازی پیدا نشد.",
                ));
            }
            (
                self.room_view(room, seat),
                room.game_id.clone(),
                room.state.clone(),
            )
        };
        let state = match state {
            Some(state) => {
                let raw = if self
                    .rooms
                    .get(room_id)
                    .and_then(|room| room.meta.as_ref())
                    .is_some_and(|meta| meta.has_player_view)
                {
                    self.engine
                        .view(&game_id, &state, seat)
                        .map_err(engine_failure)?
                } else {
                    state
                };
                Some(serde_json::from_str(&raw).unwrap_or(Value::Null))
            }
            None => None,
        };
        Ok(SeatFrame {
            seat,
            room: serde_json::to_value(view).unwrap_or(Value::Null),
            state,
        })
    }

    fn room_view(&self, room: &Room, viewer: usize) -> RoomView {
        let game = manifest(&room.game_id);
        RoomView {
            room_id: room.id.clone(),
            table_name_fa: room.table_name_fa.clone(),
            game_id: room.game_id.clone(),
            game_name_fa: game.map(|game| game.name_fa.clone()).unwrap_or_default(),
            phase: room.phase.clone(),
            host_seat: room.host_seat,
            min_players: game.map(|game| game.min_players).unwrap_or(1),
            max_players: game.map(|game| game.max_players).unwrap_or(8),
            deadline: room.deadline_ms,
            seats: room
                .seats
                .iter()
                .filter(|seat| !seat.removed)
                .map(|seat| SeatView {
                    index: seat.index,
                    name_fa: seat.name_fa.clone(),
                    ready: seat.ready,
                    connected: seat.connected,
                    is_host: seat.index == room.host_seat,
                    is_you: seat.index == viewer,
                })
                .collect(),
        }
    }

    fn publish(&mut self, room_id: &str) -> Option<RoomUpdate> {
        let seats = {
            let room = self.rooms.get(room_id)?;
            room.seats
                .iter()
                .filter(|seat| !seat.removed)
                .map(|seat| seat.index)
                .collect::<Vec<_>>()
        };
        let mut frames = Vec::with_capacity(seats.len());
        for seat in seats {
            if let Ok(frame) = self.snapshot(room_id, seat) {
                frames.push(frame);
            }
        }
        Some(RoomUpdate {
            room_id: room_id.to_string(),
            seats: frames,
        })
    }

    pub fn set_ready(
        &mut self,
        room_id: &str,
        seat_index: usize,
        ready: bool,
    ) -> Result<Vec<RoomUpdate>, GameFailure> {
        {
            let room = self
                .rooms
                .get_mut(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            if room.phase != "lobby" {
                return Err(GameFailure::new(
                    "GAME_IN_PROGRESS",
                    "این دست شروع شده است.",
                ));
            }
            let seat = room
                .seats
                .iter_mut()
                .find(|candidate| candidate.index == seat_index && !candidate.removed)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            seat.ready = ready;
            room.last_activity = Instant::now();
        }
        Ok(self.publish(room_id).into_iter().collect())
    }

    pub fn start(
        &mut self,
        room_id: &str,
        seat_index: usize,
    ) -> Result<Vec<RoomUpdate>, GameFailure> {
        let (game_id, players) = {
            let room = self
                .rooms
                .get(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            if room.phase != "lobby" {
                return Err(GameFailure::new(
                    "GAME_ALREADY_STARTED",
                    "این دست قبلاً شروع شده است.",
                ));
            }
            if seat_index != room.host_seat {
                return Err(GameFailure::new(
                    "HOST_ONLY",
                    "فقط میزبان می‌تواند بازی را شروع کند.",
                ));
            }
            let game = manifest(&room.game_id)
                .ok_or_else(|| GameFailure::new("GAME_UNKNOWN", "این بازی در دسترس نیست."))?;
            let active = room
                .seats
                .iter()
                .filter(|seat| !seat.removed)
                .collect::<Vec<_>>();
            if active.len() < game.min_players as usize {
                return Err(GameFailure::new(
                    "GAME_NEEDS_PLAYERS",
                    format!(
                        "این بازی دست‌کم {} بازیکن می‌خواهد.",
                        fa_number(game.min_players as usize)
                    ),
                ));
            }
            if !active.iter().all(|seat| seat.ready) {
                return Err(GameFailure::new(
                    "GAME_NOT_READY",
                    "همهٔ بازیکنان باید آماده باشند.",
                ));
            }
            (room.game_id.clone(), active.len())
        };

        let state = self
            .engine
            .create(&game_id, players)
            .map_err(engine_failure)?;
        let meta = self.engine.meta(&game_id).map_err(engine_failure)?;
        {
            let room = self.rooms.get_mut(room_id).expect("room exists");
            room.state = Some(state);
            room.meta = Some(meta);
            room.phase = "playing".to_string();
            room.deadline_ms = 0;
            room.last_activity = Instant::now();
        }
        self.arm_room(room_id);
        Ok(self.publish(room_id).into_iter().collect())
    }

    pub fn restart(
        &mut self,
        room_id: &str,
        seat_index: usize,
    ) -> Result<Vec<RoomUpdate>, GameFailure> {
        {
            let room = self
                .rooms
                .get_mut(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            if seat_index != room.host_seat {
                return Err(GameFailure::new(
                    "HOST_ONLY",
                    "فقط میزبان می‌تواند دست تازه بدهد.",
                ));
            }
            if room.phase == "playing" {
                return Err(GameFailure::new(
                    "GAME_IN_PROGRESS",
                    "این دست هنوز تمام نشده است.",
                ));
            }
            room.state = None;
            room.meta = None;
            room.phase = "lobby".to_string();
            room.deadline_ms = 0;
            room.next_tick = None;
            for seat in &mut room.seats {
                seat.ready = false;
            }
            room.last_activity = Instant::now();
        }
        Ok(self.publish(room_id).into_iter().collect())
    }

    pub fn apply_move(
        &mut self,
        room_id: &str,
        seat_index: usize,
        movement: Value,
    ) -> Result<MoveReply, GameFailure> {
        let (game_id, state) = {
            let room = self
                .rooms
                .get(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            if room.phase != "playing" {
                return Ok(MoveReply {
                    error: Some("این دست شروع نشده است.".to_string()),
                    updates: Vec::new(),
                });
            }
            let seat = room
                .seats
                .iter()
                .find(|seat| seat.index == seat_index && !seat.removed)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "شما در این دست نیستید."))?;
            if seat.removed {
                return Ok(MoveReply {
                    error: Some("شما در این دست نیستید.".to_string()),
                    updates: Vec::new(),
                });
            }
            (room.game_id.clone(), room.state.clone().unwrap_or_default())
        };

        let outcome = self
            .engine
            .apply_move(&game_id, &state, &movement.to_string(), seat_index)
            .map_err(engine_failure)?;
        if outcome.fatal {
            return Err(GameFailure::new("GAME_ERROR", "خطای غیرمنتظره در بازی."));
        }
        {
            let room = self.rooms.get_mut(room_id).expect("room exists");
            room.state = Some(outcome.state.clone());
            room.last_activity = Instant::now();
        }
        if let Some(key) = outcome.error {
            let message = self
                .engine
                .message(&key)
                .unwrap_or_else(|_| "این حرکت مجاز نیست.".to_string());
            return Ok(MoveReply {
                error: Some(message),
                updates: Vec::new(),
            });
        }

        let finished = winner(&outcome.state).is_some();
        if finished {
            if let Some(room) = self.rooms.get_mut(room_id) {
                room.phase = "over".to_string();
                room.deadline_ms = 0;
                room.next_tick = None;
            }
        } else {
            self.arm_room(room_id);
        }
        Ok(MoveReply {
            error: None,
            updates: self.publish(room_id).into_iter().collect(),
        })
    }

    pub fn set_connected(
        &mut self,
        room_id: &str,
        seat_index: usize,
        connected: bool,
    ) -> Result<Vec<RoomUpdate>, GameFailure> {
        {
            let room = self
                .rooms
                .get_mut(room_id)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            let phase = room.phase.clone();
            let seat = room
                .seats
                .iter_mut()
                .find(|seat| seat.index == seat_index && !seat.removed)
                .ok_or_else(|| GameFailure::new("GAME_SEAT_NOT_FOUND", "صندلی بازی پیدا نشد."))?;
            seat.connected = connected;
            seat.disconnect_at = if connected {
                None
            } else {
                Some(
                    Instant::now()
                        + if phase == "playing" {
                            PLAYING_GRACE
                        } else {
                            LOBBY_GRACE
                        },
                )
            };
            room.last_activity = Instant::now();
        }
        Ok(self.publish(room_id).into_iter().collect())
    }

    pub fn leave(
        &mut self,
        room_id: &str,
        seat_index: usize,
    ) -> Result<Vec<RoomUpdate>, GameFailure> {
        if let Some(room) = self.rooms.get_mut(room_id)
            && let Some(seat) = room.seats.iter_mut().find(|seat| seat.index == seat_index)
        {
            seat.connected = false;
        }
        Ok(self.remove_seat(room_id, seat_index).into_iter().collect())
    }

    fn remove_seat(&mut self, room_id: &str, seat_index: usize) -> Option<RoomUpdate> {
        let (phase, token_hash) = {
            let room = self.rooms.get(room_id)?;
            let seat = room
                .seats
                .iter()
                .find(|seat| seat.index == seat_index && !seat.removed)?;
            (room.phase.clone(), seat.token_hash.clone())
        };
        self.tokens.remove(&token_hash);

        if phase == "playing" {
            let (next_actor, has_set_actor, state, game_id) = {
                let room = self.rooms.get_mut(room_id)?;
                let seat = room
                    .seats
                    .iter_mut()
                    .find(|seat| seat.index == seat_index)?;
                seat.removed = true;
                seat.connected = false;
                seat.ready = false;
                let active = room
                    .seats
                    .iter()
                    .filter(|seat| !seat.removed)
                    .map(|seat| seat.index)
                    .collect::<Vec<_>>();
                if active.is_empty() {
                    self.rooms.remove(room_id);
                    return None;
                }
                if !active.contains(&room.host_seat) {
                    room.host_seat = active[0];
                }
                let next = active
                    .iter()
                    .copied()
                    .find(|index| *index > seat_index)
                    .unwrap_or(active[0]);
                (
                    next,
                    room.meta
                        .as_ref()
                        .is_some_and(|meta| meta.has_set_current_actor),
                    room.state.clone(),
                    room.game_id.clone(),
                )
            };
            if has_set_actor
                && let Some(state) = state
                && let Ok(updated) = self.engine.set_actor(&game_id, &state, next_actor)
                && let Some(room) = self.rooms.get_mut(room_id)
            {
                room.state = Some(updated);
            }
            self.arm_room(room_id);
            return self.publish(room_id);
        }

        {
            let room = self.rooms.get_mut(room_id)?;
            room.seats.retain(|seat| seat.index != seat_index);
            if room.seats.is_empty() {
                self.rooms.remove(room_id);
                return None;
            }
            for (position, seat) in room.seats.iter_mut().enumerate() {
                if seat.index != position {
                    self.tokens.remove(&seat.token_hash);
                    seat.index = position;
                    self.tokens
                        .insert(seat.token_hash.clone(), (room_id.to_string(), position));
                }
            }
            room.seats.sort_by_key(|seat| seat.index);
            if !room.seats.iter().any(|seat| seat.index == room.host_seat) {
                room.host_seat = room.seats[0].index;
            }
            room.last_activity = Instant::now();
        }
        self.publish(room_id)
    }

    fn arm_room(&mut self, room_id: &str) {
        let (game_id, state, meta, phase) = {
            let Some(room) = self.rooms.get(room_id) else {
                return;
            };
            (
                room.game_id.clone(),
                room.state.clone(),
                room.meta.clone(),
                room.phase.clone(),
            )
        };
        let Some(state) = state else {
            return;
        };
        if phase != "playing" {
            return;
        }
        let Some(meta) = meta else {
            return;
        };

        if meta.realtime && meta.has_tick {
            let interval = meta.tick_ms.max(200);
            if let Some(room) = self.rooms.get_mut(room_id) {
                room.deadline_ms = 0;
                room.next_tick = Some(Instant::now() + Duration::from_millis(interval as u64));
            }
            return;
        }

        if meta.has_deadline && meta.has_timeout {
            let deadline = self.engine.deadline(&game_id, &state).unwrap_or(0);
            if deadline > 0 {
                let delay = (deadline - now_ms()).max(250);
                if let Some(room) = self.rooms.get_mut(room_id) {
                    room.deadline_ms = deadline;
                    room.next_tick = Some(Instant::now() + Duration::from_millis(delay as u64));
                }
                return;
            }
        }
        if let Some(room) = self.rooms.get_mut(room_id) {
            room.deadline_ms = 0;
            room.next_tick = None;
        }
    }

    /// Advances disconnect grace, timers and idle rooms. Returns every room whose
    /// view changed and should be broadcast.
    pub fn tick(&mut self) -> Vec<RoomUpdate> {
        let now = Instant::now();
        let ids = self.rooms.keys().cloned().collect::<Vec<_>>();
        let mut updates = Vec::new();
        for id in ids {
            let expired = {
                let Some(room) = self.rooms.get(&id) else {
                    continue;
                };
                room.seats
                    .iter()
                    .filter(|seat| {
                        !seat.removed
                            && !seat.connected
                            && seat.disconnect_at.is_some_and(|deadline| deadline <= now)
                    })
                    .map(|seat| seat.index)
                    .collect::<Vec<_>>()
            };
            for seat in expired {
                if let Some(update) = self.remove_seat(&id, seat) {
                    updates.push(update);
                }
            }

            let idle = self.rooms.get(&id).is_some_and(|room| {
                !room
                    .seats
                    .iter()
                    .any(|seat| !seat.removed && seat.connected)
                    && now.duration_since(room.last_activity) >= ROOM_IDLE
            });
            if idle {
                self.drop_room(&id);
                continue;
            }

            let due_realtime = self
                .rooms
                .get(&id)
                .and_then(|room| room.next_tick)
                .is_some_and(|deadline| deadline <= now);
            if !due_realtime {
                continue;
            }

            let (game_id, state, meta, phase) = {
                let Some(room) = self.rooms.get(&id) else {
                    continue;
                };
                (
                    room.game_id.clone(),
                    room.state.clone(),
                    room.meta.clone(),
                    room.phase.clone(),
                )
            };
            if phase != "playing" {
                continue;
            }
            let (Some(state), Some(meta)) = (state, meta) else {
                continue;
            };
            if meta.realtime && meta.has_tick {
                let before = state.clone();
                let Ok(after) = self.engine.tick(&game_id, &state) else {
                    continue;
                };
                let changed = after != before;
                if let Some(room) = self.rooms.get_mut(&id) {
                    room.state = Some(after.clone());
                    if winner(&after).is_some() {
                        room.phase = "over".to_string();
                        room.deadline_ms = 0;
                        room.next_tick = None;
                    }
                }
                if winner(&after).is_none() {
                    self.arm_room(&id);
                }
                if changed && let Some(update) = self.publish(&id) {
                    updates.push(update);
                }
            } else if meta.has_deadline && meta.has_timeout {
                let Ok(after) = self.engine.timeout(&game_id, &state) else {
                    continue;
                };
                if let Some(room) = self.rooms.get_mut(&id) {
                    room.state = Some(after.clone());
                    if winner(&after).is_some() {
                        room.phase = "over".to_string();
                        room.deadline_ms = 0;
                        room.next_tick = None;
                    }
                }
                if winner(&after).is_none() {
                    self.arm_room(&id);
                }
                if let Some(update) = self.publish(&id) {
                    updates.push(update);
                }
            }
        }
        updates
    }

    fn drop_room(&mut self, room_id: &str) {
        if let Some(room) = self.rooms.remove(room_id) {
            for seat in room.seats {
                self.tokens.remove(&seat.token_hash);
            }
        }
    }
}

fn engine_failure(error: EngineError) -> GameFailure {
    tracing::error!("game engine error: {error}");
    GameFailure::new("GAME_ERROR", "خطای غیرمنتظره در بازی.")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn join(manager: &mut RoomManager, device: &str, name: &str) -> JoinReply {
        join_game(manager, "tictactoe", "table-1", device, name)
    }

    fn join_game(
        manager: &mut RoomManager,
        game_id: &str,
        table_id: &str,
        device: &str,
        name: &str,
    ) -> JoinReply {
        manager
            .join(JoinRequest {
                table_id: table_id.to_string(),
                table_name_fa: "میز یک".to_string(),
                epoch: "session-1".to_string(),
                game_id: game_id.to_string(),
                device_id: device.to_string(),
                name_fa: Some(name.to_string()),
            })
            .unwrap()
    }

    #[test]
    fn room_join_start_move_and_restart() {
        let mut manager = RoomManager::new().unwrap();
        let host = join(&mut manager, "device-1", "میزبان");
        let host_token = host.response["seatToken"].as_str().unwrap().to_string();
        let guest = join(&mut manager, "device-2", "مهمان");
        let room_id = host.response["room"]["roomId"]
            .as_str()
            .unwrap()
            .to_string();
        assert_eq!(host.response["room"]["seats"].as_array().unwrap().len(), 1);
        assert_eq!(guest.response["room"]["seats"].as_array().unwrap().len(), 2);
        assert_eq!(manager.resolve(&host_token).unwrap().0, room_id);

        manager.set_ready(&room_id, 0, true).unwrap();
        manager.set_ready(&room_id, 1, true).unwrap();
        manager.start(&room_id, 0).unwrap();
        let frame = manager.snapshot(&room_id, 0).unwrap();
        assert_eq!(frame.room["phase"], "playing");
        assert_eq!(frame.state.as_ref().unwrap()["currentPlayer"], 0);

        let refused = manager.apply_move(&room_id, 1, json!({"cell": 4})).unwrap();
        assert!(refused.error.is_some());
        for (cell, seat) in [(0, 0), (3, 1), (1, 0), (4, 1), (2, 0)] {
            let reply = manager
                .apply_move(&room_id, seat, json!({"cell": cell}))
                .unwrap();
            assert!(reply.error.is_none(), "{:?}", reply.error);
        }
        let frame = manager.snapshot(&room_id, 0).unwrap();
        assert_eq!(frame.room["phase"], "over");
        assert_eq!(frame.state.as_ref().unwrap()["winner"], 0);

        let updates = manager.restart(&room_id, 0).unwrap();
        assert!(!updates.is_empty());
        assert_eq!(
            manager.snapshot(&room_id, 0).unwrap().room["phase"],
            "lobby"
        );
    }

    #[test]
    fn leaving_the_lobby_frees_and_renumbers_the_seat() {
        let mut manager = RoomManager::new().unwrap();
        let host = join(&mut manager, "device-1", "میزبان");
        join(&mut manager, "device-2", "مهمان");
        let room_id = host.response["room"]["roomId"]
            .as_str()
            .unwrap()
            .to_string();
        manager.leave(&room_id, 0).unwrap();
        let frame = manager.snapshot(&room_id, 0).unwrap();
        assert_eq!(frame.room["seats"].as_array().unwrap().len(), 1);
        assert_eq!(frame.room["seats"][0]["nameFa"], "مهمان");
        assert_eq!(frame.room["hostSeat"], 0);
        assert_eq!(frame.room["seats"][0]["isHost"], true);
    }

    #[test]
    fn playing_room_keeps_indices_and_hands_the_host_to_a_survivor() {
        let mut manager = RoomManager::new().unwrap();
        let host = join(&mut manager, "device-1", "میزبان");
        join(&mut manager, "device-2", "مهمان");
        let room_id = host.response["room"]["roomId"]
            .as_str()
            .unwrap()
            .to_string();
        manager.set_ready(&room_id, 0, true).unwrap();
        manager.set_ready(&room_id, 1, true).unwrap();
        manager.start(&room_id, 0).unwrap();
        manager.leave(&room_id, 0).unwrap();
        let frame = manager.snapshot(&room_id, 1).unwrap();
        assert_eq!(frame.room["phase"], "playing");
        assert_eq!(frame.room["hostSeat"], 1);
        assert_eq!(frame.room["seats"].as_array().unwrap().len(), 1);
        assert_eq!(frame.room["seats"][0]["index"], 1);
    }

    #[test]
    fn phase_games_hide_roles_and_advance_on_timeout() {
        let mut manager = RoomManager::new().unwrap();
        let mut first = None;
        for index in 0..6 {
            let reply = join_game(
                &mut manager,
                "werewolf",
                "table-ww",
                &format!("device-{index}"),
                &format!("بازیکن {index}"),
            );
            if first.is_none() {
                first = Some(
                    reply.response["room"]["roomId"]
                        .as_str()
                        .unwrap()
                        .to_string(),
                );
            }
        }
        let room_id = first.unwrap();
        for seat in 0..6 {
            manager.set_ready(&room_id, seat, true).unwrap();
        }
        manager.start(&room_id, 0).unwrap();
        let raw: Value =
            serde_json::from_str(manager.rooms.get(&room_id).unwrap().state.as_ref().unwrap())
                .unwrap();
        let roles = raw["roles"].as_array().unwrap();
        let wolf = roles.iter().position(|role| role == "wolf").unwrap();
        let villager = roles.iter().position(|role| role == "villager").unwrap();
        let seat_zero = manager.snapshot(&room_id, wolf).unwrap();
        let seat_one = manager.snapshot(&room_id, villager).unwrap();
        let zero = seat_zero.state.as_ref().unwrap();
        let one = seat_one.state.as_ref().unwrap();
        assert_eq!(zero["phase"], "night_wolf");
        assert!(zero["myRole"].is_string());
        assert!(zero.get("chatAt").is_none());
        assert_eq!(zero["roles"].as_array().unwrap().len(), 6);
        assert_ne!(zero, one);
        assert_eq!(
            zero["roles"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|role| !role.is_null())
                .count(),
            2
        );
        assert_eq!(
            one["roles"]
                .as_array()
                .unwrap()
                .iter()
                .filter(|role| !role.is_null())
                .count(),
            1
        );
        assert_eq!(one["wolfVotes"], json!({}));
        assert!(seat_zero.room["deadline"].as_i64().unwrap() > 0);

        {
            let room = manager.rooms.get_mut(&room_id).unwrap();
            room.next_tick = Some(Instant::now() - Duration::from_secs(1));
        }
        let updates = manager.tick();
        assert!(!updates.is_empty());
        let after = manager.snapshot(&room_id, 0).unwrap().state.unwrap();
        assert_eq!(after["phase"], "night_witch");
        assert!(after["myRole"].is_string());
    }

    #[test]
    fn realtime_games_tick_and_project_each_board_privately() {
        let mut manager = RoomManager::new().unwrap();
        let host = join_game(&mut manager, "2048", "table-2048", "device-a", "یک");
        join_game(&mut manager, "2048", "table-2048", "device-b", "دو");
        let room_id = host.response["room"]["roomId"]
            .as_str()
            .unwrap()
            .to_string();
        manager.set_ready(&room_id, 0, true).unwrap();
        manager.set_ready(&room_id, 1, true).unwrap();
        manager.start(&room_id, 0).unwrap();
        let before = manager.snapshot(&room_id, 0).unwrap().state.unwrap();
        assert_eq!(before["board"].as_array().unwrap().len(), 4);
        assert_eq!(before["scores"].as_array().unwrap().len(), 2);

        let mut moved = false;
        for dir in ["left", "up", "right", "down"] {
            let reply = manager
                .apply_move(&room_id, 0, json!({ "dir": dir }))
                .unwrap();
            if reply.error.is_none() {
                moved = true;
                break;
            }
        }
        assert!(
            moved,
            "one of the four directions must move the seeded board"
        );
        let seat_zero = manager.snapshot(&room_id, 0).unwrap().state.unwrap();
        let seat_one = manager.snapshot(&room_id, 1).unwrap().state.unwrap();
        assert_ne!(seat_zero["board"], seat_one["board"]);
        assert_eq!(seat_zero["scores"], seat_one["scores"]);

        {
            let room = manager.rooms.get_mut(&room_id).unwrap();
            room.next_tick = Some(Instant::now() - Duration::from_secs(1));
        }
        manager.tick();
        let room = manager.rooms.get(&room_id).unwrap();
        assert_eq!(room.phase, "playing");
        assert!(room.next_tick.is_some_and(|next| next > Instant::now()));
    }

    #[test]
    fn a_lobby_seat_disappears_after_its_grace_period() {
        let mut manager = RoomManager::new().unwrap();
        let host = join(&mut manager, "device-1", "میزبان");
        let token = host.response["seatToken"].as_str().unwrap().to_string();
        let room_id = host.response["room"]["roomId"]
            .as_str()
            .unwrap()
            .to_string();
        manager.set_connected(&room_id, 0, false).unwrap();
        {
            let room = manager.rooms.get_mut(&room_id).unwrap();
            room.seats[0].disconnect_at = Some(Instant::now() - Duration::from_secs(1));
        }
        manager.tick();
        assert!(manager.resolve(&token).is_none());
        assert!(!manager.rooms.contains_key(&room_id));
    }
}

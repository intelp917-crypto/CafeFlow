//! Game room and engine port. The first wave ships the transport-neutral room
//! primitives; individual game engines are added in the games wave.

use std::collections::HashMap;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub id: String,
    pub name: String,
    pub is_ready: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub code: String,
    pub game_key: String,
    pub host_id: String,
    pub players: Vec<Player>,
    pub started: bool,
}

#[derive(Debug, Default, Clone)]
pub struct RoomRegistry {
    rooms: HashMap<String, Room>,
}

impl RoomRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn create(
        &mut self,
        code: impl Into<String>,
        game_key: impl Into<String>,
        host: Player,
    ) -> Room {
        let room = Room {
            code: code.into(),
            game_key: game_key.into(),
            host_id: host.id.clone(),
            players: vec![host],
            started: false,
        };
        self.rooms.insert(room.code.clone(), room.clone());
        room
    }

    pub fn get(&self, code: &str) -> Option<&Room> {
        self.rooms.get(code)
    }

    pub fn remove(&mut self, code: &str) -> Option<Room> {
        self.rooms.remove(code)
    }

    pub fn join(&mut self, code: &str, player: Player) -> Option<&Room> {
        let room = self.rooms.get_mut(code)?;
        if room.players.len() >= 8 || room.started {
            return None;
        }
        room.players.push(player);
        Some(room)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn room_lifecycle() {
        let mut registry = RoomRegistry::new();
        let host = Player {
            id: "1".into(),
            name: "میزبان".into(),
            is_ready: true,
        };
        registry.create("ABC123", "uno", host);
        let guest = Player {
            id: "2".into(),
            name: "مهمان".into(),
            is_ready: false,
        };
        assert_eq!(registry.join("ABC123", guest).unwrap().players.len(), 2);
        assert!(registry.remove("ABC123").is_some());
        assert!(registry.get("ABC123").is_none());
    }
}

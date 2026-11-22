//! Embedded game rules and in-memory table rooms for CafeFlow.

pub mod engine;
pub mod rooms;

pub use engine::{
    EngineError, GameEngine, GameManifest, GameMeta, MoveOutcome, is_game_id, manifest,
    manifest_list,
};
pub use rooms::{
    GameFailure, JoinReply, JoinRequest, MoveReply, RoomManager, RoomUpdate, RoomView, SeatFrame,
    SeatView,
};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedded_engine_runs_upstream_commonjs_rules() {
        assert_eq!(manifest_list().len(), 38);
        let mut engine = GameEngine::new().unwrap();
        let mut state = engine.create("tictactoe", 2).unwrap();
        for (cell, player) in [(0, 0), (3, 1), (1, 0), (4, 1), (2, 0)] {
            let outcome = engine
                .apply_move(
                    "tictactoe",
                    &state,
                    &format!(r#"{{"cell":{cell}}}"#),
                    player,
                )
                .unwrap();
            assert!(outcome.error.is_none(), "{:?}", outcome.error);
            state = outcome.state;
        }
        let value: serde_json::Value = serde_json::from_str(&state).unwrap();
        assert_eq!(value["winner"], 0);
    }

    #[test]
    fn every_manifest_game_can_be_initialized_and_viewed() {
        let mut engine = GameEngine::new().unwrap();
        for game in manifest_list() {
            let players = game.min_players.max(1) as usize;
            let state = engine
                .create(&game.id, players)
                .unwrap_or_else(|error| panic!("{}: {error}", game.id));
            serde_json::from_str::<serde_json::Value>(&state)
                .unwrap_or_else(|error| panic!("{} state: {error}", game.id));
            let meta = engine
                .meta(&game.id)
                .unwrap_or_else(|error| panic!("{} meta: {error}", game.id));
            if meta.has_player_view {
                for seat in 0..players {
                    let view = engine
                        .view(&game.id, &state, seat)
                        .unwrap_or_else(|error| panic!("{} view {seat}: {error}", game.id));
                    serde_json::from_str::<serde_json::Value>(&view)
                        .unwrap_or_else(|error| panic!("{} view {seat}: {error}", game.id));
                }
            }
        }
    }
}

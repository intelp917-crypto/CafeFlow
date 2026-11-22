//! Embedded rules host. The vendored CommonJS modules run inside Boa, a pure
//! Rust JavaScript engine; no Node process or native JS runtime is needed.

use std::sync::OnceLock;

use boa_engine::{Context, JsString, JsValue, Source, js_string};
use include_dir::{Dir, include_dir};
use serde::{Deserialize, Serialize};
use serde_json::Value;

static ASSETS: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/assets");
static MANIFEST: OnceLock<Vec<GameManifest>> = OnceLock::new();

const BOOTSTRAP: &str = include_str!("../assets/bootstrap.js");

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameManifest {
    pub id: String,
    pub name_fa: String,
    pub tagline_fa: String,
    pub description_fa: String,
    pub how_to_fa: String,
    pub category_fa: String,
    pub min_players: i64,
    pub max_players: i64,
    pub mode: String,
    pub playable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct GameMeta {
    pub realtime: bool,
    pub tick_ms: i64,
    pub has_tick: bool,
    pub has_deadline: bool,
    pub has_timeout: bool,
    pub has_current_actor: bool,
    pub has_set_current_actor: bool,
    pub has_pending_actors: bool,
    pub has_player_view: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MoveOutcome {
    pub state: String,
    pub error: Option<String>,
    pub fatal: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("engine bootstrap failed: {0}")]
    Bootstrap(String),
    #[error("game engine call failed: {0}")]
    Js(String),
    #[error("game state is not valid JSON: {0}")]
    Json(String),
}

pub fn manifest_list() -> &'static [GameManifest] {
    MANIFEST
        .get_or_init(|| {
            let raw = ASSETS
                .get_file("manifest.json")
                .and_then(|file| file.contents_utf8())
                .expect("games manifest asset is embedded");
            serde_json::from_str(raw).expect("games manifest is valid JSON")
        })
        .as_slice()
}

pub fn manifest(id: &str) -> Option<&'static GameManifest> {
    manifest_list().iter().find(|game| game.id == id)
}

pub fn is_game_id(id: &str) -> bool {
    manifest(id).is_some()
}

fn source_map() -> Result<String, EngineError> {
    let mut map = serde_json::Map::new();
    collect_sources(&ASSETS, &mut map);
    serde_json::to_string(&map).map_err(|error| EngineError::Bootstrap(error.to_string()))
}

fn collect_sources(directory: &Dir<'_>, map: &mut serde_json::Map<String, Value>) {
    for file in directory.files() {
        let path = file.path().to_string_lossy().replace('\\', "/");
        if path.ends_with(".js")
            && let Some(contents) = file.contents_utf8()
        {
            map.insert(path, Value::String(contents.to_string()));
        }
    }
    for child in directory.dirs() {
        collect_sources(child, map);
    }
}

pub struct GameEngine {
    context: Context,
}

impl GameEngine {
    pub fn new() -> Result<Self, EngineError> {
        let sources = source_map()?;
        let bootstrap = BOOTSTRAP.replacen("/*__SOURCES__*/", &sources, 1);
        let mut context = Context::default();
        context
            .eval(Source::from_bytes(bootstrap.as_bytes()))
            .map_err(|error| EngineError::Bootstrap(error.to_string()))?;
        Ok(Self { context })
    }

    fn call(&mut self, name: &str, args: &[JsValue]) -> Result<JsValue, EngineError> {
        let function = self
            .context
            .global_object()
            .get(js_string!(name), &mut self.context)
            .map_err(|error| EngineError::Js(error.to_string()))?;
        let callable = function
            .as_callable()
            .ok_or_else(|| EngineError::Js(format!("{name} is not callable")))?;
        callable
            .call(&JsValue::undefined(), args, &mut self.context)
            .map_err(|error| EngineError::Js(error.to_string()))
    }

    fn call_string(&mut self, name: &str, args: &[JsValue]) -> Result<String, EngineError> {
        let result = self.call(name, args)?;
        result
            .to_string(&mut self.context)
            .map(|value| value.to_std_string_escaped())
            .map_err(|error| EngineError::Js(error.to_string()))
    }

    pub fn meta(&mut self, id: &str) -> Result<GameMeta, EngineError> {
        let raw = self.call_string(
            "__cf_meta",
            &[JsValue::from(JsString::from(id.to_string()))],
        )?;
        serde_json::from_str(&raw).map_err(|error| EngineError::Json(error.to_string()))
    }

    pub fn message(&mut self, key: &str) -> Result<String, EngineError> {
        self.call_string(
            "__cf_message",
            &[JsValue::from(JsString::from(key.to_string()))],
        )
    }

    pub fn create(&mut self, id: &str, players: usize) -> Result<String, EngineError> {
        self.call_string(
            "__cf_create",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(players as i32),
            ],
        )
    }

    pub fn apply_move(
        &mut self,
        id: &str,
        state: &str,
        movement: &str,
        player: usize,
    ) -> Result<MoveOutcome, EngineError> {
        let raw = self.call_string(
            "__cf_move",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
                JsValue::from(JsString::from(movement.to_string())),
                JsValue::from(player as i32),
            ],
        )?;
        serde_json::from_str(&raw).map_err(|error| EngineError::Json(error.to_string()))
    }

    pub fn view(&mut self, id: &str, state: &str, player: usize) -> Result<String, EngineError> {
        self.call_string(
            "__cf_view",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
                JsValue::from(player as i32),
            ],
        )
    }

    pub fn current_actor(&mut self, id: &str, state: &str) -> Result<Option<usize>, EngineError> {
        let raw = self.call_string(
            "__cf_current_actor",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
            ],
        )?;
        if raw == "null" {
            Ok(None)
        } else {
            raw.parse::<usize>()
                .map(Some)
                .map_err(|error| EngineError::Json(error.to_string()))
        }
    }

    pub fn set_actor(
        &mut self,
        id: &str,
        state: &str,
        player: usize,
    ) -> Result<String, EngineError> {
        self.call_string(
            "__cf_set_actor",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
                JsValue::from(player as i32),
            ],
        )
    }

    pub fn pending_actors(&mut self, id: &str, state: &str) -> Result<Vec<usize>, EngineError> {
        let raw = self.call_string(
            "__cf_pending_actors",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
            ],
        )?;
        serde_json::from_str(&raw).map_err(|error| EngineError::Json(error.to_string()))
    }

    pub fn deadline(&mut self, id: &str, state: &str) -> Result<i64, EngineError> {
        let raw = self.call_string(
            "__cf_deadline",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
            ],
        )?;
        raw.parse::<i64>()
            .map_err(|error| EngineError::Json(error.to_string()))
    }

    pub fn timeout(&mut self, id: &str, state: &str) -> Result<String, EngineError> {
        self.call_string(
            "__cf_timeout",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
            ],
        )
    }

    pub fn tick(&mut self, id: &str, state: &str) -> Result<String, EngineError> {
        self.call_string(
            "__cf_tick",
            &[
                JsValue::from(JsString::from(id.to_string())),
                JsValue::from(JsString::from(state.to_string())),
            ],
        )
    }
}

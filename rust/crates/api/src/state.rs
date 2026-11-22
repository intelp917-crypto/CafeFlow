use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use cafeflow_db::Database;

use crate::config::Config;
use crate::games::GamesHub;

#[derive(Clone)]
pub struct AppState {
    pub db: Database,
    pub config: Arc<Config>,
    pub login_limiter: Arc<Mutex<SlidingWindowLimiter>>,
    pub request_limiter: Arc<Mutex<SlidingWindowLimiter>>,
    pub games_device_limiter: Arc<Mutex<SlidingWindowLimiter>>,
    pub games_ip_limiter: Arc<Mutex<SlidingWindowLimiter>>,
    pub games: GamesHub,
}

impl AppState {
    pub fn new(db: Database, config: Config) -> Self {
        let minutes = 10;
        Self {
            db,
            config: Arc::new(config),
            login_limiter: Arc::new(Mutex::new(SlidingWindowLimiter::new(
                Duration::from_secs(minutes * 60),
                60,
            ))),
            request_limiter: Arc::new(Mutex::new(SlidingWindowLimiter::new(
                Duration::from_secs(60),
                20,
            ))),
            games_device_limiter: Arc::new(Mutex::new(SlidingWindowLimiter::new(
                Duration::from_secs(60),
                30,
            ))),
            games_ip_limiter: Arc::new(Mutex::new(SlidingWindowLimiter::new(
                Duration::from_secs(60),
                120,
            ))),
            games: GamesHub::spawn(),
        }
    }
}

pub struct SlidingWindowLimiter {
    window: Duration,
    max_hits: usize,
    hits: HashMap<String, Vec<Instant>>,
}

impl SlidingWindowLimiter {
    pub fn new(window: Duration, max_hits: usize) -> Self {
        Self {
            window,
            max_hits,
            hits: HashMap::new(),
        }
    }

    pub fn hit(&mut self, key: &str) -> bool {
        let now = Instant::now();
        let cutoff = now - self.window;
        let history = self.hits.entry(key.to_string()).or_default();
        history.retain(|timestamp| *timestamp > cutoff);
        if history.len() >= self.max_hits {
            return false;
        }
        history.push(now);
        if self.hits.len() > 5_000 {
            self.hits
                .retain(|_, timestamps| timestamps.iter().any(|timestamp| *timestamp > cutoff));
        }
        true
    }
}

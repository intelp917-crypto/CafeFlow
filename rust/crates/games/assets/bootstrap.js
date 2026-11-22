// CommonJS loader for the vendored rule modules. Every source is injected by
// the Rust host; no filesystem, network or Node API is available here.
const __sources = /*__SOURCES__*/;
const __modules = Object.create(null);
const __games = Object.create(null);

function __normalize(base, request) {
  const raw = request.charAt(0) === '/' ? request : `${base}/${request}`;
  const parts = raw.split('/');
  const out = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function __resolve(base, request) {
  const path = __normalize(base, request);
  for (const candidate of [path, `${path}.js`, `${path}/index.js`]) {
    if (Object.prototype.hasOwnProperty.call(__sources, candidate)) return candidate;
  }
  throw new Error(`module not found: ${request} from ${base || '.'}`);
}

function __require(base, request) {
  const path = __resolve(base, request);
  const cached = __modules[path];
  if (cached) return cached.exports;
  const module = { exports: {} };
  __modules[path] = module;
  const directory = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  const factory = new Function('exports', 'module', 'require', __sources[path]);
  try {
    factory(module.exports, module, (next) => __require(directory, next));
  } catch (error) {
    delete __modules[path];
    throw error;
  }
  return module.exports;
}

const __applyPatch = __require('', 'patches.js').applyPatch;
const __messageFa = __require('', 'messages.js').messageFa;

// Some vendored rules use Math.random() in a sort comparator, which is not a
// total order. Boa's native sort panics on that; this stable insertion sort is
// tolerant and keeps those shuffles working exactly as an arbitrary shuffle.
const __nativeSort = Array.prototype.sort;
Array.prototype.sort = function (compare) {
  if (typeof compare !== 'function') return __nativeSort.call(this);
  const list = this;
  for (let index = 1; index < list.length; index += 1) {
    let cursor = index;
    while (cursor > 0 && compare(list[cursor - 1], list[cursor]) > 0) {
      const value = list[cursor];
      list[cursor] = list[cursor - 1];
      list[cursor - 1] = value;
      cursor -= 1;
    }
  }
  return list;
};

function __game(id) {
  if (!__games[id]) __games[id] = __applyPatch(id, __require('', `games/${id}.js`));
  return __games[id];
}

globalThis.__cf_meta = function (id) {
  const game = __game(id);
  return JSON.stringify({
    realtime: Boolean(game.realtime),
    tickMs: Number(game.tickMs) || 0,
    hasTick: typeof game.tick === 'function',
    hasDeadline: typeof game.getPhaseDeadline === 'function',
    hasTimeout: typeof game.onTimeout === 'function',
    hasCurrentActor: typeof game.getCurrentActor === 'function',
    hasSetCurrentActor: typeof game.setCurrentActor === 'function',
    hasPendingActors: typeof game.getPendingActors === 'function',
    hasPlayerView: typeof game.playerView === 'function',
  });
};

globalThis.__cf_message = function (key) {
  return __messageFa(key);
};

globalThis.__cf_create = function (id, players) {
  const game = __game(id);
  const state = game.createState();
  if (typeof game.initGame === 'function') game.initGame(state, players);
  return JSON.stringify(state);
};

globalThis.__cf_move = function (id, stateJson, moveJson, player) {
  const game = __game(id);
  const state = JSON.parse(stateJson);
  try {
    const error = game.handleMove(JSON.parse(moveJson) || {}, state, player);
    return JSON.stringify({ state: JSON.stringify(state), error: error || null, fatal: false });
  } catch (caught) {
    return JSON.stringify({
      state: JSON.stringify(state),
      error: String((caught && caught.message) || caught),
      fatal: true,
    });
  }
};

globalThis.__cf_view = function (id, stateJson, player) {
  const game = __game(id);
  if (typeof game.playerView !== 'function') return stateJson;
  return JSON.stringify(game.playerView(JSON.parse(stateJson), player));
};

globalThis.__cf_current_actor = function (id, stateJson) {
  const game = __game(id);
  if (typeof game.getCurrentActor !== 'function') return 'null';
  const value = game.getCurrentActor(JSON.parse(stateJson));
  return Number.isInteger(value) ? String(value) : 'null';
};

globalThis.__cf_set_actor = function (id, stateJson, player) {
  const game = __game(id);
  const state = JSON.parse(stateJson);
  if (typeof game.setCurrentActor === 'function') game.setCurrentActor(state, player);
  return JSON.stringify(state);
};

globalThis.__cf_pending_actors = function (id, stateJson) {
  const game = __game(id);
  if (typeof game.getPendingActors !== 'function') return '[]';
  const value = game.getPendingActors(JSON.parse(stateJson));
  return JSON.stringify(Array.isArray(value) ? value : []);
};

globalThis.__cf_deadline = function (id, stateJson) {
  const game = __game(id);
  if (typeof game.getPhaseDeadline !== 'function') return '0';
  const value = Number(game.getPhaseDeadline(JSON.parse(stateJson)));
  return Number.isFinite(value) && value > 0 ? String(Math.trunc(value)) : '0';
};

globalThis.__cf_timeout = function (id, stateJson) {
  const game = __game(id);
  const state = JSON.parse(stateJson);
  if (typeof game.onTimeout === 'function') game.onTimeout(state);
  return JSON.stringify(state);
};

globalThis.__cf_tick = function (id, stateJson) {
  const game = __game(id);
  const state = JSON.parse(stateJson);
  if (typeof game.tick === 'function') game.tick(state);
  return JSON.stringify(state);
};

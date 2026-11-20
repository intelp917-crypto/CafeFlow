import { afterEach, describe, expect, it, vi } from 'vitest';
import { RoomManager, type Room } from '../src/modules/games/room-manager';

const TABLE = { tableId: 'table-1', tableNameFa: 'میز ۱', epoch: 'session-1' };

function join(
  rooms: RoomManager,
  deviceId: string,
  gameId: 'tictactoe' | 'uno' | 'werewolf' | '2048' = 'tictactoe',
) {
  return rooms.join({ ...TABLE, gameId, deviceId });
}

function readyAll(rooms: RoomManager, room: Room): void {
  for (const seat of room.seats) rooms.setReady(room, seat, true);
}

let managers: RoomManager[] = [];

afterEach(() => {
  for (const manager of managers) manager.onModuleDestroy();
  managers = [];
});

function manager(): RoomManager {
  const instance = new RoomManager();
  managers.push(instance);
  return instance;
}

describe('RoomManager', () => {
  it('gives one device one seat, even on a second join', () => {
    const rooms = manager();
    const first = join(rooms, 'device-a');
    const again = join(rooms, 'device-a');

    expect(again.seat.index).toBe(first.seat.index);
    expect(first.room.seats).toHaveLength(1);
    expect(rooms.view(first.room, 0).seats).toHaveLength(1);
  });

  it('keeps a different table in a different room', () => {
    const rooms = manager();
    const one = join(rooms, 'device-a');
    const other = rooms.join({ ...TABLE, tableId: 'table-2', gameId: 'tictactoe', deviceId: 'device-b' });

    expect(other.room.id).not.toBe(one.room.id);
  });

  it('starts a new room when the table session changes', () => {
    const rooms = manager();
    const before = join(rooms, 'device-a');
    const after = rooms.join({ ...TABLE, epoch: 'session-2', gameId: 'tictactoe', deviceId: 'device-b' });

    expect(after.room.id).not.toBe(before.room.id);
  });

  it('refuses to start below the minimum player count', () => {
    const rooms = manager();
    const { room, seat } = join(rooms, 'device-a', 'werewolf');
    rooms.setReady(room, seat, true);

    expect(() => rooms.start(room, seat)).toThrowError(/دست‌کم/);
    expect(room.phase).toBe('lobby');
  });

  it('refuses to start until every guest is ready', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    join(rooms, 'device-b');
    rooms.setReady(host.room, host.seat, true);

    expect(() => rooms.start(host.room, host.seat)).toThrowError(/آماده/);
  });

  it('only the host may start, and a second start is refused without resetting the hand', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    const guest = join(rooms, 'device-b');
    readyAll(rooms, host.room);

    expect(() => rooms.start(host.room, guest.seat)).toThrowError(/میزبان/);

    rooms.start(host.room, host.seat);
    const state = host.room.state;
    expect(host.room.phase).toBe('playing');
    expect(() => rooms.start(host.room, host.seat)).toThrowError(/شروع شده/);
    expect(host.room.state).toBe(state);
  });

  it('moves the host to the next seat when the host leaves the lobby', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    const guest = join(rooms, 'device-b');

    rooms.markConnected(host.room, host.seat, false);
    rooms.leave(host.room, host.seat);

    const view = rooms.view(host.room, guest.seat.index);
    expect(view.seats).toHaveLength(1);
    expect(view.hostSeat).toBe(guest.seat.index);
    expect(view.seats[0]!.isHost).toBe(true);
  });

  it('drops the room when the last guest leaves', () => {
    const rooms = manager();
    const { room, seat } = join(rooms, 'device-a');

    rooms.markConnected(room, seat, false);
    rooms.leave(room, seat);

    expect(rooms.roomById(room.id)).toBeUndefined();
    expect(rooms.findSeatByToken('anything')).toBeUndefined();
  });

  it('never hands one seat another seat\'s cards', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a', 'uno');
    const guest = join(rooms, 'device-b', 'uno');
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);

    const hostState = rooms.stateFor(host.room, host.seat.index) as { hands: Array<Array<unknown> | null> };
    const guestState = rooms.stateFor(host.room, guest.seat.index) as { hands: Array<Array<unknown> | null> };

    expect(hostState.hands[host.seat.index]!.length).toBeGreaterThan(0);
    expect(hostState.hands[guest.seat.index]!.every((card) => card === null)).toBe(true);
    expect(guestState.hands[guest.seat.index]!.length).toBeGreaterThan(0);
    expect(guestState.hands[host.seat.index]!.every((card) => card === null)).toBe(true);
  });

  it('refuses a move from the seat that is not on turn, in Persian', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    const guest = join(rooms, 'device-b');
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);

    const refused = rooms.move(host.room, guest.seat, { cell: 0 });
    expect(refused).toBe('الان نوبت شما نیست.');

    expect(rooms.move(host.room, host.seat, { cell: 0 })).toBeNull();
    expect(rooms.move(host.room, guest.seat, { cell: 4 })).toBeNull();
  });

  it('ends the hand when a seat wins', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    const guest = join(rooms, 'device-b');
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);

    rooms.move(host.room, host.seat, { cell: 0 });
    rooms.move(host.room, guest.seat, { cell: 3 });
    rooms.move(host.room, host.seat, { cell: 1 });
    rooms.move(host.room, guest.seat, { cell: 4 });
    rooms.move(host.room, host.seat, { cell: 2 });

    expect(host.room.phase).toBe('over');
    expect((host.room.state as { winner: number }).winner).toBe(host.seat.index);
    expect(rooms.view(host.room, 0).seats[0]!.ready).toBe(true);
  });

  it('drives a timed phase game on its own deadline, and a race on a tick', () => {
    vi.useFakeTimers();
    try {
      const rooms = manager();

      // 2048 is a race: no phase deadline, but a tick keeps the room moving.
      const race = join(rooms, 'device-race', '2048');
      readyAll(rooms, race.room);
      rooms.start(race.room, race.seat);
      expect(race.room.phase).toBe('playing');
      expect(race.room.deadline).toBe(0);
      expect(race.room.timer).not.toBeNull();
      vi.advanceTimersByTime(700);
      expect(race.room.phase).toBe('playing');

      // Werewolf publishes a deadline and advances when it passes.
      const host = join(rooms, 'wolf-0', 'werewolf');
      for (let index = 1; index < 6; index += 1) join(rooms, `wolf-${index}`, 'werewolf');
      readyAll(rooms, host.room);
      rooms.start(host.room, host.seat);

      const state = host.room.state as { phase: string };
      expect(state.phase).toBe('night_wolf');
      expect(host.room.deadline).toBeGreaterThan(0);

      vi.advanceTimersByTime(41_000);
      expect((host.room.state as { phase: string }).phase).toBe('night_witch');
    } finally {
      vi.useRealTimers();
    }
  });

  it('gives each werewolf seat its own role and nobody else\'s', () => {
    const rooms = manager();
    const host = join(rooms, 'wolf-0', 'werewolf');
    for (let index = 1; index < 6; index += 1) join(rooms, `wolf-${index}`, 'werewolf');
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);

    const roles = (host.room.state as { roles: string[] }).roles;
    host.room.seats.forEach((seat) => {
      const view = rooms.stateFor(host.room, seat.index) as { myRole: string; roles: Array<string | null> };
      expect(view.myRole).toBe(roles[seat.index]);
      const other = (seat.index + 1) % 6;
      const otherIsWolf = roles[other] === 'wolf';
      if (!otherIsWolf) expect(view.roles[other]).toBeNull();
    });
  });

  it('refuses a second vote from the same seat', () => {
    const rooms = manager();
    const host = join(rooms, 'wolf-0', 'werewolf');
    for (let index = 1; index < 6; index += 1) join(rooms, `wolf-${index}`, 'werewolf');
    const guest = host.room.seats[1]!;
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);

    // Reach the vote phase without playing a whole day of discussion.
    Object.assign(host.room.state as Record<string, unknown>, {
      phase: 'vote',
      voters: [0, 1],
      voteCandidates: [0, 1],
      votes: {},
      winner: null,
    });

    expect(rooms.move(host.room, host.seat, { type: 'vote', target: 1 })).toBeNull();
    expect(rooms.move(host.room, host.seat, { type: 'vote', target: 0 })).toBe('این کار الان ممکن نیست.');
    expect(rooms.move(host.room, guest, { type: 'vote', target: 0 })).toBeNull();
  });

  it('plays the newly wired games through the same room path', () => {
    const rooms = manager();

    // گم وکو: یک مهره در مرکز
    const gomoku = join(rooms, 'gomoku-0', 'gomoku' as never);
    join(rooms, 'gomoku-1', 'gomoku' as never);
    readyAll(rooms, gomoku.room);
    rooms.start(gomoku.room, gomoku.seat);
    expect(rooms.move(gomoku.room, gomoku.seat, { row: 7, col: 7 })).toBeNull();
    expect((gomoku.room.state as { board: Array<Array<number | null>> }).board[7]![7]).toBe(0);

    // شطرنج: e2–e4
    const chess = join(rooms, 'chess-0', 'chess' as never);
    join(rooms, 'chess-1', 'chess' as never);
    readyAll(rooms, chess.room);
    rooms.start(chess.room, chess.seat);
    expect(
      rooms.move(chess.room, chess.seat, { from: { row: 6, col: 4 }, to: { row: 4, col: 4 }, promote: 'q' }),
    ).toBeNull();
    expect((chess.room.state as { moveHistory: unknown[] }).moveHistory).toHaveLength(1);

    // چکرز: حرکت سادهٔ مهرهٔ پایین
    const checkers = join(rooms, 'checkers-0', 'checkers' as never);
    join(rooms, 'checkers-1', 'checkers' as never);
    readyAll(rooms, checkers.room);
    rooms.start(checkers.room, checkers.seat);
    expect(
      rooms.move(checkers.room, checkers.seat, { from: { row: 5, col: 0 }, to: { row: 4, col: 1 } }),
    ).toBeNull();

    // سودوکو: تک‌نفره، راهنما یک خانه را پر می‌کند
    const sudoku = join(rooms, 'sudoku-0', 'sudoku' as never);
    readyAll(rooms, sudoku.room);
    rooms.start(sudoku.room, sudoku.seat);
    expect(rooms.move(sudoku.room, sudoku.seat, { type: 'hint' })).toBeNull();
    expect((sudoku.room.state as { counts: number[] }).counts[0]).toBe(1);

    // مین‌روبی: تک‌نفره، اولین خانه هیچ‌وقت مین نیست
    const mines = join(rooms, 'mines-0', 'minesweeper' as never);
    readyAll(rooms, mines.room);
    rooms.start(mines.room, mines.seat);
    expect(rooms.move(mines.room, mines.seat, { action: 'reveal', row: 0, col: 0 })).toBeNull();

    // بمب عددی: عددی که قطعاً بمب نیست
    const bomb = join(rooms, 'bomb-0', 'numberbomb' as never);
    join(rooms, 'bomb-1', 'numberbomb' as never);
    readyAll(rooms, bomb.room);
    rooms.start(bomb.room, bomb.seat);
    (bomb.room.state as { bomb: number }).bomb = 50;
    expect(rooms.move(bomb.room, bomb.seat, { guess: 1 })).toBeNull();
    expect((bomb.room.state as { low: number }).low).toBe(2);
  });

  it('drops a playing room once its last seat is gone', () => {
    const rooms = manager();
    const solo = join(rooms, 'solo-0', 'sudoku' as never);
    readyAll(rooms, solo.room);
    rooms.start(solo.room, solo.seat);

    rooms.markConnected(solo.room, solo.seat, false);
    rooms.leave(solo.room, solo.seat);

    // No seat left: the race must not keep ticking behind an empty table.
    expect(rooms.roomById(solo.room.id)).toBeUndefined();
  });

  it('does not broadcast a race tick that changed nothing', () => {
    vi.useFakeTimers();
    try {
      const rooms = manager();
      const solo = join(rooms, 'quiet-0', 'sudoku' as never);
      readyAll(rooms, solo.room);
      rooms.start(solo.room, solo.seat);

      let updates = 0;
      rooms.onUpdate(() => {
        updates += 1;
      });

      // Sudoku's tick is a no-op, so a quiet second must cost no frames.
      vi.advanceTimersByTime(2_000);
      expect(updates).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands the host badge over when the host leaves mid-game', () => {
    const rooms = manager();
    const host = join(rooms, 'host-0', 'gomoku' as never);
    const guest = join(rooms, 'host-1', 'gomoku' as never);
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);
    expect(host.room.hostSeat).toBe(host.seat.index);

    rooms.markConnected(host.room, host.seat, false);
    rooms.leave(host.room, host.seat);

    expect(host.room.hostSeat).toBe(guest.seat.index);
    expect(rooms.stateFor(host.room, guest.seat.index)).not.toBeNull();
  });

  it('never sends a seat the hidden state of the new games', () => {
    const rooms = manager();

    const sudoku = join(rooms, 'sudoku-hide', 'sudoku' as never);
    readyAll(rooms, sudoku.room);
    rooms.start(sudoku.room, sudoku.seat);
    const sudokuView = rooms.stateFor(sudoku.room, sudoku.seat.index) as Record<string, unknown>;
    expect(sudokuView.solution).toBeUndefined();
    expect(sudokuView.puzzle).toBeUndefined();

    const mines = join(rooms, 'mines-hide', 'minesweeper' as never);
    readyAll(rooms, mines.room);
    rooms.start(mines.room, mines.seat);
    const minesView = rooms.stateFor(mines.room, mines.seat.index) as Record<string, unknown>;
    expect(minesView.mines).toEqual([]);

    const bomb = join(rooms, 'bomb-hide', 'numberbomb' as never);
    join(rooms, 'bomb-hide-2', 'numberbomb' as never);
    readyAll(rooms, bomb.room);
    rooms.start(bomb.room, bomb.seat);
    const bombView = rooms.stateFor(bomb.room, bomb.seat.index) as Record<string, unknown>;
    expect(bombView.bomb).toBeNull();
  });

  it('returns to the lobby only through the host after a hand', () => {
    const rooms = manager();
    const host = join(rooms, 'device-a');
    const guest = join(rooms, 'device-b');
    readyAll(rooms, host.room);
    rooms.start(host.room, host.seat);
    host.room.phase = 'over';

    expect(() => rooms.restart(host.room, guest.seat)).toThrowError(/میزبان/);
    rooms.restart(host.room, host.seat);
    expect(host.room.phase).toBe('lobby');
    expect(host.room.state).toBeNull();
    expect(rooms.view(host.room, 0).seats.every((seat) => !seat.ready)).toBe(true);
  });
});

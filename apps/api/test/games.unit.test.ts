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

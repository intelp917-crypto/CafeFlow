import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, server, type TestContext } from './helpers';
import { attachGamesGateway } from '../src/modules/games/games.gateway';
import { RoomManager } from '../src/modules/games/room-manager';
import type { GameServerMessage } from '@cafeflow/shared';

let context: TestContext;
let port = 0;
let tableToken: string;
const sockets: WebSocket[] = [];

type Received = GameServerMessage & Record<string, any>;

async function connect(seatToken: string): Promise<{ socket: WebSocket; messages: Received[] }> {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/games?seat=${encodeURIComponent(seatToken)}`);
  const messages: Received[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as Received));
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', (error) => reject(error));
  });
  return { socket, messages };
}

async function waitFor(messages: Received[], predicate: (message: Received) => boolean): Promise<Received> {
  const started = Date.now();
  while (Date.now() - started < 3000) {
    const found = messages.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out; last messages: ${JSON.stringify(messages.slice(-4))}`);
}

async function joinAs(agent: ReturnType<typeof request.agent>, gameId: string) {
  const response = await agent
    .post('/api/v1/public/games/join')
    .send({ qrToken: tableToken, gameId });
  expect(response.status).toBe(201);
  return response.body as { seatToken: string; seat: number; room: { roomId: string } };
}

beforeAll(async () => {
  context = await createTestApp();
  tableToken = (
    context.db.prepare("SELECT token FROM qr_codes WHERE kind = 'table' LIMIT 1").get() as { token: string }
  ).token;

  await context.app.listen(0);
  attachGamesGateway(context.app);
  port = (context.app.getHttpServer().address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of sockets) {
    try {
      socket.terminate();
    } catch {
      // A socket that never finished its handshake has nothing to close.
    }
  }
  await context.close();
});

describe('games websocket', () => {
  it('closes a socket without a live seat token with the game code 4401', async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/games?seat=not-a-seat`);
    const code = await new Promise<number>((resolve) => {
      socket.on('close', (value) => resolve(value));
      socket.on('error', () => resolve(-1));
    });
    socket.terminate();
    // A readable close code is the only way a browser can tell "seat gone" from
    // "Wi-Fi dropped", so the handshake completes and then closes.
    expect(code).toBe(4401);
  });

  it('keeps the seat online while a second tab still holds it', async () => {
    // Its own game id keeps this room out of the tictactoe tests' two seats.
    const joined = await joinAs(request.agent(server(context.app)), 'gomoku');
    const first = await connect(joined.seatToken);
    const second = await connect(joined.seatToken);
    await waitFor(first.messages, (message) => message.type === 'room');

    const manager = context.app.get(RoomManager);
    first.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const room = manager.roomById(joined.room.roomId);
    expect(room?.seats[0]?.connected).toBe(true);
    second.socket.close();
  });

  it('frees the chair as soon as a guest leaves on purpose', async () => {
    const joined = await joinAs(request.agent(server(context.app)), 'checkers');
    const socket = await connect(joined.seatToken);
    await waitFor(socket.messages, (message) => message.type === 'room');

    const closed = new Promise<number>((resolve) => socket.socket.on('close', (value) => resolve(value)));
    socket.socket.send(JSON.stringify({ type: 'leave' }));

    expect(await closed).toBe(4400);
    const manager = context.app.get(RoomManager);
    expect(manager.roomById(joined.room.roomId)).toBeUndefined();
  });

  it('shows both phones the same room and lets the host start', async () => {
    const first = await joinAs(request.agent(server(context.app)), 'tictactoe');
    const second = await joinAs(request.agent(server(context.app)), 'tictactoe');

    const host = await connect(first.seatToken);
    const guest = await connect(second.seatToken);

    const hostRoom = await waitFor(host.messages, (message) => message.type === 'room');
    const guestRoom = await waitFor(guest.messages, (message) => message.type === 'room');
    expect(hostRoom.room.roomId).toBe(guestRoom.room.roomId);

    host.socket.send(JSON.stringify({ type: 'ready', ready: true }));
    guest.socket.send(JSON.stringify({ type: 'ready', ready: true }));

    await waitFor(
      host.messages,
      (message) => message.type === 'room' && message.room.seats.every((seat: { ready: boolean }) => seat.ready),
    );

    host.socket.send(JSON.stringify({ type: 'start' }));

    const hostState = await waitFor(host.messages, (message) => message.type === 'state');
    const guestState = await waitFor(guest.messages, (message) => message.type === 'state');
    expect(hostState.state.board).toHaveLength(9);
    expect(guestState.state.board).toHaveLength(9);
    expect(hostState.state.currentPlayer).toBe(first.seat);
  });

  it('refuses a move from the seat that is not on turn', async () => {
    const first = await joinAs(request.agent(server(context.app)), 'connect4');
    const second = await joinAs(request.agent(server(context.app)), 'connect4');

    const host = await connect(first.seatToken);
    const guest = await connect(second.seatToken);

    host.socket.send(JSON.stringify({ type: 'ready', ready: true }));
    guest.socket.send(JSON.stringify({ type: 'ready', ready: true }));
    await waitFor(
      host.messages,
      (message) =>
        message.type === 'room' &&
        message.room.seats.length === 2 &&
        message.room.seats.every((seat: { ready: boolean }) => seat.ready),
    );
    host.socket.send(JSON.stringify({ type: 'start' }));
    await waitFor(guest.messages, (message) => message.type === 'state');

    guest.socket.send(JSON.stringify({ type: 'move', move: { col: 0 } }));

    const refused = await waitFor(guest.messages, (message) => message.type === 'error');
    expect(refused.code).toBe('MOVE_REFUSED');
    expect(refused.message).toBe('الان نوبت شما نیست.');
  });

  it('refuses a socket while the games module is switched off', async () => {
    context.db
      .prepare(
        `INSERT INTO module_settings (key, is_enabled, updated_at) VALUES ('games', 0, ?)
         ON CONFLICT (key) DO UPDATE SET is_enabled = 0, updated_at = excluded.updated_at`,
      )
      .run(new Date().toISOString());

    try {
      // A token minted before the switch must not keep a room alive.
      const refused = await new Promise<boolean>((resolve) => {
        const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/games?seat=stale-seat`);
        socket.once('open', () => resolve(false));
        socket.once('error', () => resolve(true));
        socket.once('unexpected-response', () => resolve(true));
      });
      expect(refused).toBe(true);
    } finally {
      context.db.prepare("DELETE FROM module_settings WHERE key = 'games'").run();
    }
  });

  it('sends each seat its own hand and nobody else\'s', async () => {
    const first = await joinAs(request.agent(server(context.app)), 'uno');
    const second = await joinAs(request.agent(server(context.app)), 'uno');

    const host = await connect(first.seatToken);
    const guest = await connect(second.seatToken);

    host.socket.send(JSON.stringify({ type: 'ready', ready: true }));
    guest.socket.send(JSON.stringify({ type: 'ready', ready: true }));
    await waitFor(
      host.messages,
      (message) =>
        message.type === 'room' &&
        message.room.seats.length === 2 &&
        message.room.seats.every((seat: { ready: boolean }) => seat.ready),
    );
    host.socket.send(JSON.stringify({ type: 'start' }));

    const hostState = await waitFor(
      host.messages,
      (message) => message.type === 'state' && message.state.hands?.length === 2,
    );
    const guestState = await waitFor(
      guest.messages,
      (message) => message.type === 'state' && message.state.hands?.length === 2,
    );

    const hostHand = hostState.state.hands[first.seat];
    const guestHandInHostView = hostState.state.hands[second.seat];
    const guestHand = guestState.state.hands[second.seat];

    expect(hostHand.every((card: unknown) => card !== null)).toBe(true);
    expect(guestHandInHostView.every((card: unknown) => card === null)).toBe(true);
    expect(guestHand.every((card: unknown) => card !== null)).toBe(true);
    expect(hostState.state.deck.every((card: unknown) => card === null)).toBe(true);
  });
});

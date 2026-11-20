import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createTestApp, server, type TestContext } from './helpers';

let context: TestContext;
let tableToken: string;
let inactiveToken: string;
let promoToken: string | null;

function deviceCookie(): string {
  return `cafe_device=${randomUUID().replace(/-/g, '')}${randomUUID().replace(/-/g, '')}`;
}

beforeAll(async () => {
  context = await createTestApp();
  const db = context.db;

  tableToken = (db.prepare("SELECT token FROM qr_codes WHERE kind = 'table' LIMIT 1").get() as { token: string })
    .token;

  // A second table whose sticker was cancelled: the QR must stop working.
  const second = db
    .prepare(
      "SELECT q.token FROM qr_codes q JOIN dining_tables t ON t.id = q.table_id WHERE q.kind = 'table' AND q.token <> ? LIMIT 1",
    )
    .get(tableToken) as { token: string };
  inactiveToken = second.token;
  db.prepare('UPDATE qr_codes SET is_active = 0 WHERE token = ?').run(inactiveToken);

  const promo = db.prepare("SELECT token FROM qr_codes WHERE kind = 'promo' LIMIT 1").get() as
    | { token: string }
    | undefined;
  promoToken = promo?.token ?? null;
});

afterAll(async () => {
  await context.close();
});

describe('GET /public/games/catalog', () => {
  it('serves the Persian catalogue without a session', async () => {
    const response = await request(server(context.app)).get('/api/v1/public/games/catalog');
    expect(response.status).toBe(200);
    expect(response.body.games).toHaveLength(6);
    const ids = response.body.games.map((game: { id: string }) => game.id);
    expect(ids).toEqual(['tictactoe', 'connect4', 'reversi', 'uno', '2048', 'werewolf']);
    expect(response.body.games[0].nameFa).toBe('دوز');
  });
});

describe('POST /public/games/join', () => {
  it('rejects an unknown QR token', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: 'no-such-token', gameId: 'tictactoe' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('QR_NOT_FOUND');
  });

  it('rejects a QR whose sticker was cancelled', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: inactiveToken, gameId: 'tictactoe' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('QR_NOT_FOUND');
  });

  it('rejects a promo QR: only a table sticker is a room', async () => {
    if (!promoToken) return;
    const response = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: promoToken, gameId: 'tictactoe' });

    expect(response.status).toBe(404);
  });

  it('rejects a game that is not in the catalogue', async () => {
    const response = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: tableToken, gameId: 'chess' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('GAME_UNKNOWN');
  });

  it('puts two phones that scan the same table QR in one room', async () => {
    const first = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: tableToken, gameId: 'connect4' });
    const second = await request(server(context.app))
      .post('/api/v1/public/games/join')
      .set('Cookie', deviceCookie())
      .send({ qrToken: tableToken, gameId: 'connect4' });

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.room.roomId).toBe(second.body.room.roomId);
    expect(first.body.seat).toBe(0);
    expect(second.body.seat).toBe(1);
    expect(second.body.room.seats).toHaveLength(2);
    expect(first.body.seatToken).not.toBe(second.body.seatToken);
  });

  it('keeps one seat for a device that rejoins, instead of adding a second', async () => {
    // The agent keeps the `cafe_device` cookie the first join was issued.
    const phone = request.agent(server(context.app));
    const first = await phone
      .post('/api/v1/public/games/join')
      .send({ qrToken: tableToken, gameId: 'reversi', nameFa: 'سارا' });
    const again = await phone.post('/api/v1/public/games/join').send({ qrToken: tableToken, gameId: 'reversi' });

    expect(again.status).toBe(201);
    expect(again.body.seat).toBe(first.body.seat);
    expect(again.body.room.seats).toHaveLength(1);
    expect(again.body.room.seats[0].nameFa).toBe('سارا');
    expect(again.body.seatToken).not.toBe(first.body.seatToken);
  });
});

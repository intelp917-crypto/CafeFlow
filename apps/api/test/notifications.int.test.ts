import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  DEMO_PASSWORD,
  createTestApp,
  login,
  type TestContext,
} from './helpers';

type Agent = ReturnType<typeof request.agent>;

let context: TestContext;
let admin: Agent;
let cashier: Agent;
let cashier2: Agent;
let cashier2Id: string;
let roleNotificationId: string;

function insertNotification(entry: {
  id?: string;
  roleKey?: string;
  userId?: string;
  titleFa: string;
}): string {
  const id = entry.id ?? randomUUID();
  context.db
    .prepare(
      `INSERT INTO notifications (id, user_id, role_key, type, title_fa, body_fa)
       VALUES (?, ?, ?, 'test.notification', ?, NULL)`,
    )
    .run(id, entry.userId ?? null, entry.roleKey ?? null, entry.titleFa);
  return id;
}

async function unread(agent: Agent): Promise<number> {
  const response = await agent.get('/api/v1/notifications');
  expect(response.status).toBe(200);
  return response.body.unreadCount as number;
}

beforeAll(async () => {
  context = await createTestApp();
  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;

  const created = await admin.post('/api/v1/users').send({
    username: 'cashier2',
    fullName: 'صندوق‌دار دوم',
    password: 'Cashier2@12345',
    roleKeys: ['cashier'],
  });
  expect(created.status).toBe(201);
  cashier2Id = created.body.id as string;

  cashier = (await login(context.app, 'cashier', DEMO_PASSWORD)).agent;
  cashier2 = (await login(context.app, 'cashier2', 'Cashier2@12345')).agent;

  roleNotificationId = insertNotification({ roleKey: 'cashier', titleFa: 'اعلان مشترک صندوق' });
});

afterAll(async () => {
  await context.close();
});

describe('notification read state per user', () => {
  it('shows a role notification to everyone holding the role', async () => {
    const first = await cashier.get('/api/v1/notifications');
    const second = await cashier2.get('/api/v1/notifications');

    expect(first.body.items.some((row: { id: string }) => row.id === roleNotificationId)).toBe(true);
    expect(second.body.items.some((row: { id: string }) => row.id === roleNotificationId)).toBe(true);
    expect(first.body.unreadCount).toBe(1);
    expect(second.body.unreadCount).toBe(1);
  });

  it('marks the row read only for the user who opened it', async () => {
    const read = await cashier.post(`/api/v1/notifications/${roleNotificationId}/read`);
    expect(read.status).toBe(200);
    expect(read.body.isRead).toBe(true);
    expect(await unread(cashier)).toBe(0);

    const stillUnread = await cashier2.get('/api/v1/notifications?unread=1');
    expect(stillUnread.body.items.map((row: { id: string }) => row.id)).toContain(roleNotificationId);
    expect(stillUnread.body.unreadCount).toBe(1);
  });

  it('keeps personal notifications private to their owner', async () => {
    const personalId = insertNotification({
      userId: cashier2Id,
      titleFa: 'اعلان شخصی صندوق‌دار دوم',
    });

    const mine = await cashier2.get('/api/v1/notifications');
    expect(mine.body.items.some((row: { id: string }) => row.id === personalId)).toBe(true);

    const other = await cashier.get('/api/v1/notifications');
    expect(other.body.items.some((row: { id: string }) => row.id === personalId)).toBe(false);
  });

  it('read-all clears only the caller inbox', async () => {
    const secondRoleNotification = insertNotification({ roleKey: 'cashier', titleFa: 'اعلان دوم صندوق' });

    const cleared = await cashier.post('/api/v1/notifications/read-all');
    expect(cleared.status).toBe(200);
    expect(await unread(cashier)).toBe(0);

    const other = await cashier2.get('/api/v1/notifications?unread=1');
    expect(other.body.items.map((row: { id: string }) => row.id)).toContain(secondRoleNotification);
  });
});

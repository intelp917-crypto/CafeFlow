import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildXlsx } from '../src/modules/reports/xlsx';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  createTestApp,
  login,
  type TestContext,
} from './helpers';

type Agent = ReturnType<typeof request.agent>;

let context: TestContext;
let admin: Agent;

beforeAll(async () => {
  context = await createTestApp();
  admin = (await login(context.app, ADMIN_USERNAME, ADMIN_PASSWORD)).agent;
});

afterAll(async () => {
  await context.close();
});

describe('XLSX writer', () => {
  it('produces a stored zip with the workbook parts', () => {
    const workbook = buildXlsx([
      { name: 'پرداخت‌ها', rows: [['کد', 'مبلغ'], ['A1', 350000]] },
      { name: 'روزانه', rows: [['روز', 'فروش']] },
    ]);

    // Local file header signature of the first entry.
    expect(workbook.subarray(0, 4).toString('latin1')).toBe('PK\u0003\u0004');

    const raw = workbook.toString('latin1');
    for (const part of [
      '[Content_Types].xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
      'xl/_rels/workbook.xml.rels',
    ]) {
      expect(raw).toContain(part);
    }

    expect(raw).toContain('<v>350000</v>');
  });

  it('escapes XML in cell text and dedupes sheet names', () => {
    const workbook = buildXlsx([
      { name: 'same', rows: [['<b>&"x"</b>']] },
      { name: 'same', rows: [['ok']] },
    ]);

    const raw = workbook.toString('latin1');
    expect(raw).toContain('&lt;b&gt;&amp;&quot;x&quot;&lt;/b&gt;');
    expect(raw).toContain('name="same 2"');
  });
});

describe('GET /reports/payments.xlsx', () => {
  it('streams a spreadsheet attachment for the requested range', async () => {
    const response = await admin.get('/api/v1/reports/payments.xlsx?from=2026-01-01&to=2026-01-31');

    expect(response.status).toBe(200);
    expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(response.headers['content-disposition']).toContain('payments-2026-01-01-2026-01-31.xlsx');
  });

  it('refuses a backwards range', async () => {
    // The binary content type makes supertest skip JSON parsing, so only the
    // status is asserted here; the CSV endpoint covers the error payload.
    const response = await admin.get('/api/v1/reports/payments.xlsx?from=2026-02-01&to=2026-01-01');
    expect(response.status).toBe(400);
  });
});

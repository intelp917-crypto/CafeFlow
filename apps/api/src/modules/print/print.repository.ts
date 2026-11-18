import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PrintJob } from '@cafeflow/shared';
import { DB_SERVICE } from '../../common/tokens';
import { DatabaseService } from '../../db/database.service';

interface PrintJobRow {
  id: string;
  order_id: string;
  order_code: string | null;
  kind: string;
  status: string;
  attempts: number;
  error: string | null;
  payload_json: string | null;
  created_at: string;
  printed_at: string | null;
}

function toJob(row: PrintJobRow): PrintJob {
  let receipt: string[] = [];
  if (row.payload_json) {
    try {
      const parsed = JSON.parse(row.payload_json) as { lines?: unknown };
      if (Array.isArray(parsed.lines)) {
        receipt = parsed.lines.filter((line): line is string => typeof line === 'string');
      }
    } catch {
      receipt = [];
    }
  }

  return {
    id: row.id,
    orderId: row.order_id,
    orderCode: row.order_code,
    kind: row.kind,
    status: row.status,
    attempts: row.attempts,
    error: row.error,
    createdAt: row.created_at,
    printedAt: row.printed_at,
    receipt,
  };
}

const JOB_COLUMNS = `
  j.id, j.order_id, o.code AS order_code, j.kind, j.status, j.attempts, j.last_error AS error,
  j.payload_json, j.created_at, j.printed_at
`;

@Injectable()
export class PrintRepository {
  constructor(@Inject(DB_SERVICE) private readonly database: DatabaseService) {}

  findByDedupeKey(key: string): PrintJob | undefined {
    const row = this.database.get<PrintJobRow>(
      `SELECT ${JOB_COLUMNS} FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id WHERE j.job_key = ?`,
      [key],
    );
    return row ? toJob(row) : undefined;
  }

  findById(id: string): PrintJob | undefined {
    const row = this.database.get<PrintJobRow>(
      `SELECT ${JOB_COLUMNS} FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id WHERE j.id = ?`,
      [id],
    );
    return row ? toJob(row) : undefined;
  }

  insert(entry: {
    orderId: string;
    kind: string;
    dedupeKey: string;
    lines: string[];
    createdByUserId: string;
  }): PrintJob {
    const id = randomUUID();
    this.database.run(
      `INSERT INTO print_jobs (id, order_id, kind, job_key, payload_json, status, attempts, created_at)
       VALUES (?, ?, ?, ?, ?, 'queued', 0, ?)`,
      [
        id,
        entry.orderId,
        entry.kind,
        entry.dedupeKey,
        JSON.stringify({ lines: entry.lines, createdByUserId: entry.createdByUserId }),
        new Date().toISOString(),
      ],
    );
    const job = this.findById(id);
    if (!job) throw new Error('print job insert failed');
    return job;
  }

  list(status?: string): PrintJob[] {
    const rows = this.database.all<PrintJobRow>(
      `SELECT ${JOB_COLUMNS}
         FROM print_jobs j LEFT JOIN orders o ON o.id = j.order_id
        ${status ? 'WHERE j.status = ?' : ''}
        ORDER BY j.created_at ASC
        LIMIT 100`,
      status ? [status] : [],
    );
    return rows.map(toJob);
  }

  updateStatus(id: string, status: 'printed' | 'failed', error: string | null): PrintJob | undefined {
    const now = new Date().toISOString();
    this.database.run(
      `UPDATE print_jobs
          SET status = ?, last_error = ?, attempts = attempts + 1,
              printed_at = CASE WHEN ? = 'printed' THEN ? ELSE printed_at END
        WHERE id = ?`,
      [status, error, status, now, id],
    );
    return this.findById(id);
  }
}

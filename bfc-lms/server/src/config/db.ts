import pg from 'pg';
import { env } from './env';

const { Pool, types } = pg;

// Return temporal columns as raw strings (parity with the previous driver's
// dateStrings behaviour) so dayjs/formatting code downstream is unchanged.
types.setTypeParser(1082, (v) => v); // date
types.setTypeParser(1114, (v) => v); // timestamp
types.setTypeParser(1184, (v) => v); // timestamptz

export interface RowDataPacket {
  [column: string]: any;
}

export interface ExecuteResult {
  insertId: number;
  affectedRows: number;
}

function sslConfig(): pg.PoolConfig['ssl'] {
  if (!env.db.ssl) return undefined;
  // Verify by default. Trust a supplied CA (DB_SSL_CA) for managed providers;
  // DB_SSL_REJECT_UNAUTHORIZED=false is an explicit, scoped dev-only opt-out.
  return {
    rejectUnauthorized: env.db.sslRejectUnauthorized,
    ...(env.db.sslCa ? { ca: env.db.sslCa } : {}),
  };
}

function poolConfig(): pg.PoolConfig {
  const base: pg.PoolConfig = { max: env.db.connectionLimit };
  if (env.db.connectionString) {
    return { ...base, connectionString: env.db.connectionString, ssl: sslConfig() };
  }
  return {
    ...base,
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    database: env.db.database,
    ssl: sslConfig(),
  };
}

export const pool = new Pool(poolConfig());

/**
 * Translates the MySQL-flavoured SQL used across modules into Postgres:
 * strips backticks, maps CURDATE(), and renumbers `?` placeholders to $n
 * while leaving quoted string literals untouched.
 */
export function toPg(sql: string): string {
  let s = sql.replace(/`/g, '');
  s = s.replace(/\bCURDATE\(\)/gi, 'CURRENT_DATE');
  let out = '';
  let n = 0;
  let quote: string | null = null;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (quote) {
      out += ch;
      if (ch === quote) {
        if (s[i + 1] === quote) {
          out += s[i + 1];
          i += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      out += ch;
      continue;
    }
    if (ch === '?') {
      n += 1;
      out += `$${n}`;
      continue;
    }
    out += ch;
  }
  return out;
}

async function runExec(client: pg.PoolClient | pg.Pool, sql: string, params: unknown[]): Promise<ExecuteResult> {
  const isInsert = /^\s*INSERT/i.test(sql);
  const text = isInsert && !/\bRETURNING\b/i.test(sql) ? `${sql} RETURNING *` : sql;
  const result = await client.query(text, params as any[]);
  if (isInsert) {
    const id = (result.rows[0] as RowDataPacket | undefined)?.id;
    return { insertId: id === undefined || id === null ? 0 : Number(id), affectedRows: result.rowCount ?? 0 };
  }
  return { insertId: 0, affectedRows: result.rowCount ?? 0 };
}

export async function query<T extends RowDataPacket = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query(toPg(sql), params as any[]);
  return result.rows as T[];
}

export async function queryOne<T extends RowDataPacket = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ExecuteResult> {
  return runExec(pool, toPg(sql), params);
}

/** Narrows loosely-typed bind arrays at the driver boundary. */
export function sqlParams(params: unknown[]): any[] {
  return params as any[];
}

export interface TxClient {
  execute<R = any>(sql: string, params?: unknown[]): Promise<[R, any[]]>;
  query<R = any>(sql: string, params?: unknown[]): Promise<[R, any[]]>;
}

export async function withTransaction<T>(fn: (conn: TxClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const conn: TxClient = {
    async execute<R = any>(sql: string, params: unknown[] = []): Promise<[R, any[]]> {
      const text = toPg(sql);
      if (/^\s*SELECT/i.test(text)) {
        const result = await client.query(text, params as any[]);
        return [result.rows as R, []];
      }
      const result = await runExec(client, text, params);
      return [result as R, []];
    },
    async query<R = any>(sql: string, params: unknown[] = []): Promise<[R, any[]]> {
      const result = await client.query(toPg(sql), params as any[]);
      return [result.rows as R, []];
    },
  };
  try {
    await client.query('BEGIN');
    const outcome = await fn(conn);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function assertDatabaseReady(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
  } finally {
    client.release();
  }
}
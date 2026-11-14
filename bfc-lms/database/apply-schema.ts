import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

const serverRoot = path.resolve(__dirname, '../server');
dotenv.config({ path: path.join(serverRoot, '.env') });

function clientConfig(): pg.ClientConfig {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl:
        process.env.DB_SSL === 'true'
          ? { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
          : undefined,
    };
  }
  return {
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: Number(process.env.DB_PORT ?? 5432),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

async function main(): Promise<void> {
  const schemaPath = path.join(__dirname, 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new pg.Client(clientConfig());
  await client.connect();
  try {
    console.log('[schema] applying schema.sql (PostgreSQL) ...');
    await client.query(sql);
    const result = await client.query(
      "SELECT COUNT(*)::int AS total FROM information_schema.tables WHERE table_schema = 'public'",
    );
    console.log(`[schema] done — ${result.rows[0].total} tables present`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[schema] failed', error);
  process.exit(1);
});
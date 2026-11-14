import fs from 'node:fs';
import { createApp } from './app';
import { env, uploadDirs } from './config/env';
import { assertDatabaseReady, pool } from './config/db';

async function main(): Promise<void> {
  for (const dir of Object.values(uploadDirs)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  await assertDatabaseReady();
  const dbTarget = env.db.connectionString ? 'PostgreSQL (DATABASE_URL)' : `PostgreSQL ${env.db.host}:${env.db.port}/${env.db.database}`;
  console.log(`[db] connected to ${dbTarget}`);

  const app = createApp();
  const server = app.listen(env.port, '0.0.0.0', () => {
    console.log(`[api] BFC LMS API listening on http://0.0.0.0:${env.port}`);
    console.log(`[api] environment: ${env.nodeEnv}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n[api] ${signal} received, shutting down`);
    server.close();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[api] failed to start', error);
  process.exit(1);
});
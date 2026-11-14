import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import dayjs from 'dayjs';
import { env } from '../config/env';

export const backupsDir = path.join(env.storageDir, 'backups');

export interface BackupResult {
  fileName: string;
  relativePath: string;
  sizeBytes: number;
  createdAt: string;
  durationMs: number;
}

function resolvePgDump(): string {
  if (process.env.PG_DUMP_PATH) return process.env.PG_DUMP_PATH;
  const runtime = path.resolve(env.projectRoot, '..', '.runtime');
  if (fs.existsSync(runtime)) {
    const pgDir = fs.readdirSync(runtime).find((d) => d.startsWith('postgresql-'));
    if (pgDir) {
      const candidate = path.join(runtime, pgDir, 'bin', 'pg_dump.exe');
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return 'pg_dump';
}

/** Runs a logical pg_dump of the application database into storage/backups. */
export async function runBackup(): Promise<BackupResult> {
  fs.mkdirSync(backupsDir, { recursive: true });
  const started = Date.now();
  const fileName = `bfc_lms-${dayjs().format('YYYYMMDD-HHmmss')}.sql`;
  const absolute = path.join(backupsDir, fileName);

  const args = env.db.connectionString
    ? [env.db.connectionString, '-f', absolute, '--format=plain', '--no-owner', '--no-privileges']
    : [
        '-h', env.db.host,
        '-p', String(env.db.port),
        '-U', env.db.user,
        '-d', env.db.database,
        '-f', absolute,
        '--format=plain',
        '--no-owner',
        '--no-privileges',
      ];

  await new Promise<void>((resolve, reject) => {
    const child = spawn(resolvePgDump(), args, {
      env: { ...process.env, ...(env.db.connectionString ? {} : { PGPASSWORD: env.db.password }) },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
    child.on('error', (error) => { reject(error); });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else {
        fs.rmSync(absolute, { force: true });
        reject(new Error(`pg_dump exited with code ${code}: ${stderr.slice(0, 500)}`));
      }
    });
  });

  const stats = fs.statSync(absolute);
  return {
    fileName,
    relativePath: `backups/${fileName}`,
    sizeBytes: stats.size,
    createdAt: dayjs().format('YYYY-MM-DD HH:mm:ss'),
    durationMs: Date.now() - started,
  };
}

const BACKUP_NAME = /^bfc_lms-\d{8}-\d{6}\.sql$/;

export function isSafeBackupName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

export function backupAbsolutePath(name: string): string {
  if (!isSafeBackupName(name)) throw new Error('Invalid backup file name');
  const absolute = path.join(backupsDir, name);
  if (!absolute.startsWith(backupsDir + path.sep)) throw new Error('Invalid backup path');
  return absolute;
}

export interface BackupFileInfo {
  fileName: string;
  sizeBytes: number;
  createdAt: string;
}

export function listBackups(): BackupFileInfo[] {
  if (!fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((name) => isSafeBackupName(name))
    .map((name) => {
      const stats = fs.statSync(path.join(backupsDir, name));
      return { fileName: name, sizeBytes: stats.size, createdAt: dayjs(stats.mtime).format('YYYY-MM-DD HH:mm:ss') };
    })
    .sort((a, b) => (a.fileName < b.fileName ? 1 : -1));
}
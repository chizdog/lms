import path from 'node:path';
import dotenv from 'dotenv';

const serverRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(serverRoot, '.env') });

function required(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
}

function int(key: string, fallback: number): number {
  const raw = process.env[key];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(key: string, fallback: boolean): boolean {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int('PORT', 4000),
  clientOrigin: process.env.CLIENT_ORIGIN ?? 'http://localhost:5173',

  db: {
    connectionString: process.env.DATABASE_URL ?? '',
    ssl: bool('DB_SSL', false),
    sslCa: process.env.DB_SSL_CA ?? '',
    sslRejectUnauthorized: bool('DB_SSL_REJECT_UNAUTHORIZED', true),
    host: process.env.DB_HOST ?? '127.0.0.1',
    port: int('DB_PORT', 5432),
    user: process.env.DATABASE_URL ? '' : required('DB_USER'),
    password: process.env.DATABASE_URL ? '' : required('DB_PASSWORD'),
    database: process.env.DATABASE_URL ? '' : required('DB_NAME'),
    connectionLimit: int('DB_CONNECTION_LIMIT', 15),
  },

  session: {
    cookieName: process.env.SESSION_COOKIE_NAME ?? 'bfc_session',
    ttlHours: int('SESSION_TTL_HOURS', 12),
    // Secure cookies require HTTPS. Default on in production; set COOKIE_SECURE=false
    // for a plain-HTTP deployment (e.g. single-port Node behind no TLS yet).
    secure: bool('COOKIE_SECURE', process.env.NODE_ENV === 'production'),
  },

  storageDir: path.resolve(serverRoot, process.env.STORAGE_DIR ?? '../storage'),
  maxUploadBytes: int('MAX_UPLOAD_MB', 200) * 1024 * 1024,
  serverRoot,
  projectRoot: path.resolve(serverRoot, '..'),
};

export const uploadDirs = {
  videos: path.join(env.storageDir, 'uploads', 'videos'),
  documents: path.join(env.storageDir, 'uploads', 'documents'),
  images: path.join(env.storageDir, 'uploads', 'images'),
  thumbnails: path.join(env.storageDir, 'uploads', 'thumbnails'),
  certificates: path.join(env.storageDir, 'uploads', 'certificates'),
  exports: path.join(env.storageDir, 'uploads', 'exports'),
  imports: path.join(env.storageDir, 'imports'),
};
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env, uploadDirs } from '../config/env';
import { badRequest } from '../utils/errors';

export type UploadKind = 'video' | 'document' | 'image' | 'thumbnail' | 'import';

const ALLOWED: Record<UploadKind, { extensions: string[]; mimes: string[]; dir: string }> = {
  video: {
    extensions: ['.mp4', '.webm'],
    mimes: ['video/mp4', 'video/webm'],
    dir: uploadDirs.videos,
  },
  document: {
    extensions: ['.pdf', '.pptx', '.ppt', '.docx', '.doc'],
    mimes: [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ],
    dir: uploadDirs.documents,
  },
  image: {
    extensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp'],
    mimes: ['image/png', 'image/jpeg', 'image/gif', 'image/webp'],
    dir: uploadDirs.images,
  },
  thumbnail: {
    extensions: ['.png', '.jpg', '.jpeg', '.webp'],
    mimes: ['image/png', 'image/jpeg', 'image/webp'],
    dir: uploadDirs.thumbnails,
  },
  import: {
    extensions: ['.csv', '.xlsx'],
    mimes: ['text/csv', 'application/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/octet-stream'],
    dir: uploadDirs.imports,
  },
};

const tmpDir = path.join(env.storageDir, 'tmp');
fs.mkdirSync(tmpDir, { recursive: true });

export function uploadFor(kind: UploadKind) {
  return multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, tmpDir),
      filename: (_req, file, cb) => cb(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`),
    }),
    limits: { fileSize: env.maxUploadBytes, files: 1 },
    fileFilter: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const rule = ALLOWED[kind];
      if (!rule.extensions.includes(ext)) {
        cb(badRequest(`Unsupported file type "${ext}". Allowed: ${rule.extensions.join(', ')}`));
        return;
      }
      cb(null, true);
    },
  }).single('file');
}

/** Verifies the file's leading bytes match its claimed type, not just its name. */
export function assertFileSignature(filePath: string, ext: string): void {
  const fd = fs.openSync(filePath, 'r');
  const head = Buffer.alloc(16);
  try {
    fs.readSync(fd, head, 0, 16, 0);
  } finally {
    fs.closeSync(fd);
  }

  const starts = (bytes: number[], offset = 0) => bytes.every((b, i) => head[offset + i] === b);
  const ascii = (text: string, offset = 0) => head.subarray(offset, offset + text.length).toString('ascii') === text;

  let ok = false;
  switch (ext) {
    case '.pdf': ok = ascii('%PDF'); break;
    case '.png': ok = starts([0x89, 0x50, 0x4e, 0x47]); break;
    case '.jpg':
    case '.jpeg': ok = starts([0xff, 0xd8, 0xff]); break;
    case '.gif': ok = ascii('GIF8'); break;
    case '.webp': ok = ascii('RIFF') && ascii('WEBP', 8); break;
    case '.mp4': ok = ascii('ftyp', 4); break;
    case '.webm': ok = starts([0x1a, 0x45, 0xdf, 0xa3]); break;
    case '.docx':
    case '.pptx':
    case '.xlsx': ok = starts([0x50, 0x4b, 0x03, 0x04]); break;
    case '.doc':
    case '.ppt': ok = starts([0xd0, 0xcf, 0x11, 0xe0]); break;
    case '.csv': ok = true; break;
    default: ok = false;
  }

  if (!ok) {
    fs.unlinkSync(filePath);
    throw badRequest('File content does not match its extension. Upload rejected.');
  }
}

export function commitUpload(
  tempPath: string,
  kind: UploadKind,
): { storedName: string; relativePath: string; absolutePath: string; size: number } {
  const rule = ALLOWED[kind];
  const ext = path.extname(tempPath).toLowerCase();
  assertFileSignature(tempPath, ext);
  const storedName = `${randomUUID()}${ext}`;
  const absolutePath = path.join(rule.dir, storedName);
  fs.mkdirSync(rule.dir, { recursive: true });
  fs.renameSync(tempPath, absolutePath);
  const relativePath = path.relative(env.storageDir, absolutePath).split(path.sep).join('/');
  return { storedName, relativePath, absolutePath, size: fs.statSync(absolutePath).size };
}

export function discardUpload(tempPath: string | undefined): void {
  if (tempPath && fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
}

export function materialTypeForExt(ext: string): 'video' | 'pdf' | 'presentation' | 'document' | 'image' | 'other' {
  if (['.mp4', '.webm'].includes(ext)) return 'video';
  if (ext === '.pdf') return 'pdf';
  if (['.pptx', '.ppt'].includes(ext)) return 'presentation';
  if (['.docx', '.doc'].includes(ext)) return 'document';
  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) return 'image';
  return 'other';
}

export function resolveStoredPath(relativePath: string): string {
  const absolute = path.resolve(env.storageDir, relativePath);
  if (!absolute.startsWith(env.storageDir + path.sep)) {
    throw badRequest('Invalid storage path');
  }
  return absolute;
}
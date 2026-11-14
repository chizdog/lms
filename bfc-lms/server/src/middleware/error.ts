import type { NextFunction, Request, Response } from 'express';
import { MulterError } from 'multer';
import { AppError } from '../utils/errors';
import { env } from '../config/env';

interface MysqlError extends Error {
  code?: string;
  errno?: number;
  sqlMessage?: string;
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} does not exist` },
  });
}

export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof AppError) {
    res.status(error.status).json({
      error: { code: error.code, message: error.message, details: error.details ?? null },
    });
    return;
  }

  if (error instanceof MulterError) {
    const message =
      error.code === 'LIMIT_FILE_SIZE'
        ? `File exceeds the ${Math.round(env.maxUploadBytes / 1024 / 1024)}MB upload limit`
        : error.message;
    res.status(400).json({ error: { code: 'UPLOAD_ERROR', message } });
    return;
  }

  const mysqlError = error as MysqlError;
  if (mysqlError?.code === 'ER_DUP_ENTRY') {
    res.status(409).json({
      error: {
        code: 'DUPLICATE',
        message: 'A record with the same unique value already exists',
        details: env.isProduction ? null : mysqlError.sqlMessage,
      },
    });
    return;
  }
  if (mysqlError?.code === 'ER_NO_REFERENCED_ROW_2' || mysqlError?.code === 'ER_ROW_IS_REFERENCED_2') {
    res.status(409).json({
      error: {
        code: 'FK_CONSTRAINT',
        message: 'This record is linked to other data and cannot be changed that way',
      },
    });
    return;
  }

  console.error(`[error] ${req.method} ${req.path}`, error);
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
      details: env.isProduction ? null : String(mysqlError?.message ?? error),
    },
  });
}
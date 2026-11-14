import type { Request, RequestHandler, Response, NextFunction } from 'express';
import { execute } from '../config/db';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    fn(req, res, next).catch(next);
  };
}

export interface AuditEntry {
  action: string;
  entityType?: string;
  entityId?: string | number;
  description?: string;
  metadata?: Record<string, unknown>;
}

export function recordAudit(req: Request, entry: AuditEntry): void {
  const userId = req.auth?.userId ?? null;
  const ip = req.ip ?? null;
  const userAgent = (req.headers['user-agent'] ?? '').slice(0, 255);
  void execute(
    `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, ip_address, user_agent, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId,
      entry.action,
      entry.entityType ?? null,
      entry.entityId === undefined ? null : String(entry.entityId),
      entry.description ?? null,
      ip,
      userAgent,
      entry.metadata ? JSON.stringify(entry.metadata) : null,
    ],
  ).catch((error) => console.error('[audit] failed to write log', error));
}
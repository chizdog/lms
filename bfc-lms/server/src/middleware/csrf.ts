import type { NextFunction, Request, Response } from 'express';
import { forbidden, unauthorized } from '../utils/errors';

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Double-submit CSRF check. The token lives in the server-side session row and is
 * handed to the client at login; it must come back in a header, which a cross-site
 * form post cannot set. SameSite=Lax cookies block the cross-site request itself.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction): void {
  if (!MUTATING.has(req.method)) {
    next();
    return;
  }
  const auth = req.auth;
  if (!auth) {
    next(unauthorized());
    return;
  }
  const provided = req.headers['x-csrf-token'];
  if (typeof provided !== 'string' || provided.length === 0 || provided !== auth.csrfToken) {
    next(forbidden('Invalid or missing CSRF token'));
    return;
  }
  next();
}
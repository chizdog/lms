import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import dayjs from 'dayjs';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { env } from '../config/env';
import { loadAuthContext, requireAuth, hashToken } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requireAuthed } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { generateToken, hashPassword, verifyPassword } from '../utils/password';
import { badRequest, forbidden, notFound, tooManyRequests, unauthorized } from '../utils/errors';
import type { AuthContext } from '../types/express';

const MAX_FAILED_ATTEMPTS = 5;
const LOCK_MINUTES = 15;

interface UserRow extends RowDataPacket {
  id: number;
  username: string;
  email: string;
  password_hash: string;
  password_salt: string;
  is_active: number;
  must_change_password: number;
  failed_login_attempts: number;
  locked_until: string | null;
  employee_id: number;
  employee_active: number;
}

export function serializeAuth(auth: AuthContext) {
  return {
    userId: auth.userId,
    username: auth.username,
    roleId: auth.roleId,
    roleCode: auth.roleCode,
    roleName: auth.roleName,
    permissions: [...auth.permissions],
    scopedDepartmentIds: auth.scopedDepartmentIds,
    employee: auth.employee,
    csrfToken: auth.csrfToken,
  };
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.session.secure,
    path: '/',
    maxAge: env.session.ttlHours * 60 * 60 * 1000,
  };
}

const loginSchema = z.object({
  identifier: z.string().trim().min(1).max(150),
  password: z.string().min(1).max(200),
});

const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1).max(200),
    newPassword: z
      .string()
      .min(8, 'New password must be at least 8 characters')
      .max(200)
      .regex(/[A-Za-z]/, 'New password must contain a letter')
      .regex(/[0-9]/, 'New password must contain a number'),
    confirmPassword: z.string().min(1).max(200),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again later.' } },
});

export const authRouter = Router();

authRouter.post(
  '/login',
  loginLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { identifier, password } = req.body as z.infer<typeof loginSchema>;

    const user = await queryOne<UserRow>(
      `SELECT u.*, e.is_active AS employee_active FROM users u
       JOIN employees e ON e.id = u.employee_id
       WHERE u.username = ? OR u.email = ? LIMIT 1`,
      [identifier, identifier.toLowerCase()],
    );

    if (!user) {
      recordAudit(req, {
        action: 'auth.login_failed',
        entityType: 'user',
        description: `Unknown identifier: ${identifier}`,
      });
      throw unauthorized('Invalid username/email or password');
    }

    if (user.locked_until && dayjs(user.locked_until).isAfter(dayjs())) {
      throw tooManyRequests(
        `Account temporarily locked after ${MAX_FAILED_ATTEMPTS} failed attempts. Try again after ${dayjs(user.locked_until).format('HH:mm')}.`,
      );
    }

    if (!user.is_active || !user.employee_active) {
      throw forbidden('This account is deactivated. Contact your administrator.');
    }

    const valid = await verifyPassword(password, user.password_hash, user.password_salt);
    if (!valid) {
      const attempts = user.failed_login_attempts + 1;
      const shouldLock = attempts >= MAX_FAILED_ATTEMPTS;
      await execute(
        'UPDATE users SET failed_login_attempts = ?, locked_until = ? WHERE id = ?',
        [
          shouldLock ? 0 : attempts,
          shouldLock ? dayjs().add(LOCK_MINUTES, 'minute').format('YYYY-MM-DD HH:mm:ss') : null,
          user.id,
        ],
      );
      recordAudit(req, {
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        description: shouldLock ? 'Account locked after repeated failures' : 'Incorrect password',
      });
      throw unauthorized('Invalid username/email or password');
    }

    const token = generateToken(32);
    const csrfToken = generateToken(32);
    const expiresAt = dayjs().add(env.session.ttlHours, 'hour').format('YYYY-MM-DD HH:mm:ss');

    await execute(
      `INSERT INTO sessions (id, user_id, csrf_token, ip_address, user_agent, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        hashToken(token),
        user.id,
        csrfToken,
        req.ip ?? null,
        (req.headers['user-agent'] ?? '').slice(0, 255),
        expiresAt,
      ],
    );
    await execute(
      'UPDATE users SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?',
      [user.id],
    );

    const auth = await loadAuthContext(token);
    if (!auth) throw unauthorized('Could not establish session');

    res.cookie(env.session.cookieName, token, sessionCookieOptions());
    recordAudit(req, {
      action: 'auth.login',
      entityType: 'user',
      entityId: user.id,
      description: `${user.username} signed in`,
    });

    res.json({
      ...serializeAuth(auth),
      mustChangePassword: Boolean(user.must_change_password),
      expiresAt,
    });
  }),
);

authRouter.post(
  '/logout',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    await execute('UPDATE sessions SET revoked_at = NOW() WHERE id = ?', [auth.sessionId]);
    res.clearCookie(env.session.cookieName, { path: '/' });
    recordAudit(req, {
      action: 'auth.logout',
      entityType: 'user',
      entityId: auth.userId,
      description: `${auth.username} signed out`,
    });
    res.json({ success: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const user = await queryOne<RowDataPacket & { must_change_password: number }>(
      'SELECT must_change_password FROM users WHERE id = ?',
      [auth.userId],
    );
    res.json({
      ...serializeAuth(auth),
      mustChangePassword: Boolean(user?.must_change_password),
    });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  csrfProtection,
  validate(changePasswordSchema),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>;

    const user = await queryOne<UserRow>(
      'SELECT password_hash, password_salt FROM users WHERE id = ?',
      [auth.userId],
    );
    if (!user) throw notFound('User not found');

    const valid = await verifyPassword(currentPassword, user.password_hash, user.password_salt);
    if (!valid) throw badRequest('Current password is incorrect');
    if (currentPassword === newPassword) {
      throw badRequest('New password must be different from the current password');
    }

    const { hash, salt } = await hashPassword(newPassword);
    await execute(
      'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 0 WHERE id = ?',
      [hash, salt, auth.userId],
    );
    // Revoke every other session so a stolen cookie cannot outlive the password change.
    await execute(
      'UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND id <> ? AND revoked_at IS NULL',
      [auth.userId, auth.sessionId],
    );

    recordAudit(req, {
      action: 'auth.password_changed',
      entityType: 'user',
      entityId: auth.userId,
      description: 'Password changed; other sessions revoked',
    });
    res.json({ success: true });
  }),
);

authRouter.get(
  '/sessions',
  requireAuth,
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const rows = await query(
      `SELECT id, ip_address, user_agent, created_at, last_seen_at, expires_at
       FROM sessions
       WHERE user_id = ? AND revoked_at IS NULL AND expires_at > NOW()
       ORDER BY last_seen_at DESC`,
      [auth.userId],
    );
    res.json({
      items: rows.map((row) => ({
        id: row.id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        expiresAt: row.expires_at,
        isCurrent: row.id === auth.sessionId,
      })),
    });
  }),
);

authRouter.delete(
  '/sessions/:id',
  requireAuth,
  csrfProtection,
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const sessionId = String(req.params.id);
    const result = await execute(
      'UPDATE sessions SET revoked_at = NOW() WHERE id = ? AND user_id = ? AND revoked_at IS NULL',
      [sessionId, auth.userId],
    );
    if (result.affectedRows === 0) throw notFound('Session not found');
    recordAudit(req, {
      action: 'auth.session_revoked',
      entityType: 'session',
      entityId: sessionId,
      description: 'Session revoked by owner',
    });
    if (sessionId === auth.sessionId) res.clearCookie(env.session.cookieName, { path: '/' });
    res.json({ success: true });
  }),
);
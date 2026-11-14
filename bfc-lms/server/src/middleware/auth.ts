import { createHash } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { query, queryOne, execute, RowDataPacket } from '../config/db';
import { env } from '../config/env';
import { ROLE_CODES, type RoleCode } from '../config/permissions';
import { unauthorized } from '../utils/errors';
import type { AuthContext } from '../types/express';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

interface SessionRow extends RowDataPacket {
  session_id: string;
  csrf_token: string;
  expires_at: string;
  revoked_at: string | null;
  user_id: number;
  username: string;
  user_active: number;
  role_id: number;
  role_code: RoleCode;
  role_name: string;
  employee_id: number;
  employee_no: string;
  first_name: string;
  last_name: string;
  email: string;
  position: string | null;
  department_id: number | null;
  department_name: string | null;
  branch_id: number | null;
  branch_name: string | null;
  avatar_path: string | null;
  employee_active: number;
}

const SESSION_SQL = `
  SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.revoked_at,
         u.id AS user_id, u.username, u.is_active AS user_active,
         r.id AS role_id, r.code AS role_code, r.name AS role_name,
         e.id AS employee_id, e.employee_no, e.first_name, e.last_name, e.email,
         e.position, e.department_id, d.name AS department_name,
         e.branch_id, b.name AS branch_name, e.avatar_path,
         e.is_active AS employee_active
  FROM sessions s
  JOIN users u ON u.id = s.user_id
  JOIN roles r ON r.id = u.role_id
  JOIN employees e ON e.id = u.employee_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN branches b ON b.id = e.branch_id
  WHERE s.id = ?
  LIMIT 1
`;

export function readSessionToken(req: Request): string | null {
  const cookieToken = req.cookies?.[env.session.cookieName];
  if (typeof cookieToken === 'string' && cookieToken.length === 64) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    const bearer = header.slice(7).trim();
    if (bearer.length === 64) return bearer;
  }
  return null;
}

export async function loadAuthContext(token: string): Promise<AuthContext | null> {
  const row = await queryOne<SessionRow>(SESSION_SQL, [hashToken(token)]);
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) return null;
  if (!row.user_active || !row.employee_active) return null;

  const permissionRows = await query<RowDataPacket & { code: string }>(
    `SELECT p.code FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = ?`,
    [row.role_id],
  );

  let scopedDepartmentIds: number[] = [];
  if (row.role_code === ROLE_CODES.DEPT_ADMIN) {
    const scopeRows = await query<RowDataPacket & { department_id: number }>(
      'SELECT department_id FROM department_admins WHERE user_id = ?',
      [row.user_id],
    );
    scopedDepartmentIds = scopeRows.map((r) => r.department_id);
  }

  return {
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    userId: row.user_id,
    username: row.username,
    roleId: row.role_id,
    roleCode: row.role_code,
    roleName: row.role_name,
    permissions: new Set(permissionRows.map((r) => r.code)),
    scopedDepartmentIds,
    employee: {
      id: row.employee_id,
      employeeNo: row.employee_no,
      firstName: row.first_name,
      lastName: row.last_name,
      fullName: `${row.first_name} ${row.last_name}`,
      email: row.email,
      position: row.position,
      departmentId: row.department_id,
      departmentName: row.department_name,
      branchId: row.branch_id,
      branchName: row.branch_name,
      avatarPath: row.avatar_path,
    },
  };
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    if (!token) throw unauthorized();
    const auth = await loadAuthContext(token);
    if (!auth) throw unauthorized('Session expired or invalid. Please sign in again.');
    req.auth = auth;
    void execute('UPDATE sessions SET last_seen_at = NOW() WHERE id = ?', [auth.sessionId]).catch(
      () => undefined,
    );
    next();
  } catch (error) {
    next(error);
  }
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = readSessionToken(req);
    if (token) {
      const auth = await loadAuthContext(token);
      if (auth) req.auth = auth;
    }
    next();
  } catch (error) {
    next(error);
  }
}
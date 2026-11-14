import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, withTransaction, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset } from '../utils/query';
import { hashPassword, generateToken } from '../utils/password';
import { badRequest, conflict, notFound } from '../utils/errors';
import { PERMISSIONS, ROLE_CODES, ROLE_PERMISSIONS } from '../config/permissions';

export const usersRouter = Router();
usersRouter.use(requireAuth);

usersRouter.get(
  '/roles',
  requirePermission('user.view'),
  asyncHandler(async (_req, res) => {
    const roles = await query('SELECT id, code, name, description, is_system FROM roles ORDER BY id');
    const mappings = await query('SELECT role_id, permission_id FROM role_permissions');
    const permissions = await query('SELECT id, code, name, module FROM permissions ORDER BY module, code');
    const byRole: Record<number, string[]> = {};
    const permissionCodeById = new Map(permissions.map((p) => [p.id, p.code]));
    for (const mapping of mappings) {
      const code = permissionCodeById.get(mapping.permission_id);
      if (!code) continue;
      byRole[mapping.role_id] = byRole[mapping.role_id] ?? [];
      byRole[mapping.role_id].push(code);
    }
    res.json({
      roles: roles.map((role) => ({ ...role, permissions: byRole[role.id] ?? [] })),
      permissions,
    });
  }),
);

usersRouter.get(
  '/',
  requirePermission('user.view'),
  validate(paginationQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof paginationQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.search) {
      conditions.push('(u.username LIKE ? OR u.email LIKE ? OR e.first_name LIKE ? OR e.last_name LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like, like);
    }
    const where = conditions.join(' AND ');
    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM users u JOIN employees e ON e.id = u.employee_id WHERE ${where}`,
      params,
    );
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `SELECT u.id, u.username, u.email, u.is_active, u.must_change_password, u.last_login_at, u.created_at,
              u.role_id, r.code AS role_code, r.name AS role_name,
              e.id AS employee_id, e.employee_no, e.first_name, e.last_name, e.position,
              d.name AS department_name,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.revoked_at IS NULL AND s.expires_at > NOW()) AS active_sessions
       FROM users u
       JOIN employees e ON e.id = u.employee_id
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ${where} ORDER BY u.id LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paginate(rows.map((row) => ({
      id: row.id,
      username: row.username,
      email: row.email,
      isActive: Boolean(row.is_active),
      mustChangePassword: Boolean(row.must_change_password),
      lastLoginAt: row.last_login_at,
      createdAt: row.created_at,
      roleId: row.role_id,
      roleCode: row.role_code,
      roleName: row.role_name,
      employeeId: row.employee_id,
      employeeNo: row.employee_no,
      fullName: `${row.first_name} ${row.last_name}`,
      position: row.position,
      departmentName: row.department_name,
      activeSessions: Number(row.active_sessions),
    })), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

const roleUpdateBody = z.object({
  roleCode: z.enum([ROLE_CODES.SUPER_ADMIN, ROLE_CODES.LD_ADMIN, ROLE_CODES.HR_ADMIN, ROLE_CODES.DEPT_ADMIN, ROLE_CODES.EMPLOYEE]),
  scopedDepartmentIds: z.array(z.coerce.number().int().positive()).optional(),
});

usersRouter.put(
  '/:id/role',
  requirePermission('user.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(roleUpdateBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof roleUpdateBody>;
    if (id === auth.userId && body.roleCode !== ROLE_CODES.SUPER_ADMIN) {
      throw badRequest('You cannot remove your own Super Administrator role');
    }
    const role = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM roles WHERE code = ?', [body.roleCode]);
    if (!role) throw badRequest('Unknown role');

    await withTransaction(async (conn) => {
      await conn.execute('UPDATE users SET role_id = ? WHERE id = ?', [role.id, id]);
      await conn.execute('DELETE FROM department_admins WHERE user_id = ?', [id]);
      if (body.roleCode === ROLE_CODES.DEPT_ADMIN && body.scopedDepartmentIds?.length) {
        for (const departmentId of body.scopedDepartmentIds) {
          await conn.execute('INSERT INTO department_admins (user_id, department_id) VALUES (?, ?)', [id, departmentId]);
        }
      }
      // Role change invalidates existing sessions so permissions refresh immediately.
      await conn.execute('UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    });

    recordAudit(req, { action: 'user.role_changed', entityType: 'user', entityId: id, description: `Role set to ${body.roleCode}`, metadata: { scopedDepartmentIds: body.scopedDepartmentIds ?? [] } });
    res.json({ success: true });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('user.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const temporaryPassword = `Bfc-${generateToken(4)}`;
    const { hash, salt } = await hashPassword(temporaryPassword);
    const result = await execute(
      'UPDATE users SET password_hash = ?, password_salt = ?, must_change_password = 1 WHERE id = ?',
      [hash, salt, id],
    );
    if (result.affectedRows === 0) throw notFound('User not found');
    await execute('UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    recordAudit(req, { action: 'user.password_reset', entityType: 'user', entityId: id, description: 'Administrator reset password' });
    res.json({ temporaryPassword });
  }),
);

const activeBody = z.object({ isActive: z.boolean() });

usersRouter.put(
  '/:id/active',
  requirePermission('user.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(activeBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    if (id === auth.userId) throw badRequest('You cannot deactivate your own account');
    const body = req.body as z.infer<typeof activeBody>;
    const result = await execute('UPDATE users SET is_active = ? WHERE id = ?', [body.isActive ? 1 : 0, id]);
    if (result.affectedRows === 0) throw notFound('User not found');
    if (!body.isActive) {
      await execute('UPDATE sessions SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL', [id]);
    }
    recordAudit(req, { action: body.isActive ? 'user.activated' : 'user.deactivated', entityType: 'user', entityId: id, description: `Account ${body.isActive ? 'activated' : 'deactivated'}` });
    res.json({ success: true });
  }),
);

// --- Role permission editing (Super Admin) --------------------------------
const rolePermissionsBody = z.object({
  permissionCodes: z.array(z.string().min(1)).min(1),
});

usersRouter.put(
  '/roles/:id/permissions',
  requirePermission('role.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(rolePermissionsBody),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof rolePermissionsBody>;
    const role = await queryOne<RowDataPacket & { code: string }>('SELECT code FROM roles WHERE id = ?', [id]);
    if (!role) throw notFound('Role not found');
    if (role.code === ROLE_CODES.SUPER_ADMIN) throw badRequest('The Super Administrator role always retains full access');

    const known = new Set(PERMISSIONS.map((p) => p.code));
    const unknown = body.permissionCodes.filter((code) => !known.has(code));
    if (unknown.length > 0) throw badRequest(`Unknown permissions: ${unknown.join(', ')}`);

    await withTransaction(async (conn) => {
      await conn.execute('DELETE FROM role_permissions WHERE role_id = ?', [id]);
      for (const code of body.permissionCodes) {
        const permission = await conn.execute<RowDataPacket[]>('SELECT id FROM permissions WHERE code = ?', [code]).then(([r]) => r[0]);
        if (permission) await conn.execute('INSERT INTO role_permissions (role_id, permission_id) VALUES (?, ?)', [id, permission.id]);
      }
      await conn.execute(
        'UPDATE sessions SET revoked_at = NOW() WHERE user_id IN (SELECT id FROM users WHERE role_id = ?) AND revoked_at IS NULL',
        [id],
      );
    });

    recordAudit(req, { action: 'role.permissions_updated', entityType: 'role', entityId: id, description: `Updated permissions for ${role.code}`, metadata: { count: body.permissionCodes.length } });
    res.json({ success: true });
  }),
);
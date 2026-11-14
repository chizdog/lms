import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam } from '../utils/query';
import { conflict, notFound } from '../utils/errors';

export const organizationRouter = Router();
organizationRouter.use(requireAuth);

// --- Departments -----------------------------------------------------------
organizationRouter.get(
  '/departments',
  requirePermission('department.view'),
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT d.id, d.code, d.name, d.description, d.parent_id, d.is_active,
              (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.is_active = 1) AS employee_count,
              (SELECT COUNT(*) FROM courses c WHERE c.department_id = d.id) AS course_count
       FROM departments d ORDER BY d.name`,
    );
    res.json({ items: rows });
  }),
);

const departmentBody = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9-]+$/, 'Code may only contain letters, numbers and dashes'),
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional().nullable(),
  parentId: z.coerce.number().int().positive().optional().nullable(),
  isActive: z.boolean().default(true),
});

organizationRouter.post(
  '/departments',
  requirePermission('department.manage'),
  csrfProtection,
  validate(departmentBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof departmentBody>;
    const dup = await queryOne('SELECT id FROM departments WHERE code = ?', [body.code]);
    if (dup) throw conflict('Department code already exists');
    const id = await execute(
      'INSERT INTO departments (code, name, description, parent_id, is_active) VALUES (?, ?, ?, ?, ?)',
      [body.code.toUpperCase(), body.name, body.description ?? null, body.parentId ?? null, body.isActive ? 1 : 0],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'department.created', entityType: 'department', entityId: id, description: `Created department ${body.code}` });
    res.status(201).json({ id });
  }),
);

organizationRouter.put(
  '/departments/:id',
  requirePermission('department.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(departmentBody.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof departmentBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.code !== undefined) { fields.push('code = ?'); params.push(body.code.toUpperCase()); }
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.parentId !== undefined) { fields.push('parent_id = ?'); params.push(body.parentId); }
    if (body.isActive !== undefined) { fields.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }
    if (fields.length === 0) throw notFound('Nothing to update');
    const result = await execute(`UPDATE departments SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    if (result.affectedRows === 0) throw notFound('Department not found');
    recordAudit(req, { action: 'department.updated', entityType: 'department', entityId: id, description: `Updated department ${id}` });
    res.json({ success: true });
  }),
);

organizationRouter.delete(
  '/departments/:id',
  requirePermission('department.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inUse = await queryOne<RowDataPacket & { total: number }>(
      'SELECT (SELECT COUNT(*) FROM employees WHERE department_id = ?) + (SELECT COUNT(*) FROM courses WHERE department_id = ?) AS total',
      [id, id],
    );
    if (Number(inUse?.total ?? 0) > 0) throw conflict('Department still has employees or courses. Reassign them first.');
    const result = await execute('DELETE FROM departments WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Department not found');
    recordAudit(req, { action: 'department.deleted', entityType: 'department', entityId: id, description: `Deleted department ${id}` });
    res.json({ success: true });
  }),
);

// --- Branches --------------------------------------------------------------
organizationRouter.get(
  '/branches',
  requirePermission('branch.view'),
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT b.id, b.code, b.name, b.address, b.city, b.region, b.is_active,
              (SELECT COUNT(*) FROM employees e WHERE e.branch_id = b.id AND e.is_active = 1) AS employee_count
       FROM branches b ORDER BY b.name`,
    );
    res.json({ items: rows });
  }),
);

const branchBody = z.object({
  code: z.string().trim().min(1).max(30).regex(/^[A-Za-z0-9-]+$/),
  name: z.string().trim().min(1).max(120),
  address: z.string().trim().max(255).optional().nullable(),
  city: z.string().trim().max(80).optional().nullable(),
  region: z.string().trim().max(80).optional().nullable(),
  isActive: z.boolean().default(true),
});

organizationRouter.post(
  '/branches',
  requirePermission('branch.manage'),
  csrfProtection,
  validate(branchBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof branchBody>;
    const dup = await queryOne('SELECT id FROM branches WHERE code = ?', [body.code]);
    if (dup) throw conflict('Branch code already exists');
    const id = await execute(
      'INSERT INTO branches (code, name, address, city, region, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [body.code.toUpperCase(), body.name, body.address ?? null, body.city ?? null, body.region ?? null, body.isActive ? 1 : 0],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'branch.created', entityType: 'branch', entityId: id, description: `Created branch ${body.code}` });
    res.status(201).json({ id });
  }),
);

organizationRouter.put(
  '/branches/:id',
  requirePermission('branch.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(branchBody.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof branchBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.code !== undefined) { fields.push('code = ?'); params.push(body.code.toUpperCase()); }
    if (body.name !== undefined) { fields.push('name = ?'); params.push(body.name); }
    if (body.address !== undefined) { fields.push('address = ?'); params.push(body.address); }
    if (body.city !== undefined) { fields.push('city = ?'); params.push(body.city); }
    if (body.region !== undefined) { fields.push('region = ?'); params.push(body.region); }
    if (body.isActive !== undefined) { fields.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }
    if (fields.length === 0) throw notFound('Nothing to update');
    const result = await execute(`UPDATE branches SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    if (result.affectedRows === 0) throw notFound('Branch not found');
    recordAudit(req, { action: 'branch.updated', entityType: 'branch', entityId: id, description: `Updated branch ${id}` });
    res.json({ success: true });
  }),
);

organizationRouter.delete(
  '/branches/:id',
  requirePermission('branch.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inUse = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM employees WHERE branch_id = ?', [id]);
    if (Number(inUse?.total ?? 0) > 0) throw conflict('Branch still has employees. Reassign them first.');
    const result = await execute('DELETE FROM branches WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Branch not found');
    recordAudit(req, { action: 'branch.deleted', entityType: 'branch', entityId: id, description: `Deleted branch ${id}` });
    res.json({ success: true });
  }),
);
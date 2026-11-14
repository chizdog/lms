import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { paginationQuery, paginate, limitOffset } from '../utils/query';
import { badRequest, notFound } from '../utils/errors';
import { runBackup, listBackups, backupAbsolutePath, isSafeBackupName } from '../utils/backup';

export const systemRouter = Router();
systemRouter.use(requireAuth);

// --- Audit logs -------------------------------------------------------------
const auditQuery = paginationQuery.extend({
  action: z.string().trim().max(80).optional(),
  userId: z.coerce.number().int().positive().optional(),
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

systemRouter.get(
  '/audit',
  requirePermission('audit.view'),
  validate(auditQuery, 'query'),
  asyncHandler(async (req, res) => {
    const q = req.query as unknown as z.infer<typeof auditQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.action) { conditions.push('a.action = ?'); params.push(q.action); }
    if (q.userId) { conditions.push('a.user_id = ?'); params.push(q.userId); }
    if (q.dateFrom) { conditions.push('a.created_at >= ?'); params.push(`${q.dateFrom} 00:00:00`); }
    if (q.dateTo) { conditions.push('a.created_at <= ?'); params.push(`${q.dateTo} 23:59:59`); }
    if (q.search) {
      conditions.push('(a.action LIKE ? OR a.description LIKE ? OR a.entity_type LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like);
    }
    const where = conditions.join(' AND ');
    const total = await queryOne<RowDataPacket & { total: number }>(`SELECT COUNT(*) AS total FROM audit_logs a WHERE ${where}`, params);
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `SELECT a.id, a.action, a.entity_type, a.entity_id, a.description, a.ip_address, a.metadata, a.created_at,
              u.username, CONCAT(e.first_name, ' ', e.last_name) AS actor_name
       FROM audit_logs a
       LEFT JOIN users u ON u.id = a.user_id
       LEFT JOIN employees e ON e.id = u.employee_id
       WHERE ${where} ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paginate(rows.map((r) => ({
      id: r.id, action: r.action, entityType: r.entity_type, entityId: r.entity_id,
      description: r.description, ipAddress: r.ip_address,
      metadata: r.metadata ? (typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata) : null,
      createdAt: r.created_at,
      actor: r.username ? { username: r.username, name: r.actor_name } : null,
    })), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

systemRouter.get(
  '/audit/actions',
  requirePermission('audit.view'),
  asyncHandler(async (_req, res) => {
    const rows = await query('SELECT DISTINCT action FROM audit_logs ORDER BY action ASC');
    res.json({ items: rows.map((r) => r.action) });
  }),
);

// --- System settings --------------------------------------------------------
const EDITABLE_SETTINGS: Record<string, { type: 'string' | 'number' | 'boolean'; max?: number }> = {
  company_name: { type: 'string', max: 150 },
  certificate_signatory: { type: 'string', max: 150 },
  default_passing_score: { type: 'number', max: 100 },
  reminder_days_before_due: { type: 'number', max: 60 },
  email_notifications_enabled: { type: 'boolean' },
};

systemRouter.get(
  '/settings',
  requirePermission('settings.manage'),
  asyncHandler(async (_req, res) => {
    const rows = await query('SELECT setting_key, setting_value, description, updated_at FROM system_settings ORDER BY setting_key ASC');
    res.json({
      items: rows.map((r) => ({ key: r.setting_key, value: r.setting_value, description: r.description, updatedAt: r.updated_at })),
      editable: Object.keys(EDITABLE_SETTINGS),
    });
  }),
);

const settingsBody = z.object({
  settings: z.array(z.object({
    key: z.string().trim().regex(/^[a-z_]+$/).max(80),
    value: z.string().max(2000),
  })).min(1).max(20),
});

systemRouter.put(
  '/settings',
  requirePermission('settings.manage'),
  csrfProtection,
  validate(settingsBody),
  asyncHandler(async (req, res) => {
    const { settings } = req.body as z.infer<typeof settingsBody>;
    for (const item of settings) {
      const rule = EDITABLE_SETTINGS[item.key];
      if (!rule) throw badRequest(`Setting "${item.key}" is not editable`);
      if (rule.type === 'number') {
        const n = Number(item.value);
        if (!Number.isFinite(n) || n < 0 || (rule.max !== undefined && n > rule.max)) throw badRequest(`"${item.key}" must be a number between 0 and ${rule.max ?? '∞'}`);
      }
      if (rule.type === 'boolean' && !['true', 'false'].includes(item.value)) throw badRequest(`"${item.key}" must be true or false`);
      if (rule.type === 'string' && rule.max !== undefined && item.value.length > rule.max) throw badRequest(`"${item.key}" is too long`);
    }
    for (const item of settings) {
      await execute(
        `INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?)
         ON CONFLICT (setting_key) DO UPDATE SET setting_value = EXCLUDED.setting_value`,
        [item.key, item.value],
      );
    }
    recordAudit(req, { action: 'settings.updated', entityType: 'system_settings', description: `Updated ${settings.length} system setting(s)`, metadata: { keys: settings.map((s) => s.key) } });
    res.json({ success: true, updated: settings.length });
  }),
);

// --- Database backups -------------------------------------------------------
systemRouter.post(
  '/backup',
  requirePermission('backup.manage'),
  csrfProtection,
  asyncHandler(async (req, res) => {
    const result = await runBackup();
    recordAudit(req, { action: 'database.backup', entityType: 'backup', description: `Created database backup ${result.fileName}`, metadata: { sizeBytes: result.sizeBytes } });
    res.status(201).json(result);
  }),
);

systemRouter.get(
  '/backups',
  requirePermission('backup.manage'),
  asyncHandler(async (_req, res) => {
    res.json({ items: listBackups() });
  }),
);

systemRouter.get(
  '/backups/:name/download',
  requirePermission('backup.manage'),
  validate(z.object({ name: z.string().trim().max(80) }), 'params'),
  asyncHandler(async (req, res) => {
    const name = String(req.params.name);
    if (!isSafeBackupName(name)) throw badRequest('Invalid backup file name');
    const absolute = backupAbsolutePath(name);
    if (!fs.existsSync(absolute)) throw notFound('Backup file not found');
    res.setHeader('Content-Type', 'application/sql');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(absolute).pipe(res);
  }),
);

systemRouter.delete(
  '/backups/:name',
  requirePermission('backup.manage'),
  csrfProtection,
  validate(z.object({ name: z.string().trim().max(80) }), 'params'),
  asyncHandler(async (req, res) => {
    const name = String(req.params.name);
    if (!isSafeBackupName(name)) throw badRequest('Invalid backup file name');
    const absolute = backupAbsolutePath(name);
    if (!fs.existsSync(absolute)) throw notFound('Backup file not found');
    fs.unlinkSync(absolute);
    recordAudit(req, { action: 'database.backup_deleted', entityType: 'backup', description: `Deleted backup ${name}` });
    res.json({ success: true });
  }),
);
import { Router } from 'express';
import { z } from 'zod';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed } from '../middleware/rbac';
import { asyncHandler } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset } from '../utils/query';
import { notFound } from '../utils/errors';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth, requirePermission('notification.view'));

const listQuery = paginationQuery.extend({
  unreadOnly: z.enum(['true', 'false']).optional(),
  type: z
    .enum([
      'course_assigned',
      'deadline_reminder',
      'course_overdue',
      'course_completed',
      'assessment_result',
      'course_published',
      'certificate_issued',
    ])
    .optional(),
});

function serialize(row: RowDataPacket) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    message: row.message,
    link: row.link,
    isRead: Boolean(row.is_read),
    readAt: row.read_at,
    createdAt: row.created_at,
  };
}

notificationsRouter.get(
  '/',
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const conditions = ['user_id = ?'];
    const params: unknown[] = [auth.userId];
    if (q.unreadOnly === 'true') conditions.push('is_read = 0');
    if (q.type) { conditions.push('type = ?'); params.push(q.type); }

    const where = conditions.join(' AND ');
    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM notifications WHERE ${where}`,
      params,
    );
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `SELECT * FROM notifications WHERE ${where} ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paginate(rows.map(serialize), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

notificationsRouter.get(
  '/unread-count',
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const row = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM notifications WHERE user_id = ? AND is_read = 0',
      [auth.userId],
    );
    res.json({ unread: Number(row?.total ?? 0) });
  }),
);

notificationsRouter.put(
  '/read-all',
  csrfProtection,
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const result = await execute(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE user_id = ? AND is_read = 0',
      [auth.userId],
    );
    res.json({ updated: result.affectedRows });
  }),
);

notificationsRouter.put(
  '/:id/read',
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const result = await execute(
      'UPDATE notifications SET is_read = 1, read_at = NOW() WHERE id = ? AND user_id = ?',
      [id, auth.userId],
    );
    if (result.affectedRows === 0) throw notFound('Notification not found');
    res.json({ success: true });
  }),
);

notificationsRouter.delete(
  '/:id',
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const result = await execute('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, auth.userId]);
    if (result.affectedRows === 0) throw notFound('Notification not found');
    res.json({ success: true });
  }),
);
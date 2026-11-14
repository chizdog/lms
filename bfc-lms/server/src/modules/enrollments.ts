import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { execute, query, queryOne, withTransaction, RowDataPacket, ExecuteResult } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, employeeScope, hasOrgWideAccess } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset, safeSort } from '../utils/query';
import { badRequest, notFound } from '../utils/errors';
import { ROLE_CODES } from '../config/permissions';

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAuth);

const listQuery = paginationQuery.extend({
  courseId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  status: z.enum(['assigned', 'in_progress', 'completed']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});

enrollmentsRouter.get(
  '/',
  requirePermission('enrollment.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.courseId) { conditions.push('ce.course_id = ?'); params.push(q.courseId); }
    if (q.employeeId) { conditions.push('ce.employee_id = ?'); params.push(q.employeeId); }
    if (q.departmentId) { conditions.push('e.department_id = ?'); params.push(q.departmentId); }
    if (q.branchId) { conditions.push('e.branch_id = ?'); params.push(q.branchId); }
    if (q.status) { conditions.push('ce.status = ?'); params.push(q.status); }
    if (q.overdue === 'true') conditions.push("(ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed')");
    if (q.overdue === 'false') conditions.push("(ce.due_date IS NULL OR ce.due_date >= CURDATE() OR ce.status = 'completed')");
    if (q.search) {
      conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_no LIKE ? OR c.title LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like, like);
    }
    const scope = employeeScope(auth, 'e');
    if (scope.sql) { conditions.push(scope.sql.replace(/^ AND /, '')); params.push(...scope.params); }

    const where = conditions.join(' AND ');
    const sort = safeSort(q.sortBy, {
      dueDate: 'ce.due_date', progress: 'ce.progress_percent', employee: 'e.last_name', course: 'c.title', enrolledAt: 'ce.enrolled_at',
    }, 'ce.enrolled_at', 'desc');

    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM course_enrollments ce JOIN employees e ON e.id = ce.employee_id JOIN courses c ON c.id = ce.course_id WHERE ${where}`,
      params,
    );
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `SELECT ce.id, ce.status, ce.progress_percent, ce.due_date, ce.enrolled_at, ce.completed_at, ce.assignment_type,
              c.id AS course_id, c.title AS course_title, c.code AS course_code, c.course_type,
              e.id AS employee_id, e.employee_no, e.first_name, e.last_name, e.position,
              d.name AS department_name, b.name AS branch_name,
              (ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed') AS is_overdue
       FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id
       JOIN employees e ON e.id = ce.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       LEFT JOIN branches b ON b.id = e.branch_id
       WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paginate(rows.map((r) => ({
      id: r.id, status: r.status, progressPercent: Number(r.progress_percent), dueDate: r.due_date,
      enrolledAt: r.enrolled_at, completedAt: r.completed_at, assignmentType: r.assignment_type,
      isOverdue: Boolean(r.is_overdue),
      course: { id: r.course_id, title: r.course_title, code: r.course_code, courseType: r.course_type },
      employee: { id: r.employee_id, employeeNo: r.employee_no, name: `${r.first_name} ${r.last_name}`, position: r.position, departmentName: r.department_name, branchName: r.branch_name },
    })), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

const assignBody = z.object({
  courseId: z.coerce.number().int().positive(),
  targetType: z.enum(['individual', 'department', 'position', 'branch', 'all']),
  employeeIds: z.array(z.coerce.number().int().positive()).optional(),
  departmentIds: z.array(z.coerce.number().int().positive()).optional(),
  branchIds: z.array(z.coerce.number().int().positive()).optional(),
  position: z.string().trim().max(120).optional(),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

enrollmentsRouter.post(
  '/assign',
  requirePermission('enrollment.assign'),
  csrfProtection,
  validate(assignBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const body = req.body as z.infer<typeof assignBody>;
    const course = await queryOne<RowDataPacket & { title: string; status: string }>('SELECT title, status FROM courses WHERE id = ?', [body.courseId]);
    if (!course) throw notFound('Course not found');
    if (course.status !== 'published') throw badRequest('Only published courses can be assigned');

    const conditions: string[] = ['e.is_active = 1'];
    const params: unknown[] = [];
    switch (body.targetType) {
      case 'individual':
        if (!body.employeeIds?.length) throw badRequest('Select at least one employee');
        conditions.push(`e.id IN (${body.employeeIds.map(() => '?').join(',')})`);
        params.push(...body.employeeIds);
        break;
      case 'department':
        if (!body.departmentIds?.length) throw badRequest('Select at least one department');
        conditions.push(`e.department_id IN (${body.departmentIds.map(() => '?').join(',')})`);
        params.push(...body.departmentIds);
        break;
      case 'branch':
        if (!body.branchIds?.length) throw badRequest('Select at least one branch');
        conditions.push(`e.branch_id IN (${body.branchIds.map(() => '?').join(',')})`);
        params.push(...body.branchIds);
        break;
      case 'position':
        if (!body.position) throw badRequest('Provide a position');
        conditions.push('e.position = ?');
        params.push(body.position);
        break;
      case 'all':
        break;
    }

    // Department trainers may only assign within their authorized departments.
    if (auth.roleCode === ROLE_CODES.DEPT_ADMIN && !hasOrgWideAccess(auth)) {
      if (auth.scopedDepartmentIds.length === 0) throw badRequest('Your account has no authorized departments');
      conditions.push(`e.department_id IN (${auth.scopedDepartmentIds.map(() => '?').join(',')})`);
      params.push(...auth.scopedDepartmentIds);
    }

    const targets = await query<RowDataPacket & { id: number; user_id: number }>(
      `SELECT e.id, u.id AS user_id FROM employees e JOIN users u ON u.employee_id = e.id WHERE ${conditions.join(' AND ')}`,
      params,
    );
    if (targets.length === 0) throw badRequest('No active employees match the selected target');

    let created = 0;
    let skipped = 0;
    await withTransaction(async (conn) => {
      for (const target of targets) {
        const [existing] = await conn.execute<RowDataPacket[]>('SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?', [body.courseId, target.id]);
        if (existing.length > 0) { skipped += 1; continue; }
        const [result] = await conn.execute<ExecuteResult>(
          `INSERT INTO course_enrollments (course_id, employee_id, assigned_by, assignment_type, status, due_date) VALUES (?, ?, ?, ?, 'assigned', ?)`,
          [body.courseId, target.id, auth.userId, body.targetType, body.dueDate ?? null],
        );
        await conn.execute(
          `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'course_assigned', 'New training assigned', ?, ?)`,
          [target.user_id, `You have been assigned "${course.title}".${body.dueDate ? ` Complete it by ${body.dueDate}.` : ''}`, `/learner/courses/${body.courseId}`],
        );
        void result;
        created += 1;
      }
    });

    recordAudit(req, { action: 'training.assigned', entityType: 'course', entityId: body.courseId, description: `Assigned "${course.title}" to ${created} employees (${body.targetType})`, metadata: { created, skipped, targetType: body.targetType } });
    res.json({ created, skipped, total: targets.length });
  }),
);

enrollmentsRouter.put(
  '/:id',
  requirePermission('enrollment.assign'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(z.object({ dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await execute('UPDATE course_enrollments SET due_date = ? WHERE id = ?', [req.body.dueDate, id]);
    if (result.affectedRows === 0) throw notFound('Enrollment not found');
    recordAudit(req, { action: 'enrollment.deadline_updated', entityType: 'course_enrollment', entityId: id, description: `Deadline set to ${req.body.dueDate}` });
    res.json({ success: true });
  }),
);

enrollmentsRouter.delete(
  '/:id',
  requirePermission('enrollment.revoke'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const enrollment = await queryOne<RowDataPacket & { status: string }>('SELECT status FROM course_enrollments WHERE id = ?', [id]);
    if (!enrollment) throw notFound('Enrollment not found');
    if (enrollment.status === 'completed') throw badRequest('Completed training records cannot be removed');
    const result = await execute('DELETE FROM course_enrollments WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Enrollment not found');
    recordAudit(req, { action: 'enrollment.revoked', entityType: 'course_enrollment', entityId: id, description: `Removed assignment ${id}` });
    res.json({ success: true });
  }),
);

// Deadline reminders: notify learners whose training is due within N days.
enrollmentsRouter.post(
  '/send-reminders',
  requirePermission('enrollment.assign'),
  csrfProtection,
  asyncHandler(async (req, res) => {
    const setting = await queryOne<RowDataPacket & { setting_value: string }>("SELECT setting_value FROM system_settings WHERE setting_key = 'reminder_days_before_due'");
    const days = Number(setting?.setting_value ?? 3);
    const due = await query<RowDataPacket & { user_id: number; title: string; due_date: string; course_id: number }>(
      `SELECT u.id AS user_id, c.title, ce.due_date, c.id AS course_id
       FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id
       JOIN employees e ON e.id = ce.employee_id
       JOIN users u ON u.employee_id = e.id
       WHERE ce.status <> 'completed' AND ce.due_date IS NOT NULL
         AND ce.due_date BETWEEN CURRENT_DATE AND (CURRENT_DATE + (? * INTERVAL '1 day'))`,
      [days],
    );
    for (const row of due) {
      await execute(
        `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'deadline_reminder', 'Training deadline approaching', ?, ?)`,
        [row.user_id, `"${row.title}" is due on ${row.due_date}.`, `/learner/courses/${row.course_id}`],
      );
    }
    recordAudit(req, { action: 'training.reminders_sent', entityType: 'notification', description: `Sent ${due.length} deadline reminders` });
    res.json({ sent: due.length, windowDays: days });
  }),
);
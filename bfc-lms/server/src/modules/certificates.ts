import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import dayjs from 'dayjs';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, employeeScope, assertEmployeeAccess } from '../middleware/rbac';
import { resolveStoredPath } from '../middleware/upload';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset, safeSort } from '../utils/query';
import { badRequest, notFound } from '../utils/errors';
import { writeCertificatePdf } from '../utils/certificate-pdf';

export const certificatesRouter = Router();
certificatesRouter.use(requireAuth);

const CERT_SELECT = `
  SELECT cert.id, cert.certificate_number, cert.completion_date, cert.score, cert.signatory_name,
         cert.issued_at, cert.revoked_at, cert.file_path,
         e.id AS employee_id, e.employee_no, e.first_name, e.last_name, e.department_id,
         d.name AS department_name, b.name AS branch_name,
         c.id AS course_id, c.title AS course_title, c.code AS course_code
  FROM certificates cert
  JOIN employees e ON e.id = cert.employee_id
  JOIN courses c ON c.id = cert.course_id
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN branches b ON b.id = e.branch_id`;

function serialize(row: RowDataPacket) {
  return {
    id: row.id,
    certificateNumber: row.certificate_number,
    completionDate: row.completion_date,
    score: row.score === null ? null : Number(row.score),
    signatoryName: row.signatory_name,
    issuedAt: row.issued_at,
    revokedAt: row.revoked_at,
    isRevoked: Boolean(row.revoked_at),
    employee: {
      id: row.employee_id,
      employeeNo: row.employee_no,
      name: `${row.first_name} ${row.last_name}`,
      departmentName: row.department_name,
      branchName: row.branch_name,
    },
    course: { id: row.course_id, title: row.course_title, code: row.course_code },
  };
}

const listQuery = paginationQuery.extend({
  courseId: z.coerce.number().int().positive().optional(),
  employeeId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  includeRevoked: z.enum(['true', 'false']).optional(),
});

certificatesRouter.get(
  '/',
  requirePermission('certificate.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (q.includeRevoked !== 'true') conditions.push('cert.revoked_at IS NULL');
    if (q.courseId) { conditions.push('cert.course_id = ?'); params.push(q.courseId); }
    if (q.employeeId) { conditions.push('cert.employee_id = ?'); params.push(q.employeeId); }
    if (q.departmentId) { conditions.push('e.department_id = ?'); params.push(q.departmentId); }
    if (q.search) {
      conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_no LIKE ? OR c.title LIKE ? OR cert.certificate_number LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like, like, like);
    }
    const scope = employeeScope(auth, 'e');
    if (scope.sql) { conditions.push(scope.sql.replace(/^ AND /, '')); params.push(...scope.params); }

    const where = conditions.join(' AND ');
    const sort = safeSort(q.sortBy, {
      issuedAt: 'cert.issued_at', completionDate: 'cert.completion_date', employee: 'e.last_name', course: 'c.title',
    }, 'cert.issued_at', 'desc');

    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM certificates cert JOIN employees e ON e.id = cert.employee_id JOIN courses c ON c.id = cert.course_id WHERE ${where}`,
      params,
    );
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(`${CERT_SELECT} WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`, [...params, limit, offset]);
    res.json(paginate(rows.map(serialize), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

certificatesRouter.get(
  '/:id',
  requirePermission('certificate.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const scope = employeeScope(auth, 'e');
    const row = await queryOne(`${CERT_SELECT} WHERE cert.id = ? ${scope.sql}`, [id, ...scope.params]);
    if (!row) throw notFound('Certificate not found or outside your scope');
    res.json(serialize(row));
  }),
);

certificatesRouter.get(
  '/:id/download',
  requirePermission('certificate.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const scope = employeeScope(auth, 'e');
    const row = await queryOne<RowDataPacket & { file_path: string | null; certificate_number: string; revoked_at: string | null }>(
      `SELECT cert.file_path, cert.certificate_number, cert.revoked_at
       FROM certificates cert JOIN employees e ON e.id = cert.employee_id
       WHERE cert.id = ? ${scope.sql}`,
      [id, ...scope.params],
    );
    if (!row) throw notFound('Certificate not found or outside your scope');
    if (row.revoked_at) throw badRequest('This certificate has been revoked');
    if (!row.file_path) throw notFound('Certificate file is not available');
    const absolute = resolveStoredPath(row.file_path);
    if (!fs.existsSync(absolute)) throw notFound('Certificate file missing from storage');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${row.certificate_number}.pdf"`);
    res.setHeader('Cache-Control', 'private, no-store');
    fs.createReadStream(absolute).pipe(res);
  }),
);

const issueBody = z.object({ enrollmentId: z.coerce.number().int().positive() });

certificatesRouter.post(
  '/issue',
  requirePermission('certificate.issue'),
  csrfProtection,
  validate(issueBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const { enrollmentId } = req.body as z.infer<typeof issueBody>;
    const ctx = await queryOne<RowDataPacket & {
      employee_id: number; course_id: number; status: string; certificate_enabled: number;
      signatory_name: string | null; course_title: string; course_code: string; duration_minutes: number;
      first_name: string; last_name: string; employee_no: string;
    }>(
      `SELECT ce.employee_id, ce.course_id, ce.status, c.certificate_enabled, c.signatory_name,
              c.title AS course_title, c.code AS course_code, c.duration_minutes,
              e.first_name, e.last_name, e.employee_no
       FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id
       JOIN employees e ON e.id = ce.employee_id
       WHERE ce.id = ?`,
      [enrollmentId],
    );
    if (!ctx) throw notFound('Enrollment not found');
    await assertEmployeeAccess(auth, ctx.employee_id, async (eid) => {
      const r = await queryOne<RowDataPacket & { department_id: number | null }>('SELECT department_id FROM employees WHERE id = ?', [eid]);
      return r?.department_id ?? null;
    });
    if (ctx.status !== 'completed') throw badRequest('Certificates can only be issued for completed training');

    const existing = await queryOne<RowDataPacket & { id: number; certificate_number: string; revoked_at: string | null }>(
      'SELECT id, certificate_number, revoked_at FROM certificates WHERE employee_id = ? AND course_id = ?',
      [ctx.employee_id, ctx.course_id],
    );
    if (existing && !existing.revoked_at) {
      res.json({ id: existing.id, certificateNumber: existing.certificate_number, alreadyIssued: true });
      return;
    }

    const best = await queryOne<RowDataPacket & { percentage: string }>(
      `SELECT qa.percentage FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
       WHERE q.course_id = ? AND qa.employee_id = ? AND qa.passed = 1 ORDER BY qa.percentage DESC LIMIT 1`,
      [ctx.course_id, ctx.employee_id],
    );
    const completedAt = dayjs();
    const count = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM certificates');
    const certificateNumber = `BFC-CERT-${completedAt.format('YYYY')}-${String(Number(count?.total ?? 0) + 1).padStart(5, '0')}`;
    const score = best ? Number(best.percentage) : null;
    const signatory = ctx.signatory_name ?? 'Maria Santos, L&D Manager';
    const filePath = await writeCertificatePdf({
      certificateNumber,
      employeeName: `${ctx.first_name} ${ctx.last_name}`,
      employeeNo: ctx.employee_no,
      courseTitle: ctx.course_title,
      courseCode: ctx.course_code,
      completionDate: completedAt.format('MMMM D, YYYY'),
      score,
      signatoryName: signatory,
      durationMinutes: Number(ctx.duration_minutes),
    });

    let id: number;
    if (existing) {
      await execute(
        `UPDATE certificates SET certificate_number = ?, file_path = ?, completion_date = ?, score = ?, signatory_name = ?, issued_at = NOW(), revoked_at = NULL WHERE id = ?`,
        [certificateNumber, filePath, completedAt.format('YYYY-MM-DD'), score, signatory, existing.id],
      );
      id = existing.id;
    } else {
      id = await execute(
        `INSERT INTO certificates (certificate_number, employee_id, course_id, enrollment_id, file_path, completion_date, score, signatory_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [certificateNumber, ctx.employee_id, ctx.course_id, enrollmentId, filePath, completedAt.format('YYYY-MM-DD'), score, signatory],
      ).then((r) => r.insertId);
    }

    recordAudit(req, { action: 'certificate.issued', entityType: 'certificate', entityId: id, description: `Issued ${certificateNumber} for "${ctx.course_title}"` });
    res.status(201).json({ id, certificateNumber, alreadyIssued: false });
  }),
);

certificatesRouter.post(
  '/:id/revoke',
  requirePermission('certificate.revoke'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(z.object({ reason: z.string().trim().max(255).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const cert = await queryOne<RowDataPacket & { certificate_number: string; revoked_at: string | null }>(
      'SELECT certificate_number, revoked_at FROM certificates WHERE id = ?',
      [id],
    );
    if (!cert) throw notFound('Certificate not found');
    if (cert.revoked_at) throw badRequest('Certificate is already revoked');
    await execute('UPDATE certificates SET revoked_at = NOW() WHERE id = ?', [id]);
    recordAudit(req, { action: 'certificate.revoked', entityType: 'certificate', entityId: id, description: `Revoked ${cert.certificate_number}`, metadata: { reason: req.body.reason ?? null } });
    res.json({ success: true });
  }),
);
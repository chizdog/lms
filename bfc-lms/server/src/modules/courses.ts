import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import sharp from 'sharp';
import { execute, query, queryOne, withTransaction, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, hasOrgWideAccess, isLearnerOnly } from '../middleware/rbac';
import { uploadFor, commitUpload, discardUpload, resolveStoredPath } from '../middleware/upload';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset, safeSort } from '../utils/query';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';
import { ROLE_CODES } from '../config/permissions';

export const coursesRouter = Router();
coursesRouter.use(requireAuth);

// --- Categories ------------------------------------------------------------
coursesRouter.get(
  '/categories',
  requirePermission('category.view'),
  asyncHandler(async (_req, res) => {
    const rows = await query(
      `SELECT cc.id, cc.name, cc.slug, cc.description, cc.color, cc.sort_order, cc.is_active,
              (SELECT COUNT(*) FROM courses c WHERE c.category_id = cc.id) AS course_count
       FROM course_categories cc ORDER BY cc.sort_order, cc.name`,
    );
    res.json({ items: rows });
  }),
);

const categoryBody = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(255).optional().nullable(),
  color: z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).default('#C8952F'),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isActive: z.boolean().default(true),
});

const slugify = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

coursesRouter.post(
  '/categories',
  requirePermission('category.manage'),
  csrfProtection,
  validate(categoryBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof categoryBody>;
    const dup = await queryOne('SELECT id FROM course_categories WHERE name = ? OR slug = ?', [body.name, slugify(body.name)]);
    if (dup) throw conflict('Category already exists');
    const id = await execute(
      'INSERT INTO course_categories (name, slug, description, color, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?)',
      [body.name, slugify(body.name), body.description ?? null, body.color, body.sortOrder, body.isActive ? 1 : 0],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'category.created', entityType: 'course_category', entityId: id, description: `Created category ${body.name}` });
    res.status(201).json({ id });
  }),
);

coursesRouter.put(
  '/categories/:id',
  requirePermission('category.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(categoryBody.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof categoryBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.name !== undefined) { fields.push('name = ?', 'slug = ?'); params.push(body.name, slugify(body.name)); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.color !== undefined) { fields.push('color = ?'); params.push(body.color); }
    if (body.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(body.sortOrder); }
    if (body.isActive !== undefined) { fields.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }
    if (fields.length === 0) throw badRequest('Nothing to update');
    const result = await execute(`UPDATE course_categories SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    if (result.affectedRows === 0) throw notFound('Category not found');
    recordAudit(req, { action: 'category.updated', entityType: 'course_category', entityId: id, description: `Updated category ${id}` });
    res.json({ success: true });
  }),
);

coursesRouter.delete(
  '/categories/:id',
  requirePermission('category.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const inUse = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM courses WHERE category_id = ?', [id]);
    if (Number(inUse?.total ?? 0) > 0) throw conflict('Category still has courses. Reassign them first.');
    const result = await execute('DELETE FROM course_categories WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Category not found');
    recordAudit(req, { action: 'category.deleted', entityType: 'course_category', entityId: id, description: `Deleted category ${id}` });
    res.json({ success: true });
  }),
);

// --- Course list -----------------------------------------------------------
const courseListQuery = paginationQuery.extend({
  categoryId: z.coerce.number().int().positive().optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  status: z.enum(['draft', 'published', 'archived']).optional(),
  courseType: z.enum(['mandatory', 'optional']).optional(),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).optional(),
  mine: z.enum(['true', 'false']).optional(),
});

coursesRouter.get(
  '/',
  requirePermission('course.view'),
  validate(courseListQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const q = req.query as unknown as z.infer<typeof courseListQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (isLearnerOnly(auth)) {
      conditions.push("(c.status = 'published' OR EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.employee_id = ?))");
      params.push(auth.employee.id);
    } else if (q.status) {
      conditions.push('c.status = ?');
      params.push(q.status);
    }
    if (q.categoryId) { conditions.push('c.category_id = ?'); params.push(q.categoryId); }
    if (q.departmentId) { conditions.push('c.department_id = ?'); params.push(q.departmentId); }
    if (q.courseType) { conditions.push('c.course_type = ?'); params.push(q.courseType); }
    if (q.difficulty) { conditions.push('c.difficulty = ?'); params.push(q.difficulty); }
    if (q.search) {
      conditions.push('(c.title LIKE ? OR c.code LIKE ? OR c.description LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like);
    }
    if (q.mine === 'true') {
      conditions.push('EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.employee_id = ?)');
      params.push(auth.employee.id);
    }
    if (auth.roleCode === ROLE_CODES.DEPT_ADMIN && !hasOrgWideAccess(auth)) {
      // Department trainers see their own department's courses plus the shared catalogue.
      if (auth.scopedDepartmentIds.length > 0) {
        const placeholders = auth.scopedDepartmentIds.map(() => '?').join(',');
        conditions.push(`(c.department_id IS NULL OR c.department_id IN (${placeholders}) OR c.created_by = ?)`);
        params.push(...auth.scopedDepartmentIds, auth.userId);
      }
    }

    const where = conditions.join(' AND ');
    const sort = safeSort(q.sortBy, {
      title: 'c.title', code: 'c.code', createdAt: 'c.created_at', duration: 'c.duration_minutes', enrollments: 'enrollment_count',
    }, 'c.created_at', q.sortDir === 'asc' ? 'desc' : q.sortDir);

    const total = await queryOne<RowDataPacket & { total: number }>(`SELECT COUNT(*) AS total FROM courses c WHERE ${where}`, params);
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `SELECT c.id, c.code, c.title, c.description, c.category_id, cc.name AS category_name, cc.color AS category_color,
              c.department_id, d.name AS department_name, c.thumbnail_path, c.instructor_name, c.duration_minutes,
              c.difficulty, c.course_type, c.target_audience, c.status, c.certificate_enabled, c.signatory_name, c.published_at, c.created_at,
              (SELECT COUNT(*) FROM course_modules m WHERE m.course_id = c.id) AS module_count,
              (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id) AS lesson_count,
              (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id) AS enrollment_count,
              (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.status = 'completed') AS completed_count,
              (SELECT ce.status FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.employee_id = ? LIMIT 1) AS my_status,
              (SELECT ce.progress_percent FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.employee_id = ? LIMIT 1) AS my_progress,
              (SELECT ce.id FROM course_enrollments ce WHERE ce.course_id = c.id AND ce.employee_id = ? LIMIT 1) AS my_enrollment_id
       FROM courses c
       JOIN course_categories cc ON cc.id = c.category_id
       LEFT JOIN departments d ON d.id = c.department_id
       WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [auth.employee.id, auth.employee.id, auth.employee.id, ...params, limit, offset],
    );
    res.json(paginate(rows.map(serializeCourse), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

function serializeCourse(row: RowDataPacket) {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    description: row.description,
    categoryId: row.category_id,
    categoryName: row.category_name,
    categoryColor: row.category_color,
    departmentId: row.department_id,
    departmentName: row.department_name,
    thumbnailPath: row.thumbnail_path,
    instructorName: row.instructor_name,
    durationMinutes: Number(row.duration_minutes),
    difficulty: row.difficulty,
    courseType: row.course_type,
    targetAudience: row.target_audience,
    status: row.status,
    certificateEnabled: Boolean(row.certificate_enabled),
    signatoryName: row.signatory_name ?? null,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    moduleCount: Number(row.module_count),
    lessonCount: Number(row.lesson_count),
    enrollmentCount: Number(row.enrollment_count),
    completedCount: Number(row.completed_count),
    myStatus: row.my_status ?? null,
    myProgress: row.my_progress === null || row.my_progress === undefined ? null : Number(row.my_progress),
    myEnrollmentId: row.my_enrollment_id ?? null,
  };
}

// --- Course detail ---------------------------------------------------------
coursesRouter.get(
  '/:id',
  requirePermission('course.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const course = await queryOne(
      `SELECT c.*, cc.name AS category_name, cc.color AS category_color, d.name AS department_name
       FROM courses c JOIN course_categories cc ON cc.id = c.category_id LEFT JOIN departments d ON d.id = c.department_id
       WHERE c.id = ?`,
      [id],
    );
    if (!course) throw notFound('Course not found');

    if (isLearnerOnly(auth) && course.status !== 'published') {
      const enrolled = await queryOne('SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?', [id, auth.employee.id]);
      if (!enrolled) throw forbidden('This course is not available to you');
    }

    const modules = await query(
      'SELECT id, title, description, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order',
      [id],
    );
    const lessons = await query(
      `SELECT l.id, l.module_id, l.title, l.content_type, l.duration_minutes, l.sort_order, l.is_required,
              (SELECT COUNT(*) FROM learning_materials lm WHERE lm.lesson_id = l.id) AS material_count
       FROM lessons l JOIN course_modules m ON m.id = l.module_id
       WHERE m.course_id = ? ORDER BY m.sort_order, l.sort_order`,
      [id],
    );
    const quizzes = await query(
      'SELECT id, title, passing_score, time_limit_minutes, max_attempts, is_active FROM quizzes WHERE course_id = ? ORDER BY id',
      [id],
    );
    const enrollment = await queryOne(
      'SELECT id, status, progress_percent, due_date, completed_at FROM course_enrollments WHERE course_id = ? AND employee_id = ?',
      [id, auth.employee.id],
    );

    res.json({
      ...serializeCourse({ ...course, module_count: modules.length, lesson_count: lessons.length, enrollment_count: 0, completed_count: 0, my_status: enrollment?.status ?? null, my_progress: enrollment?.progress_percent ?? null, my_enrollment_id: enrollment?.id ?? null }),
      modules: modules.map((module) => ({
        id: module.id,
        title: module.title,
        description: module.description,
        sortOrder: module.sort_order,
        lessons: lessons.filter((l) => l.module_id === module.id).map((l) => ({
          id: l.id, title: l.title, contentType: l.content_type, durationMinutes: Number(l.duration_minutes),
          sortOrder: l.sort_order, isRequired: Boolean(l.is_required), materialCount: Number(l.material_count),
        })),
      })),
      quizzes,
      myEnrollment: enrollment ? {
        id: enrollment.id, status: enrollment.status, progressPercent: Number(enrollment.progress_percent),
        dueDate: enrollment.due_date, completedAt: enrollment.completed_at,
      } : null,
    });
  }),
);

// --- Course CRUD -----------------------------------------------------------
const courseBody = z.object({
  code: z.string().trim().min(1).max(30),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(5000).optional().nullable(),
  categoryId: z.coerce.number().int().positive(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  instructorName: z.string().trim().max(150).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(0).default(0),
  difficulty: z.enum(['beginner', 'intermediate', 'advanced']).default('beginner'),
  courseType: z.enum(['mandatory', 'optional']).default('optional'),
  targetAudience: z.string().trim().max(255).optional().nullable(),
  certificateEnabled: z.boolean().default(true),
  signatoryName: z.string().trim().max(150).optional().nullable(),
});

coursesRouter.post(
  '/',
  requirePermission('course.create'),
  csrfProtection,
  validate(courseBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const body = req.body as z.infer<typeof courseBody>;
    const dup = await queryOne('SELECT id FROM courses WHERE code = ?', [body.code]);
    if (dup) throw conflict('Course code already exists');
    const category = await queryOne('SELECT id FROM course_categories WHERE id = ?', [body.categoryId]);
    if (!category) throw badRequest('Unknown category');

    const id = await execute(
      `INSERT INTO courses (code, title, description, category_id, department_id, instructor_name, duration_minutes, difficulty, course_type, target_audience, status, certificate_enabled, signatory_name, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`,
      [body.code, body.title, body.description ?? null, body.categoryId, body.departmentId ?? null, body.instructorName ?? null, body.durationMinutes, body.difficulty, body.courseType, body.targetAudience ?? null, body.certificateEnabled ? 1 : 0, body.signatoryName ?? null, auth.userId],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'course.created', entityType: 'course', entityId: id, description: `Created course ${body.code}` });
    res.status(201).json({ id });
  }),
);

coursesRouter.put(
  '/:id',
  requirePermission('course.update'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(courseBody.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof courseBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      code: 'code', title: 'title', description: 'description', categoryId: 'category_id', departmentId: 'department_id',
      instructorName: 'instructor_name', durationMinutes: 'duration_minutes', difficulty: 'difficulty',
      courseType: 'course_type', targetAudience: 'target_audience', signatoryName: 'signatory_name',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in body) { fields.push(`${column} = ?`); params.push((body as Record<string, unknown>)[key] ?? null); }
    }
    if (body.certificateEnabled !== undefined) { fields.push('certificate_enabled = ?'); params.push(body.certificateEnabled ? 1 : 0); }
    if (fields.length === 0) throw badRequest('Nothing to update');
    const result = await execute(`UPDATE courses SET ${fields.join(', ')} WHERE id = ?`, [...params, id]);
    if (result.affectedRows === 0) throw notFound('Course not found');
    recordAudit(req, { action: 'course.updated', entityType: 'course', entityId: id, description: `Updated course ${id}` });
    res.json({ success: true });
  }),
);

const publishBody = z.object({ status: z.enum(['draft', 'published', 'archived']) });

coursesRouter.post(
  '/:id/publish',
  requirePermission('course.publish'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(publishBody),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof publishBody>;
    const course = await queryOne<RowDataPacket & { title: string }>('SELECT title FROM courses WHERE id = ?', [id]);
    if (!course) throw notFound('Course not found');

    if (body.status === 'published') {
      const lessonCount = await queryOne<RowDataPacket & { total: number }>(
        'SELECT COUNT(*) AS total FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = ?',
        [id],
      );
      if (Number(lessonCount?.total ?? 0) === 0) throw badRequest('Add at least one lesson before publishing');
    }

    await execute(
      'UPDATE courses SET status = ?, published_at = CASE WHEN ? = \'published\' AND published_at IS NULL THEN NOW() ELSE published_at END WHERE id = ?',
      [body.status, body.status, id],
    );

    if (body.status === 'published') {
      // Notify every active learner about the newly published course.
      await execute(
        `INSERT INTO notifications (user_id, type, title, message, link)
         SELECT u.id, 'course_published', 'New course available', ?, ?
         FROM users u JOIN employees e ON e.id = u.employee_id
         WHERE u.is_active = 1 AND e.is_active = 1`,
        [`"${course.title}" has been published and is open for enrollment.`, `/learner/courses/${id}`],
      );
    }

    recordAudit(req, { action: `course.${body.status}`, entityType: 'course', entityId: id, description: `Course status set to ${body.status}` });
    res.json({ success: true });
  }),
);

coursesRouter.delete(
  '/:id',
  requirePermission('course.delete'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const enrollments = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM course_enrollments WHERE course_id = ?', [id]);
    if (Number(enrollments?.total ?? 0) > 0) throw conflict('Course has enrollments. Archive it instead of deleting.');
    const result = await execute('DELETE FROM courses WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Course not found');
    recordAudit(req, { action: 'course.deleted', entityType: 'course', entityId: id, description: `Deleted course ${id}` });
    res.json({ success: true });
  }),
);

// --- Thumbnail -------------------------------------------------------------
coursesRouter.post(
  '/:id/thumbnail',
  requirePermission('course.update'),
  csrfProtection,
  validate(idParam, 'params'),
  uploadFor('thumbnail'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const file = req.file;
    if (!file) throw badRequest('Attach an image in the "file" field');
    const course = await queryOne('SELECT id FROM courses WHERE id = ?', [id]);
    if (!course) { discardUpload(file.path); throw notFound('Course not found'); }

    let committed;
    try {
      committed = commitUpload(file.path, 'thumbnail');
    } catch (error) {
      discardUpload(file.path);
      throw error;
    }
    // Normalize to a web-friendly JPEG regardless of source format.
    const jpegName = committed.storedName.replace(/\.[a-z]+$/, '.jpg');
    const jpegPath = path.join(path.dirname(committed.absolutePath), jpegName);
    await sharp(committed.absolutePath).resize({ width: 960, height: 540, fit: 'cover' }).jpeg({ quality: 82 }).toFile(jpegPath);
    if (jpegPath !== committed.absolutePath) fs.unlinkSync(committed.absolutePath);
    const relativePath = `uploads/thumbnails/${jpegName}`;

    await execute('UPDATE courses SET thumbnail_path = ? WHERE id = ?', [relativePath, id]);
    recordAudit(req, { action: 'course.thumbnail_updated', entityType: 'course', entityId: id, description: 'Updated course thumbnail' });
    res.json({ thumbnailPath: relativePath });
  }),
);

coursesRouter.get(
  '/:id/thumbnail',
  requireAuth,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const course = await queryOne<RowDataPacket & { thumbnail_path: string | null }>('SELECT thumbnail_path FROM courses WHERE id = ?', [id]);
    if (!course?.thumbnail_path) throw notFound('No thumbnail for this course');
    const absolute = resolveStoredPath(course.thumbnail_path);
    if (!fs.existsSync(absolute)) throw notFound('Thumbnail file missing');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.sendFile(absolute);
  }),
);

// --- Modules & lessons -----------------------------------------------------
const moduleBody = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  sortOrder: z.coerce.number().int().min(0).default(0),
});

coursesRouter.post(
  '/:id/modules',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(moduleBody),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as z.infer<typeof moduleBody>;
    const course = await queryOne('SELECT id FROM courses WHERE id = ?', [id]);
    if (!course) throw notFound('Course not found');
    const moduleId = await execute(
      'INSERT INTO course_modules (course_id, title, description, sort_order) VALUES (?, ?, ?, ?)',
      [id, body.title, body.description ?? null, body.sortOrder],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'module.created', entityType: 'course_module', entityId: moduleId, description: `Added module to course ${id}` });
    res.status(201).json({ id: moduleId });
  }),
);

coursesRouter.put(
  '/modules/:moduleId',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(z.object({ moduleId: z.coerce.number().int().positive() }), 'params'),
  validate(moduleBody.partial()),
  asyncHandler(async (req, res) => {
    const moduleId = Number(req.params.moduleId);
    const body = req.body as Partial<z.infer<typeof moduleBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    if (body.title !== undefined) { fields.push('title = ?'); params.push(body.title); }
    if (body.description !== undefined) { fields.push('description = ?'); params.push(body.description); }
    if (body.sortOrder !== undefined) { fields.push('sort_order = ?'); params.push(body.sortOrder); }
    if (fields.length === 0) throw badRequest('Nothing to update');
    const result = await execute(`UPDATE course_modules SET ${fields.join(', ')} WHERE id = ?`, [...params, moduleId]);
    if (result.affectedRows === 0) throw notFound('Module not found');
    res.json({ success: true });
  }),
);

coursesRouter.delete(
  '/modules/:moduleId',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(z.object({ moduleId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const moduleId = Number(req.params.moduleId);
    const result = await execute('DELETE FROM course_modules WHERE id = ?', [moduleId]);
    if (result.affectedRows === 0) throw notFound('Module not found');
    recordAudit(req, { action: 'module.deleted', entityType: 'course_module', entityId: moduleId, description: `Deleted module ${moduleId}` });
    res.json({ success: true });
  }),
);

const lessonBody = z.object({
  title: z.string().trim().min(1).max(200),
  contentType: z.enum(['video', 'pdf', 'presentation', 'document', 'image', 'text', 'link']).default('text'),
  content: z.string().max(50000).optional().nullable(),
  externalUrl: z.string().trim().url().max(500).optional().nullable(),
  durationMinutes: z.coerce.number().int().min(0).default(0),
  sortOrder: z.coerce.number().int().min(0).default(0),
  isRequired: z.boolean().default(true),
});

coursesRouter.post(
  '/modules/:moduleId/lessons',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(z.object({ moduleId: z.coerce.number().int().positive() }), 'params'),
  validate(lessonBody),
  asyncHandler(async (req, res) => {
    const moduleId = Number(req.params.moduleId);
    const body = req.body as z.infer<typeof lessonBody>;
    const module = await queryOne('SELECT id FROM course_modules WHERE id = ?', [moduleId]);
    if (!module) throw notFound('Module not found');
    if (body.contentType === 'link' && !body.externalUrl) throw badRequest('Link lessons require an external URL');
    const lessonId = await execute(
      'INSERT INTO lessons (module_id, title, content_type, content, external_url, duration_minutes, sort_order, is_required) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [moduleId, body.title, body.contentType, body.content ?? null, body.externalUrl ?? null, body.durationMinutes, body.sortOrder, body.isRequired ? 1 : 0],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'lesson.created', entityType: 'lesson', entityId: lessonId, description: `Added lesson to module ${moduleId}` });
    res.status(201).json({ id: lessonId });
  }),
);

coursesRouter.put(
  '/lessons/:lessonId',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(z.object({ lessonId: z.coerce.number().int().positive() }), 'params'),
  validate(lessonBody.partial()),
  asyncHandler(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const body = req.body as Partial<z.infer<typeof lessonBody>>;
    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      title: 'title', contentType: 'content_type', content: 'content', externalUrl: 'external_url',
      durationMinutes: 'duration_minutes', sortOrder: 'sort_order',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in body) { fields.push(`${column} = ?`); params.push((body as Record<string, unknown>)[key] ?? null); }
    }
    if (body.isRequired !== undefined) { fields.push('is_required = ?'); params.push(body.isRequired ? 1 : 0); }
    if (fields.length === 0) throw badRequest('Nothing to update');
    const result = await execute(`UPDATE lessons SET ${fields.join(', ')} WHERE id = ?`, [...params, lessonId]);
    if (result.affectedRows === 0) throw notFound('Lesson not found');
    res.json({ success: true });
  }),
);

coursesRouter.delete(
  '/lessons/:lessonId',
  requirePermission('lesson.manage'),
  csrfProtection,
  validate(z.object({ lessonId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const lessonId = Number(req.params.lessonId);
    const result = await execute('DELETE FROM lessons WHERE id = ?', [lessonId]);
    if (result.affectedRows === 0) throw notFound('Lesson not found');
    recordAudit(req, { action: 'lesson.deleted', entityType: 'lesson', entityId: lessonId, description: `Deleted lesson ${lessonId}` });
    res.json({ success: true });
  }),
);
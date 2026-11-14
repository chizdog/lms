import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, isLearnerOnly } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam } from '../utils/query';
import { recomputeProgress, tryCompleteCourse } from '../utils/completion';
import { badRequest, conflict, forbidden, notFound } from '../utils/errors';

export const learningRouter = Router();
learningRouter.use(requireAuth);

learningRouter.get(
  '/my-courses',
  requirePermission('enrollment.view'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const rows = await query(
      `SELECT ce.id, ce.status, ce.progress_percent, ce.due_date, ce.enrolled_at, ce.started_at, ce.completed_at, ce.last_accessed_at,
              c.id AS course_id, c.code, c.title, c.thumbnail_path, c.difficulty, c.course_type, c.duration_minutes,
              cc.name AS category_name, cc.color AS category_color,
              (ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed') AS is_overdue,
              (SELECT COUNT(*) FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE m.course_id = c.id AND l.is_required = 1) AS required_lessons,
              (SELECT COUNT(*) FROM lesson_progress lp WHERE lp.enrollment_id = ce.id AND lp.is_completed = 1) AS completed_lessons
       FROM course_enrollments ce
       JOIN courses c ON c.id = ce.course_id
       JOIN course_categories cc ON cc.id = c.category_id
       WHERE ce.employee_id = ?
       ORDER BY ce.status = 'completed', ce.due_date IS NULL, ce.due_date ASC`,
      [auth.employee.id],
    );
    res.json({
      items: rows.map((r) => ({
        id: r.id, status: r.status, progressPercent: Number(r.progress_percent), dueDate: r.due_date,
        enrolledAt: r.enrolled_at, startedAt: r.started_at, completedAt: r.completed_at, lastAccessedAt: r.last_accessed_at,
        isOverdue: Boolean(r.is_overdue),
        requiredLessons: Number(r.required_lessons), completedLessons: Number(r.completed_lessons),
        course: {
          id: r.course_id, code: r.code, title: r.title, thumbnailPath: r.thumbnail_path,
          difficulty: r.difficulty, courseType: r.course_type, durationMinutes: Number(r.duration_minutes),
          categoryName: r.category_name, categoryColor: r.category_color,
        },
      })),
    });
  }),
);

learningRouter.post(
  '/enroll',
  requirePermission('learner.enroll'),
  csrfProtection,
  validate(z.object({ courseId: z.coerce.number().int().positive() })),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const courseId = Number(req.body.courseId);
    const course = await queryOne<RowDataPacket & { status: string; course_type: string; title: string }>(
      'SELECT status, course_type, title FROM courses WHERE id = ?',
      [courseId],
    );
    if (!course) throw notFound('Course not found');
    if (course.status !== 'published') throw badRequest('Only published courses can be self-enrolled');
    if (course.course_type === 'mandatory') throw badRequest('Mandatory courses are assigned by your administrator');

    const existing = await queryOne('SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?', [courseId, auth.employee.id]);
    if (existing) throw conflict('You are already enrolled in this course');

    const id = await execute(
      `INSERT INTO course_enrollments (course_id, employee_id, assignment_type, status, due_date) VALUES (?, ?, 'self', 'assigned', NULL)`,
      [courseId, auth.employee.id],
    ).then((r) => r.insertId);
    recordAudit(req, { action: 'enrollment.self_enrolled', entityType: 'course_enrollment', entityId: id, description: `Self-enrolled in ${course.title}` });
    res.status(201).json({ id });
  }),
);

learningRouter.get(
  '/enrollments/:id',
  requirePermission('enrollment.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const enrollment = await queryOne<RowDataPacket & { employee_id: number; course_id: number }>(
      'SELECT id, employee_id, course_id, status, progress_percent, due_date, completed_at FROM course_enrollments WHERE id = ?',
      [id],
    );
    if (!enrollment) throw notFound('Enrollment not found');
    if (isLearnerOnly(auth) && enrollment.employee_id !== auth.employee.id) {
      throw forbidden('You can only view your own enrollments');
    }

    const course = await queryOne(
      `SELECT c.id, c.code, c.title, c.description, c.thumbnail_path, c.instructor_name, c.duration_minutes, c.difficulty, c.course_type,
              cc.name AS category_name, cc.color AS category_color
       FROM courses c JOIN course_categories cc ON cc.id = c.category_id WHERE c.id = ?`,
      [enrollment.course_id],
    );
    const modules = await query('SELECT id, title, description, sort_order FROM course_modules WHERE course_id = ? ORDER BY sort_order', [enrollment.course_id]);
    const lessons = await query(
      `SELECT l.id, l.module_id, l.title, l.content_type, l.duration_minutes, l.sort_order, l.is_required,
              lp.is_completed, lp.completed_at
       FROM lessons l
       JOIN course_modules m ON m.id = l.module_id
       LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.enrollment_id = ?
       WHERE m.course_id = ? ORDER BY m.sort_order, l.sort_order`,
      [id, enrollment.course_id],
    );
    const quizzes = await query(
      `SELECT q.id, q.title, q.passing_score, q.time_limit_minutes, q.max_attempts,
              (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.employee_id = ?) AS attempts_used,
              (SELECT MAX(qa.passed) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.employee_id = ?) AS best_passed,
              (SELECT MAX(qa.percentage) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.employee_id = ?) AS best_percentage
       FROM quizzes q WHERE q.course_id = ? AND q.is_active = 1`,
      [enrollment.employee_id, enrollment.employee_id, enrollment.employee_id, enrollment.course_id],
    );

    res.json({
      enrollment: {
        id: enrollment.id, status: enrollment.status, progressPercent: Number(enrollment.progress_percent),
        dueDate: enrollment.due_date, completedAt: enrollment.completed_at,
        isOverdue: Boolean(enrollment.due_date && dayjs(enrollment.due_date).isBefore(dayjs(), 'day') && enrollment.status !== 'completed'),
      },
      course,
      modules: modules.map((module) => ({
        id: module.id, title: module.title, description: module.description,
        lessons: lessons.filter((l) => l.module_id === module.id).map((l) => ({
          id: l.id, title: l.title, contentType: l.content_type, durationMinutes: Number(l.duration_minutes),
          isRequired: Boolean(l.is_required), isCompleted: Boolean(l.is_completed), completedAt: l.completed_at,
        })),
      })),
      quizzes: quizzes.map((q) => ({
        id: q.id, title: q.title, passingScore: Number(q.passing_score), timeLimitMinutes: q.time_limit_minutes,
        maxAttempts: Number(q.max_attempts), attemptsUsed: Number(q.attempts_used),
        bestPassed: q.best_passed === null ? null : Boolean(q.best_passed),
        bestPercentage: q.best_percentage === null ? null : Number(q.best_percentage),
      })),
    });
  }),
);

learningRouter.get(
  '/lessons/:lessonId',
  requirePermission('learner.learn'),
  validate(z.object({ lessonId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const lessonId = Number(req.params.lessonId);
    const lesson = await queryOne<RowDataPacket & { course_id: number; module_id: number }>(
      `SELECT l.id, l.module_id, l.title, l.content_type, l.content, l.external_url, l.duration_minutes, l.is_required, m.course_id
       FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = ?`,
      [lessonId],
    );
    if (!lesson) throw notFound('Lesson not found');

    const enrollment = await queryOne<RowDataPacket & { id: number }>(
      'SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?',
      [lesson.course_id, auth.employee.id],
    );
    if (!enrollment) throw forbidden('Enroll in the course to open its lessons');

    const materials = await query(
      'SELECT id, original_name, mime_type, file_size, material_type FROM learning_materials WHERE lesson_id = ? ORDER BY id',
      [lessonId],
    );
    const progress = await queryOne('SELECT is_completed, completed_at, time_spent_seconds FROM lesson_progress WHERE enrollment_id = ? AND lesson_id = ?', [enrollment.id, lessonId]);

    await execute(
      `INSERT INTO lesson_progress (enrollment_id, lesson_id, employee_id, is_completed, time_spent_seconds)
       VALUES (?, ?, ?, 0, 0)
       ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET last_viewed_at = NOW()`,
      [enrollment.id, lessonId, auth.employee.id],
    );

    res.json({
      id: lesson.id,
      moduleId: lesson.module_id,
      courseId: lesson.course_id,
      enrollmentId: enrollment.id,
      title: lesson.title,
      contentType: lesson.content_type,
      content: lesson.content,
      externalUrl: lesson.external_url,
      durationMinutes: Number(lesson.duration_minutes),
      isRequired: Boolean(lesson.is_required),
      isCompleted: Boolean(progress?.is_completed),
      completedAt: progress?.completed_at ?? null,
      materials: materials.map((m) => ({ id: m.id, originalName: m.original_name, mimeType: m.mime_type, fileSize: Number(m.file_size), materialType: m.material_type })),
    });
  }),
);

learningRouter.post(
  '/lessons/:lessonId/complete',
  requirePermission('learner.learn'),
  csrfProtection,
  validate(z.object({ lessonId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const lessonId = Number(req.params.lessonId);
    const lesson = await queryOne<RowDataPacket & { course_id: number }>(
      'SELECT l.id, m.course_id FROM lessons l JOIN course_modules m ON m.id = l.module_id WHERE l.id = ?',
      [lessonId],
    );
    if (!lesson) throw notFound('Lesson not found');
    const enrollment = await queryOne<RowDataPacket & { id: number }>(
      'SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?',
      [lesson.course_id, auth.employee.id],
    );
    if (!enrollment) throw forbidden('Enroll in the course to record progress');

    await execute(
      `INSERT INTO lesson_progress (enrollment_id, lesson_id, employee_id, is_completed, completed_at)
       VALUES (?, ?, ?, 1, NOW())
       ON CONFLICT (enrollment_id, lesson_id) DO UPDATE SET is_completed = 1, completed_at = COALESCE(lesson_progress.completed_at, NOW())`,
      [enrollment.id, lessonId, auth.employee.id],
    );
    const percent = await recomputeProgress(enrollment.id);
    const completion = await tryCompleteCourse(enrollment.id);

    res.json({ progressPercent: percent, courseCompleted: completion.completed, certificateNumber: completion.certificateNumber });
  }),
);

learningRouter.get(
  '/my-certificates',
  requirePermission('certificate.view'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const rows = await query(
      `SELECT cert.id, cert.certificate_number, cert.completion_date, cert.score, cert.issued_at, cert.file_path,
              c.title AS course_title, c.code AS course_code
       FROM certificates cert JOIN courses c ON c.id = cert.course_id
       WHERE cert.employee_id = ? AND cert.revoked_at IS NULL ORDER BY cert.issued_at DESC`,
      [auth.employee.id],
    );
    res.json({ items: rows.map((r) => ({ id: r.id, certificateNumber: r.certificate_number, completionDate: r.completion_date, score: r.score === null ? null : Number(r.score), issuedAt: r.issued_at, courseTitle: r.course_title, courseCode: r.course_code })) });
  }),
);
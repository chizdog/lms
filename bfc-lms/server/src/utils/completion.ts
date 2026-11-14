import dayjs from 'dayjs';
import { execute, query, queryOne, RowDataPacket } from '../config/db';
import { writeCertificatePdf } from './certificate-pdf';

/** Recomputes an enrollment's progress from its required-lesson completion rows. */
export async function recomputeProgress(enrollmentId: number): Promise<number> {
  const row = await queryOne<RowDataPacket & { total: number; done: number }>(
    `SELECT COUNT(*) AS total,
            SUM(CASE WHEN lp.is_completed = 1 THEN 1 ELSE 0 END) AS done
     FROM lessons l
     JOIN course_modules m ON m.id = l.module_id
     JOIN course_enrollments ce ON ce.course_id = m.course_id
     LEFT JOIN lesson_progress lp ON lp.lesson_id = l.id AND lp.enrollment_id = ce.id
     WHERE ce.id = ? AND l.is_required = 1`,
    [enrollmentId],
  );
  const total = Number(row?.total ?? 0);
  const done = Number(row?.done ?? 0);
  const percent = total === 0 ? 0 : Number(((done / total) * 100).toFixed(2));

  await execute(
    `UPDATE course_enrollments
     SET progress_percent = ?,
         status = CASE WHEN status = 'completed' THEN status WHEN ?::numeric > 0 THEN 'in_progress' ELSE status END,
         started_at = COALESCE(started_at, CASE WHEN ?::numeric > 0 THEN NOW() ELSE NULL END),
         last_accessed_at = NOW()
     WHERE id = ?`,
    [percent, percent, percent, enrollmentId],
  );
  return percent;
}

interface CompletionContext extends RowDataPacket {
  enrollment_id: number;
  employee_id: number;
  course_id: number;
  status: string;
  progress_percent: string;
  certificate_enabled: number;
  signatory_name: string | null;
  course_title: string;
  course_code: string;
  duration_minutes: number;
  first_name: string;
  last_name: string;
  employee_no: string;
  user_id: number;
}

/**
 * Marks the enrollment complete and issues a certificate when all required lessons
 * are done and every active assessment has a passing attempt.
 */
export async function tryCompleteCourse(enrollmentId: number): Promise<{ completed: boolean; certificateNumber: string | null }> {
  const context = await queryOne<CompletionContext>(
    `SELECT ce.id AS enrollment_id, ce.employee_id, ce.course_id, ce.status, ce.progress_percent,
            c.certificate_enabled, c.signatory_name, c.title AS course_title, c.code AS course_code, c.duration_minutes,
            e.first_name, e.last_name, e.employee_no, u.id AS user_id
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     JOIN employees e ON e.id = ce.employee_id
     JOIN users u ON u.employee_id = e.id
     WHERE ce.id = ?`,
    [enrollmentId],
  );
  if (!context) return { completed: false, certificateNumber: null };
  if (context.status === 'completed') return { completed: true, certificateNumber: null };
  if (Number(context.progress_percent) < 100) return { completed: false, certificateNumber: null };

  const activeQuizzes = await query<RowDataPacket & { id: number }>(
    'SELECT id FROM quizzes WHERE course_id = ? AND is_active = 1',
    [context.course_id],
  );
  for (const quiz of activeQuizzes) {
    const passed = await queryOne(
      'SELECT id FROM quiz_attempts WHERE quiz_id = ? AND employee_id = ? AND passed = 1 LIMIT 1',
      [quiz.id, context.employee_id],
    );
    if (!passed) return { completed: false, certificateNumber: null };
  }

  const bestAttempt = await queryOne<RowDataPacket & { percentage: string }>(
    `SELECT qa.percentage FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id
     WHERE q.course_id = ? AND qa.employee_id = ? AND qa.passed = 1
     ORDER BY qa.percentage DESC LIMIT 1`,
    [context.course_id, context.employee_id],
  );

  const completedAt = dayjs();
  await execute(
    "UPDATE course_enrollments SET status = 'completed', completed_at = NOW(), progress_percent = 100 WHERE id = ?",
    [enrollmentId],
  );

  let certificateNumber: string | null = null;
  if (context.certificate_enabled) {
    const existing = await queryOne<RowDataPacket & { certificate_number: string }>(
      'SELECT certificate_number FROM certificates WHERE employee_id = ? AND course_id = ?',
      [context.employee_id, context.course_id],
    );
    if (existing) {
      certificateNumber = existing.certificate_number;
    } else {
      const count = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM certificates');
      certificateNumber = `BFC-CERT-${completedAt.format('YYYY')}-${String(Number(count?.total ?? 0) + 1).padStart(5, '0')}`;
      const score = bestAttempt ? Number(bestAttempt.percentage) : null;
      const filePath = await writeCertificatePdf({
        certificateNumber,
        employeeName: `${context.first_name} ${context.last_name}`,
        employeeNo: context.employee_no,
        courseTitle: context.course_title,
        courseCode: context.course_code,
        completionDate: completedAt.format('MMMM D, YYYY'),
        score,
        signatoryName: context.signatory_name ?? 'Maria Santos, L&D Manager',
        durationMinutes: Number(context.duration_minutes),
      });
      await execute(
        `INSERT INTO certificates (certificate_number, employee_id, course_id, enrollment_id, file_path, completion_date, score, signatory_name)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [certificateNumber, context.employee_id, context.course_id, enrollmentId, filePath, completedAt.format('YYYY-MM-DD'), score, context.signatory_name ?? 'Maria Santos, L&D Manager'],
      );
      await execute(
        `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'certificate_issued', 'Certificate available', ?, '/learner/certificates')`,
        [context.user_id, `Your certificate for "${context.course_title}" is ready to download.`],
      );
    }
  }

  await execute(
    `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'course_completed', 'Course completed', ?, ?)`,
    [context.user_id, `Congratulations! You completed "${context.course_title}".`, `/learner/courses/${context.course_id}`],
  );

  return { completed: true, certificateNumber };
}
import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import { execute, query, queryOne, withTransaction, sqlParams, RowDataPacket, ExecuteResult } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, isLearnerOnly, hasOrgWideAccess } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam } from '../utils/query';
import { tryCompleteCourse } from '../utils/completion';
import { badRequest, forbidden, notFound } from '../utils/errors';
import { ROLE_CODES } from '../config/permissions';

export const quizzesRouter = Router();
quizzesRouter.use(requireAuth);

const QUESTION_TYPES = ['multiple_choice', 'true_false', 'multiple_select', 'identification', 'short_answer'] as const;
type QuestionType = (typeof QUESTION_TYPES)[number];

function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

const normalize = (value: string) => value.toLowerCase().trim().replace(/\s+/g, ' ');

// --- Admin: list & detail --------------------------------------------------
quizzesRouter.get(
  '/',
  requirePermission('quiz.view'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const courseId = req.query.courseId ? Number(req.query.courseId) : null;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];
    if (courseId) { conditions.push('q.course_id = ?'); params.push(courseId); }
    if (isLearnerOnly(auth)) {
      conditions.push('EXISTS (SELECT 1 FROM course_enrollments ce WHERE ce.course_id = q.course_id AND ce.employee_id = ?)');
      params.push(auth.employee.id);
    }
    const rows = await query(
      `SELECT q.id, q.course_id, q.title, q.description, q.passing_score, q.time_limit_minutes, q.max_attempts,
              q.randomize_questions, q.randomize_options, q.show_results, q.is_active,
              c.title AS course_title, c.code AS course_code,
              (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id) AS question_count,
              (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id) AS attempt_count,
              (SELECT COUNT(*) FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.passed = 1) AS passed_count
       FROM quizzes q JOIN courses c ON c.id = q.course_id
       WHERE ${conditions.join(' AND ')} ORDER BY q.id`,
      params,
    );
    res.json({ items: rows.map((r) => ({
      id: r.id, courseId: r.course_id, title: r.title, description: r.description,
      passingScore: Number(r.passing_score), timeLimitMinutes: r.time_limit_minutes, maxAttempts: Number(r.max_attempts),
      randomizeQuestions: Boolean(r.randomize_questions), randomizeOptions: Boolean(r.randomize_options),
      showResults: Boolean(r.show_results), isActive: Boolean(r.is_active),
      courseTitle: r.course_title, courseCode: r.course_code,
      questionCount: Number(r.question_count), attemptCount: Number(r.attempt_count), passedCount: Number(r.passed_count),
    })) });
  }),
);

quizzesRouter.get(
  '/:id',
  requirePermission('quiz.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const id = Number(req.params.id);
    const quiz = await queryOne<RowDataPacket & { course_id: number }>('SELECT * FROM quizzes WHERE id = ?', [id]);
    if (!quiz) throw notFound('Quiz not found');
    if (isLearnerOnly(auth)) {
      const enrolled = await queryOne('SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?', [quiz.course_id, auth.employee.id]);
      if (!enrolled) throw forbidden('Enroll in the course to view its assessment');
    }

    const questions = await query('SELECT * FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order', [id]);
    const options = await query(
      'SELECT o.* FROM quiz_options o JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = ? ORDER BY o.question_id, o.sort_order',
      [id],
    );
    const includeAnswers = !isLearnerOnly(auth);

    res.json({
      id: quiz.id, courseId: quiz.course_id, title: quiz.title, description: quiz.description,
      passingScore: Number(quiz.passing_score), timeLimitMinutes: quiz.time_limit_minutes, maxAttempts: Number(quiz.max_attempts),
      randomizeQuestions: Boolean(quiz.randomize_questions), randomizeOptions: Boolean(quiz.randomize_options),
      showResults: Boolean(quiz.show_results), isActive: Boolean(quiz.is_active),
      questions: questions.map((q) => ({
        id: q.id, questionType: q.question_type, questionText: q.question_text, points: Number(q.points),
        explanation: q.explanation, sortOrder: q.sort_order,
        correctAnswer: includeAnswers ? q.correct_answer : undefined,
        options: options.filter((o) => o.question_id === q.id).map((o) => ({
          id: o.id, optionText: o.option_text, sortOrder: o.sort_order,
          isCorrect: includeAnswers ? Boolean(o.is_correct) : undefined,
        })),
      })),
    });
  }),
);

// --- Admin: create / update / delete --------------------------------------
const questionBody = z.object({
  questionType: z.enum(QUESTION_TYPES),
  questionText: z.string().trim().min(1).max(2000),
  points: z.coerce.number().min(0.5).max(100).default(1),
  correctAnswer: z.string().trim().max(500).optional().nullable(),
  explanation: z.string().trim().max(2000).optional().nullable(),
  options: z.array(z.object({ optionText: z.string().trim().min(1).max(500), isCorrect: z.boolean().default(false) })).optional(),
});

const quizBody = z.object({
  courseId: z.coerce.number().int().positive(),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional().nullable(),
  passingScore: z.coerce.number().min(1).max(100).default(75),
  timeLimitMinutes: z.coerce.number().int().min(1).max(480).optional().nullable(),
  maxAttempts: z.coerce.number().int().min(1).max(10).default(3),
  randomizeQuestions: z.boolean().default(false),
  randomizeOptions: z.boolean().default(false),
  questionsPerAttempt: z.coerce.number().int().min(1).optional().nullable(),
  showResults: z.boolean().default(true),
  isActive: z.boolean().default(true),
  questions: z.array(questionBody).min(1),
});

function validateQuestions(questions: z.infer<typeof questionBody>[]): void {
  for (const question of questions) {
    const needsOptions = ['multiple_choice', 'true_false', 'multiple_select'].includes(question.questionType);
    if (needsOptions) {
      if (!question.options || question.options.length < 2) throw badRequest(`"${question.questionText}" needs at least two options`);
      const correctCount = question.options.filter((o) => o.isCorrect).length;
      if (question.questionType === 'multiple_select' && correctCount < 1) throw badRequest(`"${question.questionText}" needs at least one correct option`);
      if (question.questionType !== 'multiple_select' && correctCount !== 1) throw badRequest(`"${question.questionText}" needs exactly one correct option`);
    }
    if (question.questionType === 'identification' && !question.correctAnswer) {
      throw badRequest(`Identification question "${question.questionText}" needs an accepted answer`);
    }
  }
}

async function replaceQuestions(quizId: number, questions: z.infer<typeof questionBody>[]): Promise<void> {
  await execute('DELETE FROM quiz_questions WHERE quiz_id = ?', [quizId]);
  let order = 0;
  for (const question of questions) {
    order += 1;
    const questionId = await execute(
      'INSERT INTO quiz_questions (quiz_id, question_type, question_text, points, correct_answer, explanation, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [quizId, question.questionType, question.questionText, question.points, question.correctAnswer ?? null, question.explanation ?? null, order],
    ).then((r) => r.insertId);
    let optionOrder = 0;
    for (const option of question.options ?? []) {
      optionOrder += 1;
      await execute(
        'INSERT INTO quiz_options (question_id, option_text, is_correct, sort_order) VALUES (?, ?, ?, ?)',
        [questionId, option.optionText, option.isCorrect ? 1 : 0, optionOrder],
      );
    }
  }
}

quizzesRouter.post(
  '/',
  requirePermission('quiz.manage'),
  csrfProtection,
  validate(quizBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const body = req.body as z.infer<typeof quizBody>;
    validateQuestions(body.questions);
    const course = await queryOne('SELECT id FROM courses WHERE id = ?', [body.courseId]);
    if (!course) throw badRequest('Unknown course');

    const id = await withTransaction(async (conn) => {
      const [quiz] = await conn.execute<ExecuteResult>(
        `INSERT INTO quizzes (course_id, title, description, passing_score, time_limit_minutes, max_attempts, randomize_questions, randomize_options, questions_per_attempt, show_results, is_active, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [body.courseId, body.title, body.description ?? null, body.passingScore, body.timeLimitMinutes ?? null, body.maxAttempts, body.randomizeQuestions ? 1 : 0, body.randomizeOptions ? 1 : 0, body.questionsPerAttempt ?? null, body.showResults ? 1 : 0, body.isActive ? 1 : 0, auth.userId],
      );
      return quiz.insertId;
    });
    await replaceQuestions(id, body.questions);
    recordAudit(req, { action: 'quiz.created', entityType: 'quiz', entityId: id, description: `Created assessment ${body.title}` });
    res.status(201).json({ id });
  }),
);

quizzesRouter.put(
  '/:id',
  requirePermission('quiz.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(quizBody.partial().extend({ questions: z.array(questionBody).min(1).optional() })),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof quizBody>>;
    const quiz = await queryOne('SELECT id FROM quizzes WHERE id = ?', [id]);
    if (!quiz) throw notFound('Quiz not found');
    if (body.questions) validateQuestions(body.questions);

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      title: 'title', description: 'description', passingScore: 'passing_score', timeLimitMinutes: 'time_limit_minutes',
      maxAttempts: 'max_attempts', questionsPerAttempt: 'questions_per_attempt',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in body) { fields.push(`${column} = ?`); params.push((body as Record<string, unknown>)[key] ?? null); }
    }
    if (body.randomizeQuestions !== undefined) { fields.push('randomize_questions = ?'); params.push(body.randomizeQuestions ? 1 : 0); }
    if (body.randomizeOptions !== undefined) { fields.push('randomize_options = ?'); params.push(body.randomizeOptions ? 1 : 0); }
    if (body.showResults !== undefined) { fields.push('show_results = ?'); params.push(body.showResults ? 1 : 0); }
    if (body.isActive !== undefined) { fields.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }

    await withTransaction(async (conn) => {
      if (fields.length > 0) await conn.execute(`UPDATE quizzes SET ${fields.join(', ')} WHERE id = ?`, sqlParams([...params, id]));
    });
    if (body.questions) await replaceQuestions(id, body.questions);
    recordAudit(req, { action: 'quiz.updated', entityType: 'quiz', entityId: id, description: `Updated assessment ${id}` });
    res.json({ success: true });
  }),
);

quizzesRouter.delete(
  '/:id',
  requirePermission('quiz.manage'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const attempts = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM quiz_attempts WHERE quiz_id = ?', [id]);
    if (Number(attempts?.total ?? 0) > 0) throw badRequest('Assessment has attempt history. Deactivate it instead of deleting.');
    const result = await execute('DELETE FROM quizzes WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Quiz not found');
    recordAudit(req, { action: 'quiz.deleted', entityType: 'quiz', entityId: id, description: `Deleted assessment ${id}` });
    res.json({ success: true });
  }),
);

// --- Learner: start an attempt --------------------------------------------
quizzesRouter.post(
  '/:id/start',
  requirePermission('learner.learn'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const quizId = Number(req.params.id);
    const quiz = await queryOne<RowDataPacket & { course_id: number; is_active: number; max_attempts: number; time_limit_minutes: number | null; randomize_questions: number; randomize_options: number; questions_per_attempt: number | null }>(
      'SELECT * FROM quizzes WHERE id = ?',
      [quizId],
    );
    if (!quiz) throw notFound('Quiz not found');
    if (!quiz.is_active) throw badRequest('This assessment is not active');

    const enrollment = await queryOne<RowDataPacket & { id: number }>(
      'SELECT id FROM course_enrollments WHERE course_id = ? AND employee_id = ?',
      [quiz.course_id, auth.employee.id],
    );
    if (!enrollment) throw forbidden('Enroll in the course before taking its assessment');

    const inProgress = await queryOne<RowDataPacket & { id: number; expires_at: string | null }>(
      "SELECT id, expires_at FROM quiz_attempts WHERE quiz_id = ? AND employee_id = ? AND status = 'in_progress'",
      [quizId, auth.employee.id],
    );
    if (inProgress) {
      if (inProgress.expires_at && dayjs(inProgress.expires_at).isBefore(dayjs())) {
        await execute("UPDATE quiz_attempts SET status = 'expired', passed = 0 WHERE id = ?", [inProgress.id]);
      } else {
        return res.json(await buildAttemptPayload(inProgress.id, auth.employee.id));
      }
    }

    const used = await queryOne<RowDataPacket & { total: number }>(
      'SELECT COUNT(*) AS total FROM quiz_attempts WHERE quiz_id = ? AND employee_id = ?',
      [quizId, auth.employee.id],
    );
    if (Number(used?.total ?? 0) >= quiz.max_attempts) {
      throw badRequest(`You have used all ${quiz.max_attempts} attempts for this assessment`);
    }

    const attemptNumber = Number(used?.total ?? 0) + 1;
    const expiresAt = quiz.time_limit_minutes ? dayjs().add(quiz.time_limit_minutes, 'minute').format('YYYY-MM-DD HH:mm:ss') : null;
    const attemptId = await execute(
      `INSERT INTO quiz_attempts (quiz_id, employee_id, enrollment_id, attempt_number, status, expires_at) VALUES (?, ?, ?, ?, 'in_progress', ?)`,
      [quizId, auth.employee.id, enrollment.id, attemptNumber, expiresAt],
    ).then((r) => r.insertId);

    recordAudit(req, { action: 'quiz.attempt_started', entityType: 'quiz_attempt', entityId: attemptId, description: `Started attempt ${attemptNumber} of quiz ${quizId}` });
    res.status(201).json(await buildAttemptPayload(attemptId, auth.employee.id));
  }),
);

async function buildAttemptPayload(attemptId: number, employeeId: number) {
  const attempt = await queryOne<RowDataPacket & { quiz_id: number; attempt_number: number; expires_at: string | null; started_at: string }>(
    'SELECT id, quiz_id, attempt_number, expires_at, started_at FROM quiz_attempts WHERE id = ?',
    [attemptId],
  );
  if (!attempt) throw notFound('Attempt not found');
  const quiz = await queryOne<RowDataPacket & { title: string; passing_score: string; time_limit_minutes: number | null; randomize_questions: number; randomize_options: number; questions_per_attempt: number | null; max_attempts: number }>(
    'SELECT title, passing_score, time_limit_minutes, randomize_questions, randomize_options, questions_per_attempt, max_attempts FROM quizzes WHERE id = ?',
    [attempt.quiz_id],
  );
  let questions = await query('SELECT id, question_type, question_text, points, sort_order FROM quiz_questions WHERE quiz_id = ? ORDER BY sort_order', [attempt.quiz_id]);
  if (quiz!.randomize_questions) questions = shuffle(questions);
  if (quiz!.questions_per_attempt && quiz!.questions_per_attempt < questions.length) {
    questions = questions.slice(0, quiz!.questions_per_attempt);
  }
  const options = await query(
    'SELECT o.id, o.question_id, o.option_text, o.sort_order FROM quiz_options o JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = ? ORDER BY o.sort_order',
    [attempt.quiz_id],
  );

  return {
    attemptId: attempt.id,
    attemptNumber: attempt.attempt_number,
    quizId: attempt.quiz_id,
    title: quiz!.title,
    passingScore: Number(quiz!.passing_score),
    timeLimitMinutes: quiz!.time_limit_minutes,
    maxAttempts: Number(quiz!.max_attempts),
    startedAt: attempt.started_at,
    expiresAt: attempt.expires_at,
    questions: questions.map((q) => {
      let questionOptions = options.filter((o) => o.question_id === q.id);
      if (quiz!.randomize_options) questionOptions = shuffle(questionOptions);
      return {
        id: q.id, questionType: q.question_type as QuestionType, questionText: q.question_text, points: Number(q.points),
        options: questionOptions.map((o) => ({ id: o.id, optionText: o.option_text })),
      };
    }),
  };
}

// --- Learner: submit -------------------------------------------------------
const submitBody = z.object({
  answers: z.array(z.object({
    questionId: z.coerce.number().int().positive(),
    selectedOptionIds: z.array(z.coerce.number().int().positive()).optional(),
    textAnswer: z.string().max(5000).optional(),
  })),
});

quizzesRouter.post(
  '/attempts/:attemptId/submit',
  requirePermission('learner.learn'),
  csrfProtection,
  validate(z.object({ attemptId: z.coerce.number().int().positive() }), 'params'),
  validate(submitBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const attemptId = Number(req.params.attemptId);
    const body = req.body as z.infer<typeof submitBody>;

    const attempt = await queryOne<RowDataPacket & { quiz_id: number; employee_id: number; enrollment_id: number | null; status: string; expires_at: string | null }>(
      'SELECT id, quiz_id, employee_id, enrollment_id, status, expires_at FROM quiz_attempts WHERE id = ?',
      [attemptId],
    );
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.employee_id !== auth.employee.id) throw forbidden('This attempt belongs to another learner');
    if (attempt.status !== 'in_progress') throw badRequest('This attempt has already been submitted');

    const quiz = await queryOne<RowDataPacket & { passing_score: string; show_results: number; course_id: number; title: string }>(
      'SELECT passing_score, show_results, course_id, title FROM quizzes WHERE id = ?',
      [attempt.quiz_id],
    );
    const questions = await query<RowDataPacket & { id: number; question_type: QuestionType; points: string; correct_answer: string | null }>(
      'SELECT id, question_type, points, correct_answer FROM quiz_questions WHERE quiz_id = ?',
      [attempt.quiz_id],
    );
    const options = await query<RowDataPacket & { id: number; question_id: number; is_correct: number }>(
      'SELECT o.id, o.question_id, o.is_correct FROM quiz_options o JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = ?',
      [attempt.quiz_id],
    );

    const expired = Boolean(attempt.expires_at && dayjs(attempt.expires_at).isBefore(dayjs()));
    const answerByQuestion = new Map(body.answers.map((a) => [a.questionId, a]));

    let earned = 0;
    let maxScore = 0;
    let hasManual = false;

    await withTransaction(async (conn) => {
      for (const question of questions) {
        const points = Number(question.points);
        maxScore += points;
        const answer = answerByQuestion.get(question.id);
        let isCorrect: boolean | null = null;
        let awarded = 0;
        let needsManual = false;
        let selectedOptionIds: number[] | null = null;
        let textAnswer: string | null = null;

        if (question.question_type === 'multiple_choice' || question.question_type === 'true_false') {
          selectedOptionIds = answer?.selectedOptionIds ?? [];
          const correctIds = options.filter((o) => o.question_id === question.id && o.is_correct).map((o) => o.id);
          isCorrect = selectedOptionIds.length === 1 && correctIds.includes(selectedOptionIds[0]);
          awarded = isCorrect ? points : 0;
        } else if (question.question_type === 'multiple_select') {
          selectedOptionIds = answer?.selectedOptionIds ?? [];
          const correctIds = options.filter((o) => o.question_id === question.id && o.is_correct).map((o) => o.id).sort((a, b) => a - b);
          const chosen = [...selectedOptionIds].sort((a, b) => a - b);
          isCorrect = chosen.length === correctIds.length && chosen.every((id, i) => id === correctIds[i]);
          awarded = isCorrect ? points : 0;
        } else if (question.question_type === 'identification') {
          textAnswer = answer?.textAnswer ?? '';
          const accepted = (question.correct_answer ?? '').split('|').map(normalize).filter(Boolean);
          isCorrect = accepted.includes(normalize(textAnswer));
          awarded = isCorrect ? points : 0;
        } else {
          // short_answer: subjective, queued for trainer review.
          textAnswer = answer?.textAnswer ?? '';
          needsManual = true;
          hasManual = true;
          isCorrect = null;
          awarded = 0;
        }

        earned += awarded;
        await conn.execute(
          `INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer, is_correct, points_awarded, needs_manual_review)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (attempt_id, question_id) DO UPDATE SET selected_option_ids = EXCLUDED.selected_option_ids, text_answer = EXCLUDED.text_answer, is_correct = EXCLUDED.is_correct, points_awarded = EXCLUDED.points_awarded, needs_manual_review = EXCLUDED.needs_manual_review`,
          [attemptId, question.id, selectedOptionIds ? JSON.stringify(selectedOptionIds) : null, textAnswer, isCorrect === null ? null : isCorrect ? 1 : 0, awarded, needsManual ? 1 : 0],
        );
      }

      const percentage = maxScore === 0 ? 0 : Number(((earned / maxScore) * 100).toFixed(2));
      const graded = !hasManual;
      const passed = graded ? percentage >= Number(quiz!.passing_score) : null;
      await conn.execute(
        `UPDATE quiz_attempts SET status = ?, score = ?, max_score = ?, percentage = ?, passed = ?, submitted_at = NOW(), graded_at = CASE WHEN ? = 'graded' THEN NOW() ELSE NULL END WHERE id = ?`,
        [expired ? 'expired' : graded ? 'graded' : 'submitted', earned, maxScore, percentage, passed === null ? null : passed ? 1 : 0, graded ? 'graded' : 'submitted', attemptId],
      );
    });

    const percentage = maxScore === 0 ? 0 : Number(((earned / maxScore) * 100).toFixed(2));
    const passed = !hasManual ? percentage >= Number(quiz!.passing_score) : null;

    await execute(
      `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'assessment_result', 'Assessment submitted', ?, ?)`,
      [auth.userId, hasManual ? `Your answers for "${quiz!.title}" were submitted and are awaiting trainer review.` : `You scored ${percentage.toFixed(1)}% on "${quiz!.title}" — ${passed ? 'PASSED' : 'FAILED'}.`, `/learner/courses/${quiz!.course_id}`],
    );

    if (hasManual) {
      await execute(
        `INSERT INTO notifications (user_id, type, title, message, link)
         SELECT u.id, 'assessment_result', 'Answers awaiting review', ?, '/admin/assessments'
         FROM users u JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE p.code = 'quiz.grade' AND u.is_active = 1`,
        [`A learner submitted subjective answers for "${quiz!.title}" that need grading.`],
      );
    }

    let completion = { completed: false, certificateNumber: null as string | null };
    if (passed && attempt.enrollment_id) {
      completion = await tryCompleteCourse(attempt.enrollment_id);
    }

    recordAudit(req, { action: 'quiz.attempt_submitted', entityType: 'quiz_attempt', entityId: attemptId, description: `Scored ${percentage}% on quiz ${attempt.quiz_id}`, metadata: { percentage, passed } });

    res.json({
      attemptId, score: earned, maxScore, percentage, passed,
      status: expired ? 'expired' : hasManual ? 'submitted' : 'graded',
      awaitingReview: hasManual,
      showResults: Boolean(quiz!.show_results),
      courseCompleted: completion.completed,
      certificateNumber: completion.certificateNumber,
    });
  }),
);

// --- Attempt result / history ---------------------------------------------
quizzesRouter.get(
  '/attempts/:attemptId',
  requirePermission('quiz.view'),
  validate(z.object({ attemptId: z.coerce.number().int().positive() }), 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const attemptId = Number(req.params.attemptId);
    const attempt = await queryOne<RowDataPacket & { employee_id: number; quiz_id: number }>(
      'SELECT * FROM quiz_attempts WHERE id = ?',
      [attemptId],
    );
    if (!attempt) throw notFound('Attempt not found');
    if (isLearnerOnly(auth) && attempt.employee_id !== auth.employee.id) throw forbidden('You can only view your own attempts');

    const quiz = await queryOne<RowDataPacket & { show_results: number; title: string; passing_score: string }>('SELECT show_results, title, passing_score FROM quizzes WHERE id = ?', [attempt.quiz_id]);
    const answers = await query(
      `SELECT qa.question_id, qa.selected_option_ids, qa.text_answer, qa.is_correct, qa.points_awarded, qa.needs_manual_review,
              qq.question_text, qq.question_type, qq.points, qq.correct_answer, qq.explanation
       FROM quiz_answers qa JOIN quiz_questions qq ON qq.id = qa.question_id
       WHERE qa.attempt_id = ? ORDER BY qq.sort_order`,
      [attemptId],
    );
    const options = await query(
      'SELECT o.id, o.question_id, o.option_text, o.is_correct FROM quiz_options o JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = ?',
      [attempt.quiz_id],
    );
    const employee = await queryOne<RowDataPacket & { first_name: string; last_name: string; employee_no: string }>('SELECT first_name, last_name, employee_no FROM employees WHERE id = ?', [attempt.employee_id]);
    const reveal = !isLearnerOnly(auth) || Boolean(quiz!.show_results);

    res.json({
      id: attempt.id, quizId: attempt.quiz_id, quizTitle: quiz!.title, passingScore: Number(quiz!.passing_score),
      attemptNumber: attempt.attempt_number, status: attempt.status,
      score: Number(attempt.score), maxScore: Number(attempt.max_score), percentage: Number(attempt.percentage),
      passed: attempt.passed === null ? null : Boolean(attempt.passed),
      startedAt: attempt.started_at, submittedAt: attempt.submitted_at, expiresAt: attempt.expires_at,
      employee: employee ? { id: attempt.employee_id, name: `${employee.first_name} ${employee.last_name}`, employeeNo: employee.employee_no } : null,
      answers: answers.map((a) => ({
        questionId: a.question_id, questionText: a.question_text, questionType: a.question_type, points: Number(a.points),
        selectedOptionIds: typeof a.selected_option_ids === 'string' ? JSON.parse(a.selected_option_ids) : (a.selected_option_ids ?? null),
        textAnswer: a.text_answer, isCorrect: a.is_correct === null ? null : Boolean(a.is_correct),
        pointsAwarded: Number(a.points_awarded), needsManualReview: Boolean(a.needs_manual_review),
        explanation: reveal ? a.explanation : null,
        correctAnswer: reveal ? a.correct_answer : null,
        options: options.filter((o) => o.question_id === a.question_id).map((o) => ({
          id: o.id, optionText: o.option_text, isCorrect: reveal ? Boolean(o.is_correct) : undefined,
        })),
      })),
    });
  }),
);

quizzesRouter.get(
  '/:id/attempts',
  requirePermission('quiz.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const quizId = Number(req.params.id);
    const conditions: string[] = ['qa.quiz_id = ?'];
    const params: unknown[] = [quizId];
    if (isLearnerOnly(auth)) { conditions.push('qa.employee_id = ?'); params.push(auth.employee.id); }
    else if (!hasOrgWideAccess(auth) && auth.roleCode === ROLE_CODES.DEPT_ADMIN && auth.scopedDepartmentIds.length > 0) {
      const placeholders = auth.scopedDepartmentIds.map(() => '?').join(',');
      conditions.push(`e.department_id IN (${placeholders})`);
      params.push(...auth.scopedDepartmentIds);
    }
    const rows = await query(
      `SELECT qa.id, qa.attempt_number, qa.status, qa.score, qa.max_score, qa.percentage, qa.passed, qa.started_at, qa.submitted_at,
              e.id AS employee_id, e.first_name, e.last_name, e.employee_no, d.name AS department_name,
              (SELECT COUNT(*) FROM quiz_answers an WHERE an.attempt_id = qa.id AND an.needs_manual_review = 1) AS pending_review
       FROM quiz_attempts qa
       JOIN employees e ON e.id = qa.employee_id
       LEFT JOIN departments d ON d.id = e.department_id
       WHERE ${conditions.join(' AND ')} ORDER BY qa.started_at DESC`,
      params,
    );
    res.json({ items: rows.map((r) => ({
      id: r.id, attemptNumber: r.attempt_number, status: r.status, score: Number(r.score), maxScore: Number(r.max_score),
      percentage: Number(r.percentage), passed: r.passed === null ? null : Boolean(r.passed),
      startedAt: r.started_at, submittedAt: r.submitted_at, pendingReview: Number(r.pending_review),
      employee: { id: r.employee_id, name: `${r.first_name} ${r.last_name}`, employeeNo: r.employee_no, departmentName: r.department_name },
    })) });
  }),
);

// --- Trainer: manual grading ----------------------------------------------
const gradeBody = z.object({
  grades: z.array(z.object({
    questionId: z.coerce.number().int().positive(),
    pointsAwarded: z.coerce.number().min(0).max(100),
    isCorrect: z.boolean(),
  })).min(1),
});

quizzesRouter.post(
  '/attempts/:attemptId/grade',
  requirePermission('quiz.grade'),
  csrfProtection,
  validate(z.object({ attemptId: z.coerce.number().int().positive() }), 'params'),
  validate(gradeBody),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const attemptId = Number(req.params.attemptId);
    const body = req.body as z.infer<typeof gradeBody>;
    const attempt = await queryOne<RowDataPacket & { quiz_id: number; employee_id: number; enrollment_id: number | null; status: string }>(
      'SELECT id, quiz_id, employee_id, enrollment_id, status FROM quiz_attempts WHERE id = ?',
      [attemptId],
    );
    if (!attempt) throw notFound('Attempt not found');
    if (attempt.status === 'in_progress') throw badRequest('Cannot grade an attempt that has not been submitted');

    const questions = await query<RowDataPacket & { id: number; points: string }>('SELECT id, points FROM quiz_questions WHERE quiz_id = ?', [attempt.quiz_id]);
    const pointsByQuestion = new Map(questions.map((q) => [q.id, Number(q.points)]));
    for (const grade of body.grades) {
      const max = pointsByQuestion.get(grade.questionId);
      if (max === undefined) throw badRequest(`Question ${grade.questionId} is not part of this assessment`);
      if (grade.pointsAwarded > max) throw badRequest(`Points awarded exceed the question maximum (${max})`);
    }

    await withTransaction(async (conn) => {
      for (const grade of body.grades) {
        await conn.execute(
          'UPDATE quiz_answers SET points_awarded = ?, is_correct = ?, needs_manual_review = 0 WHERE attempt_id = ? AND question_id = ?',
          [grade.pointsAwarded, grade.isCorrect ? 1 : 0, attemptId, grade.questionId],
        );
      }
      const [totals] = await conn.execute<RowDataPacket[]>(
        'SELECT COALESCE(SUM(points_awarded), 0) AS earned, (SELECT COALESCE(SUM(points), 0) FROM quiz_questions WHERE quiz_id = ?) AS max_score, (SELECT COUNT(*) FROM quiz_answers WHERE attempt_id = ? AND needs_manual_review = 1) AS pending FROM quiz_answers WHERE attempt_id = ?',
        [attempt.quiz_id, attemptId, attemptId],
      );
      const earned = Number(totals[0].earned);
      const maxScore = Number(totals[0].max_score);
      const pending = Number(totals[0].pending);
      const percentage = maxScore === 0 ? 0 : Number(((earned / maxScore) * 100).toFixed(2));
      const quiz = await conn.execute<RowDataPacket[]>('SELECT passing_score FROM quizzes WHERE id = ?', [attempt.quiz_id]).then(([r]) => r[0]);
      const fullyGraded = pending === 0;
      const passed = fullyGraded ? percentage >= Number(quiz.passing_score) : null;
      await conn.execute(
        "UPDATE quiz_attempts SET score = ?, max_score = ?, percentage = ?, passed = ?, status = CASE WHEN ? = 1 THEN 'graded' ELSE 'submitted' END, graded_at = CASE WHEN ? = 1 THEN NOW() ELSE graded_at END, graded_by = ? WHERE id = ?",
        [earned, maxScore, percentage, passed === null ? null : passed ? 1 : 0, fullyGraded ? 1 : 0, fullyGraded ? 1 : 0, auth.userId, attemptId],
      );
    });

    const refreshed = await queryOne<RowDataPacket & { percentage: string; passed: number | null; status: string }>('SELECT percentage, passed, status FROM quiz_attempts WHERE id = ?', [attemptId]);
    const learnerUser = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM users WHERE employee_id = ?', [attempt.employee_id]);
    if (learnerUser) {
      await execute(
        `INSERT INTO notifications (user_id, type, title, message, link) VALUES (?, 'assessment_result', 'Assessment graded', ?, '/learner/certificates')`,
        [learnerUser.id, `Your assessment was graded: ${Number(refreshed!.percentage).toFixed(1)}% — ${refreshed!.passed ? 'PASSED' : 'FAILED'}.`],
      );
    }
    let completion = { completed: false, certificateNumber: null as string | null };
    if (refreshed!.passed && attempt.enrollment_id) completion = await tryCompleteCourse(attempt.enrollment_id);

    recordAudit(req, { action: 'quiz.attempt_graded', entityType: 'quiz_attempt', entityId: attemptId, description: `Manually graded attempt ${attemptId}` });
    res.json({ percentage: Number(refreshed!.percentage), passed: refreshed!.passed === null ? null : Boolean(refreshed!.passed), status: refreshed!.status, courseCompleted: completion.completed, certificateNumber: completion.certificateNumber });
  }),
);
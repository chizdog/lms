import { Router } from 'express';
import { z } from 'zod';
import dayjs from 'dayjs';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { query, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { validate } from '../middleware/validate';
import { requirePermission, requireAuthed, employeeScope } from '../middleware/rbac';
import { asyncHandler, recordAudit } from '../utils/http';
import { dateRangeQuery } from '../utils/query';
import { badRequest, notFound } from '../utils/errors';
import type { AuthContext } from '../types/express';

export const reportsRouter = Router();
reportsRouter.use(requireAuth, requirePermission('report.view'));

interface ReportColumn {
  key: string;
  label: string;
  width?: number;
}

interface ReportResult {
  type: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
}

type Filters = z.infer<typeof dateRangeQuery>;

const REPORT_TYPES: { type: string; title: string; description: string }[] = [
  { type: 'completion', title: 'Employee Training Completion', description: 'Per-employee assigned, completed, in-progress and overdue training with completion rate.' },
  { type: 'department', title: 'Department Training Performance', description: 'Training volume and completion rate aggregated by department.' },
  { type: 'enrollment', title: 'Course Enrollment', description: 'Enrollment, completion and average progress per course.' },
  { type: 'assessment', title: 'Assessment Results', description: 'Every assessment attempt with score, percentage and pass/fail status.' },
  { type: 'failed', title: 'Failed Assessment', description: 'Assessment attempts that did not meet the passing score.' },
  { type: 'overdue', title: 'Overdue Training', description: 'Assigned training past its deadline and not yet completed.' },
  { type: 'history', title: 'Training History', description: 'Chronological record of enrollments and completions.' },
  { type: 'effectiveness', title: 'Course Effectiveness', description: 'Average assessment score, pass rate and completion rate per course.' },
];

function baseFilters(q: Filters, auth: AuthContext, employeeAlias = 'e'): { conditions: string[]; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (q.departmentId) { conditions.push(`${employeeAlias}.department_id = ?`); params.push(q.departmentId); }
  if (q.branchId) { conditions.push(`${employeeAlias}.branch_id = ?`); params.push(q.branchId); }
  if (q.employeeId) { conditions.push(`${employeeAlias}.id = ?`); params.push(q.employeeId); }
  if (q.courseId) { conditions.push('ce.course_id = ?'); params.push(q.courseId); }
  const scope = employeeScope(auth, employeeAlias);
  if (scope.sql) { conditions.push(scope.sql.replace(/^ AND /, '')); params.push(...scope.params); }
  return { conditions, params };
}

function pushDate(conditions: string[], params: unknown[], column: string, q: Filters): void {
  if (q.dateFrom) { conditions.push(`${column} >= ?`); params.push(`${q.dateFrom} 00:00:00`); }
  if (q.dateTo) { conditions.push(`${column} <= ?`); params.push(`${q.dateTo} 23:59:59`); }
}

function where(conditions: string[]): string {
  return conditions.length ? conditions.join(' AND ') : '1=1';
}

function num(value: unknown): number {
  return value === null || value === undefined ? 0 : Number(value);
}

async function buildCompletion(q: Filters, auth: AuthContext): Promise<ReportResult> {
  // Employee-level filters live in WHERE; enrollment-level filters live in the
  // LEFT JOIN ON clause so employees with no matching training still appear.
  const whereConditions: string[] = [];
  const whereParams: unknown[] = [];
  if (q.departmentId) { whereConditions.push('e.department_id = ?'); whereParams.push(q.departmentId); }
  if (q.branchId) { whereConditions.push('e.branch_id = ?'); whereParams.push(q.branchId); }
  if (q.employeeId) { whereConditions.push('e.id = ?'); whereParams.push(q.employeeId); }
  const scope = employeeScope(auth, 'e');
  if (scope.sql) { whereConditions.push(scope.sql.replace(/^ AND /, '')); whereParams.push(...scope.params); }

  const onConditions = ['ce.employee_id = e.id'];
  const onParams: unknown[] = [];
  if (q.courseId) { onConditions.push('ce.course_id = ?'); onParams.push(q.courseId); }
  if (q.dateFrom) { onConditions.push('ce.enrolled_at >= ?'); onParams.push(`${q.dateFrom} 00:00:00`); }
  if (q.dateTo) { onConditions.push('ce.enrolled_at <= ?'); onParams.push(`${q.dateTo} 23:59:59`); }

  const rows = await query(
    `SELECT e.employee_no, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department_name, b.name AS branch_name, e.position,
            COUNT(ce.id) AS assigned,
            SUM((ce.status = 'completed')::int) AS completed,
            SUM((ce.status = 'in_progress')::int) AS in_progress,
            SUM((ce.status = 'assigned')::int) AS not_started,
            SUM((ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed')::int) AS overdue,
            ROUND(COALESCE(AVG(ce.progress_percent), 0), 1) AS avg_progress,
            ROUND(100.0 * COALESCE(SUM((ce.status = 'completed')::int), 0) / NULLIF(COUNT(ce.id), 0), 1) AS completion_rate
     FROM employees e
     LEFT JOIN course_enrollments ce ON ${onConditions.join(' AND ')}
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ${where(whereConditions)}
     GROUP BY e.id, e.employee_no, employee_name, d.name, b.name, e.position
     ORDER BY completion_rate DESC, employee_name ASC`,
    [...onParams, ...whereParams],
  );
  const mapped = rows.map((r) => ({
    employeeNo: r.employee_no, employeeName: r.employee_name, department: r.department_name ?? '—',
    branch: r.branch_name ?? '—', position: r.position ?? '—',
    assigned: num(r.assigned), completed: num(r.completed), inProgress: num(r.in_progress),
    notStarted: num(r.not_started), overdue: num(r.overdue),
    avgProgress: num(r.avg_progress), completionRate: num(r.completion_rate),
  }));
  const totalAssigned = mapped.reduce((s, r) => s + r.assigned, 0);
  const totalCompleted = mapped.reduce((s, r) => s + r.completed, 0);
  return {
    type: 'completion', title: 'Employee Training Completion',
    columns: [
      { key: 'employeeNo', label: 'Employee No', width: 14 },
      { key: 'employeeName', label: 'Employee', width: 24 },
      { key: 'department', label: 'Department', width: 20 },
      { key: 'branch', label: 'Branch', width: 18 },
      { key: 'position', label: 'Position', width: 20 },
      { key: 'assigned', label: 'Assigned', width: 10 },
      { key: 'completed', label: 'Completed', width: 10 },
      { key: 'inProgress', label: 'In Progress', width: 11 },
      { key: 'notStarted', label: 'Not Started', width: 11 },
      { key: 'overdue', label: 'Overdue', width: 9 },
      { key: 'avgProgress', label: 'Avg Progress %', width: 13 },
      { key: 'completionRate', label: 'Completion %', width: 12 },
    ],
    rows: mapped,
    summary: { employees: mapped.length, totalAssigned, totalCompleted, overallCompletionRate: totalAssigned ? Number(((totalCompleted / totalAssigned) * 100).toFixed(1)) : 0 },
  };
}

async function buildDepartment(q: Filters, auth: AuthContext): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  pushDate(conditions, params, 'ce.enrolled_at', q);
  const rows = await query(
    `SELECT d.name AS department_name,
            COUNT(DISTINCT e.id) AS employees,
            COUNT(ce.id) AS enrollments,
            SUM((ce.status = 'completed')::int) AS completed,
            SUM((ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed')::int) AS overdue,
            ROUND(COALESCE(AVG(ce.progress_percent), 0), 1) AS avg_progress,
            ROUND(100.0 * COALESCE(SUM((ce.status = 'completed')::int), 0) / NULLIF(COUNT(ce.id), 0), 1) AS completion_rate
     FROM course_enrollments ce
     JOIN employees e ON e.id = ce.employee_id
     JOIN departments d ON d.id = e.department_id
     WHERE ${where(conditions)}
     GROUP BY d.id, d.name
     ORDER BY completion_rate DESC, d.name ASC`,
    params,
  );
  const mapped = rows.map((r) => ({
    department: r.department_name, employees: num(r.employees), enrollments: num(r.enrollments),
    completed: num(r.completed), overdue: num(r.overdue), avgProgress: num(r.avg_progress), completionRate: num(r.completion_rate),
  }));
  return {
    type: 'department', title: 'Department Training Performance',
    columns: [
      { key: 'department', label: 'Department', width: 28 },
      { key: 'employees', label: 'Employees', width: 12 },
      { key: 'enrollments', label: 'Enrollments', width: 13 },
      { key: 'completed', label: 'Completed', width: 12 },
      { key: 'overdue', label: 'Overdue', width: 10 },
      { key: 'avgProgress', label: 'Avg Progress %', width: 14 },
      { key: 'completionRate', label: 'Completion %', width: 13 },
    ],
    rows: mapped,
    summary: { departments: mapped.length, totalEnrollments: mapped.reduce((s, r) => s + r.enrollments, 0) },
  };
}

async function buildEnrollment(q: Filters, auth: AuthContext): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  pushDate(conditions, params, 'ce.enrolled_at', q);
  const rows = await query(
    `SELECT c.code AS course_code, c.title AS course_title, cat.name AS category_name, c.course_type,
            COUNT(ce.id) AS enrolled,
            SUM((ce.status = 'completed')::int) AS completed,
            SUM((ce.status = 'in_progress')::int) AS in_progress,
            SUM((ce.status = 'assigned')::int) AS not_started,
            ROUND(COALESCE(AVG(ce.progress_percent), 0), 1) AS avg_progress,
            ROUND(100.0 * COALESCE(SUM((ce.status = 'completed')::int), 0) / NULLIF(COUNT(ce.id), 0), 1) AS completion_rate
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     JOIN employees e ON e.id = ce.employee_id
     LEFT JOIN course_categories cat ON cat.id = c.category_id
     WHERE ${where(conditions)}
     GROUP BY c.id, c.code, c.title, cat.name, c.course_type
     ORDER BY enrolled DESC, c.title ASC`,
    params,
  );
  const mapped = rows.map((r) => ({
    courseCode: r.course_code, courseTitle: r.course_title, category: r.category_name ?? '—',
    courseType: r.course_type, enrolled: num(r.enrolled), completed: num(r.completed),
    inProgress: num(r.in_progress), notStarted: num(r.not_started), avgProgress: num(r.avg_progress), completionRate: num(r.completion_rate),
  }));
  return {
    type: 'enrollment', title: 'Course Enrollment',
    columns: [
      { key: 'courseCode', label: 'Code', width: 12 },
      { key: 'courseTitle', label: 'Course', width: 30 },
      { key: 'category', label: 'Category', width: 22 },
      { key: 'courseType', label: 'Type', width: 12 },
      { key: 'enrolled', label: 'Enrolled', width: 10 },
      { key: 'completed', label: 'Completed', width: 11 },
      { key: 'inProgress', label: 'In Progress', width: 11 },
      { key: 'notStarted', label: 'Not Started', width: 11 },
      { key: 'avgProgress', label: 'Avg Progress %', width: 13 },
      { key: 'completionRate', label: 'Completion %', width: 12 },
    ],
    rows: mapped,
    summary: { courses: mapped.length, totalEnrolled: mapped.reduce((s, r) => s + r.enrolled, 0) },
  };
}

async function buildAssessment(q: Filters, auth: AuthContext, onlyFailed = false): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  pushDate(conditions, params, 'qa.submitted_at', q);
  if (onlyFailed) conditions.push('qa.passed = 0');
  else conditions.push("qa.status IN ('submitted', 'graded')");
  const rows = await query(
    `SELECT e.employee_no, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department_name, c.title AS course_title, qz.title AS quiz_title,
            qa.attempt_number, qa.score, qa.max_score, qa.percentage, qa.passed, qa.status,
            qa.submitted_at, qz.passing_score
     FROM quiz_attempts qa
     JOIN quizzes qz ON qz.id = qa.quiz_id
     JOIN courses c ON c.id = qz.course_id
     JOIN employees e ON e.id = qa.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${where(conditions)}
     ORDER BY qa.submitted_at DESC, e.last_name ASC`,
    params,
  );
  const mapped = rows.map((r) => ({
    employeeNo: r.employee_no, employeeName: r.employee_name, department: r.department_name ?? '—',
    course: r.course_title, quiz: r.quiz_title, attempt: num(r.attempt_number),
    score: `${num(r.score)} / ${num(r.max_score)}`, percentage: num(r.percentage),
    passingScore: num(r.passing_score), result: r.passed ? 'Passed' : 'Failed',
    status: r.status, submittedAt: r.submitted_at ?? '—',
  }));
  const passed = mapped.filter((r) => r.result === 'Passed').length;
  return {
    type: onlyFailed ? 'failed' : 'assessment',
    title: onlyFailed ? 'Failed Assessment' : 'Assessment Results',
    columns: [
      { key: 'employeeNo', label: 'Employee No', width: 13 },
      { key: 'employeeName', label: 'Employee', width: 22 },
      { key: 'department', label: 'Department', width: 18 },
      { key: 'course', label: 'Course', width: 26 },
      { key: 'quiz', label: 'Assessment', width: 24 },
      { key: 'attempt', label: 'Attempt', width: 8 },
      { key: 'score', label: 'Score', width: 12 },
      { key: 'percentage', label: 'Percent %', width: 10 },
      { key: 'passingScore', label: 'Pass %', width: 8 },
      { key: 'result', label: 'Result', width: 9 },
      { key: 'submittedAt', label: 'Submitted', width: 18 },
    ],
    rows: mapped,
    summary: { attempts: mapped.length, passed, failed: mapped.length - passed, passRate: mapped.length ? Number(((passed / mapped.length) * 100).toFixed(1)) : 0 },
  };
}

async function buildOverdue(q: Filters, auth: AuthContext): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  conditions.push("ce.status <> 'completed'");
  conditions.push('ce.due_date IS NOT NULL');
  conditions.push('ce.due_date < CURDATE()');
  if (q.dateFrom) { conditions.push('ce.due_date >= ?'); params.push(q.dateFrom); }
  if (q.dateTo) { conditions.push('ce.due_date <= ?'); params.push(q.dateTo); }
  const rows = await query(
    `SELECT e.employee_no, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department_name, b.name AS branch_name, c.title AS course_title, c.course_type,
            ce.due_date, ce.progress_percent, ce.status,
            (CURRENT_DATE - ce.due_date::date) AS days_overdue
     FROM course_enrollments ce
     JOIN employees e ON e.id = ce.employee_id
     JOIN courses c ON c.id = ce.course_id
     LEFT JOIN departments d ON d.id = e.department_id
     LEFT JOIN branches b ON b.id = e.branch_id
     WHERE ${where(conditions)}
     ORDER BY days_overdue DESC, e.last_name ASC`,
    params,
  );
  const mapped = rows.map((r) => ({
    employeeNo: r.employee_no, employeeName: r.employee_name, department: r.department_name ?? '—',
    branch: r.branch_name ?? '—', course: r.course_title, courseType: r.course_type,
    dueDate: r.due_date, daysOverdue: num(r.days_overdue), progress: num(r.progress_percent), status: r.status,
  }));
  return {
    type: 'overdue', title: 'Overdue Training',
    columns: [
      { key: 'employeeNo', label: 'Employee No', width: 13 },
      { key: 'employeeName', label: 'Employee', width: 22 },
      { key: 'department', label: 'Department', width: 18 },
      { key: 'branch', label: 'Branch', width: 16 },
      { key: 'course', label: 'Course', width: 28 },
      { key: 'courseType', label: 'Type', width: 11 },
      { key: 'dueDate', label: 'Due Date', width: 12 },
      { key: 'daysOverdue', label: 'Days Overdue', width: 12 },
      { key: 'progress', label: 'Progress %', width: 11 },
    ],
    rows: mapped,
    summary: { overdueCount: mapped.length, mandatory: mapped.filter((r) => r.courseType === 'mandatory').length },
  };
}

async function buildHistory(q: Filters, auth: AuthContext): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  pushDate(conditions, params, 'ce.enrolled_at', q);
  const rows = await query(
    `SELECT e.employee_no, CONCAT(e.first_name, ' ', e.last_name) AS employee_name,
            d.name AS department_name, c.title AS course_title, c.code AS course_code,
            ce.assignment_type, ce.status, ce.progress_percent, ce.enrolled_at, ce.started_at, ce.completed_at, ce.due_date
     FROM course_enrollments ce
     JOIN employees e ON e.id = ce.employee_id
     JOIN courses c ON c.id = ce.course_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE ${where(conditions)}
     ORDER BY ce.enrolled_at DESC, e.last_name ASC`,
    params,
  );
  const mapped = rows.map((r) => ({
    employeeNo: r.employee_no, employeeName: r.employee_name, department: r.department_name ?? '—',
    courseCode: r.course_code, course: r.course_title, assignmentType: r.assignment_type,
    status: r.status, progress: num(r.progress_percent),
    enrolledAt: r.enrolled_at, startedAt: r.started_at ?? '—', completedAt: r.completed_at ?? '—', dueDate: r.due_date ?? '—',
  }));
  return {
    type: 'history', title: 'Training History',
    columns: [
      { key: 'employeeNo', label: 'Employee No', width: 13 },
      { key: 'employeeName', label: 'Employee', width: 22 },
      { key: 'department', label: 'Department', width: 18 },
      { key: 'course', label: 'Course', width: 28 },
      { key: 'assignmentType', label: 'Assigned Via', width: 12 },
      { key: 'status', label: 'Status', width: 12 },
      { key: 'progress', label: 'Progress %', width: 11 },
      { key: 'enrolledAt', label: 'Enrolled', width: 18 },
      { key: 'completedAt', label: 'Completed', width: 18 },
    ],
    rows: mapped,
    summary: { records: mapped.length, completed: mapped.filter((r) => r.status === 'completed').length },
  };
}

async function buildEffectiveness(q: Filters, auth: AuthContext): Promise<ReportResult> {
  const { conditions, params } = baseFilters(q, auth);
  pushDate(conditions, params, 'ce.enrolled_at', q);
  const enrollmentRows = await query(
    `SELECT c.id AS course_id, c.code AS course_code, c.title AS course_title, cat.name AS category_name,
            COUNT(ce.id) AS enrolled,
            SUM((ce.status = 'completed')::int) AS completed,
            ROUND(100.0 * COALESCE(SUM((ce.status = 'completed')::int), 0) / NULLIF(COUNT(ce.id), 0), 1) AS completion_rate
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     JOIN employees e ON e.id = ce.employee_id
     LEFT JOIN course_categories cat ON cat.id = c.category_id
     WHERE ${where(conditions)}
     GROUP BY c.id, c.code, c.title, cat.name`,
    params,
  );
  const assessmentConditions = ['1=1'];
  const assessmentParams: unknown[] = [];
  if (q.courseId) { assessmentConditions.push('qz.course_id = ?'); assessmentParams.push(q.courseId); }
  if (q.dateFrom) { assessmentConditions.push('qa.submitted_at >= ?'); assessmentParams.push(`${q.dateFrom} 00:00:00`); }
  if (q.dateTo) { assessmentConditions.push('qa.submitted_at <= ?'); assessmentParams.push(`${q.dateTo} 23:59:59`); }
  const assessmentRows = await query(
    `SELECT qz.course_id,
            COUNT(qa.id) AS attempts,
            ROUND(COALESCE(AVG(qa.percentage), 0), 1) AS avg_score,
            ROUND(100.0 * COALESCE(SUM((qa.passed = 1)::int), 0) / NULLIF(COUNT(qa.id), 0), 1) AS pass_rate,
            ROUND(COALESCE(AVG(qa.attempt_number), 0), 2) AS avg_attempts
     FROM quiz_attempts qa
     JOIN quizzes qz ON qz.id = qa.quiz_id
     WHERE qa.status IN ('submitted', 'graded') AND ${assessmentConditions.join(' AND ')}
     GROUP BY qz.course_id`,
    assessmentParams,
  );
  const assessmentByCourse = new Map(assessmentRows.map((r) => [Number(r.course_id), r]));
  const mapped = enrollmentRows.map((r) => {
    const a = assessmentByCourse.get(Number(r.course_id));
    return {
      courseCode: r.course_code, courseTitle: r.course_title, category: r.category_name ?? '—',
      enrolled: num(r.enrolled), completed: num(r.completed), completionRate: num(r.completion_rate),
      attempts: a ? num(a.attempts) : 0, avgScore: a ? num(a.avg_score) : 0,
      passRate: a ? num(a.pass_rate) : 0, avgAttempts: a ? num(a.avg_attempts) : 0,
    };
  }).sort((x, y) => y.completionRate - x.completionRate);
  return {
    type: 'effectiveness', title: 'Course Effectiveness',
    columns: [
      { key: 'courseCode', label: 'Code', width: 12 },
      { key: 'courseTitle', label: 'Course', width: 30 },
      { key: 'category', label: 'Category', width: 22 },
      { key: 'enrolled', label: 'Enrolled', width: 10 },
      { key: 'completionRate', label: 'Completion %', width: 12 },
      { key: 'attempts', label: 'Attempts', width: 10 },
      { key: 'avgScore', label: 'Avg Score %', width: 12 },
      { key: 'passRate', label: 'Pass Rate %', width: 12 },
      { key: 'avgAttempts', label: 'Avg Attempts', width: 12 },
    ],
    rows: mapped,
    summary: { courses: mapped.length },
  };
}

async function buildReport(type: string, q: Filters, auth: AuthContext): Promise<ReportResult> {
  switch (type) {
    case 'completion': return buildCompletion(q, auth);
    case 'department': return buildDepartment(q, auth);
    case 'enrollment': return buildEnrollment(q, auth);
    case 'assessment': return buildAssessment(q, auth, false);
    case 'failed': return buildAssessment(q, auth, true);
    case 'overdue': return buildOverdue(q, auth);
    case 'history': return buildHistory(q, auth);
    case 'effectiveness': return buildEffectiveness(q, auth);
    default: throw notFound('Unknown report type');
  }
}

reportsRouter.get('/types', (_req, res) => {
  res.json({ items: REPORT_TYPES });
});

const reportQuery = dateRangeQuery.extend({
  format: z.enum(['json', 'csv', 'xlsx', 'pdf']).default('json'),
});

reportsRouter.get(
  '/:type',
  validate(z.object({ type: z.string().trim().max(40) }), 'params'),
  validate(reportQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    const type = String(req.params.type);
    const q = req.query as unknown as z.infer<typeof reportQuery>;
    if (!REPORT_TYPES.some((r) => r.type === type)) throw notFound('Unknown report type');
    const report = await buildReport(type, q, auth);

    if (q.format === 'json') {
      res.json(report);
      return;
    }
    if (!auth.permissions.has('report.export')) throw badRequest('Your role cannot export reports');

    const stamp = dayjs().format('YYYYMMDD-HHmm');
    const baseName = `bfc-${type}-${stamp}`;
    recordAudit(req, { action: 'report.exported', entityType: 'report', description: `Exported ${report.title} as ${q.format} (${report.rows.length} rows)` });

    if (q.format === 'csv') {
      const escape = (value: unknown) => {
        const text = value === null || value === undefined ? '' : String(value);
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
      };
      const lines = [report.columns.map((c) => escape(c.label)).join(',')];
      for (const row of report.rows) lines.push(report.columns.map((c) => escape(row[c.key])).join(','));
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.csv"`);
      res.send(lines.join('\n'));
      return;
    }

    if (q.format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet(report.title.slice(0, 31));
      sheet.columns = report.columns.map((c) => ({ header: c.label, key: c.key, width: c.width ?? 16 }));
      sheet.getRow(1).font = { bold: true };
      report.rows.forEach((row) => sheet.addRow(row));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${baseName}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    // PDF
    const pdf = await renderReportPdf(report, q);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${baseName}.pdf"`);
    res.send(pdf);
  }),
);

function filterSummary(q: Filters): string {
  const parts: string[] = [];
  if (q.dateFrom || q.dateTo) parts.push(`Period: ${q.dateFrom ?? '…'} to ${q.dateTo ?? '…'}`);
  if (q.departmentId) parts.push(`Department #${q.departmentId}`);
  if (q.branchId) parts.push(`Branch #${q.branchId}`);
  if (q.courseId) parts.push(`Course #${q.courseId}`);
  if (q.employeeId) parts.push(`Employee #${q.employeeId}`);
  return parts.length ? parts.join('   ·   ') : 'All records';
}

async function renderReportPdf(report: ReportResult, q: Filters): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const left = doc.page.margins.left;
    const right = pageW - doc.page.margins.right;
    const usable = right - left;
    const totalWeight = report.columns.reduce((s, c) => s + (c.width ?? 16), 0);
    const colWidths = report.columns.map((c) => ((c.width ?? 16) / totalWeight) * usable);
    const colX: number[] = [];
    let acc = left;
    for (const w of colWidths) { colX.push(acc); acc += w; }
    const rowH = 18;
    const headerH = 22;

    const drawHeader = () => {
      doc.fillColor('#C8952F').font('Helvetica-Bold').fontSize(10)
        .text('BUT FIRST, COFFEE  ·  LEARNING & DEVELOPMENT', left, 36, { width: usable, align: 'left', characterSpacing: 1 });
      doc.fillColor('#111111').font('Helvetica-Bold').fontSize(18)
        .text(report.title, left, 52, { width: usable });
      doc.fillColor('#777777').font('Helvetica').fontSize(8.5)
        .text(`Generated ${dayjs().format('MMMM D, YYYY HH:mm')}   ·   ${filterSummary(q)}   ·   ${report.rows.length} rows`, left, 76, { width: usable });
      doc.moveTo(left, 92).lineTo(right, 92).lineWidth(0.75).stroke('#C8952F');
    };

    const drawTableHeader = (y: number) => {
      doc.rect(left, y, usable, headerH).fill('#111111');
      doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(8);
      report.columns.forEach((c, i) => {
        doc.text(c.label, colX[i] + 4, y + 7, { width: colWidths[i] - 8, align: 'left', lineBreak: false });
      });
      return y + headerH;
    };

    drawHeader();
    let y = drawTableHeader(100);
    doc.font('Helvetica').fontSize(8);

    report.rows.forEach((row, index) => {
      if (y + rowH > doc.page.height - doc.page.margins.bottom - 24) {
        doc.addPage();
        drawHeader();
        y = drawTableHeader(100);
        doc.font('Helvetica').fontSize(8);
      }
      if (index % 2 === 1) doc.rect(left, y, usable, rowH).fill('#F4F1EA');
      doc.fillColor('#222222');
      report.columns.forEach((c, i) => {
        const value = row[c.key];
        const text = value === null || value === undefined ? '' : String(value);
        doc.text(text, colX[i] + 4, y + 5, { width: colWidths[i] - 8, align: 'left', lineBreak: false, ellipsis: true });
      });
      y += rowH;
    });

    doc.moveTo(left, y + 4).lineTo(right, y + 4).lineWidth(0.5).stroke('#CCCCCC');
    doc.fillColor('#999999').font('Helvetica').fontSize(7.5)
      .text('But First, Coffee — Confidential training report. Generated by the BFC Learning Management System.', left, y + 10, { width: usable, align: 'center' });

    doc.end();
  });
}
import { Router } from 'express';
import { query, queryOne, RowDataPacket } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { requirePermission, requireAuthed, hasOrgWideAccess, isLearnerOnly } from '../middleware/rbac';
import { asyncHandler } from '../utils/http';
import { ROLE_CODES } from '../config/permissions';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

dashboardRouter.get(
  '/',
  requirePermission('dashboard.view'),
  asyncHandler(async (req, res) => {
    const auth = requireAuthed(req);
    if (isLearnerOnly(auth)) {
      res.json(await learnerDashboard(auth.employee.id));
      return;
    }
    res.json(await adminDashboard(auth));
  }),
);

async function learnerDashboard(employeeId: number) {
  const counts = await queryOne<RowDataPacket & { assigned: number; in_progress: number; completed: number; overdue: number }>(
    `SELECT
       SUM((status = 'assigned')::int) AS assigned,
       SUM((status = 'in_progress')::int) AS in_progress,
       SUM((status = 'completed')::int) AS completed,
       SUM((due_date IS NOT NULL AND due_date < CURDATE() AND status <> 'completed')::int) AS overdue
     FROM course_enrollments WHERE employee_id = ?`,
    [employeeId],
  );
  const pendingAssessments = await queryOne<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM quizzes q
     JOIN course_enrollments ce ON ce.course_id = q.course_id
     WHERE ce.employee_id = ? AND q.is_active = 1 AND ce.status <> 'completed'
       AND NOT EXISTS (SELECT 1 FROM quiz_attempts qa WHERE qa.quiz_id = q.id AND qa.employee_id = ce.employee_id AND qa.passed = 1)`,
    [employeeId],
  );
  const upcoming = await query(
    `SELECT ce.id, ce.due_date, c.id AS course_id, c.title, c.thumbnail_path FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     WHERE ce.employee_id = ? AND ce.status <> 'completed' AND ce.due_date IS NOT NULL AND ce.due_date >= CURDATE()
     ORDER BY ce.due_date ASC LIMIT 5`,
    [employeeId],
  );
  const inProgress = await query(
    `SELECT ce.id, ce.progress_percent, ce.due_date, c.id AS course_id, c.title, c.thumbnail_path,
            (ce.due_date IS NOT NULL AND ce.due_date < CURDATE()) AS is_overdue
     FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
     WHERE ce.employee_id = ? AND ce.status = 'in_progress' ORDER BY ce.last_accessed_at DESC LIMIT 6`,
    [employeeId],
  );
  const certificates = await queryOne<RowDataPacket & { total: number }>('SELECT COUNT(*) AS total FROM certificates WHERE employee_id = ? AND revoked_at IS NULL', [employeeId]);
  const recentCompleted = await query(
    `SELECT c.title, ce.completed_at FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
     WHERE ce.employee_id = ? AND ce.status = 'completed' ORDER BY ce.completed_at DESC LIMIT 5`,
    [employeeId],
  );
  const learningTrend = await query(
    `SELECT to_char(completed_at, 'YYYY-MM') AS month, COUNT(*) AS completed
     FROM course_enrollments WHERE employee_id = ? AND completed_at IS NOT NULL AND completed_at >= (CURRENT_DATE - INTERVAL '6 months')
     GROUP BY month ORDER BY month`,
    [employeeId],
  );

  return {
    role: 'learner',
    stats: {
      assigned: Number(counts?.assigned ?? 0),
      inProgress: Number(counts?.in_progress ?? 0),
      completed: Number(counts?.completed ?? 0),
      overdue: Number(counts?.overdue ?? 0),
      pendingAssessments: Number(pendingAssessments?.total ?? 0),
      certificates: Number(certificates?.total ?? 0),
    },
    upcoming: upcoming.map((r) => ({ enrollmentId: r.id, courseId: r.course_id, dueDate: r.due_date, title: r.title, thumbnailPath: r.thumbnail_path })),
    inProgress: inProgress.map((r) => ({ enrollmentId: r.id, courseId: r.course_id, title: r.title, thumbnailPath: r.thumbnail_path, progressPercent: Number(r.progress_percent), dueDate: r.due_date, isOverdue: Boolean(r.is_overdue) })),
    recentCompleted: recentCompleted.map((r) => ({ title: r.title, completedAt: r.completed_at })),
    learningTrend: learningTrend.map((r) => ({ month: r.month, completed: Number(r.completed) })),
  };
}

async function adminDashboard(auth: NonNullable<import('../types/express').AuthContext>) {
  const scopeParams: unknown[] = [];
  let employeeFilter = '';
  let enrollmentFilter = '';
  if (auth.roleCode === ROLE_CODES.DEPT_ADMIN && !hasOrgWideAccess(auth)) {
    if (auth.scopedDepartmentIds.length > 0) {
      const placeholders = auth.scopedDepartmentIds.map(() => '?').join(',');
      employeeFilter = ` AND e.department_id IN (${placeholders})`;
      enrollmentFilter = ` AND e.department_id IN (${placeholders})`;
      scopeParams.push(...auth.scopedDepartmentIds);
    } else {
      employeeFilter = ' AND e.id = ?';
      enrollmentFilter = ' AND e.id = ?';
      scopeParams.push(auth.employee.id);
    }
  }

  const employeeCount = await queryOne<RowDataPacket & { total: number }>(`SELECT COUNT(*) AS total FROM employees e WHERE e.is_active = 1 ${employeeFilter}`, scopeParams);
  const courseStats = await queryOne<RowDataPacket & { total: number; published: number; draft: number; archived: number }>(
    "SELECT COUNT(*) AS total, SUM((status = 'published')::int) AS published, SUM((status = 'draft')::int) AS draft, SUM((status = 'archived')::int) AS archived FROM courses",
  );
  const enrollmentStats = await queryOne<RowDataPacket & { total: number; completed: number; in_progress: number; assigned: number; overdue: number }>(
    `SELECT COUNT(*) AS total,
            SUM((ce.status = 'completed')::int) AS completed,
            SUM((ce.status = 'in_progress')::int) AS in_progress,
            SUM((ce.status = 'assigned')::int) AS assigned,
            SUM((ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed')::int) AS overdue
     FROM course_enrollments ce JOIN employees e ON e.id = ce.employee_id WHERE 1=1 ${enrollmentFilter}`,
    scopeParams,
  );
  const totalEnrollments = Number(enrollmentStats?.total ?? 0);
  const completedEnrollments = Number(enrollmentStats?.completed ?? 0);
  const completionRate = totalEnrollments === 0 ? 0 : Number(((completedEnrollments / totalEnrollments) * 100).toFixed(1));

  const departmentPerformance = await query(
    `SELECT d.id, d.name,
            (SELECT COUNT(*) FROM employees e WHERE e.department_id = d.id AND e.is_active = 1) AS employees,
            COUNT(ce.id) AS enrollments,
            SUM((ce.status = 'completed')::int) AS completed,
            SUM((ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed')::int) AS overdue
     FROM departments d
     LEFT JOIN employees e ON e.department_id = d.id
     LEFT JOIN course_enrollments ce ON ce.employee_id = e.id
     GROUP BY d.id, d.name ORDER BY enrollments DESC`,
  );

  const monthlyCompletions = await query(
    `SELECT to_char(ce.completed_at, 'YYYY-MM') AS month, COUNT(*) AS completed
     FROM course_enrollments ce JOIN employees e ON e.id = ce.employee_id
     WHERE ce.completed_at IS NOT NULL AND ce.completed_at >= (CURRENT_DATE - INTERVAL '6 months') ${enrollmentFilter}
     GROUP BY month ORDER BY month`,
    scopeParams,
  );

  const topCourses = await query(
    `SELECT c.id, c.title, c.thumbnail_path, COUNT(ce.id) AS enrollments,
            SUM((ce.status = 'completed')::int) AS completed,
            ROUND(AVG(ce.progress_percent), 1) AS avg_progress
     FROM courses c LEFT JOIN course_enrollments ce ON ce.course_id = c.id
     GROUP BY c.id, c.title, c.thumbnail_path ORDER BY enrollments DESC LIMIT 6`,
  );

  const assessmentStats = await queryOne<RowDataPacket & { total: number; passed: number; failed: number; pending: number }>(
    `SELECT COUNT(*) AS total, SUM((passed = 1)::int) AS passed, SUM((passed = 0)::int) AS failed, SUM((status = 'submitted')::int) AS pending
     FROM quiz_attempts qa JOIN employees e ON e.id = qa.employee_id WHERE 1=1 ${enrollmentFilter}`,
    scopeParams,
  );

  const recentActivities = await query(
    `SELECT al.id, al.action, al.description, al.created_at, u.username, e.first_name, e.last_name
     FROM audit_logs al LEFT JOIN users u ON u.id = al.user_id LEFT JOIN employees e ON e.id = u.employee_id
     ORDER BY al.created_at DESC LIMIT 10`,
  );

  const overdueList = await query(
    `SELECT ce.id, ce.due_date, c.title AS course_title, e.first_name, e.last_name, e.employee_no, d.name AS department_name
     FROM course_enrollments ce
     JOIN courses c ON c.id = ce.course_id
     JOIN employees e ON e.id = ce.employee_id
     LEFT JOIN departments d ON d.id = e.department_id
     WHERE ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed' ${enrollmentFilter}
     ORDER BY ce.due_date ASC LIMIT 8`,
    scopeParams,
  );

  const certificatesIssued = await queryOne<RowDataPacket & { total: number }>(
    `SELECT COUNT(*) AS total FROM certificates cert JOIN employees e ON e.id = cert.employee_id WHERE cert.revoked_at IS NULL ${employeeFilter.replace(/e\.department_id/g, 'e.department_id')}`,
    scopeParams,
  );

  return {
    role: 'admin',
    stats: {
      totalEmployees: Number(employeeCount?.total ?? 0),
      totalCourses: Number(courseStats?.total ?? 0),
      activeCourses: Number(courseStats?.published ?? 0),
      draftCourses: Number(courseStats?.draft ?? 0),
      archivedCourses: Number(courseStats?.archived ?? 0),
      totalEnrollments,
      completedEnrollments,
      inProgressEnrollments: Number(enrollmentStats?.in_progress ?? 0),
      assignedEnrollments: Number(enrollmentStats?.assigned ?? 0),
      overdueTraining: Number(enrollmentStats?.overdue ?? 0),
      completionRate,
      certificatesIssued: Number(certificatesIssued?.total ?? 0),
      assessmentsTaken: Number(assessmentStats?.total ?? 0),
      assessmentsPassed: Number(assessmentStats?.passed ?? 0),
      assessmentsFailed: Number(assessmentStats?.failed ?? 0),
      assessmentsPending: Number(assessmentStats?.pending ?? 0),
    },
    departmentPerformance: departmentPerformance.map((r) => ({
      id: r.id, name: r.name, employees: Number(r.employees), enrollments: Number(r.enrollments),
      completed: Number(r.completed), overdue: Number(r.overdue),
      completionRate: Number(r.enrollments) === 0 ? 0 : Number(((Number(r.completed) / Number(r.enrollments)) * 100).toFixed(1)),
    })),
    monthlyCompletions: monthlyCompletions.map((r) => ({ month: r.month, completed: Number(r.completed) })),
    topCourses: topCourses.map((r) => ({ id: r.id, title: r.title, thumbnailPath: r.thumbnail_path, enrollments: Number(r.enrollments), completed: Number(r.completed), avgProgress: Number(r.avg_progress) })),
    recentActivities: recentActivities.map((r) => ({ id: r.id, action: r.action, description: r.description, createdAt: r.created_at, actor: r.first_name ? `${r.first_name} ${r.last_name}` : r.username ?? 'System' })),
    overdueList: overdueList.map((r) => ({ enrollmentId: r.id, dueDate: r.due_date, courseTitle: r.course_title, employeeName: `${r.first_name} ${r.last_name}`, employeeNo: r.employee_no, departmentName: r.department_name })),
  };
}
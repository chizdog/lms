export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface AuthEmployee {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  fullName?: string;
  email: string;
  departmentId: number | null;
  departmentName?: string | null;
  branchId: number | null;
  branchName?: string | null;
  position: string | null;
  avatarPath?: string | null;
}

export interface Auth {
  userId: number;
  username: string;
  roleId: number;
  roleCode: string;
  roleName: string;
  permissions: string[];
  scopedDepartmentIds: number[];
  employee: AuthEmployee;
  csrfToken: string;
  mustChangePassword?: boolean;
}

export interface Employee {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  middleName?: string | null;
  fullName: string;
  email: string;
  phone?: string | null;
  departmentId: number | null;
  departmentName?: string | null;
  departmentCode?: string | null;
  branchId: number | null;
  branchName?: string | null;
  branchCode?: string | null;
  position?: string | null;
  employmentStatus: string;
  hireDate?: string | null;
  avatarPath?: string | null;
  isActive: boolean;
  createdAt?: string;
  userId?: number | null;
  username?: string | null;
  userActive?: boolean;
  roleCode?: string | null;
  roleName?: string | null;
  assignedCourses?: number;
  completedCourses?: number;
}

/** RAW snake_case rows returned by /api/departments. */
export interface Department {
  id: number;
  code: string;
  name: string;
  description: string | null;
  parent_id: number | null;
  is_active: number;
  employee_count: string;
  course_count: string;
}

/** RAW snake_case rows returned by /api/branches. */
export interface Branch {
  id: number;
  code: string;
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  is_active: number;
  employee_count: string;
}

/** RAW snake_case rows returned by /api/courses/categories. */
export interface Category {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  color: string;
  sort_order: number;
  is_active: number;
  course_count: string;
}

export interface Notification {
  id: number;
  type: string;
  title: string;
  message: string;
  link: string | null;
  isRead: boolean;
  readAt: string | null;
  createdAt: string;
}

export interface Certificate {
  id: number;
  certificateNumber: string;
  completionDate: string;
  score: number | null;
  signatoryName: string | null;
  issuedAt: string;
  revokedAt: string | null;
  isRevoked: boolean;
  employee: { id: number; employeeNo: string; name: string; departmentName?: string | null; branchName?: string | null };
  course: { id: number; title: string; code: string };
}

export interface MyCertificate {
  id: number;
  certificateNumber: string;
  completionDate: string;
  score: number | null;
  issuedAt: string;
  courseTitle: string;
  courseCode: string;
}

export interface AdminDashboard {
  role: 'admin';
  stats: {
    totalEmployees: number; totalCourses: number; activeCourses: number; draftCourses: number; archivedCourses: number;
    totalEnrollments: number; completedEnrollments: number; inProgressEnrollments: number; assignedEnrollments: number;
    overdueTraining: number; completionRate: number; certificatesIssued: number;
    assessmentsTaken: number; assessmentsPassed: number; assessmentsFailed: number; assessmentsPending: number;
  };
  departmentPerformance: { id: number; name: string; employees: number; enrollments: number; completed: number; overdue: number; completionRate: number }[];
  monthlyCompletions: { month: string; completed: number }[];
  topCourses: { id: number; title: string; thumbnailPath: string | null; enrollments: number; completed: number; avgProgress: number }[];
  recentActivities: { id: number; action: string; description: string; createdAt: string; actor: string }[];
  overdueList: { enrollmentId: number; dueDate: string; courseTitle: string; employeeName: string; employeeNo: string; departmentName: string | null }[];
}

export interface LearnerDashboard {
  role: 'learner';
  stats: { assigned: number; inProgress: number; completed: number; overdue: number; pendingAssessments: number; certificates: number };
  upcoming: { enrollmentId: number; courseId: number; dueDate: string; title: string; thumbnailPath: string | null }[];
  inProgress: { enrollmentId: number; courseId: number; title: string; thumbnailPath: string | null; progressPercent: number; dueDate: string | null; isOverdue: boolean }[];
  recentCompleted: { title: string; completedAt: string }[];
  learningTrend: { month: string; completed: number }[];
}

export type Dashboard = AdminDashboard | LearnerDashboard;

export interface ReportColumn { key: string; label: string; width?: number }
export interface ReportResult {
  type: string;
  title: string;
  columns: ReportColumn[];
  rows: Record<string, unknown>[];
  summary: Record<string, unknown>;
}
export interface ReportType { type: string; title: string; description: string }

// --- Courses ---------------------------------------------------------------
export type Difficulty = 'beginner' | 'intermediate' | 'advanced';
export type CourseType = 'mandatory' | 'optional';
export type CourseStatus = 'draft' | 'published' | 'archived';
export type ContentType = 'video' | 'pdf' | 'presentation' | 'document' | 'image' | 'text' | 'link';

export interface Course {
  id: number;
  code: string;
  title: string;
  description: string | null;
  categoryId: number;
  categoryName: string;
  categoryColor: string;
  departmentId: number | null;
  departmentName: string | null;
  thumbnailPath: string | null;
  instructorName: string | null;
  durationMinutes: number;
  difficulty: Difficulty;
  courseType: CourseType;
  targetAudience: string | null;
  status: CourseStatus;
  certificateEnabled: boolean;
  signatoryName: string | null;
  publishedAt: string | null;
  createdAt: string;
  moduleCount: number;
  lessonCount: number;
  enrollmentCount: number;
  completedCount: number;
  myStatus: string | null;
  myProgress: number | null;
  myEnrollmentId: number | null;
}

export interface CourseLessonDetail {
  id: number;
  title: string;
  contentType: ContentType;
  durationMinutes: number;
  sortOrder: number;
  isRequired: boolean;
  materialCount: number;
}
export interface CourseModule {
  id: number;
  title: string;
  description: string | null;
  sortOrder: number;
  lessons: CourseLessonDetail[];
}
/** RAW snake_case quiz rows inside course detail. */
export interface CourseQuizRaw {
  id: number;
  title: string;
  passing_score: string;
  time_limit_minutes: number | null;
  max_attempts: number;
  is_active: number;
}
export interface MyEnrollment {
  id: number;
  status: string;
  progressPercent: number;
  dueDate: string | null;
  completedAt: string | null;
}
export interface CourseDetail extends Course {
  modules: CourseModule[];
  quizzes: CourseQuizRaw[];
  myEnrollment: MyEnrollment | null;
}

// --- Learning (learner flow) ----------------------------------------------
export interface MyCourseItem {
  id: number;
  status: string;
  progressPercent: number;
  dueDate: string | null;
  enrolledAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastAccessedAt: string | null;
  isOverdue: boolean;
  requiredLessons: number;
  completedLessons: number;
  course: {
    id: number; code: string; title: string; thumbnailPath: string | null;
    difficulty: string; courseType: string; durationMinutes: number;
    categoryName: string; categoryColor: string;
  };
}

export interface Material {
  id: number;
  originalName: string;
  mimeType: string;
  fileSize: number;
  materialType: string;
  createdAt?: string;
}

export interface LessonPlayer {
  id: number;
  moduleId: number;
  courseId: number;
  enrollmentId: number;
  title: string;
  contentType: ContentType;
  content: string | null;
  externalUrl: string | null;
  durationMinutes: number;
  isRequired: boolean;
  isCompleted: boolean;
  completedAt: string | null;
  materials: Material[];
}

export interface LessonCompleteResult {
  progressPercent: number;
  courseCompleted: boolean;
  certificateNumber: string | null;
}

/** course object inside /api/learning/enrollments/:id is RAW snake_case. */
export interface EnrollmentDetail {
  enrollment: { id: number; status: string; progressPercent: number; dueDate: string | null; completedAt: string | null; isOverdue: boolean };
  course: {
    id: number; code: string; title: string; description: string | null; thumbnail_path: string | null;
    instructor_name: string | null; duration_minutes: number; difficulty: string; course_type: string;
    category_name: string; category_color: string;
  };
  modules: {
    id: number; title: string; description: string | null;
    lessons: { id: number; title: string; contentType: string; durationMinutes: number; isRequired: boolean; isCompleted: boolean; completedAt: string | null }[];
  }[];
  quizzes: {
    id: number; title: string; passingScore: number; timeLimitMinutes: number | null; maxAttempts: number;
    attemptsUsed: number; bestPassed: boolean | null; bestPercentage: number | null;
  }[];
}

// --- Assessments -----------------------------------------------------------
export type QuestionType = 'multiple_choice' | 'true_false' | 'multiple_select' | 'identification' | 'short_answer';
export type AttemptStatus = 'in_progress' | 'submitted' | 'graded' | 'expired';

export interface QuizListItem {
  id: number; courseId: number; title: string; description: string | null;
  passingScore: number; timeLimitMinutes: number | null; maxAttempts: number;
  randomizeQuestions: boolean; randomizeOptions: boolean; showResults: boolean; isActive: boolean;
  courseTitle: string; courseCode: string;
  questionCount: number; attemptCount: number; passedCount: number;
}
export interface QuizOption { id: number; optionText: string; sortOrder?: number; isCorrect?: boolean }
export interface QuizQuestion {
  id: number; questionType: QuestionType; questionText: string; points: number;
  explanation: string | null; sortOrder: number; correctAnswer?: string | null; options: QuizOption[];
}
export interface QuizDetail {
  id: number; courseId: number; title: string; description: string | null;
  passingScore: number; timeLimitMinutes: number | null; maxAttempts: number;
  randomizeQuestions: boolean; randomizeOptions: boolean; showResults: boolean; isActive: boolean;
  questions: QuizQuestion[];
}
export interface AttemptStart {
  attemptId: number; attemptNumber: number; quizId: number; title: string; passingScore: number;
  timeLimitMinutes: number | null; maxAttempts: number; startedAt: string; expiresAt: string | null;
  questions: { id: number; questionType: QuestionType; questionText: string; points: number; options: { id: number; optionText: string }[] }[];
}
export interface AttemptSubmitResult {
  attemptId: number; score: number; maxScore: number; percentage: number; passed: boolean | null;
  status: AttemptStatus; awaitingReview: boolean; showResults: boolean; courseCompleted: boolean; certificateNumber: string | null;
}
export interface AttemptAnswer {
  questionId: number; questionText: string; questionType: QuestionType; points: number;
  selectedOptionIds: number[] | null; textAnswer: string | null; isCorrect: boolean | null;
  pointsAwarded: number; needsManualReview: boolean; explanation: string | null; correctAnswer: string | null;
  options: { id: number; optionText: string; isCorrect?: boolean }[];
}
export interface AttemptResult {
  id: number; quizId: number; quizTitle: string; passingScore: number; attemptNumber: number; status: AttemptStatus;
  score: number; maxScore: number; percentage: number; passed: boolean | null;
  startedAt: string; submittedAt: string | null; expiresAt: string | null;
  employee: { id: number; name: string; employeeNo: string } | null;
  answers: AttemptAnswer[];
}
export interface QuizAttemptListItem {
  id: number; attemptNumber: number; status: string; score: number; maxScore: number; percentage: number;
  passed: boolean | null; startedAt: string; submittedAt: string | null; pendingReview: number;
  employee: { id: number; name: string; employeeNo: string; departmentName: string | null };
}
export interface GradeResult {
  percentage: number; passed: boolean | null; status: string; courseCompleted: boolean; certificateNumber: string | null;
}

// --- Assignments / enrollments --------------------------------------------
export type AssignmentType = 'individual' | 'department' | 'position' | 'branch' | 'all' | 'self';
export interface Enrollment {
  id: number; status: 'assigned' | 'in_progress' | 'completed'; progressPercent: number;
  dueDate: string | null; enrolledAt: string; completedAt: string | null;
  assignmentType: AssignmentType; isOverdue: boolean;
  course: { id: number; title: string; code: string; courseType: CourseType };
  employee: { id: number; employeeNo: string; name: string; position: string | null; departmentName: string | null; branchName: string | null };
}
export interface AssignResult { created: number; skipped: number; total: number }

// --- Users / roles ---------------------------------------------------------
export interface UserRow {
  id: number; username: string; email: string; isActive: boolean; mustChangePassword: boolean;
  lastLoginAt: string | null; createdAt: string; roleId: number; roleCode: string; roleName: string;
  employeeId: number; employeeNo: string; fullName: string; position: string | null;
  departmentName: string | null; activeSessions: number;
}
export interface RoleRow { id: number; code: string; name: string; description: string | null; is_system: number; permissions: string[] }
export interface PermissionRow { id: number; code: string; name: string; module: string }
export interface RolesResponse { roles: RoleRow[]; permissions: PermissionRow[] }

// --- Employee training (RAW) ----------------------------------------------
export interface EmployeeTraining {
  enrollments: {
    id: number; status: string; progress_percent: string; due_date: string | null; enrolled_at: string;
    completed_at: string | null; course_id: number; title: string; code: string; course_type: string;
    difficulty: string; is_overdue: number;
  }[];
  certificates: { id: number; certificate_number: string; completion_date: string; score: string | null; course_title: string }[];
  attempts: {
    id: number; attempt_number: number; percentage: string; passed: number | null; submitted_at: string | null;
    quiz_title: string; course_title: string;
  }[];
}

// --- System ----------------------------------------------------------------
export interface Session {
  id: string; ipAddress: string | null; userAgent: string | null;
  createdAt: string; lastSeenAt: string; expiresAt: string; isCurrent: boolean;
}
export interface AuditLog {
  id: number; action: string; entityType: string | null; entityId: string | null; description: string | null;
  ipAddress: string | null; metadata: Record<string, unknown> | null; createdAt: string;
  actor: { username: string; name: string } | null;
}
export interface SystemSetting { key: string; value: string; description: string | null; updatedAt: string }
export interface Backup { fileName: string; sizeBytes: number; createdAt: string }
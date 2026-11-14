export const ROLE_CODES = {
  SUPER_ADMIN: 'super_admin',
  LD_ADMIN: 'ld_admin',
  HR_ADMIN: 'hr_admin',
  DEPT_ADMIN: 'dept_admin',
  EMPLOYEE: 'employee',
} as const;

export type RoleCode = (typeof ROLE_CODES)[keyof typeof ROLE_CODES];

export interface PermissionDef {
  code: string;
  name: string;
  module: string;
}

export const PERMISSIONS: PermissionDef[] = [
  { code: 'dashboard.view', name: 'View dashboard', module: 'dashboard' },

  { code: 'employee.view', name: 'View employees', module: 'employees' },
  { code: 'employee.create', name: 'Create employees', module: 'employees' },
  { code: 'employee.update', name: 'Update employees', module: 'employees' },
  { code: 'employee.delete', name: 'Deactivate employees', module: 'employees' },
  { code: 'employee.import', name: 'Bulk import employees', module: 'employees' },

  { code: 'department.view', name: 'View departments', module: 'organization' },
  { code: 'department.manage', name: 'Manage departments', module: 'organization' },
  { code: 'branch.view', name: 'View branches', module: 'organization' },
  { code: 'branch.manage', name: 'Manage branches', module: 'organization' },

  { code: 'user.view', name: 'View user accounts', module: 'access' },
  { code: 'user.manage', name: 'Manage user accounts and roles', module: 'access' },
  { code: 'role.manage', name: 'Manage roles and permissions', module: 'access' },

  { code: 'course.view', name: 'View courses', module: 'courses' },
  { code: 'course.create', name: 'Create courses', module: 'courses' },
  { code: 'course.update', name: 'Update courses', module: 'courses' },
  { code: 'course.delete', name: 'Delete courses', module: 'courses' },
  { code: 'course.publish', name: 'Publish and archive courses', module: 'courses' },
  { code: 'category.view', name: 'View course categories', module: 'courses' },
  { code: 'category.manage', name: 'Manage course categories', module: 'courses' },
  { code: 'lesson.manage', name: 'Manage modules and lessons', module: 'courses' },
  { code: 'material.upload', name: 'Upload learning materials', module: 'courses' },
  { code: 'material.delete', name: 'Delete learning materials', module: 'courses' },

  { code: 'quiz.view', name: 'View assessments', module: 'assessment' },
  { code: 'quiz.manage', name: 'Create and edit assessments', module: 'assessment' },
  { code: 'quiz.grade', name: 'Grade subjective answers', module: 'assessment' },

  { code: 'enrollment.view', name: 'View enrollments', module: 'training' },
  { code: 'enrollment.assign', name: 'Assign training', module: 'training' },
  { code: 'enrollment.revoke', name: 'Remove training assignments', module: 'training' },
  { code: 'progress.view', name: 'View own learning progress', module: 'training' },
  { code: 'progress.viewAll', name: 'View all learner progress', module: 'training' },

  { code: 'certificate.view', name: 'View certificates', module: 'certificates' },
  { code: 'certificate.issue', name: 'Issue certificates', module: 'certificates' },
  { code: 'certificate.revoke', name: 'Revoke certificates', module: 'certificates' },

  { code: 'report.view', name: 'View reports and analytics', module: 'reports' },
  { code: 'report.export', name: 'Export reports', module: 'reports' },

  { code: 'notification.view', name: 'View notifications', module: 'notifications' },
  { code: 'settings.manage', name: 'Manage system settings', module: 'system' },
  { code: 'audit.view', name: 'View audit logs', module: 'system' },
  { code: 'backup.manage', name: 'Run database backups', module: 'system' },

  { code: 'learner.enroll', name: 'Self-enroll in optional courses', module: 'learning' },
  { code: 'learner.learn', name: 'Take lessons and assessments', module: 'learning' },
];

const ALL = PERMISSIONS.map((p) => p.code);

const LEARNING_CORE = [
  'dashboard.view',
  'course.view',
  'category.view',
  'enrollment.view',
  'progress.view',
  'quiz.view',
  'certificate.view',
  'notification.view',
  'learner.enroll',
  'learner.learn',
];

export const ROLE_PERMISSIONS: Record<RoleCode, string[]> = {
  [ROLE_CODES.SUPER_ADMIN]: ALL,

  [ROLE_CODES.LD_ADMIN]: [
    'dashboard.view',
    'employee.view',
    'department.view',
    'branch.view',
    'course.view',
    'course.create',
    'course.update',
    'course.delete',
    'course.publish',
    'category.view',
    'category.manage',
    'lesson.manage',
    'material.upload',
    'material.delete',
    'quiz.view',
    'quiz.manage',
    'quiz.grade',
    'enrollment.view',
    'enrollment.assign',
    'enrollment.revoke',
    'progress.view',
    'progress.viewAll',
    'certificate.view',
    'certificate.issue',
    'certificate.revoke',
    'report.view',
    'report.export',
    'notification.view',
    'audit.view',
  ],

  [ROLE_CODES.HR_ADMIN]: [
    'dashboard.view',
    'employee.view',
    'employee.create',
    'employee.update',
    'employee.import',
    'department.view',
    'branch.view',
    'course.view',
    'category.view',
    'quiz.view',
    'enrollment.view',
    'enrollment.assign',
    'enrollment.revoke',
    'progress.view',
    'progress.viewAll',
    'certificate.view',
    'certificate.issue',
    'report.view',
    'report.export',
    'notification.view',
  ],

  [ROLE_CODES.DEPT_ADMIN]: [
    'dashboard.view',
    'employee.view',
    'department.view',
    'branch.view',
    'course.view',
    'course.create',
    'course.update',
    'category.view',
    'lesson.manage',
    'material.upload',
    'quiz.view',
    'quiz.manage',
    'quiz.grade',
    'enrollment.view',
    'enrollment.assign',
    'progress.view',
    'progress.viewAll',
    'certificate.view',
    'report.view',
    'report.export',
    'notification.view',
  ],

  [ROLE_CODES.EMPLOYEE]: LEARNING_CORE,
};

export const ROLE_DEFINITIONS: { code: RoleCode; name: string; description: string }[] = [
  {
    code: ROLE_CODES.SUPER_ADMIN,
    name: 'Super Administrator (IT)',
    description: 'Full system access including users, roles, organization and settings.',
  },
  {
    code: ROLE_CODES.LD_ADMIN,
    name: 'L&D Administrator',
    description: 'Owns the course catalogue, assessments, assignments and certification.',
  },
  {
    code: ROLE_CODES.HR_ADMIN,
    name: 'HR Administrator',
    description: 'Manages employee records, compliance training and training reports.',
  },
  {
    code: ROLE_CODES.DEPT_ADMIN,
    name: 'Department Administrator / Trainer',
    description: 'Manages department-scoped courses, assignments and learner performance.',
  },
  {
    code: ROLE_CODES.EMPLOYEE,
    name: 'Employee / Learner',
    description: 'Takes assigned training, tracks progress and downloads certificates.',
  },
];
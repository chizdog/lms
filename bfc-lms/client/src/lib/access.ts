import type { Auth } from './types';

export const ROLES = {
  SUPER_ADMIN: 'super_admin',
  LD_ADMIN: 'ld_admin',
  HR_ADMIN: 'hr_admin',
  DEPT_ADMIN: 'dept_admin',
  EMPLOYEE: 'employee',
} as const;

export function can(auth: Auth | null, ...codes: string[]): boolean {
  if (!auth) return false;
  return codes.some((c) => auth.permissions.includes(c));
}

export function isLearner(auth: Auth | null): boolean {
  return auth?.roleCode === ROLES.EMPLOYEE;
}

export function isOrgWide(auth: Auth | null): boolean {
  return !!auth && [ROLES.SUPER_ADMIN, ROLES.LD_ADMIN, ROLES.HR_ADMIN].includes(auth.roleCode as never);
}

export const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Administrator',
  ld_admin: 'L&D Administrator',
  hr_admin: 'HR Administrator',
  dept_admin: 'Department Trainer',
  employee: 'Employee',
};

export const DIFFICULTY_LABELS: Record<string, string> = {
  beginner: 'Beginner',
  intermediate: 'Intermediate',
  advanced: 'Advanced',
};

export const STATUS_TONES: Record<string, string> = {
  published: 'bg-emerald-50 text-emerald-700',
  active: 'bg-emerald-50 text-emerald-700',
  completed: 'bg-emerald-50 text-emerald-700',
  passed: 'bg-emerald-50 text-emerald-700',
  draft: 'bg-ink-100 text-ink-600',
  assigned: 'bg-sky-50 text-sky-700',
  in_progress: 'bg-gold-50 text-gold-700',
  submitted: 'bg-gold-50 text-gold-700',
  archived: 'bg-ink-100 text-ink-500',
  overdue: 'bg-red-50 text-red-700',
  failed: 'bg-red-50 text-red-700',
  expired: 'bg-red-50 text-red-700',
  graded: 'bg-emerald-50 text-emerald-700',
  mandatory: 'bg-red-50 text-red-700',
  optional: 'bg-sky-50 text-sky-700',
};
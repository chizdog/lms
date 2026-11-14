import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { ROLE_CODES } from '../config/permissions';
import { forbidden, unauthorized } from '../utils/errors';
import type { AuthContext } from '../types/express';

export function requireAuthed(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

export function requirePermission(...codes: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = requireAuthed(req);
    const missing = codes.filter((code) => !auth.permissions.has(code));
    if (missing.length > 0) {
      next(forbidden(`Missing permission: ${missing.join(', ')}`));
      return;
    }
    next();
  };
}

export function requireAnyPermission(...codes: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = requireAuthed(req);
    if (!codes.some((code) => auth.permissions.has(code))) {
      next(forbidden(`Requires one of: ${codes.join(', ')}`));
      return;
    }
    next();
  };
}

export function requireRole(...roles: string[]): RequestHandler {
  return (req: Request, _res: Response, next: NextFunction) => {
    const auth = requireAuthed(req);
    if (!roles.includes(auth.roleCode)) {
      next(forbidden('Your role cannot perform this action'));
      return;
    }
    next();
  };
}

/** Roles that see organization-wide training data instead of a department slice. */
export function hasOrgWideAccess(auth: AuthContext): boolean {
  return (
    auth.roleCode === ROLE_CODES.SUPER_ADMIN ||
    auth.roleCode === ROLE_CODES.LD_ADMIN ||
    auth.roleCode === ROLE_CODES.HR_ADMIN
  );
}

export function isLearnerOnly(auth: AuthContext): boolean {
  return auth.roleCode === ROLE_CODES.EMPLOYEE;
}

/**
 * Builds a SQL fragment restricting rows to what the caller may see.
 * Returns an empty fragment for organization-wide roles.
 */
export function employeeScope(
  auth: AuthContext,
  employeeAlias: string,
): { sql: string; params: unknown[] } {
  if (hasOrgWideAccess(auth)) return { sql: '', params: [] };

  if (auth.roleCode === ROLE_CODES.DEPT_ADMIN) {
    if (auth.scopedDepartmentIds.length === 0) {
      return { sql: ` AND ${employeeAlias}.id = ?`, params: [auth.employee.id] };
    }
    const placeholders = auth.scopedDepartmentIds.map(() => '?').join(',');
    return {
      sql: ` AND ${employeeAlias}.department_id IN (${placeholders})`,
      params: [...auth.scopedDepartmentIds],
    };
  }

  return { sql: ` AND ${employeeAlias}.id = ?`, params: [auth.employee.id] };
}

/** Throws unless the caller may read/write the given employee's training data. */
export async function assertEmployeeAccess(
  auth: AuthContext,
  employeeId: number,
  lookupDepartment: (employeeId: number) => Promise<number | null>,
): Promise<void> {
  if (hasOrgWideAccess(auth)) return;
  if (employeeId === auth.employee.id) return;

  if (auth.roleCode === ROLE_CODES.DEPT_ADMIN && auth.scopedDepartmentIds.length > 0) {
    const departmentId = await lookupDepartment(employeeId);
    if (departmentId !== null && auth.scopedDepartmentIds.includes(departmentId)) return;
  }

  throw forbidden('You can only access training records within your authorized scope');
}
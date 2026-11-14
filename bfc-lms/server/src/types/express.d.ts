import type { RoleCode } from '../config/permissions';

export interface AuthEmployee {
  id: number;
  employeeNo: string;
  firstName: string;
  lastName: string;
  fullName: string;
  email: string;
  position: string | null;
  departmentId: number | null;
  departmentName: string | null;
  branchId: number | null;
  branchName: string | null;
  avatarPath: string | null;
}

export interface AuthContext {
  sessionId: string;
  csrfToken: string;
  userId: number;
  username: string;
  roleId: number;
  roleCode: RoleCode;
  roleName: string;
  permissions: Set<string>;
  employee: AuthEmployee;
  /** Departments a Department Administrator is allowed to manage. Empty for other roles. */
  scopedDepartmentIds: number[];
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}

export {};
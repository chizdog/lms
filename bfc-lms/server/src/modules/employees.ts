import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { parse as parseCsv } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import dayjs from 'dayjs';
import { execute, query, queryOne, withTransaction, sqlParams, RowDataPacket, ExecuteResult } from '../config/db';
import { requireAuth } from '../middleware/auth';
import { csrfProtection } from '../middleware/csrf';
import { validate } from '../middleware/validate';
import { requirePermission, employeeScope, hasOrgWideAccess } from '../middleware/rbac';
import { uploadFor, commitUpload, discardUpload } from '../middleware/upload';
import { asyncHandler, recordAudit } from '../utils/http';
import { idParam, paginationQuery, paginate, limitOffset, safeSort } from '../utils/query';
import { hashPassword, generateToken } from '../utils/password';
import { badRequest, conflict, notFound } from '../utils/errors';
import { ROLE_CODES } from '../config/permissions';

export const employeesRouter = Router();
employeesRouter.use(requireAuth);

const EMPLOYEE_SELECT = `
  SELECT e.id, e.employee_no, e.first_name, e.last_name, e.middle_name, e.email, e.phone,
         e.department_id, d.name AS department_name, d.code AS department_code,
         e.branch_id, b.name AS branch_name, b.code AS branch_code,
         e.position, e.employment_status, e.hire_date, e.avatar_path, e.is_active,
         e.created_at, u.id AS user_id, u.username, u.is_active AS user_active,
         r.code AS role_code, r.name AS role_name,
         (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.employee_id = e.id) AS assigned_courses,
         (SELECT COUNT(*) FROM course_enrollments ce WHERE ce.employee_id = e.id AND ce.status = 'completed') AS completed_courses
  FROM employees e
  LEFT JOIN departments d ON d.id = e.department_id
  LEFT JOIN branches b ON b.id = e.branch_id
  LEFT JOIN users u ON u.employee_id = e.id
  LEFT JOIN roles r ON r.id = u.role_id
`;

function serializeEmployee(row: RowDataPacket) {
  return {
    id: row.id,
    employeeNo: row.employee_no,
    firstName: row.first_name,
    lastName: row.last_name,
    middleName: row.middle_name,
    fullName: `${row.first_name} ${row.last_name}`,
    email: row.email,
    phone: row.phone,
    departmentId: row.department_id,
    departmentName: row.department_name,
    departmentCode: row.department_code,
    branchId: row.branch_id,
    branchName: row.branch_name,
    branchCode: row.branch_code,
    position: row.position,
    employmentStatus: row.employment_status,
    hireDate: row.hire_date,
    avatarPath: row.avatar_path,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at,
    userId: row.user_id,
    username: row.username,
    userActive: Boolean(row.user_active),
    roleCode: row.role_code,
    roleName: row.role_name,
    assignedCourses: Number(row.assigned_courses),
    completedCourses: Number(row.completed_courses),
  };
}

const listQuery = paginationQuery.extend({
  departmentId: z.coerce.number().int().positive().optional(),
  branchId: z.coerce.number().int().positive().optional(),
  employmentStatus: z.enum(['regular', 'probationary', 'contractual', 'intern', 'resigned']).optional(),
  isActive: z.enum(['true', 'false']).optional(),
});

employeesRouter.get(
  '/',
  requirePermission('employee.view'),
  validate(listQuery, 'query'),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const q = req.query as unknown as z.infer<typeof listQuery>;
    const conditions: string[] = ['1=1'];
    const params: unknown[] = [];

    if (q.search) {
      conditions.push('(e.first_name LIKE ? OR e.last_name LIKE ? OR e.employee_no LIKE ? OR e.email LIKE ? OR e.position LIKE ?)');
      const like = `%${q.search}%`;
      params.push(like, like, like, like, like);
    }
    if (q.departmentId) { conditions.push('e.department_id = ?'); params.push(q.departmentId); }
    if (q.branchId) { conditions.push('e.branch_id = ?'); params.push(q.branchId); }
    if (q.employmentStatus) { conditions.push('e.employment_status = ?'); params.push(q.employmentStatus); }
    if (q.isActive) { conditions.push('e.is_active = ?'); params.push(q.isActive === 'true' ? 1 : 0); }

    const scope = employeeScope(auth, 'e');
    if (scope.sql) {
      conditions.push(scope.sql.replace(/^ AND /, ''));
      params.push(...scope.params);
    }

    const where = conditions.join(' AND ');
    const sort = safeSort(q.sortBy, {
      employeeNo: 'e.employee_no', name: 'e.last_name', email: 'e.email',
      department: 'd.name', branch: 'b.name', position: 'e.position', hireDate: 'e.hire_date',
    }, 'e.employee_no', q.sortDir);

    const total = await queryOne<RowDataPacket & { total: number }>(
      `SELECT COUNT(*) AS total FROM employees e LEFT JOIN departments d ON d.id = e.department_id LEFT JOIN branches b ON b.id = e.branch_id WHERE ${where}`,
      params,
    );
    const { limit, offset } = limitOffset(q.page, q.pageSize);
    const rows = await query(
      `${EMPLOYEE_SELECT} WHERE ${where} ORDER BY ${sort} LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    res.json(paginate(rows.map(serializeEmployee), Number(total?.total ?? 0), q.page, q.pageSize));
  }),
);

employeesRouter.get(
  '/export',
  requirePermission('employee.view'),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const scope = employeeScope(auth, 'e');
    const rows = await query(
      `${EMPLOYEE_SELECT} WHERE 1=1 ${scope.sql} ORDER BY e.employee_no`,
      scope.params,
    );
    const format = String(req.query.format ?? 'csv');
    const items = rows.map(serializeEmployee);

    recordAudit(req, { action: 'employee.exported', entityType: 'employee', description: `Exported ${items.length} employee records as ${format}` });

    if (format === 'xlsx') {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet('Employees');
      sheet.columns = [
        { header: 'Employee No', key: 'employeeNo', width: 14 },
        { header: 'First Name', key: 'firstName', width: 16 },
        { header: 'Last Name', key: 'lastName', width: 16 },
        { header: 'Email', key: 'email', width: 34 },
        { header: 'Department', key: 'departmentName', width: 22 },
        { header: 'Branch', key: 'branchName', width: 22 },
        { header: 'Position', key: 'position', width: 26 },
        { header: 'Status', key: 'employmentStatus', width: 14 },
        { header: 'Hire Date', key: 'hireDate', width: 12 },
        { header: 'Assigned', key: 'assignedCourses', width: 10 },
        { header: 'Completed', key: 'completedCourses', width: 10 },
      ];
      sheet.getRow(1).font = { bold: true };
      items.forEach((item) => sheet.addRow(item));
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="bfc-employees-${dayjs().format('YYYYMMDD')}.xlsx"`);
      await workbook.xlsx.write(res);
      res.end();
      return;
    }

    const header = ['employee_no', 'first_name', 'last_name', 'email', 'department_code', 'branch_code', 'position', 'employment_status', 'hire_date'];
    const escape = (value: unknown) => {
      const text = value === null || value === undefined ? '' : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const lines = [header.join(',')];
    for (const item of items) {
      lines.push([item.employeeNo, item.firstName, item.lastName, item.email, item.departmentCode, item.branchCode, item.position, item.employmentStatus, item.hireDate].map(escape).join(','));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bfc-employees-${dayjs().format('YYYYMMDD')}.csv"`);
    res.send(lines.join('\n'));
  }),
);

employeesRouter.get(
  '/:id',
  requirePermission('employee.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const id = Number(req.params.id);
    const scope = employeeScope(auth, 'e');
    const row = await queryOne(`${EMPLOYEE_SELECT} WHERE e.id = ? ${scope.sql}`, [id, ...scope.params]);
    if (!row) throw notFound('Employee not found or outside your scope');
    res.json(serializeEmployee(row));
  }),
);

const employeeBody = z.object({
  employeeNo: z.string().trim().min(1).max(30),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  middleName: z.string().trim().max(80).optional().nullable(),
  email: z.string().trim().email().max(150),
  phone: z.string().trim().max(40).optional().nullable(),
  departmentId: z.coerce.number().int().positive().optional().nullable(),
  branchId: z.coerce.number().int().positive().optional().nullable(),
  position: z.string().trim().max(120).optional().nullable(),
  employmentStatus: z.enum(['regular', 'probationary', 'contractual', 'intern', 'resigned']).default('regular'),
  hireDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  roleCode: z.enum([ROLE_CODES.SUPER_ADMIN, ROLE_CODES.LD_ADMIN, ROLE_CODES.HR_ADMIN, ROLE_CODES.DEPT_ADMIN, ROLE_CODES.EMPLOYEE]).default(ROLE_CODES.EMPLOYEE),
  isActive: z.boolean().default(true),
});

employeesRouter.post(
  '/',
  requirePermission('employee.create'),
  csrfProtection,
  validate(employeeBody),
  asyncHandler(async (req, res) => {
    const body = req.body as z.infer<typeof employeeBody>;
    const existing = await queryOne('SELECT id FROM employees WHERE employee_no = ? OR email = ?', [body.employeeNo, body.email]);
    if (existing) throw conflict('Employee number or email already exists');

    const role = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM roles WHERE code = ?', [body.roleCode]);
    if (!role) throw badRequest('Unknown role');

    const { hash, salt } = await hashPassword(generateToken(6));
    const result = await withTransaction(async (conn) => {
      const [emp] = await conn.execute<ExecuteResult>(
        `INSERT INTO employees (employee_no, first_name, last_name, middle_name, email, phone, department_id, branch_id, position, employment_status, hire_date, is_active)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [body.employeeNo, body.firstName, body.lastName, body.middleName ?? null, body.email, body.phone ?? null, body.departmentId ?? null, body.branchId ?? null, body.position ?? null, body.employmentStatus, body.hireDate ?? null, body.isActive ? 1 : 0],
      );
      const username = body.email.split('@')[0];
      const [user] = await conn.execute<ExecuteResult>(
        `INSERT INTO users (employee_id, username, email, password_hash, password_salt, role_id, must_change_password, is_active)
         VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
        [emp.insertId, username, body.email, hash, salt, role.id, body.isActive ? 1 : 0],
      );
      return { employeeId: emp.insertId, userId: user.insertId, username };
    });

    recordAudit(req, { action: 'employee.created', entityType: 'employee', entityId: result.employeeId, description: `Created employee ${body.employeeNo}` });
    const row = await queryOne(`${EMPLOYEE_SELECT} WHERE e.id = ?`, [result.employeeId]);
    res.status(201).json({ ...serializeEmployee(row!), temporaryUsername: result.username });
  }),
);

employeesRouter.put(
  '/:id',
  requirePermission('employee.update'),
  csrfProtection,
  validate(idParam, 'params'),
  validate(employeeBody.partial()),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const body = req.body as Partial<z.infer<typeof employeeBody>>;
    const existing = await queryOne<RowDataPacket & { id: number; user_id: number }>(
      'SELECT e.id, u.id AS user_id FROM employees e LEFT JOIN users u ON u.employee_id = e.id WHERE e.id = ?',
      [id],
    );
    if (!existing) throw notFound('Employee not found');

    const fields: string[] = [];
    const params: unknown[] = [];
    const map: Record<string, string> = {
      employeeNo: 'employee_no', firstName: 'first_name', lastName: 'last_name', middleName: 'middle_name',
      email: 'email', phone: 'phone', departmentId: 'department_id', branchId: 'branch_id',
      position: 'position', employmentStatus: 'employment_status', hireDate: 'hire_date',
    };
    for (const [key, column] of Object.entries(map)) {
      if (key in body) { fields.push(`${column} = ?`); params.push((body as Record<string, unknown>)[key] ?? null); }
    }
    if ('isActive' in body) { fields.push('is_active = ?'); params.push(body.isActive ? 1 : 0); }

    await withTransaction(async (conn) => {
      if (fields.length > 0) {
        await conn.execute(`UPDATE employees SET ${fields.join(', ')} WHERE id = ?`, sqlParams([...params, id]));
      }
      if (existing.user_id) {
        const userFields: string[] = [];
        const userParams: unknown[] = [];
        if ('email' in body) { userFields.push('email = ?'); userParams.push(body.email); }
        if ('isActive' in body) { userFields.push('is_active = ?'); userParams.push(body.isActive ? 1 : 0); }
        if (body.roleCode) {
          const role = await conn.execute<RowDataPacket[]>('SELECT id FROM roles WHERE code = ?', [body.roleCode]).then(([r]) => r[0]);
          if (role) { userFields.push('role_id = ?'); userParams.push(role.id); }
        }
        if (userFields.length > 0) {
          await conn.execute(`UPDATE users SET ${userFields.join(', ')} WHERE id = ?`, sqlParams([...userParams, existing.user_id]));
        }
      }
    });

    recordAudit(req, { action: 'employee.updated', entityType: 'employee', entityId: id, description: `Updated employee ${id}`, metadata: body as Record<string, unknown> });
    const row = await queryOne(`${EMPLOYEE_SELECT} WHERE e.id = ?`, [id]);
    res.json(serializeEmployee(row!));
  }),
);

employeesRouter.delete(
  '/:id',
  requirePermission('employee.delete'),
  csrfProtection,
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const id = Number(req.params.id);
    const result = await execute('UPDATE employees SET is_active = 0 WHERE id = ?', [id]);
    if (result.affectedRows === 0) throw notFound('Employee not found');
    await execute('UPDATE users SET is_active = 0 WHERE employee_id = ?', [id]);
    await execute('UPDATE sessions SET revoked_at = NOW() WHERE user_id IN (SELECT id FROM users WHERE employee_id = ?) AND revoked_at IS NULL', [id]);
    recordAudit(req, { action: 'employee.deactivated', entityType: 'employee', entityId: id, description: `Deactivated employee ${id}` });
    res.json({ success: true });
  }),
);

// --- Bulk import -----------------------------------------------------------
interface ImportRow {
  employee_no: string;
  first_name: string;
  last_name: string;
  email: string;
  department_code?: string;
  branch_code?: string;
  position?: string;
  employment_status?: string;
  phone?: string;
  hire_date?: string;
}

employeesRouter.post(
  '/import',
  requirePermission('employee.import'),
  csrfProtection,
  uploadFor('import'),
  asyncHandler(async (req, res) => {
    const file = req.file;
    if (!file) throw badRequest('Attach a CSV or XLSX file in the "file" field');

    let rows: ImportRow[] = [];
    try {
      const ext = file.filename.slice(file.filename.lastIndexOf('.')).toLowerCase();
      if (ext === '.csv') {
        rows = parseCsv(fs.readFileSync(file.path, 'utf8'), {
          columns: (header: string[]) => header.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_')),
          skip_empty_lines: true,
          trim: true,
        }) as ImportRow[];
      } else {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.readFile(file.path);
        const sheet = workbook.worksheets[0];
        const header = (sheet.getRow(1).values as unknown[]).slice(1).map((h) => String(h ?? '').trim().toLowerCase().replace(/\s+/g, '_'));
        sheet.eachRow((row, rowNumber) => {
          if (rowNumber === 1) return;
          const values = (row.values as unknown[]).slice(1);
          const record: Record<string, string> = {};
          header.forEach((key, index) => { record[key] = values[index] === undefined || values[index] === null ? '' : String(values[index]); });
          rows.push(record as unknown as ImportRow);
        });
      }
    } finally {
      discardUpload(file.path);
    }

    if (rows.length === 0) throw badRequest('The file contains no data rows');
    if (rows.length > 2000) throw badRequest('Import limited to 2000 rows per file');

    const departments = await query<RowDataPacket & { id: number; code: string }>('SELECT id, code FROM departments');
    const branches = await query<RowDataPacket & { id: number; code: string }>('SELECT id, code FROM branches');
    const employeeRole = await queryOne<RowDataPacket & { id: number }>('SELECT id FROM roles WHERE code = ?', [ROLE_CODES.EMPLOYEE]);
    const { hash, salt } = await hashPassword(generateToken(6));

    const errors: { row: number; message: string }[] = [];
    let created = 0;
    let skipped = 0;

    await withTransaction(async (conn) => {
      for (let i = 0; i < rows.length; i += 1) {
        const row = rows[i];
        const rowNumber = i + 2;
        if (!row.employee_no || !row.first_name || !row.last_name || !row.email) {
          errors.push({ row: rowNumber, message: 'Missing required field (employee_no, first_name, last_name, email)' });
          skipped += 1;
          continue;
        }
        if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) {
          errors.push({ row: rowNumber, message: `Invalid email: ${row.email}` });
          skipped += 1;
          continue;
        }
        const [dup] = await conn.execute<RowDataPacket[]>('SELECT id FROM employees WHERE employee_no = ? OR email = ?', [row.employee_no, row.email]);
        if (dup.length > 0) {
          errors.push({ row: rowNumber, message: `Duplicate employee_no or email: ${row.employee_no}` });
          skipped += 1;
          continue;
        }
        const department = departments.find((d) => d.code === (row.department_code ?? '').toUpperCase());
        const branch = branches.find((b) => b.code === (row.branch_code ?? '').toUpperCase());
        const status = ['regular', 'probationary', 'contractual', 'intern', 'resigned'].includes(row.employment_status ?? '') ? (row.employment_status ?? 'regular') : 'regular';

        const [emp] = await conn.execute<ExecuteResult>(
          `INSERT INTO employees (employee_no, first_name, last_name, email, phone, department_id, branch_id, position, employment_status, hire_date, is_active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          sqlParams([row.employee_no, row.first_name, row.last_name, row.email, row.phone || null, department?.id ?? null, branch?.id ?? null, row.position || null, status, row.hire_date || null]),
        );
        await conn.execute(
          `INSERT INTO users (employee_id, username, email, password_hash, password_salt, role_id, must_change_password, is_active)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1)`,
          [emp.insertId, row.email.split('@')[0], row.email, hash, salt, employeeRole!.id],
        );
        created += 1;
      }
    });

    recordAudit(req, { action: 'employee.imported', entityType: 'employee', description: `Bulk import: ${created} created, ${skipped} skipped`, metadata: { created, skipped } });
    res.json({ created, skipped, total: rows.length, errors });
  }),
);

// --- Training record for one employee -------------------------------------
employeesRouter.get(
  '/:id/training',
  requirePermission('employee.view'),
  validate(idParam, 'params'),
  asyncHandler(async (req, res) => {
    const auth = req.auth!;
    const id = Number(req.params.id);
    const scope = employeeScope(auth, 'e');
    const employee = await queryOne(`SELECT e.id FROM employees e WHERE e.id = ? ${scope.sql}`, [id, ...scope.params]);
    if (!employee) throw notFound('Employee not found or outside your scope');

    const enrollments = await query(
      `SELECT ce.id, ce.status, ce.progress_percent, ce.due_date, ce.enrolled_at, ce.completed_at,
              c.id AS course_id, c.title, c.code, c.course_type, c.difficulty,
              (ce.due_date IS NOT NULL AND ce.due_date < CURDATE() AND ce.status <> 'completed') AS is_overdue
       FROM course_enrollments ce JOIN courses c ON c.id = ce.course_id
       WHERE ce.employee_id = ? ORDER BY ce.enrolled_at DESC`,
      [id],
    );
    const certificates = await query(
      `SELECT cert.id, cert.certificate_number, cert.completion_date, cert.score, c.title AS course_title
       FROM certificates cert JOIN courses c ON c.id = cert.course_id
       WHERE cert.employee_id = ? AND cert.revoked_at IS NULL ORDER BY cert.issued_at DESC`,
      [id],
    );
    const attempts = await query(
      `SELECT qa.id, qa.attempt_number, qa.percentage, qa.passed, qa.submitted_at, q.title AS quiz_title, c.title AS course_title
       FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id JOIN courses c ON c.id = q.course_id
       WHERE qa.employee_id = ? ORDER BY qa.started_at DESC`,
      [id],
    );
    res.json({ enrollments, certificates, attempts });
  }),
);
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Upload, Download, Users, GraduationCap, Award, ClipboardList, FileSpreadsheet } from 'lucide-react';
import { api, queryString, downloadFile } from '@/lib/api';
import type { Employee, Department, Branch, Paginated, EmployeeTraining } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatNumber, formatPercent, titleCase } from '@/lib/format';
import { ROLE_LABELS, STATUS_TONES } from '@/lib/access';
import {
  PageHeader, Card, Button, Badge, Avatar, LoadingBlock, EmptyState, Modal, Field, Input, Select, ConfirmDialog,
  IconButton, Pagination, SearchInput, ProgressBar,
} from '@/components/ui';

const EMP_STATUS = ['regular', 'probationary', 'contractual', 'intern', 'resigned'];
const ROLE_CODES = ['super_admin', 'ld_admin', 'hr_admin', 'dept_admin', 'employee'];

interface EmpForm {
  employeeNo: string; firstName: string; lastName: string; middleName: string; email: string; phone: string;
  departmentId: string; branchId: string; position: string; employmentStatus: string; hireDate: string; roleCode: string; isActive: boolean;
}
const EMPTY: EmpForm = {
  employeeNo: '', firstName: '', lastName: '', middleName: '', email: '', phone: '',
  departmentId: '', branchId: '', position: '', employmentStatus: 'regular', hireDate: '', roleCode: 'employee', isActive: true,
};

export function EmployeesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canCreate = has('employee.create');
  const canUpdate = has('employee.update');
  const canDelete = has('employee.delete');
  const canImport = has('employee.import');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [isActive, setIsActive] = useState('');

  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ items: Branch[] }>('/branches') });

  const query = queryString({ page, pageSize: 20, search, departmentId, branchId, isActive, sortBy: 'employeeNo', sortDir: 'asc' });
  const { data, isLoading } = useQuery({ queryKey: ['employees', query], queryFn: () => api.get<Paginated<Employee>>(`/employees/${query}`) });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmpForm>(EMPTY);
  const [deleting, setDeleting] = useState<Employee | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [training, setTraining] = useState<Employee | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        employeeNo: form.employeeNo, firstName: form.firstName, lastName: form.lastName, middleName: form.middleName || null,
        email: form.email, phone: form.phone || null, departmentId: form.departmentId ? Number(form.departmentId) : null,
        branchId: form.branchId ? Number(form.branchId) : null, position: form.position || null, employmentStatus: form.employmentStatus,
        hireDate: form.hireDate || null, roleCode: form.roleCode, isActive: form.isActive,
      };
      return editing ? api.put<Employee>(`/employees/${editing.id}`, body) : api.post<Employee & { temporaryUsername: string }>('/employees/', body);
    },
    onSuccess: (res) => {
      if (editing) toast.success('Employee updated');
      else toast.success(`Account created — username "${(res as { temporaryUsername?: string }).temporaryUsername ?? form.email}". Use Users → Reset password to issue login credentials.`);
      setOpen(false); setEditing(null); setForm(EMPTY);
      void qc.invalidateQueries({ queryKey: ['employees'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/employees/${id}`),
    onSuccess: () => { toast.success('Employee deactivated'); setDeleting(null); void qc.invalidateQueries({ queryKey: ['employees'] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  function openEdit(e: Employee) {
    setEditing(e);
    setForm({
      employeeNo: e.employeeNo, firstName: e.firstName, lastName: e.lastName, middleName: e.middleName ?? '', email: e.email,
      phone: e.phone ?? '', departmentId: e.departmentId ? String(e.departmentId) : '', branchId: e.branchId ? String(e.branchId) : '',
      position: e.position ?? '', employmentStatus: e.employmentStatus, hireDate: e.hireDate ?? '', roleCode: e.roleCode ?? 'employee', isActive: e.isActive,
    });
    setOpen(true);
  }

  const items = data?.items ?? [];
  const valid = form.employeeNo.trim() && form.firstName.trim() && form.lastName.trim() && form.email.trim();

  return (
    <div>
      <PageHeader title="Employees" subtitle="Manage BFC staff records, roles and training history."
        actions={<>
          {canImport && <Button variant="outline" icon={<Upload className="h-4 w-4" />} onClick={() => setImportOpen(true)}>Import</Button>}
          <Button variant="outline" icon={<Download className="h-4 w-4" />} onClick={() => void downloadFile('/employees/export?format=xlsx', 'bfc-employees.xlsx')}>Export</Button>
          {canCreate && <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setForm(EMPTY); setOpen(true); }}>New employee</Button>}
        </>} />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="lg:col-span-2"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, number, email…" /></div>
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
            <option value="">All branches</option>
            {(branches?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={isActive} onChange={(e) => { setIsActive(e.target.value); setPage(1); }}>
            <option value="">Any status</option><option value="true">Active</option><option value="false">Inactive</option>
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No employees found" message="Try adjusting your filters." icon={<Users className="h-7 w-7" />} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ink-100 text-left">
                  <th className="th">Employee</th><th className="th">Department</th><th className="th">Branch</th>
                  <th className="th">Position</th><th className="th">Role</th><th className="th text-center">Training</th>
                  <th className="th text-center">Status</th><th className="th text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                      <td className="td">
                        <button className="flex items-center gap-3 text-left" onClick={() => setTraining(e)}>
                          <Avatar name={e.fullName} size="sm" />
                          <span>
                            <span className="block font-semibold text-ink-800 hover:text-gold-700">{e.fullName}</span>
                            <span className="block text-xs text-ink-400">{e.employeeNo} · {e.email}</span>
                          </span>
                        </button>
                      </td>
                      <td className="td text-ink-600">{e.departmentName ?? '—'}</td>
                      <td className="td text-ink-600">{e.branchName ?? '—'}</td>
                      <td className="td text-ink-600">{e.position ?? '—'}</td>
                      <td className="td"><Badge tone="bg-ink-100 text-ink-600">{e.roleCode ? (ROLE_LABELS[e.roleCode] ?? e.roleCode) : 'No account'}</Badge></td>
                      <td className="td text-center text-xs text-ink-500">{formatNumber(e.assignedCourses)} assigned<br /><span className="text-emerald-600">{formatNumber(e.completedCourses)} done</span></td>
                      <td className="td text-center"><Badge tone={e.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{e.isActive ? titleCase(e.employmentStatus) : 'Inactive'}</Badge></td>
                      <td className="td"><div className="flex justify-end gap-1">
                        <IconButton label="Training history" onClick={() => setTraining(e)}><GraduationCap className="h-4 w-4" /></IconButton>
                        {canUpdate && <IconButton label="Edit" onClick={() => openEdit(e)}><Pencil className="h-4 w-4" /></IconButton>}
                        {canDelete && <IconButton label="Deactivate" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(e)}><Trash2 className="h-4 w-4" /></IconButton>}
                      </div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} />
          </>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit employee' : 'New employee'} size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="gold" loading={save.isPending} disabled={!valid} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create employee'}</Button>
        </>}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Employee no." required><Input value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} maxLength={30} /></Field>
          <Field label="Email" required><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} maxLength={150} /></Field>
          <Field label="First name" required><Input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} maxLength={80} /></Field>
          <Field label="Last name" required><Input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} maxLength={80} /></Field>
          <Field label="Middle name"><Input value={form.middleName} onChange={(e) => setForm({ ...form, middleName: e.target.value })} maxLength={80} /></Field>
          <Field label="Phone"><Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} maxLength={40} /></Field>
          <Field label="Department"><Select value={form.departmentId} onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
            <option value="">Unassigned</option>{(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select></Field>
          <Field label="Branch"><Select value={form.branchId} onChange={(e) => setForm({ ...form, branchId: e.target.value })}>
            <option value="">Unassigned</option>{(branches?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select></Field>
          <Field label="Position"><Input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} maxLength={120} placeholder="Barista" /></Field>
          <Field label="Employment status"><Select value={form.employmentStatus} onChange={(e) => setForm({ ...form, employmentStatus: e.target.value })}>
            {EMP_STATUS.map((s) => <option key={s} value={s}>{titleCase(s)}</option>)}
          </Select></Field>
          <Field label="Hire date"><Input type="date" value={form.hireDate} onChange={(e) => setForm({ ...form, hireDate: e.target.value })} /></Field>
          <Field label="System role" hint={editing ? 'Changing role revokes the user’s sessions.' : 'Determines login access.'}>
            <Select value={form.roleCode} onChange={(e) => setForm({ ...form, roleCode: e.target.value })}>
              {ROLE_CODES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2.5 text-sm text-ink-700 sm:col-span-2">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" /> Active employee
          </label>
        </div>
      </Modal>

      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} onDone={() => void qc.invalidateQueries({ queryKey: ['employees'] })} />
      <TrainingModal employee={training} onClose={() => setTraining(null)} />

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Deactivate employee" message={`Deactivate "${deleting?.fullName}"? Their account and sessions will be disabled. Training records are preserved.`}
        confirmLabel="Deactivate" danger loading={remove.isPending} />
    </div>
  );
}

function ImportModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<{ created: number; skipped: number; total: number; errors: { row: number; message: string }[] } | null>(null);

  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('file', file!);
      return api.upload<{ created: number; skipped: number; total: number; errors: { row: number; message: string }[] }>('/employees/import', fd);
    },
    onSuccess: (res) => { setResult(res); toast.success(`Imported ${res.created} of ${res.total} rows`); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  function close() { setFile(null); setResult(null); onClose(); }

  return (
    <Modal open={open} onClose={close} title="Bulk import employees" subtitle="Upload a CSV or XLSX file." size="lg"
      footer={<>
        <Button variant="outline" onClick={close}>Close</Button>
        {!result && <Button variant="gold" loading={upload.isPending} disabled={!file} onClick={() => upload.mutate()}>Import</Button>}
      </>}>
      {!result ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-ink-200 bg-ink-50/50 p-5 text-sm text-ink-600">
            <p className="mb-2 flex items-center gap-2 font-semibold text-ink-800"><FileSpreadsheet className="h-4 w-4 text-gold-500" /> Required columns</p>
            <code className="block rounded-lg bg-white px-3 py-2 text-xs text-ink-600">employee_no, first_name, last_name, email</code>
            <p className="mt-3 mb-1 text-xs font-semibold text-ink-500">Optional columns</p>
            <code className="block rounded-lg bg-white px-3 py-2 text-xs text-ink-500">department_code, branch_code, position, employment_status, phone, hire_date</code>
            <p className="mt-3 text-xs text-ink-400">Up to 2000 rows. Department/branch matched by code. Imported staff get the Employee role and must set a password on first login.</p>
          </div>
          <Field label="File" required>
            <input type="file" accept=".csv,.xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-lg file:border-0 file:bg-gold-50 file:px-4 file:py-2 file:text-sm file:font-semibold file:text-gold-700 hover:file:bg-gold-100" />
          </Field>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-emerald-50 p-4 text-center"><p className="text-2xl font-bold text-emerald-700">{result.created}</p><p className="text-xs text-emerald-600">Created</p></div>
            <div className="rounded-xl bg-gold-50 p-4 text-center"><p className="text-2xl font-bold text-gold-700">{result.skipped}</p><p className="text-xs text-gold-600">Skipped</p></div>
            <div className="rounded-xl bg-ink-100 p-4 text-center"><p className="text-2xl font-bold text-ink-700">{result.total}</p><p className="text-xs text-ink-500">Total rows</p></div>
          </div>
          {result.errors.length > 0 && (
            <div>
              <p className="mb-2 text-sm font-semibold text-ink-700">Row errors ({result.errors.length})</p>
              <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-100">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-ink-100 bg-ink-50 text-left"><th className="px-3 py-2">Row</th><th className="px-3 py-2">Message</th></tr></thead>
                  <tbody>{result.errors.map((e, i) => <tr key={i} className="border-b border-ink-50 last:border-0"><td className="px-3 py-2 font-semibold text-red-600">{e.row}</td><td className="px-3 py-2 text-ink-600">{e.message}</td></tr>)}</tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function TrainingModal({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['employee-training', employee?.id],
    queryFn: () => api.get<EmployeeTraining>(`/employees/${employee!.id}/training`),
    enabled: !!employee,
  });
  return (
    <Modal open={!!employee} onClose={onClose} title={employee ? `${employee.fullName} — Training` : 'Training'} subtitle={employee?.employeeNo} size="lg">
      {isLoading || !data ? <LoadingBlock /> : (
        <div className="space-y-6">
          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800"><GraduationCap className="h-4 w-4 text-gold-500" /> Enrollments ({data.enrollments.length})</h4>
            {data.enrollments.length === 0 ? <p className="text-sm text-ink-400">No enrollments.</p> : (
              <div className="space-y-2">
                {data.enrollments.map((e) => (
                  <div key={e.id} className="rounded-xl border border-ink-100 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-ink-800">{e.title}</span>
                      <Badge tone={STATUS_TONES[e.status] ?? 'bg-ink-100 text-ink-600'}>{titleCase(e.status)}</Badge>
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={Number(e.progress_percent)} className="h-1.5 flex-1" />
                      <span className="text-xs text-ink-400">{formatPercent(e.progress_percent)}</span>
                    </div>
                    {e.due_date && <p className={`mt-1 text-[11px] ${e.is_overdue ? 'text-red-600' : 'text-ink-400'}`}>Due {formatDate(e.due_date)}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>
          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800"><Award className="h-4 w-4 text-gold-500" /> Certificates ({data.certificates.length})</h4>
            {data.certificates.length === 0 ? <p className="text-sm text-ink-400">No certificates.</p> : (
              <div className="space-y-2">{data.certificates.map((c) => (
                <div key={c.id} className="flex items-center justify-between rounded-xl bg-gold-50/50 px-3 py-2.5 text-sm">
                  <span className="font-medium text-ink-800">{c.course_title}</span>
                  <span className="font-mono text-xs text-ink-500">{c.certificate_number}</span>
                </div>
              ))}</div>
            )}
          </section>
          <section>
            <h4 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-800"><ClipboardList className="h-4 w-4 text-gold-500" /> Assessment attempts ({data.attempts.length})</h4>
            {data.attempts.length === 0 ? <p className="text-sm text-ink-400">No attempts.</p> : (
              <div className="overflow-x-auto rounded-xl border border-ink-100">
                <table className="w-full text-xs">
                  <thead><tr className="border-b border-ink-100 bg-ink-50 text-left"><th className="px-3 py-2">Assessment</th><th className="px-3 py-2">Attempt</th><th className="px-3 py-2 text-center">Score</th><th className="px-3 py-2 text-center">Result</th></tr></thead>
                  <tbody>{data.attempts.map((a) => (
                    <tr key={a.id} className="border-b border-ink-50 last:border-0">
                      <td className="px-3 py-2 text-ink-700">{a.quiz_title}</td>
                      <td className="px-3 py-2 text-ink-500">#{a.attempt_number}</td>
                      <td className="px-3 py-2 text-center font-semibold text-ink-700">{formatPercent(a.percentage)}</td>
                      <td className="px-3 py-2 text-center"><Badge tone={a.passed === 1 ? 'bg-emerald-50 text-emerald-700' : a.passed === 0 ? 'bg-red-50 text-red-700' : 'bg-gold-50 text-gold-700'}>{a.passed === 1 ? 'Passed' : a.passed === 0 ? 'Failed' : 'Pending'}</Badge></td>
                    </tr>
                  ))}</tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
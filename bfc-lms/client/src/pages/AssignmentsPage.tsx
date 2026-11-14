import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, CalendarClock, Trash2, BellRing, Send, Users, AlertTriangle } from 'lucide-react';
import { api, queryString } from '@/lib/api';
import type { Enrollment, Course, Department, Branch, Employee, Paginated, AssignResult } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatPercent, titleCase } from '@/lib/format';
import { STATUS_TONES } from '@/lib/access';
import {
  PageHeader, Card, Button, Badge, Avatar, LoadingBlock, EmptyState, Modal, Field, Input, Select,
  ConfirmDialog, IconButton, Pagination, SearchInput, ProgressBar,
} from '@/components/ui';

const TARGET_TYPES = [
  { value: 'individual', label: 'Specific employees' },
  { value: 'department', label: 'Departments' },
  { value: 'branch', label: 'Branches' },
  { value: 'position', label: 'Position / job title' },
  { value: 'all', label: 'All active employees' },
] as const;

export function AssignmentsPage() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canAssign = has('enrollment.assign');
  const canRevoke = has('enrollment.revoke');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState('');
  const [overdue, setOverdue] = useState('');

  const { data: courses } = useQuery({ queryKey: ['courses', 'all-published'], queryFn: () => api.get<Paginated<Course>>('/courses/?status=published&pageSize=200') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });
  const { data: branches } = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ items: Branch[] }>('/branches') });

  const query = queryString({ page, pageSize: 20, search, courseId, departmentId, branchId, status, overdue });
  const { data, isLoading } = useQuery({ queryKey: ['enrollments', query], queryFn: () => api.get<Paginated<Enrollment>>(`/enrollments/${query}`) });

  const [assignOpen, setAssignOpen] = useState(false);
  const [deadline, setDeadline] = useState<Enrollment | null>(null);
  const [revoking, setRevoking] = useState<Enrollment | null>(null);

  const revoke = useMutation({
    mutationFn: (id: number) => api.del(`/enrollments/${id}`),
    onSuccess: () => { toast.success('Assignment removed'); setRevoking(null); void qc.invalidateQueries({ queryKey: ['enrollments'] }); },
    onError: (e: Error) => { toast.error(e.message); setRevoking(null); },
  });

  const reminders = useMutation({
    mutationFn: () => api.post<{ sent: number; windowDays: number }>('/enrollments/send-reminders'),
    onSuccess: (r) => { toast.success(`Sent ${r.sent} reminder${r.sent === 1 ? '' : 's'} for training due within ${r.windowDays} days`); void qc.invalidateQueries({ queryKey: ['notifications'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Assignments" subtitle="Assign training, track progress and manage deadlines."
        actions={<>
          {canAssign && <Button variant="outline" icon={<BellRing className="h-4 w-4" />} loading={reminders.isPending} onClick={() => reminders.mutate()}>Send reminders</Button>}
          {canAssign && <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>Assign training</Button>}
        </>} />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search employee or course…" />
          <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setPage(1); }}>
            <option value="">All courses</option>
            {(courses?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            <option value="">Any status</option><option value="assigned">Assigned</option><option value="in_progress">In progress</option><option value="completed">Completed</option>
          </Select>
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <Select value={branchId} onChange={(e) => { setBranchId(e.target.value); setPage(1); }}>
            <option value="">All branches</option>
            {(branches?.items ?? []).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
          <Select value={overdue} onChange={(e) => { setOverdue(e.target.value); setPage(1); }}>
            <option value="">Any deadline</option><option value="true">Overdue only</option><option value="false">On track only</option>
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No assignments found" message="Assign training to employees or adjust your filters." icon={<CalendarClock className="h-7 w-7" />}
            action={canAssign ? <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => setAssignOpen(true)}>Assign training</Button> : undefined} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ink-100 text-left">
                  <th className="th">Employee</th><th className="th">Course</th><th className="th">Progress</th>
                  <th className="th">Due date</th><th className="th">Assigned via</th><th className="th text-center">Status</th>
                  <th className="th text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar name={e.employee.name} size="sm" />
                          <span>
                            <span className="block font-semibold text-ink-800">{e.employee.name}</span>
                            <span className="block text-xs text-ink-400">{e.employee.employeeNo}{e.employee.departmentName ? ` · ${e.employee.departmentName}` : ''}</span>
                          </span>
                        </div>
                      </td>
                      <td className="td">
                        <span className="block font-medium text-ink-700">{e.course.title}</span>
                        <span className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-400">{e.course.code}
                          <Badge tone={STATUS_TONES[e.course.courseType] ?? 'bg-ink-100 text-ink-600'}>{titleCase(e.course.courseType)}</Badge>
                        </span>
                      </td>
                      <td className="td">
                        <div className="flex w-32 items-center gap-2">
                          <ProgressBar value={e.progressPercent} className="h-1.5 flex-1" tone={e.status === 'completed' ? 'bg-emerald-500' : 'bg-gold-500'} />
                          <span className="w-9 text-right text-xs text-ink-500">{formatPercent(e.progressPercent)}</span>
                        </div>
                      </td>
                      <td className="td">
                        {e.dueDate ? (
                          <span className={`inline-flex items-center gap-1 text-xs ${e.isOverdue ? 'font-semibold text-red-600' : 'text-ink-600'}`}>
                            {e.isOverdue && <AlertTriangle className="h-3.5 w-3.5" />}{formatDate(e.dueDate)}
                          </span>
                        ) : <span className="text-xs text-ink-300">No deadline</span>}
                      </td>
                      <td className="td"><Badge tone="bg-ink-100 text-ink-600">{titleCase(e.assignmentType)}</Badge></td>
                      <td className="td text-center"><Badge tone={STATUS_TONES[e.status] ?? 'bg-ink-100 text-ink-600'}>{titleCase(e.status)}</Badge></td>
                      <td className="td"><div className="flex justify-end gap-1">
                        {canAssign && <IconButton label="Edit deadline" onClick={() => setDeadline(e)}><CalendarClock className="h-4 w-4" /></IconButton>}
                        {canRevoke && e.status !== 'completed' && <IconButton label="Remove assignment" className="hover:bg-red-50 hover:text-red-600" onClick={() => setRevoking(e)}><Trash2 className="h-4 w-4" /></IconButton>}
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

      <AssignModal open={assignOpen} onClose={() => setAssignOpen(false)} courses={courses?.items ?? []} depts={depts?.items ?? []} branches={branches?.items ?? []}
        onDone={() => void qc.invalidateQueries({ queryKey: ['enrollments'] })} />
      <DeadlineModal enrollment={deadline} onClose={() => setDeadline(null)} onDone={() => void qc.invalidateQueries({ queryKey: ['enrollments'] })} />

      <ConfirmDialog open={!!revoking} onClose={() => setRevoking(null)} onConfirm={() => revoking && revoke.mutate(revoking.id)}
        title="Remove assignment" message={`Remove "${revoking?.course.title}" from ${revoking?.employee.name}? Their progress for this course will be deleted.`}
        confirmLabel="Remove" danger loading={revoke.isPending} />
    </div>
  );
}

function AssignModal({ open, onClose, courses, depts, branches, onDone }: {
  open: boolean; onClose: () => void; courses: Course[]; depts: Department[]; branches: Branch[]; onDone: () => void;
}) {
  const toast = useToast();
  const [courseId, setCourseId] = useState('');
  const [targetType, setTargetType] = useState<string>('individual');
  const [employeeIds, setEmployeeIds] = useState<number[]>([]);
  const [departmentIds, setDepartmentIds] = useState<number[]>([]);
  const [branchIds, setBranchIds] = useState<number[]>([]);
  const [position, setPosition] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [empSearch, setEmpSearch] = useState('');

  const { data: employees } = useQuery({
    queryKey: ['employees', 'assign-picker', empSearch],
    queryFn: () => api.get<Paginated<Employee>>(`/employees/${queryString({ pageSize: 200, search: empSearch, isActive: 'true' })}`),
    enabled: open && targetType === 'individual',
  });

  const assign = useMutation({
    mutationFn: () => {
      const body: Record<string, unknown> = { courseId: Number(courseId), targetType, dueDate: dueDate || null };
      if (targetType === 'individual') body.employeeIds = employeeIds;
      if (targetType === 'department') body.departmentIds = departmentIds;
      if (targetType === 'branch') body.branchIds = branchIds;
      if (targetType === 'position') body.position = position;
      return api.post<AssignResult>('/enrollments/assign', body);
    },
    onSuccess: (r) => {
      toast.success(`Assigned to ${r.created} employee${r.created === 1 ? '' : 's'}${r.skipped ? ` · ${r.skipped} already enrolled` : ''}`);
      reset(); onClose(); onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function reset() { setCourseId(''); setTargetType('individual'); setEmployeeIds([]); setDepartmentIds([]); setBranchIds([]); setPosition(''); setDueDate(''); setEmpSearch(''); }
  function close() { reset(); onClose(); }
  const toggle = (list: number[], set: (v: number[]) => void, id: number) => set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);

  const targetValid =
    targetType === 'individual' ? employeeIds.length > 0 :
    targetType === 'department' ? departmentIds.length > 0 :
    targetType === 'branch' ? branchIds.length > 0 :
    targetType === 'position' ? position.trim().length > 0 : true;
  const valid = courseId && targetValid;

  return (
    <Modal open={open} onClose={close} title="Assign training" subtitle="Choose a published course and who should take it." size="lg"
      footer={<>
        <Button variant="outline" onClick={close}>Cancel</Button>
        <Button variant="gold" icon={<Send className="h-4 w-4" />} loading={assign.isPending} disabled={!valid} onClick={() => assign.mutate()}>Assign</Button>
      </>}>
      <div className="space-y-4">
        <Field label="Course" required hint="Only published courses can be assigned.">
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">Select a course…</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.title} ({c.code})</option>)}
          </Select>
        </Field>

        <Field label="Assign to" required>
          <div className="grid gap-2 sm:grid-cols-2">
            {TARGET_TYPES.map((t) => (
              <label key={t.value} className={`flex cursor-pointer items-center gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition ${targetType === t.value ? 'border-gold-400 bg-gold-50 text-ink-900' : 'border-ink-200 text-ink-600 hover:border-ink-300'}`}>
                <input type="radio" name="targetType" checked={targetType === t.value} onChange={() => setTargetType(t.value)} className="h-4 w-4 text-gold-500 focus:ring-gold-400" />
                {t.label}
              </label>
            ))}
          </div>
        </Field>

        {targetType === 'individual' && (
          <Field label={`Employees (${employeeIds.length} selected)`} required>
            <div className="space-y-2">
              <SearchInput value={empSearch} onChange={setEmpSearch} placeholder="Search employees…" />
              <div className="max-h-56 overflow-y-auto rounded-xl border border-ink-100">
                {(employees?.items ?? []).length === 0 ? <p className="px-3 py-4 text-sm text-ink-400">No employees found.</p> :
                  (employees?.items ?? []).map((e) => (
                    <label key={e.id} className="flex cursor-pointer items-center gap-3 border-b border-ink-50 px-3 py-2 last:border-0 hover:bg-ink-50">
                      <input type="checkbox" checked={employeeIds.includes(e.id)} onChange={() => toggle(employeeIds, setEmployeeIds, e.id)} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                      <Avatar name={e.fullName} size="sm" />
                      <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-ink-800">{e.fullName}</span><span className="block text-xs text-ink-400">{e.employeeNo}{e.departmentName ? ` · ${e.departmentName}` : ''}</span></span>
                    </label>
                  ))}
              </div>
            </div>
          </Field>
        )}

        {targetType === 'department' && (
          <Field label={`Departments (${departmentIds.length} selected)`} required>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-ink-100 p-2">
              {depts.map((d) => (
                <label key={d.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                  <input type="checkbox" checked={departmentIds.includes(d.id)} onChange={() => toggle(departmentIds, setDepartmentIds, d.id)} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                  <span className="flex-1 text-ink-700">{d.name}</span><span className="text-xs text-ink-400">{d.employee_count} staff</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        {targetType === 'branch' && (
          <Field label={`Branches (${branchIds.length} selected)`} required>
            <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-ink-100 p-2">
              {branches.map((b) => (
                <label key={b.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-ink-50">
                  <input type="checkbox" checked={branchIds.includes(b.id)} onChange={() => toggle(branchIds, setBranchIds, b.id)} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                  <span className="flex-1 text-ink-700">{b.name}</span><span className="text-xs text-ink-400">{b.employee_count} staff</span>
                </label>
              ))}
            </div>
          </Field>
        )}

        {targetType === 'position' && (
          <Field label="Position" required hint="Matches employees whose job title equals this exactly (e.g. Barista).">
            <Input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="Barista" maxLength={120} />
          </Field>
        )}

        {targetType === 'all' && (
          <div className="flex items-center gap-2 rounded-xl bg-sky-50 px-3 py-2.5 text-sm text-sky-700">
            <Users className="h-4 w-4 shrink-0" /> Every active employee will be enrolled in this course.
          </div>
        )}

        <Field label="Deadline" hint="Optional. Learners are reminded as the due date approaches.">
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}

function DeadlineModal({ enrollment, onClose, onDone }: { enrollment: Enrollment | null; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [dueDate, setDueDate] = useState('');
  const [loadedId, setLoadedId] = useState<number | null>(null);

  if (enrollment && enrollment.id !== loadedId) {
    setLoadedId(enrollment.id);
    setDueDate(enrollment.dueDate ?? '');
  }

  const save = useMutation({
    mutationFn: () => api.put(`/enrollments/${enrollment!.id}`, { dueDate: dueDate || null }),
    onSuccess: () => { toast.success('Deadline updated'); onClose(); onDone(); },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Modal open={!!enrollment} onClose={onClose} title="Edit deadline" subtitle={enrollment ? `${enrollment.course.title} — ${enrollment.employee.name}` : ''} size="sm"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="gold" loading={save.isPending} onClick={() => save.mutate()}>Save deadline</Button>
      </>}>
      <Field label="Due date" hint="Leave empty to remove the deadline.">
        <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
      </Field>
    </Modal>
  );
}
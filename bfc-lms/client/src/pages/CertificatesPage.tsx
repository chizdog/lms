import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Download, Plus, Ban, FileBadge } from 'lucide-react';
import { api, queryString, downloadFile } from '@/lib/api';
import type { Certificate, Enrollment, Course, Department, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDate, formatPercent } from '@/lib/format';
import {
  PageHeader, Card, Button, Badge, Avatar, LoadingBlock, EmptyState, Modal, Field, Select, Textarea,
  IconButton, Pagination, SearchInput,
} from '@/components/ui';

export function CertificatesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canIssue = has('certificate.issue');
  const canRevoke = has('certificate.revoke');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [courseId, setCourseId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [includeRevoked, setIncludeRevoked] = useState(false);

  const { data: courses } = useQuery({ queryKey: ['courses', 'all-published'], queryFn: () => api.get<Paginated<Course>>('/courses/?status=published&pageSize=200') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });

  const query = queryString({ page, pageSize: 20, search, courseId, departmentId, includeRevoked: includeRevoked ? 'true' : '' });
  const { data, isLoading } = useQuery({ queryKey: ['certificates', query], queryFn: () => api.get<Paginated<Certificate>>(`/certificates/${query}`) });

  const [issueOpen, setIssueOpen] = useState(false);
  const [revoking, setRevoking] = useState<Certificate | null>(null);
  const [reason, setReason] = useState('');

  const revoke = useMutation({
    mutationFn: () => api.post(`/certificates/${revoking!.id}/revoke`, { reason: reason || undefined }),
    onSuccess: () => { toast.success('Certificate revoked'); setRevoking(null); setReason(''); void qc.invalidateQueries({ queryKey: ['certificates'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  async function download(c: Certificate) {
    try { await downloadFile(`/certificates/${c.id}/download`, `${c.certificateNumber}.pdf`); }
    catch (e) { toast.error((e as Error).message); }
  }

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Certificates" subtitle="Issue, download and revoke training completion certificates."
        actions={canIssue ? <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => setIssueOpen(true)}>Issue certificate</Button> : undefined} />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, course, number…" />
          <Select value={courseId} onChange={(e) => { setCourseId(e.target.value); setPage(1); }}>
            <option value="">All courses</option>
            {(courses?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
          <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
            <option value="">All departments</option>
            {(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </Select>
          <label className="flex items-center gap-2.5 rounded-xl border border-ink-200 px-3 text-sm text-ink-600">
            <input type="checkbox" checked={includeRevoked} onChange={(e) => { setIncludeRevoked(e.target.checked); setPage(1); }} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
            Include revoked
          </label>
        </div>
      </Card>

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No certificates found" message="Certificates are issued automatically on completion, or manually here." icon={<Award className="h-7 w-7" />} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ink-100 text-left">
                  <th className="th">Certificate</th><th className="th">Employee</th><th className="th">Course</th>
                  <th className="th">Completed</th><th className="th text-center">Score</th><th className="th text-center">Status</th>
                  <th className="th text-right">Actions</th>
                </tr></thead>
                <tbody>
                  {items.map((c) => (
                    <tr key={c.id} className={`border-b border-ink-50 last:border-0 hover:bg-ink-50/50 ${c.isRevoked ? 'opacity-60' : ''}`}>
                      <td className="td">
                        <span className="flex items-center gap-2 font-mono text-xs font-semibold text-ink-700"><FileBadge className="h-4 w-4 text-gold-500" />{c.certificateNumber}</span>
                        <span className="mt-0.5 block text-[11px] text-ink-400">Issued {formatDate(c.issuedAt)}</span>
                      </td>
                      <td className="td">
                        <div className="flex items-center gap-3">
                          <Avatar name={c.employee.name} size="sm" />
                          <span><span className="block font-semibold text-ink-800">{c.employee.name}</span><span className="block text-xs text-ink-400">{c.employee.employeeNo}</span></span>
                        </div>
                      </td>
                      <td className="td"><span className="block font-medium text-ink-700">{c.course.title}</span><span className="block text-xs text-ink-400">{c.course.code}</span></td>
                      <td className="td text-ink-600">{formatDate(c.completionDate)}</td>
                      <td className="td text-center font-semibold text-ink-700">{c.score === null ? '—' : formatPercent(c.score)}</td>
                      <td className="td text-center">
                        {c.isRevoked ? <Badge tone="bg-red-50 text-red-700">Revoked</Badge> : <Badge tone="bg-emerald-50 text-emerald-700">Active</Badge>}
                      </td>
                      <td className="td"><div className="flex justify-end gap-1">
                        {!c.isRevoked && <IconButton label="Download PDF" onClick={() => void download(c)}><Download className="h-4 w-4" /></IconButton>}
                        {canRevoke && !c.isRevoked && <IconButton label="Revoke" className="hover:bg-red-50 hover:text-red-600" onClick={() => { setRevoking(c); setReason(''); }}><Ban className="h-4 w-4" /></IconButton>}
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

      <IssueModal open={issueOpen} onClose={() => setIssueOpen(false)} onDone={() => void qc.invalidateQueries({ queryKey: ['certificates'] })} />

      <Modal open={!!revoking} onClose={() => setRevoking(null)} title="Revoke certificate" subtitle={revoking?.certificateNumber} size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setRevoking(null)}>Cancel</Button>
          <Button variant="danger" loading={revoke.isPending} onClick={() => revoke.mutate()}>Revoke</Button>
        </>}>
        <div className="space-y-3">
          <p className="text-sm text-ink-600">Revoking invalidates this certificate. The learner will no longer be able to download it. This is recorded in the audit log.</p>
          <Field label="Reason (optional)"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} placeholder="e.g. Issued in error" /></Field>
        </div>
      </Modal>
    </div>
  );
}

function IssueModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [enrollmentId, setEnrollmentId] = useState('');
  const [search, setSearch] = useState('');

  const { data } = useQuery({
    queryKey: ['enrollments', 'completed-picker', search],
    queryFn: () => api.get<Paginated<Enrollment>>(`/enrollments/${queryString({ status: 'completed', pageSize: 200, search })}`),
    enabled: open,
  });

  const issue = useMutation({
    mutationFn: () => api.post<{ id: number; certificateNumber: string; alreadyIssued: boolean }>('/certificates/issue', { enrollmentId: Number(enrollmentId) }),
    onSuccess: (r) => {
      toast.success(r.alreadyIssued ? `Certificate ${r.certificateNumber} already exists` : `Issued ${r.certificateNumber}`);
      setEnrollmentId(''); setSearch(''); onClose(); onDone();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];

  return (
    <Modal open={open} onClose={onClose} title="Issue certificate" subtitle="Select a completed training record." size="lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="gold" icon={<Award className="h-4 w-4" />} loading={issue.isPending} disabled={!enrollmentId} onClick={() => issue.mutate()}>Issue</Button>
      </>}>
      <div className="space-y-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Search employee or course…" />
        <div className="max-h-80 overflow-y-auto rounded-xl border border-ink-100">
          {items.length === 0 ? <p className="px-3 py-6 text-center text-sm text-ink-400">No completed training records found.</p> :
            items.map((e) => (
              <label key={e.id} className={`flex cursor-pointer items-center gap-3 border-b border-ink-50 px-3 py-2.5 last:border-0 hover:bg-ink-50 ${enrollmentId === String(e.id) ? 'bg-gold-50/60' : ''}`}>
                <input type="radio" name="enrollment" checked={enrollmentId === String(e.id)} onChange={() => setEnrollmentId(String(e.id))} className="h-4 w-4 text-gold-500 focus:ring-gold-400" />
                <Avatar name={e.employee.name} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink-800">{e.employee.name}</span>
                  <span className="block truncate text-xs text-ink-400">{e.course.title} · completed {formatDate(e.completedAt)}</span>
                </span>
              </label>
            ))}
        </div>
        <p className="text-xs text-ink-400">A certificate PDF is generated with the course signatory and the learner’s best assessment score.</p>
      </div>
    </Modal>
  );
}
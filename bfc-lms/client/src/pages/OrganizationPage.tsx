import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Building2, MapPin } from 'lucide-react';
import { api } from '@/lib/api';
import type { Department, Branch } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatNumber } from '@/lib/format';
import {
  PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Modal, Field, Input, Textarea, Select, ConfirmDialog, IconButton, Tabs,
} from '@/components/ui';

export function OrganizationPage() {
  const { has } = useAuth();
  const [tab, setTab] = useState<'departments' | 'branches'>('departments');
  const tabs = [
    ...(has('department.view') ? [{ key: 'departments', label: 'Departments' }] : []),
    ...(has('branch.view') ? [{ key: 'branches', label: 'Branches' }] : []),
  ];
  const active = tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key ?? 'departments');

  return (
    <div>
      <PageHeader title="Organization" subtitle="Manage BFC departments and branch locations." />
      <div className="mb-5"><Tabs tabs={tabs} active={active} onChange={(k) => setTab(k as 'departments' | 'branches')} /></div>
      {active === 'departments' ? <Departments /> : <Branches />}
    </div>
  );
}

interface DeptForm { code: string; name: string; description: string; parentId: string; isActive: boolean }
const DEPT_EMPTY: DeptForm = { code: '', name: '', description: '', parentId: '', isActive: true };

function Departments() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = has('department.manage');
  const { data, isLoading } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments') });
  const items = data?.items ?? [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [form, setForm] = useState<DeptForm>(DEPT_EMPTY);
  const [deleting, setDeleting] = useState<Department | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { code: form.code, name: form.name, description: form.description || null, parentId: form.parentId ? Number(form.parentId) : null, isActive: form.isActive };
      return editing ? api.put(`/departments/${editing.id}`, body) : api.post('/departments', body);
    },
    onSuccess: () => { toast.success(editing ? 'Department updated' : 'Department created'); setOpen(false); setEditing(null); setForm(DEPT_EMPTY); void qc.invalidateQueries({ queryKey: ['departments'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/departments/${id}`),
    onSuccess: () => { toast.success('Department deleted'); setDeleting(null); void qc.invalidateQueries({ queryKey: ['departments'] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  function openEdit(d: Department) {
    setEditing(d);
    setForm({ code: d.code, name: d.name, description: d.description ?? '', parentId: d.parent_id ? String(d.parent_id) : '', isActive: Boolean(d.is_active) });
    setOpen(true);
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
        <h3 className="flex items-center gap-2 font-bold text-ink-900"><Building2 className="h-4 w-4 text-gold-500" /> Departments</h3>
        {canManage && <Button variant="gold" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setForm(DEPT_EMPTY); setOpen(true); }}>New department</Button>}
      </div>
      {isLoading ? <LoadingBlock /> : items.length === 0 ? (
        <EmptyState title="No departments" icon={<Building2 className="h-7 w-7" />} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-100 text-left">
              <th className="th">Code</th><th className="th">Name</th><th className="th">Parent</th><th className="th">Description</th>
              <th className="th text-center">Employees</th><th className="th text-center">Courses</th><th className="th text-center">Status</th>
              {canManage && <th className="th text-right">Actions</th>}
            </tr></thead>
            <tbody>
              {items.map((d) => (
                <tr key={d.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                  <td className="td font-mono text-xs font-semibold text-ink-600">{d.code}</td>
                  <td className="td font-semibold text-ink-800">{d.name}</td>
                  <td className="td text-ink-500">{items.find((p) => p.id === d.parent_id)?.name ?? '—'}</td>
                  <td className="td max-w-xs truncate text-ink-500">{d.description ?? '—'}</td>
                  <td className="td text-center font-semibold text-ink-700">{formatNumber(d.employee_count)}</td>
                  <td className="td text-center text-ink-600">{formatNumber(d.course_count)}</td>
                  <td className="td text-center"><Badge tone={d.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{d.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  {canManage && <td className="td"><div className="flex justify-end gap-1">
                    <IconButton label="Edit" onClick={() => openEdit(d)}><Pencil className="h-4 w-4" /></IconButton>
                    <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(d)}><Trash2 className="h-4 w-4" /></IconButton>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit department' : 'New department'}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="gold" loading={save.isPending} disabled={!form.code.trim() || !form.name.trim()} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="OPS" maxLength={30} className="font-mono" /></Field>
            <div className="col-span-2"><Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Operations" maxLength={120} /></Field></div>
          </div>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={255} /></Field>
          <Field label="Parent department" hint="Optional — for sub-departments.">
            <Select value={form.parentId} onChange={(e) => setForm({ ...form, parentId: e.target.value })}>
              <option value="">None (top level)</option>
              {items.filter((d) => d.id !== editing?.id).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
          <label className="flex items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" /> Active
          </label>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete department" message={`Delete "${deleting?.name}"? Departments with employees or courses cannot be deleted.`} confirmLabel="Delete" danger loading={remove.isPending} />
    </Card>
  );
}

interface BranchForm { code: string; name: string; address: string; city: string; region: string; isActive: boolean }
const BRANCH_EMPTY: BranchForm = { code: '', name: '', address: '', city: '', region: '', isActive: true };

function Branches() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = has('branch.manage');
  const { data, isLoading } = useQuery({ queryKey: ['branches'], queryFn: () => api.get<{ items: Branch[] }>('/branches') });
  const items = data?.items ?? [];

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Branch | null>(null);
  const [form, setForm] = useState<BranchForm>(BRANCH_EMPTY);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { code: form.code, name: form.name, address: form.address || null, city: form.city || null, region: form.region || null, isActive: form.isActive };
      return editing ? api.put(`/branches/${editing.id}`, body) : api.post('/branches', body);
    },
    onSuccess: () => { toast.success(editing ? 'Branch updated' : 'Branch created'); setOpen(false); setEditing(null); setForm(BRANCH_EMPTY); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/branches/${id}`),
    onSuccess: () => { toast.success('Branch deleted'); setDeleting(null); void qc.invalidateQueries({ queryKey: ['branches'] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  function openEdit(b: Branch) {
    setEditing(b);
    setForm({ code: b.code, name: b.name, address: b.address ?? '', city: b.city ?? '', region: b.region ?? '', isActive: Boolean(b.is_active) });
    setOpen(true);
  }

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
        <h3 className="flex items-center gap-2 font-bold text-ink-900"><MapPin className="h-4 w-4 text-gold-500" /> Branches</h3>
        {canManage && <Button variant="gold" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => { setEditing(null); setForm(BRANCH_EMPTY); setOpen(true); }}>New branch</Button>}
      </div>
      {isLoading ? <LoadingBlock /> : items.length === 0 ? (
        <EmptyState title="No branches" icon={<MapPin className="h-7 w-7" />} />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="border-b border-ink-100 text-left">
              <th className="th">Code</th><th className="th">Name</th><th className="th">Location</th><th className="th">Address</th>
              <th className="th text-center">Employees</th><th className="th text-center">Status</th>
              {canManage && <th className="th text-right">Actions</th>}
            </tr></thead>
            <tbody>
              {items.map((b) => (
                <tr key={b.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                  <td className="td font-mono text-xs font-semibold text-ink-600">{b.code}</td>
                  <td className="td font-semibold text-ink-800">{b.name}</td>
                  <td className="td text-ink-500">{[b.city, b.region].filter(Boolean).join(', ') || '—'}</td>
                  <td className="td max-w-xs truncate text-ink-500">{b.address ?? '—'}</td>
                  <td className="td text-center font-semibold text-ink-700">{formatNumber(b.employee_count)}</td>
                  <td className="td text-center"><Badge tone={b.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{b.is_active ? 'Active' : 'Inactive'}</Badge></td>
                  {canManage && <td className="td"><div className="flex justify-end gap-1">
                    <IconButton label="Edit" onClick={() => openEdit(b)}><Pencil className="h-4 w-4" /></IconButton>
                    <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" /></IconButton>
                  </div></td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit branch' : 'New branch'}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="gold" loading={save.isPending} disabled={!form.code.trim() || !form.name.trim()} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create'}</Button>
        </>}>
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <Field label="Code" required><Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="BGC" maxLength={30} className="font-mono" /></Field>
            <div className="col-span-2"><Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="BGC High Street" maxLength={120} /></Field></div>
          </div>
          <Field label="Address"><Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} maxLength={255} /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="City"><Input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} maxLength={80} /></Field>
            <Field label="Region"><Input value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} maxLength={80} /></Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" /> Active
          </label>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete branch" message={`Delete "${deleting?.name}"? Branches with employees cannot be deleted.`} confirmLabel="Delete" danger loading={remove.isPending} />
    </Card>
  );
}
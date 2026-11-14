import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Pencil, Trash2, Tags } from 'lucide-react';
import { api } from '@/lib/api';
import type { Category } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatNumber } from '@/lib/format';
import {
  PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Modal, Field, Input, Textarea, ConfirmDialog, IconButton,
} from '@/components/ui';

interface FormState { name: string; description: string; color: string; sortOrder: number; isActive: boolean }
const EMPTY: FormState = { name: '', description: '', color: '#C8952F', sortOrder: 0, isActive: true };

export function CategoriesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = has('category.manage');
  const { data, isLoading } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: Category[] }>('/courses/categories') });

  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [deleting, setDeleting] = useState<Category | null>(null);

  const save = useMutation({
    mutationFn: () => {
      const body = { name: form.name, description: form.description || null, color: form.color, sortOrder: form.sortOrder, isActive: form.isActive };
      return editing ? api.put(`/courses/categories/${editing.id}`, body) : api.post('/courses/categories', body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Category updated' : 'Category created');
      setOpen(false); setEditing(null); setForm(EMPTY);
      void qc.invalidateQueries({ queryKey: ['categories'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/courses/categories/${id}`),
    onSuccess: () => { toast.success('Category deleted'); setDeleting(null); void qc.invalidateQueries({ queryKey: ['categories'] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  function openCreate() { setEditing(null); setForm(EMPTY); setOpen(true); }
  function openEdit(c: Category) {
    setEditing(c);
    setForm({ name: c.name, description: c.description ?? '', color: c.color, sortOrder: c.sort_order, isActive: Boolean(c.is_active) });
    setOpen(true);
  }

  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Course Categories" subtitle="Organize the catalogue into BFC training categories."
        actions={canManage && <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={openCreate}>New category</Button>} />

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No categories yet" message="Create your first training category." icon={<Tags className="h-7 w-7" />}
            action={canManage && <Button variant="gold" size="sm" onClick={openCreate}>New category</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left">
                  <th className="th">Category</th>
                  <th className="th">Slug</th>
                  <th className="th">Description</th>
                  <th className="th text-center">Courses</th>
                  <th className="th text-center">Order</th>
                  <th className="th text-center">Status</th>
                  {canManage && <th className="th text-right">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                    <td className="td">
                      <span className="flex items-center gap-2.5 font-semibold text-ink-800">
                        <span className="h-4 w-4 shrink-0 rounded-full ring-2 ring-white" style={{ background: c.color }} />
                        {c.name}
                      </span>
                    </td>
                    <td className="td text-ink-400">{c.slug}</td>
                    <td className="td max-w-xs truncate text-ink-500">{c.description ?? '—'}</td>
                    <td className="td text-center font-semibold text-ink-700">{formatNumber(c.course_count)}</td>
                    <td className="td text-center text-ink-500">{c.sort_order}</td>
                    <td className="td text-center">
                      <Badge tone={c.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{c.is_active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {canManage && (
                      <td className="td">
                        <div className="flex items-center justify-end gap-1">
                          <IconButton label="Edit" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></IconButton>
                          <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(c)}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={open} onClose={() => setOpen(false)} title={editing ? 'Edit category' : 'New category'}
        footer={<>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="gold" loading={save.isPending} disabled={!form.name.trim()} onClick={() => save.mutate()}>{editing ? 'Save changes' : 'Create category'}</Button>
        </>}>
        <div className="space-y-4">
          <Field label="Name" required><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Coffee Craft" maxLength={120} /></Field>
          <Field label="Description"><Textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={255} placeholder="Optional short description" /></Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Color">
              <div className="flex items-center gap-2">
                <input type="color" value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="h-10 w-14 cursor-pointer rounded-lg border border-ink-200 bg-white p-1" />
                <Input value={form.color} onChange={(e) => setForm({ ...form, color: e.target.value })} className="font-mono" />
              </div>
            </Field>
            <Field label="Sort order"><Input type="number" min={0} value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) })} /></Field>
          </div>
          <label className="flex items-center gap-2.5 text-sm text-ink-700">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
            Active (visible in catalogue)
          </label>
        </div>
      </Modal>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete category" message={`Delete "${deleting?.name}"? Categories with courses cannot be deleted.`}
        confirmLabel="Delete" danger loading={remove.isPending} />
    </div>
  );
}
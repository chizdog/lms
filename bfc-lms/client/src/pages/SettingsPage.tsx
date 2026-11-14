import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Settings, ScrollText, DatabaseBackup, Save, Download, Trash2, Plus, ShieldCheck, HardDrive } from 'lucide-react';
import { api, queryString, downloadFile } from '@/lib/api';
import type { SystemSetting, AuditLog, Backup, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDateTime, fileSize, titleCase } from '@/lib/format';
import {
  PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Field, Input, Select, ConfirmDialog,
  IconButton, Pagination, SearchInput, Tabs,
} from '@/components/ui';

const EDITABLE_META: Record<string, { label: string; type: 'text' | 'number' | 'boolean'; hint?: string; min?: number; max?: number }> = {
  company_name: { label: 'Company name', type: 'text', hint: 'Shown across the portal and on certificates.' },
  certificate_signatory: { label: 'Certificate signatory', type: 'text', hint: 'Default name printed on certificates when a course has none.' },
  default_passing_score: { label: 'Default passing score (%)', type: 'number', min: 0, max: 100, hint: 'Used as the default for new assessments.' },
  reminder_days_before_due: { label: 'Reminder days before due', type: 'number', min: 0, max: 60, hint: 'How many days ahead deadline reminders are sent.' },
  email_notifications_enabled: { label: 'Email notifications', type: 'boolean', hint: 'Email delivery is not yet wired; in-app notifications always work.' },
};

export function SettingsPage() {
  const { has } = useAuth();
  const tabs = [
    has('settings.manage') ? { key: 'general', label: 'General' } : null,
    has('audit.view') ? { key: 'audit', label: 'Audit log' } : null,
    has('backup.manage') ? { key: 'backups', label: 'Backups' } : null,
  ].filter(Boolean) as { key: string; label: string }[];
  const [tab, setTab] = useState(tabs[0]?.key ?? 'general');

  return (
    <div>
      <PageHeader title="System Settings" subtitle="Configure the platform, review the audit trail and manage database backups." />
      {tabs.length > 1 && <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>}
      {tab === 'general' && has('settings.manage') && <GeneralTab />}
      {tab === 'audit' && has('audit.view') && <AuditTab />}
      {tab === 'backups' && has('backup.manage') && <BackupsTab />}
    </div>
  );
}

function GeneralTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['system-settings'], queryFn: () => api.get<{ items: SystemSetting[]; editable: string[] }>('/system/settings') });
  const [form, setForm] = useState<Record<string, string>>({});
  const [initialized, setInitialized] = useState(false);

  useEffect(() => {
    if (data && !initialized) {
      const next: Record<string, string> = {};
      for (const s of data.items) next[s.key] = s.value;
      setForm(next); setInitialized(true);
    }
  }, [data, initialized]);

  const save = useMutation({
    mutationFn: () => api.put('/system/settings', { settings: (data?.editable ?? []).map((key) => ({ key, value: form[key] ?? '' })) }),
    onSuccess: () => { toast.success('Settings saved'); void qc.invalidateQueries({ queryKey: ['system-settings'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <Card><LoadingBlock /></Card>;
  const editable = data.editable;
  const readOnly = data.items.filter((s) => !editable.includes(s.key));

  return (
    <div className="space-y-5">
      <Card className="p-5">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900"><Settings className="h-4 w-4 text-gold-500" /> General configuration</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          {editable.map((key) => {
            const meta = EDITABLE_META[key] ?? { label: titleCase(key), type: 'text' as const };
            const value = form[key] ?? '';
            if (meta.type === 'boolean') {
              return (
                <Field key={key} label={meta.label} hint={meta.hint}>
                  <Select value={value} onChange={(e) => setForm({ ...form, [key]: e.target.value })}>
                    <option value="true">Enabled</option><option value="false">Disabled</option>
                  </Select>
                </Field>
              );
            }
            return (
              <Field key={key} label={meta.label} hint={meta.hint}>
                <Input type={meta.type === 'number' ? 'number' : 'text'} value={value} min={meta.min} max={meta.max}
                  onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            );
          })}
        </div>
        <div className="mt-5 flex justify-end">
          <Button variant="gold" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={() => save.mutate()}>Save changes</Button>
        </div>
      </Card>

      {readOnly.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900"><ShieldCheck className="h-4 w-4 text-ink-400" /> System information</h3>
          <div className="divide-y divide-ink-50">
            {readOnly.map((s) => (
              <div key={s.key} className="flex items-center justify-between gap-4 py-2.5">
                <div><p className="text-sm font-medium text-ink-700">{titleCase(s.key)}</p>{s.description && <p className="text-xs text-ink-400">{s.description}</p>}</div>
                <span className="font-mono text-xs text-ink-500">{s.value}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function AuditTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [action, setAction] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const { data: actions } = useQuery({ queryKey: ['audit-actions'], queryFn: () => api.get<{ items: string[] }>('/system/audit/actions') });
  const query = queryString({ page, pageSize: 20, search, action, dateFrom, dateTo });
  const { data, isLoading } = useQuery({ queryKey: ['audit', query], queryFn: () => api.get<Paginated<AuditLog>>(`/system/audit${query}`) });

  const items = data?.items ?? [];

  return (
    <div>
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search action or description…" />
          <Select value={action} onChange={(e) => { setAction(e.target.value); setPage(1); }}>
            <option value="">All actions</option>
            {(actions?.items ?? []).map((a) => <option key={a} value={a}>{titleCase(a)}</option>)}
          </Select>
          <Input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
          <Input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        </div>
      </Card>
      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No audit entries" message="Activity will appear here as users interact with the system." icon={<ScrollText className="h-7 w-7" />} />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="border-b border-ink-100 text-left">
                  <th className="th">When</th><th className="th">Actor</th><th className="th">Action</th><th className="th">Description</th><th className="th">IP</th>
                </tr></thead>
                <tbody>
                  {items.map((a) => (
                    <tr key={a.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                      <td className="td whitespace-nowrap text-xs text-ink-500">{formatDateTime(a.createdAt)}</td>
                      <td className="td"><span className="block font-medium text-ink-700">{a.actor?.name ?? 'System'}</span>{a.actor && <span className="block text-xs text-ink-400">@{a.actor.username}</span>}</td>
                      <td className="td"><Badge tone="bg-ink-100 text-ink-600">{titleCase(a.action)}</Badge></td>
                      <td className="td max-w-md text-ink-600" title={a.metadata ? JSON.stringify(a.metadata) : undefined}>{a.description ?? '—'}</td>
                      <td className="td font-mono text-xs text-ink-400">{a.ipAddress ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}

function BackupsTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['backups'], queryFn: () => api.get<{ items: Backup[] }>('/system/backups') });
  const [deleting, setDeleting] = useState<Backup | null>(null);

  const create = useMutation({
    mutationFn: () => api.post<Backup>('/system/backup'),
    onSuccess: (r) => { toast.success(`Backup created: ${r.fileName}`); void qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: (name: string) => api.del(`/system/backups/${encodeURIComponent(name)}`),
    onSuccess: () => { toast.success('Backup deleted'); setDeleting(null); void qc.invalidateQueries({ queryKey: ['backups'] }); },
    onError: (e: Error) => { toast.error(e.message); setDeleting(null); },
  });

  async function download(b: Backup) {
    try { await downloadFile(`/system/backups/${encodeURIComponent(b.fileName)}/download`, b.fileName); }
    catch (e) { toast.error((e as Error).message); }
  }

  const items = data?.items ?? [];

  return (
    <div>
      <Card className="mb-5 flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-bold text-ink-900"><DatabaseBackup className="h-4 w-4 text-gold-500" /> Database backups</h3>
          <p className="mt-1 text-sm text-ink-500">Create a full SQL dump of the BFC LMS database. Store backups off-server for disaster recovery.</p>
        </div>
        <Button variant="gold" icon={<Plus className="h-4 w-4" />} loading={create.isPending} onClick={() => create.mutate()}>Create backup</Button>
      </Card>
      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No backups yet" message="Create your first database backup." icon={<HardDrive className="h-7 w-7" />} />
        ) : (
          <div className="divide-y divide-ink-50">
            {items.map((b) => (
              <div key={b.fileName} className="flex items-center gap-3 px-4 py-3.5 sm:px-5">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500"><HardDrive className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-sm font-medium text-ink-800">{b.fileName}</p>
                  <p className="text-xs text-ink-400">{fileSize(b.sizeBytes)} · {formatDateTime(b.createdAt)}</p>
                </div>
                <IconButton label="Download backup" onClick={() => void download(b)}><Download className="h-4 w-4" /></IconButton>
                <IconButton label="Delete backup" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(b)}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
          </div>
        )}
      </Card>
      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.fileName)}
        title="Delete backup" message={`Permanently delete "${deleting?.fileName}"? This cannot be undone.`} confirmLabel="Delete" danger loading={remove.isPending} />
    </div>
  );
}
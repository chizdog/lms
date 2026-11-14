import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ShieldCheck, KeyRound, Power, Pencil, Copy, Check, Users as UsersIcon } from 'lucide-react';
import { api, queryString } from '@/lib/api';
import type { UserRow, RolesResponse, Department, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDateTime, titleCase } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/access';
import {
  PageHeader, Card, Button, Badge, Avatar, LoadingBlock, EmptyState, Modal, Field, Select, ConfirmDialog,
  IconButton, Pagination, SearchInput, Tabs,
} from '@/components/ui';

const ROLE_CODES = ['super_admin', 'ld_admin', 'hr_admin', 'dept_admin', 'employee'];

export function UsersPage() {
  const { has } = useAuth();
  const [tab, setTab] = useState<'users' | 'roles'>('users');
  const tabs = [{ key: 'users', label: 'User Accounts' }, ...(has('role.manage') ? [{ key: 'roles', label: 'Roles & Permissions' }] : [])];
  return (
    <div>
      <PageHeader title="Users & Roles" subtitle="Control system access, roles and permissions." />
      <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={(k) => setTab(k as 'users' | 'roles')} /></div>
      {tab === 'users' ? <UsersTab /> : <RolesTab />}
    </div>
  );
}

function UsersTab() {
  const { has, auth } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const canManage = has('user.manage');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const query = queryString({ page, pageSize: 20, search });
  const { data, isLoading } = useQuery({ queryKey: ['users', query], queryFn: () => api.get<Paginated<UserRow>>(`/users/${query}`) });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments'), enabled: canManage });

  const [roleUser, setRoleUser] = useState<UserRow | null>(null);
  const [roleCode, setRoleCode] = useState('employee');
  const [scopeIds, setScopeIds] = useState<number[]>([]);
  const [resetUser, setResetUser] = useState<UserRow | null>(null);
  const [tempPassword, setTempPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [toggleUser, setToggleUser] = useState<UserRow | null>(null);

  const changeRole = useMutation({
    mutationFn: () => api.put(`/users/${roleUser!.id}/role`, { roleCode, ...(roleCode === 'dept_admin' ? { scopedDepartmentIds: scopeIds } : {}) }),
    onSuccess: () => { toast.success('Role updated'); setRoleUser(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const resetPassword = useMutation({
    mutationFn: () => api.post<{ temporaryPassword: string }>(`/users/${resetUser!.id}/reset-password`),
    onSuccess: (res) => { setTempPassword(res.temporaryPassword); setResetUser(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e: Error) => { toast.error(e.message); setResetUser(null); },
  });
  const toggleActive = useMutation({
    mutationFn: () => api.put(`/users/${toggleUser!.id}/active`, { isActive: !toggleUser!.isActive }),
    onSuccess: () => { toast.success(toggleUser!.isActive ? 'Account deactivated' : 'Account activated'); setToggleUser(null); void qc.invalidateQueries({ queryKey: ['users'] }); },
    onError: (e: Error) => { toast.error(e.message); setToggleUser(null); },
  });

  function openRole(u: UserRow) { setRoleUser(u); setRoleCode(u.roleCode); setScopeIds([]); }

  const items = data?.items ?? [];
  return (
    <Card>
      <div className="border-b border-ink-100 p-4"><div className="max-w-sm"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search username, name, email…" /></div></div>
      {isLoading ? <LoadingBlock /> : items.length === 0 ? <EmptyState title="No users found" icon={<UsersIcon className="h-7 w-7" />} /> : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-100 text-left">
                <th className="th">User</th><th className="th">Employee</th><th className="th">Role</th>
                <th className="th text-center">Sessions</th><th className="th">Last login</th><th className="th text-center">Status</th>
                {canManage && <th className="th text-right">Actions</th>}
              </tr></thead>
              <tbody>
                {items.map((u) => (
                  <tr key={u.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                    <td className="td">
                      <span className="flex items-center gap-3"><Avatar name={u.fullName} size="sm" />
                        <span><span className="block font-semibold text-ink-800">{u.username}</span><span className="block text-xs text-ink-400">{u.email}</span></span>
                      </span>
                    </td>
                    <td className="td text-ink-600">{u.fullName}<span className="block text-xs text-ink-400">{u.employeeNo}{u.departmentName ? ` · ${u.departmentName}` : ''}</span></td>
                    <td className="td"><Badge tone="bg-gold-50 text-gold-700">{ROLE_LABELS[u.roleCode] ?? u.roleName}</Badge></td>
                    <td className="td text-center text-ink-600">{u.activeSessions}</td>
                    <td className="td text-xs text-ink-500">{formatDateTime(u.lastLoginAt)}</td>
                    <td className="td text-center">
                      <Badge tone={u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{u.isActive ? 'Active' : 'Disabled'}</Badge>
                      {u.mustChangePassword && <span className="mt-1 block text-[10px] text-gold-600">Must change pwd</span>}
                    </td>
                    {canManage && <td className="td"><div className="flex justify-end gap-1">
                      <IconButton label="Change role" onClick={() => openRole(u)}><ShieldCheck className="h-4 w-4" /></IconButton>
                      <IconButton label="Reset password" onClick={() => setResetUser(u)}><KeyRound className="h-4 w-4" /></IconButton>
                      <IconButton label={u.isActive ? 'Deactivate' : 'Activate'} disabled={u.id === auth?.userId}
                        className={u.isActive ? 'hover:bg-red-50 hover:text-red-600' : 'hover:bg-emerald-50 hover:text-emerald-600'} onClick={() => setToggleUser(u)}><Power className="h-4 w-4" /></IconButton>
                    </div></td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} />
        </>
      )}

      <Modal open={!!roleUser} onClose={() => setRoleUser(null)} title="Change role" subtitle={roleUser?.username}
        footer={<>
          <Button variant="outline" onClick={() => setRoleUser(null)}>Cancel</Button>
          <Button variant="gold" loading={changeRole.isPending} onClick={() => changeRole.mutate()}>Save role</Button>
        </>}>
        <div className="space-y-4">
          <Field label="Role" required>
            <Select value={roleCode} onChange={(e) => setRoleCode(e.target.value)}>
              {ROLE_CODES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
            </Select>
          </Field>
          {roleCode === 'dept_admin' && (
            <Field label="Authorized departments" hint="This trainer will only see employees and courses in the selected departments.">
              <div className="max-h-52 space-y-1.5 overflow-y-auto rounded-xl border border-ink-100 p-3">
                {(depts?.items ?? []).map((d) => (
                  <label key={d.id} className="flex items-center gap-2.5 text-sm text-ink-700">
                    <input type="checkbox" checked={scopeIds.includes(d.id)}
                      onChange={(e) => setScopeIds(e.target.checked ? [...scopeIds, d.id] : scopeIds.filter((x) => x !== d.id))}
                      className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                    {d.name}
                  </label>
                ))}
              </div>
            </Field>
          )}
          <p className="text-xs text-ink-400">Changing a role revokes all of the user’s active sessions.</p>
        </div>
      </Modal>

      <ConfirmDialog open={!!resetUser} onClose={() => setResetUser(null)} onConfirm={() => resetPassword.mutate()}
        title="Reset password" message={`Generate a temporary password for "${resetUser?.username}"? They must change it on next login and all sessions will be revoked.`}
        confirmLabel="Reset password" loading={resetPassword.isPending} />

      <Modal open={!!tempPassword} onClose={() => { setTempPassword(null); setCopied(false); }} title="Temporary password" size="sm"
        footer={<Button variant="gold" onClick={() => { setTempPassword(null); setCopied(false); }}>Done</Button>}>
        <p className="mb-3 text-sm text-ink-600">Share this password securely. It will not be shown again.</p>
        <div className="flex items-center gap-2 rounded-xl bg-ink-950 px-4 py-3">
          <code className="flex-1 font-mono text-lg font-bold text-gold-300">{tempPassword}</code>
          <IconButton label="Copy" className="text-ink-300 hover:bg-white/10 hover:text-white"
            onClick={() => { void navigator.clipboard.writeText(tempPassword ?? ''); setCopied(true); }}>
            {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
          </IconButton>
        </div>
      </Modal>

      <ConfirmDialog open={!!toggleUser} onClose={() => setToggleUser(null)} onConfirm={() => toggleActive.mutate()}
        title={toggleUser?.isActive ? 'Deactivate account' : 'Activate account'}
        message={toggleUser?.isActive ? `Disable login for "${toggleUser?.username}"? Active sessions will be revoked.` : `Re-enable login for "${toggleUser?.username}"?`}
        confirmLabel={toggleUser?.isActive ? 'Deactivate' : 'Activate'} danger={toggleUser?.isActive} loading={toggleActive.isPending} />
    </Card>
  );
}

function RolesTab() {
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<RolesResponse>('/users/roles') });
  const [editing, setEditing] = useState<{ id: number; name: string; code: string } | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const save = useMutation({
    mutationFn: () => api.put(`/users/roles/${editing!.id}/permissions`, { permissionCodes: selected }),
    onSuccess: () => { toast.success('Permissions updated'); setEditing(null); void qc.invalidateQueries({ queryKey: ['roles'] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <Card><LoadingBlock /></Card>;
  const modules = [...new Set(data.permissions.map((p) => p.module))];

  function openEdit(role: { id: number; name: string; code: string; permissions: string[] }) {
    setEditing({ id: role.id, name: role.name, code: role.code });
    setSelected([...role.permissions]);
  }
  function toggle(code: string) { setSelected((s) => s.includes(code) ? s.filter((c) => c !== code) : [...s, code]); }

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.roles.map((role) => (
          <Card key={role.id} className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="font-bold text-ink-900">{role.name}</h3>
                <p className="font-mono text-xs text-ink-400">{role.code}</p>
              </div>
              <Badge tone="bg-gold-50 text-gold-700">{role.permissions.length} perms</Badge>
            </div>
            <p className="mt-2 min-h-[2.5rem] text-sm text-ink-500">{role.description ?? '—'}</p>
            <div className="mt-3">
              {role.code === 'super_admin' ? (
                <Badge tone="bg-ink-100 text-ink-500">Full access (locked)</Badge>
              ) : (
                <Button variant="outline" size="sm" icon={<Pencil className="h-3.5 w-3.5" />} onClick={() => openEdit(role)}>Edit permissions</Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!editing} onClose={() => setEditing(null)} title={`Permissions — ${editing?.name ?? ''}`} size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
          <Button variant="gold" loading={save.isPending} disabled={selected.length === 0} onClick={() => save.mutate()}>Save permissions</Button>
        </>}>
        <p className="mb-4 text-xs text-ink-400">Select the permissions granted to this role. Saving revokes sessions of all users with this role. At least one permission is required.</p>
        <div className="space-y-5">
          {modules.map((mod) => (
            <div key={mod}>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">{titleCase(mod)}</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {data.permissions.filter((p) => p.module === mod).map((p) => (
                  <label key={p.code} className="flex items-center gap-2.5 rounded-lg border border-ink-100 px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">
                    <input type="checkbox" checked={selected.includes(p.code)} onChange={() => toggle(p.code)} className="h-4 w-4 rounded border-ink-300 text-gold-500 focus:ring-gold-400" />
                    <span className="flex-1">{p.name}</span>
                    <code className="text-[10px] text-ink-300">{p.code}</code>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}
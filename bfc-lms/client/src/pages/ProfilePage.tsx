import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Monitor, Smartphone, LogOut, ShieldCheck, Mail, Building2, MapPin, Briefcase, IdCard } from 'lucide-react';
import { api } from '@/lib/api';
import type { Session } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatDateTime, relativeTime } from '@/lib/format';
import { ROLE_LABELS } from '@/lib/access';
import { PageHeader, Card, Button, Badge, Avatar, LoadingBlock, Field, Input, IconButton, EmptyState } from '@/components/ui';

export function ProfilePage() {
  const { auth } = useAuth();
  if (!auth) return null;
  const e = auth.employee;
  const name = e.fullName ?? `${e.firstName} ${e.lastName}`;

  const info = [
    { icon: IdCard, label: 'Employee no.', value: e.employeeNo },
    { icon: Mail, label: 'Email', value: e.email },
    { icon: Briefcase, label: 'Position', value: e.position ?? '—' },
    { icon: Building2, label: 'Department', value: e.departmentName ?? '—' },
    { icon: MapPin, label: 'Branch', value: e.branchName ?? '—' },
    { icon: ShieldCheck, label: 'Username', value: auth.username },
  ];

  return (
    <div>
      <PageHeader title="My Profile" subtitle="Your account details, password and active sessions." />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="p-6 lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <Avatar name={name} size="lg" />
            <h2 className="mt-4 text-lg font-bold text-ink-950">{name}</h2>
            <p className="text-sm text-ink-400">{e.employeeNo}</p>
            <Badge tone="bg-gold-50 text-gold-700 mt-3">{ROLE_LABELS[auth.roleCode] ?? auth.roleName}</Badge>
          </div>
          <div className="mt-6 space-y-3 border-t border-ink-100 pt-5">
            {info.map((row) => (
              <div key={row.label} className="flex items-center gap-3">
                <row.icon className="h-4 w-4 shrink-0 text-ink-300" />
                <div className="min-w-0"><p className="text-[11px] uppercase tracking-wide text-ink-400">{row.label}</p><p className="truncate text-sm font-medium text-ink-700">{row.value}</p></div>
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-xl bg-ink-50 px-3 py-2.5 text-xs text-ink-400">Profile details are managed by HR. Contact your administrator to update them.</p>
        </Card>

        <div className="space-y-5 lg:col-span-2">
          <ChangePassword />
          <Sessions />
        </div>
      </div>
    </div>
  );
}

function ChangePassword() {
  const toast = useToast();
  const { refresh } = useAuth();
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const [confirmPassword, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);

  const newError =
    newPassword.length === 0 ? '' :
    newPassword.length < 8 ? 'At least 8 characters.' :
    !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword) ? 'Must include a letter and a number.' : '';
  const confirmError = confirmPassword.length > 0 && confirmPassword !== newPassword ? 'Passwords do not match.' : '';
  const valid = currentPassword.length > 0 && newPassword.length >= 8 && !newError && confirmPassword === newPassword;

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword, confirmPassword }),
    onSuccess: () => {
      toast.success('Password changed. Other sessions were signed out.');
      setCurrent(''); setNew(''); setConfirm(''); setTouched(false);
      void refresh();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <Card className="p-5">
      <h3 className="mb-4 flex items-center gap-2 text-sm font-bold text-ink-900"><KeyRound className="h-4 w-4 text-gold-500" /> Change password</h3>
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={(ev) => { ev.preventDefault(); setTouched(true); if (valid) change.mutate(); }}>
        <div className="sm:col-span-2">
          <Field label="Current password" required>
            <Input type="password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
          </Field>
        </div>
        <Field label="New password" required error={touched ? newError : ''} hint="8+ characters with a letter and a number.">
          <Input type="password" value={newPassword} onChange={(e) => setNew(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Confirm new password" required error={touched ? confirmError : ''}>
          <Input type="password" value={confirmPassword} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <Button type="submit" variant="gold" loading={change.isPending} disabled={!valid}>Update password</Button>
        </div>
      </form>
    </Card>
  );
}

function Sessions() {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { logout } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['sessions'], queryFn: () => api.get<{ items: Session[] }>('/auth/sessions') });

  const revoke = useMutation({
    mutationFn: (id: string) => api.del(`/auth/sessions/${id}`),
    onSuccess: (_r, id) => {
      const wasCurrent = data?.items.find((s) => s.id === id)?.isCurrent;
      toast.success('Session signed out');
      if (wasCurrent) { void logout().then(() => navigate('/login')); return; }
      void qc.invalidateQueries({ queryKey: ['sessions'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];

  return (
    <Card className="p-5">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-ink-900"><Monitor className="h-4 w-4 text-gold-500" /> Active sessions</h3>
      <p className="mb-4 text-xs text-ink-400">Devices currently signed in to your account. Sign out any you don't recognize.</p>
      {isLoading ? <LoadingBlock /> : items.length === 0 ? (
        <EmptyState title="No active sessions" icon={<Monitor className="h-7 w-7" />} />
      ) : (
        <div className="divide-y divide-ink-50">
          {items.map((s) => {
            const mobile = /Mobi|Android|iPhone/i.test(s.userAgent ?? '');
            const Icon = mobile ? Smartphone : Monitor;
            return (
              <div key={s.id} className="flex items-center gap-3 py-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-ink-100 text-ink-500"><Icon className="h-5 w-5" /></span>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 text-sm font-medium text-ink-800">
                    <span className="truncate" title={s.userAgent ?? ''}>{s.userAgent ? s.userAgent.slice(0, 60) : 'Unknown device'}</span>
                    {s.isCurrent && <Badge tone="bg-emerald-50 text-emerald-700">This device</Badge>}
                  </p>
                  <p className="text-xs text-ink-400">{s.ipAddress ?? 'Unknown IP'} · active {relativeTime(s.lastSeenAt)} · expires {formatDateTime(s.expiresAt)}</p>
                </div>
                <IconButton label={s.isCurrent ? 'Sign out this device' : 'Sign out device'} className="hover:bg-red-50 hover:text-red-600"
                  disabled={revoke.isPending} onClick={() => revoke.mutate(s.id)}><LogOut className="h-4 w-4" /></IconButton>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
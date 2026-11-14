import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bell, CheckCheck, Trash2, BookOpen, CalendarClock, AlertTriangle, CheckCircle2, ClipboardList, Award, Megaphone, ExternalLink,
} from 'lucide-react';
import { api, queryString } from '@/lib/api';
import type { Notification, Paginated } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { relativeTime, titleCase } from '@/lib/format';
import { PageHeader, Card, Button, LoadingBlock, EmptyState, IconButton, Pagination, Select, Tabs } from '@/components/ui';

const TYPE_META: Record<string, { icon: typeof Bell; tone: string; label: string }> = {
  course_assigned: { icon: BookOpen, tone: 'bg-sky-50 text-sky-600', label: 'Course assigned' },
  deadline_reminder: { icon: CalendarClock, tone: 'bg-gold-50 text-gold-600', label: 'Deadline reminder' },
  course_overdue: { icon: AlertTriangle, tone: 'bg-red-50 text-red-600', label: 'Course overdue' },
  course_completed: { icon: CheckCircle2, tone: 'bg-emerald-50 text-emerald-600', label: 'Course completed' },
  assessment_result: { icon: ClipboardList, tone: 'bg-violet-50 text-violet-600', label: 'Assessment result' },
  course_published: { icon: Megaphone, tone: 'bg-gold-50 text-gold-600', label: 'Course published' },
  certificate_issued: { icon: Award, tone: 'bg-emerald-50 text-emerald-600', label: 'Certificate issued' },
};
const TYPES = Object.keys(TYPE_META);

export function NotificationsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const [page, setPage] = useState(1);
  const [tab, setTab] = useState('all');
  const [type, setType] = useState('');

  const query = queryString({ page, pageSize: 20, unreadOnly: tab === 'unread' ? 'true' : '', type });
  const { data, isLoading } = useQuery({ queryKey: ['notifications', 'page', query], queryFn: () => api.get<Paginated<Notification>>(`/notifications/${query}`) });
  const { data: count } = useQuery({ queryKey: ['notifications', 'unread-count'], queryFn: () => api.get<{ unread: number }>('/notifications/unread-count') });

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['notifications'] });

  const markRead = useMutation({ mutationFn: (id: number) => api.put(`/notifications/${id}/read`), onSuccess: invalidate, onError: (e: Error) => toast.error(e.message) });
  const markAll = useMutation({
    mutationFn: () => api.put<{ updated: number }>('/notifications/read-all'),
    onSuccess: (r) => { toast.success(r.updated ? `Marked ${r.updated} as read` : 'Nothing to mark'); invalidate(); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({ mutationFn: (id: number) => api.del(`/notifications/${id}`), onSuccess: invalidate, onError: (e: Error) => toast.error(e.message) });

  function open(n: Notification) {
    if (!n.isRead) markRead.mutate(n.id);
    if (n.link) navigate(n.link);
  }

  const items = data?.items ?? [];
  const unread = count?.unread ?? 0;

  return (
    <div>
      <PageHeader title="Notifications" subtitle="Updates about your training, assessments and certificates."
        actions={<Button variant="outline" icon={<CheckCheck className="h-4 w-4" />} loading={markAll.isPending} disabled={unread === 0} onClick={() => markAll.mutate()}>Mark all read</Button>} />

      <Card className="mb-5 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <Tabs tabs={[{ key: 'all', label: 'All' }, { key: 'unread', label: 'Unread', count: unread }]} active={tab} onChange={(k) => { setTab(k); setPage(1); }} />
        <Select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} className="sm:w-56">
          <option value="">All types</option>
          {TYPES.map((t) => <option key={t} value={t}>{TYPE_META[t].label}</option>)}
        </Select>
      </Card>

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title={tab === 'unread' ? 'No unread notifications' : 'No notifications yet'} message="You're all caught up." icon={<Bell className="h-7 w-7" />} />
        ) : (
          <>
            <div className="divide-y divide-ink-50">
              {items.map((n) => {
                const meta = TYPE_META[n.type] ?? { icon: Bell, tone: 'bg-ink-100 text-ink-500', label: titleCase(n.type) };
                const Icon = meta.icon;
                return (
                  <div key={n.id} className={`flex items-start gap-3.5 px-4 py-4 transition hover:bg-ink-50/50 sm:px-5 ${n.isRead ? '' : 'bg-gold-50/30'}`}>
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${meta.tone}`}><Icon className="h-5 w-5" /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold text-ink-900">{n.title}</p>
                        {!n.isRead && <span className="h-2 w-2 rounded-full bg-gold-500" />}
                        <span className="text-[11px] text-ink-300">{relativeTime(n.createdAt)}</span>
                      </div>
                      <p className="mt-0.5 text-sm text-ink-500">{n.message}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <span className="text-[11px] font-medium uppercase tracking-wide text-ink-300">{meta.label}</span>
                        {n.link && <button onClick={() => open(n)} className="inline-flex items-center gap-1 text-xs font-semibold text-gold-600 hover:text-gold-700">Open <ExternalLink className="h-3 w-3" /></button>}
                        {!n.isRead && <button onClick={() => markRead.mutate(n.id)} className="text-xs font-semibold text-ink-400 hover:text-ink-700">Mark read</button>}
                      </div>
                    </div>
                    <IconButton label="Delete notification" className="hover:bg-red-50 hover:text-red-600" onClick={() => remove.mutate(n.id)}><Trash2 className="h-4 w-4" /></IconButton>
                  </div>
                );
              })}
            </div>
            <Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} />
          </>
        )}
      </Card>
    </div>
  );
}
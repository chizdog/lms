import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { api } from '@/lib/api';
import type { Notification, Paginated } from '@/lib/types';
import { relativeTime } from '@/lib/format';
import { Spinner } from '@/components/ui';

const TYPE_DOT: Record<string, string> = {
  course_assigned: 'bg-sky-500',
  deadline_reminder: 'bg-gold-500',
  course_overdue: 'bg-red-500',
  course_completed: 'bg-emerald-500',
  assessment_result: 'bg-violet-500',
  course_published: 'bg-gold-500',
  certificate_issued: 'bg-emerald-500',
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: count } = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => api.get<{ unread: number }>('/notifications/unread-count'),
    refetchInterval: 30000,
  });

  const { data: list, isLoading } = useQuery({
    queryKey: ['notifications', 'recent'],
    queryFn: () => api.get<Paginated<Notification>>('/notifications?pageSize=8'),
    enabled: open,
  });

  const markRead = useMutation({
    mutationFn: (id: number) => api.put(`/notifications/${id}/read`),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markAll = useMutation({
    mutationFn: () => api.put('/notifications/read-all'),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['notifications'] }),
  });

  const unread = count?.unread ?? 0;

  const openItem = (n: Notification) => {
    if (!n.isRead) markRead.mutate(n.id);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-500 transition hover:bg-ink-100 hover:text-ink-800" aria-label="Notifications">
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-gold-500 px-1 text-[10px] font-bold text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-80 overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-xl sm:w-96">
            <div className="flex items-center justify-between border-b border-ink-100 px-4 py-3">
              <p className="text-sm font-bold text-ink-900">Notifications {unread > 0 && <span className="text-gold-600">({unread})</span>}</p>
              <button onClick={() => markAll.mutate()} className="flex items-center gap-1 text-xs font-semibold text-ink-500 hover:text-gold-600">
                <CheckCheck className="h-3.5 w-3.5" /> Mark all read
              </button>
            </div>
            <div className="max-h-96 overflow-y-auto">
              {isLoading ? (
                <div className="flex justify-center py-10"><Spinner /></div>
              ) : (list?.items.length ?? 0) === 0 ? (
                <p className="px-4 py-10 text-center text-sm text-ink-400">You're all caught up.</p>
              ) : (
                list!.items.map((n) => (
                  <button key={n.id} onClick={() => openItem(n)} className={`flex w-full items-start gap-3 border-b border-ink-50 px-4 py-3 text-left transition hover:bg-ink-50 ${n.isRead ? '' : 'bg-gold-50/40'}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[n.type] ?? 'bg-ink-300'}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-ink-800">{n.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-ink-500">{n.message}</span>
                      <span className="mt-1 block text-[11px] text-ink-300">{relativeTime(n.createdAt)}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
            <button onClick={() => { setOpen(false); navigate('/notifications'); }} className="block w-full border-t border-ink-100 py-2.5 text-center text-xs font-semibold text-gold-600 hover:bg-ink-50">
              View all notifications
            </button>
          </div>
        </>
      )}
    </div>
  );
}
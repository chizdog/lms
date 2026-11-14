import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { GraduationCap, PlayCircle, CheckCircle2, AlertTriangle, Library } from 'lucide-react';
import { api } from '@/lib/api';
import type { MyCourseItem } from '@/lib/types';
import { formatDate, formatPercent } from '@/lib/format';
import { STATUS_TONES } from '@/lib/access';
import { titleCase } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, ProgressBar, Tabs } from '@/components/ui';
import { CourseThumb } from '@/components/media';

export function LearnerMyCoursesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['my-courses'], queryFn: () => api.get<{ items: MyCourseItem[] }>('/learning/my-courses') });
  const [tab, setTab] = useState('all');
  const items = data?.items ?? [];
  const filtered = items.filter((c) => {
    if (tab === 'progress') return c.status === 'in_progress' || c.status === 'assigned';
    if (tab === 'completed') return c.status === 'completed';
    if (tab === 'overdue') return c.isOverdue;
    return true;
  });
  const tabs = [
    { key: 'all', label: 'All', count: items.length },
    { key: 'progress', label: 'In progress', count: items.filter((c) => c.status !== 'completed').length },
    { key: 'completed', label: 'Completed', count: items.filter((c) => c.status === 'completed').length },
    { key: 'overdue', label: 'Overdue', count: items.filter((c) => c.isOverdue).length },
  ];

  return (
    <div>
      <PageHeader title="My Courses" subtitle="Your assigned and enrolled training."
        actions={<Link to="/learner/catalog"><Button variant="outline" icon={<Library className="h-4 w-4" />}>Browse catalog</Button></Link>} />
      <div className="mb-5"><Tabs tabs={tabs} active={tab} onChange={setTab} /></div>

      {isLoading ? <Card><LoadingBlock /></Card> : filtered.length === 0 ? (
        <Card><EmptyState title={tab === 'all' ? 'No courses yet' : 'Nothing here'} message="Enroll in a course from the catalog to start learning." icon={<GraduationCap className="h-7 w-7" />}
          action={<Link to="/learner/catalog"><Button variant="gold" size="sm">Browse catalog</Button></Link>} /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <Card key={c.id} className="group flex flex-col overflow-hidden p-0 transition hover:shadow-md">
              <Link to={`/learner/courses/${c.course.id}`} className="relative block">
                <CourseThumb courseId={c.course.id} title={c.course.title} className="h-36 w-full" rounded="rounded-none" />
                <span className="absolute left-3 top-3"><Badge tone={STATUS_TONES[c.status]}>{titleCase(c.status)}</Badge></span>
                {c.isOverdue && <span className="absolute right-3 top-3"><Badge tone="bg-red-500 text-white">Overdue</Badge></span>}
              </Link>
              <div className="flex flex-1 flex-col p-4">
                <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.course.categoryColor }} />{c.course.categoryName}
                  {c.course.courseType === 'mandatory' && <Badge tone="bg-red-50 text-red-700">Mandatory</Badge>}
                </div>
                <Link to={`/learner/courses/${c.course.id}`} className="line-clamp-2 font-bold text-ink-900 group-hover:text-gold-700">{c.course.title}</Link>
                <div className="mt-3 flex items-center gap-2">
                  <ProgressBar value={c.progressPercent} className="flex-1" tone={c.status === 'completed' ? 'bg-emerald-500' : 'bg-gold-500'} />
                  <span className="text-xs font-bold text-ink-600">{formatPercent(c.progressPercent)}</span>
                </div>
                <p className="mt-2 text-[11px] text-ink-400">{c.completedLessons}/{c.requiredLessons} required lessons{c.dueDate ? ` · Due ${formatDate(c.dueDate)}` : ''}</p>
                <div className="mt-3 border-t border-ink-100 pt-3">
                  <Link to={`/learner/courses/${c.course.id}`}>
                    <Button variant={c.status === 'completed' ? 'outline' : 'gold'} size="sm" className="w-full" icon={c.status === 'completed' ? <CheckCircle2 className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}>
                      {c.status === 'completed' ? 'Review course' : c.status === 'assigned' ? 'Start course' : 'Continue'}
                    </Button>
                  </Link>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      {items.some((c) => c.isOverdue) && tab !== 'overdue' && (
        <p className="mt-5 flex items-center gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700"><AlertTriangle className="h-4 w-4" /> You have overdue training. Complete it as soon as possible.</p>
      )}
    </div>
  );
}
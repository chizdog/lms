import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Library, CheckCircle2, PlayCircle, Lock, Layers, Clock } from 'lucide-react';
import { api, queryString } from '@/lib/api';
import type { Course, Category, Paginated } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { DIFFICULTY_LABELS } from '@/lib/access';
import { formatNumber } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Select, SearchInput, Pagination } from '@/components/ui';
import { CourseThumb } from '@/components/media';

export function CatalogPage() {
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [difficulty, setDifficulty] = useState('');

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: Category[] }>('/courses/categories') });
  const query = queryString({ page, pageSize: 12, search, categoryId, difficulty, sortBy: 'title' });
  const { data, isLoading } = useQuery({ queryKey: ['catalog', query], queryFn: () => api.get<Paginated<Course>>(`/courses/${query}`) });

  const enroll = useMutation({
    mutationFn: (courseId: number) => api.post<{ id: number }>('/learning/enroll', { courseId }),
    onSuccess: (_d, courseId) => { toast.success('Enrolled successfully!'); void qc.invalidateQueries({ queryKey: ['catalog'] }); void qc.invalidateQueries({ queryKey: ['my-courses'] }); navigate(`/learner/courses/${courseId}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const items = data?.items ?? [];
  return (
    <div>
      <PageHeader title="Course Catalog" subtitle="Discover optional courses and enroll to start learning." />
      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search courses…" /></div>
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>{(cats?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}>
            <option value="">Any difficulty</option>{Object.entries(DIFFICULTY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
        </div>
      </Card>

      {isLoading ? <Card><LoadingBlock /></Card> : items.length === 0 ? (
        <Card><EmptyState title="No courses available" message="Check back later or adjust your filters." icon={<Library className="h-7 w-7" />} /></Card>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => {
              const enrolled = !!c.myEnrollmentId;
              const canEnroll = c.status === 'published' && c.courseType === 'optional' && !enrolled;
              return (
                <Card key={c.id} className="group flex flex-col overflow-hidden p-0 transition hover:shadow-md">
                  <Link to={`/courses/${c.id}`} className="relative block">
                    <CourseThumb courseId={c.id} title={c.title} className="h-40 w-full" rounded="rounded-none" />
                    {c.courseType === 'mandatory' && <span className="absolute right-3 top-3"><Badge tone="bg-red-500 text-white">Mandatory</Badge></span>}
                    {enrolled && <span className="absolute left-3 top-3"><Badge tone="bg-emerald-500 text-white">Enrolled</Badge></span>}
                  </Link>
                  <div className="flex flex-1 flex-col p-4">
                    <div className="mb-1 flex items-center gap-2 text-xs text-ink-400">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.categoryColor }} />{c.categoryName}
                      <span className="ml-auto font-mono text-[11px] text-ink-300">{c.code}</span>
                    </div>
                    <Link to={`/courses/${c.id}`} className="line-clamp-2 font-bold text-ink-900 group-hover:text-gold-700">{c.title}</Link>
                    <p className="mt-1 line-clamp-2 flex-1 text-xs text-ink-500">{c.description ?? 'No description.'}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                      <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{c.lessonCount} lessons</span>
                      <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{c.durationMinutes} min</span>
                      <Badge tone="bg-ink-100 text-ink-500">{DIFFICULTY_LABELS[c.difficulty]}</Badge>
                    </div>
                    <div className="mt-3 border-t border-ink-100 pt-3">
                      {enrolled ? (
                        <Link to={`/learner/courses/${c.id}`}><Button variant="gold" size="sm" className="w-full" icon={<PlayCircle className="h-4 w-4" />}>{c.myStatus === 'completed' ? 'Review' : 'Continue learning'}</Button></Link>
                      ) : canEnroll ? (
                        <Button variant="gold" size="sm" className="w-full" icon={<CheckCircle2 className="h-4 w-4" />} loading={enroll.isPending && enroll.variables === c.id} onClick={() => enroll.mutate(c.id)}>Enroll now</Button>
                      ) : (
                        <Button variant="outline" size="sm" className="w-full" disabled icon={<Lock className="h-4 w-4" />}>{c.courseType === 'mandatory' ? 'Assigned by admin' : 'Unavailable'}</Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
          <div className="mt-5"><Card><Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} /></Card></div>
        </>
      )}
      <p className="mt-4 text-center text-xs text-ink-400">{formatNumber(data?.total ?? 0)} courses in the catalogue</p>
    </div>
  );
}
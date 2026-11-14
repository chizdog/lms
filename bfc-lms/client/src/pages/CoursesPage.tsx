import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, BookOpen, Pencil, Layers, Users, Eye } from 'lucide-react';
import { api, queryString } from '@/lib/api';
import type { Course, Category, Department, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { DIFFICULTY_LABELS, STATUS_TONES, isLearner } from '@/lib/access';
import { formatNumber, titleCase } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Select, SearchInput, Pagination, IconButton } from '@/components/ui';
import { CourseThumb } from '@/components/media';

export function CoursesPage() {
  const { auth, has } = useAuth();
  const navigate = useNavigate();
  const learner = isLearner(auth);
  const canCreate = has('course.create');

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [status, setStatus] = useState('');
  const [courseType, setCourseType] = useState('');
  const [difficulty, setDifficulty] = useState('');

  const { data: cats } = useQuery({ queryKey: ['categories'], queryFn: () => api.get<{ items: Category[] }>('/courses/categories') });
  const { data: depts } = useQuery({ queryKey: ['departments'], queryFn: () => api.get<{ items: Department[] }>('/departments'), enabled: !learner });
  const [departmentId, setDepartmentId] = useState('');

  const query = queryString({ page, pageSize: 12, search, categoryId, departmentId, status: learner ? '' : status, courseType, difficulty, sortBy: 'createdAt' });
  const { data, isLoading } = useQuery({ queryKey: ['courses', query], queryFn: () => api.get<Paginated<Course>>(`/courses/${query}`) });
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="Courses" subtitle={learner ? 'Browse the BFC training catalogue.' : 'Build and manage the training catalogue.'}
        actions={canCreate && <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/courses/new')}>New course</Button>} />

      <Card className="mb-5 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="lg:col-span-2"><SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search title, code, description…" /></div>
          <Select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
            <option value="">All categories</option>{(cats?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
          <Select value={difficulty} onChange={(e) => { setDifficulty(e.target.value); setPage(1); }}>
            <option value="">Any difficulty</option>{Object.entries(DIFFICULTY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </Select>
          {!learner && (
            <>
              <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
                <option value="">Any status</option><option value="published">Published</option><option value="draft">Draft</option><option value="archived">Archived</option>
              </Select>
              <Select value={courseType} onChange={(e) => { setCourseType(e.target.value); setPage(1); }}>
                <option value="">Any type</option><option value="mandatory">Mandatory</option><option value="optional">Optional</option>
              </Select>
              <Select value={departmentId} onChange={(e) => { setDepartmentId(e.target.value); setPage(1); }}>
                <option value="">All departments</option>{(depts?.items ?? []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </Select>
            </>
          )}
          {learner && (
            <Select value={courseType} onChange={(e) => { setCourseType(e.target.value); setPage(1); }}>
              <option value="">Any type</option><option value="mandatory">Mandatory</option><option value="optional">Optional</option>
            </Select>
          )}
        </div>
      </Card>

      {isLoading ? <Card><LoadingBlock /></Card> : items.length === 0 ? (
        <Card><EmptyState title="No courses found" message={canCreate ? 'Create your first course to get started.' : 'Try adjusting your filters.'} icon={<BookOpen className="h-7 w-7" />}
          action={canCreate && <Button variant="gold" size="sm" onClick={() => navigate('/courses/new')}>New course</Button>} /></Card>
      ) : (
        <>
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((c) => (
              <Card key={c.id} className="group flex flex-col overflow-hidden p-0 transition hover:shadow-md">
                <Link to={`/courses/${c.id}`} className="relative block">
                  <CourseThumb courseId={c.id} title={c.title} className="h-40 w-full" rounded="rounded-none" />
                  <span className="absolute left-3 top-3"><Badge tone={STATUS_TONES[c.status]}>{titleCase(c.status)}</Badge></span>
                  {c.courseType === 'mandatory' && <span className="absolute right-3 top-3"><Badge tone="bg-red-500 text-white">Mandatory</Badge></span>}
                </Link>
                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-1 flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.categoryColor }} />
                    <span className="text-xs font-medium text-ink-400">{c.categoryName}</span>
                    <span className="ml-auto font-mono text-[11px] text-ink-300">{c.code}</span>
                  </div>
                  <Link to={`/courses/${c.id}`} className="line-clamp-2 font-bold text-ink-900 group-hover:text-gold-700">{c.title}</Link>
                  <p className="mt-1 line-clamp-2 flex-1 text-xs text-ink-500">{c.description ?? 'No description.'}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-ink-400">
                    <span className="flex items-center gap-1"><Layers className="h-3.5 w-3.5" />{c.lessonCount} lessons</span>
                    <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{formatNumber(c.enrollmentCount)} enrolled</span>
                    <Badge tone="bg-ink-100 text-ink-500">{DIFFICULTY_LABELS[c.difficulty]}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-1 border-t border-ink-100 pt-3">
                    <Link to={`/courses/${c.id}`} className="flex-1"><Button variant="outline" size="sm" className="w-full" icon={<Eye className="h-3.5 w-3.5" />}>View</Button></Link>
                    {has('course.update') && <IconButton label="Edit course" onClick={() => navigate(`/courses/${c.id}/edit`)}><Pencil className="h-4 w-4" /></IconButton>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          <div className="mt-5"><Card><Pagination page={data!.page} totalPages={data!.totalPages} total={data!.total} onChange={setPage} /></Card></div>
        </>
      )}
    </div>
  );
}
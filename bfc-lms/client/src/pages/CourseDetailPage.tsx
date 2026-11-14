import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, Pencil, Trash2, CalendarPlus, Globe, Archive, Layers, Users, ClipboardList, Clock, Award,
  CheckCircle2, PlayCircle, Lock, BookOpen,
} from 'lucide-react';
import { api } from '@/lib/api';
import type { CourseDetail, Paginated, Enrollment } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatNumber, formatPercent, titleCase } from '@/lib/format';
import { DIFFICULTY_LABELS, STATUS_TONES, isLearner } from '@/lib/access';
import { Card, Button, Badge, LoadingBlock, ProgressBar, ConfirmDialog, EmptyState } from '@/components/ui';
import { CourseThumb } from '@/components/media';
import { contentIcon } from './CourseBuilderPage';

export function CourseDetailPage() {
  const { id } = useParams();
  const courseId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { auth, has } = useAuth();
  const learner = isLearner(auth);

  const { data: course, isLoading } = useQuery({ queryKey: ['course', courseId], queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`) });
  const { data: enrollments } = useQuery({
    queryKey: ['course-enrollments', courseId],
    queryFn: () => api.get<Paginated<Enrollment>>(`/enrollments/?courseId=${courseId}&pageSize=1`),
    enabled: !learner && has('enrollment.view'),
  });
  const [delOpen, setDelOpen] = useState(false);

  const enroll = useMutation({
    mutationFn: () => api.post<{ id: number }>('/learning/enroll', { courseId }),
    onSuccess: () => { toast.success('Enrolled! Opening your course…'); void qc.invalidateQueries({ queryKey: ['course', courseId] }); void qc.invalidateQueries({ queryKey: ['my-courses'] }); navigate(`/learner/courses/${courseId}`); },
    onError: (e: Error) => toast.error(e.message),
  });
  const publish = useMutation({
    mutationFn: (status: string) => api.post(`/courses/${courseId}/publish`, { status }),
    onSuccess: (_d, s) => { toast.success(s === 'published' ? 'Course published' : 'Course archived'); void qc.invalidateQueries({ queryKey: ['course', courseId] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => api.del(`/courses/${courseId}`),
    onSuccess: () => { toast.success('Course deleted'); navigate('/courses'); },
    onError: (e: Error) => { toast.error(e.message); setDelOpen(false); },
  });

  if (isLoading || !course) return <LoadingBlock label="Loading course…" />;
  const enrolled = !!course.myEnrollment;
  const totalLessons = course.modules.reduce((n, m) => n + m.lessons.length, 0);

  return (
    <div>
      <div className="mb-4"><Link to={learner ? '/learner/catalog' : '/courses'} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Back</Link></div>

      <Card className="mb-6 overflow-hidden p-0">
        <div className="grid gap-0 md:grid-cols-3">
          <CourseThumb courseId={course.id} title={course.title} className="h-52 w-full md:h-full" rounded="rounded-none" />
          <div className="p-6 md:col-span-2">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge tone={STATUS_TONES[course.status]}>{titleCase(course.status)}</Badge>
              <Badge tone={course.courseType === 'mandatory' ? 'bg-red-50 text-red-700' : 'bg-sky-50 text-sky-700'}>{titleCase(course.courseType)}</Badge>
              <span className="flex items-center gap-1.5 text-xs text-ink-400"><span className="h-2.5 w-2.5 rounded-full" style={{ background: course.categoryColor }} />{course.categoryName}</span>
              <span className="ml-auto font-mono text-xs text-ink-300">{course.code}</span>
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-ink-950">{course.title}</h1>
            <p className="mt-2 text-sm text-ink-600">{course.description ?? 'No description provided.'}</p>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-500">
              {course.instructorName && <span className="flex items-center gap-1.5"><Award className="h-4 w-4 text-gold-500" />{course.instructorName}</span>}
              <span className="flex items-center gap-1.5"><Clock className="h-4 w-4 text-gold-500" />{course.durationMinutes} min</span>
              <span className="flex items-center gap-1.5"><Layers className="h-4 w-4 text-gold-500" />{course.moduleCount} modules · {totalLessons} lessons</span>
              <Badge tone="bg-ink-100 text-ink-500">{DIFFICULTY_LABELS[course.difficulty]}</Badge>
              {course.departmentName && <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-gold-500" />{course.departmentName}</span>}
            </div>
            {course.targetAudience && <p className="mt-3 text-xs text-ink-400">Target audience: {course.targetAudience}</p>}

            <div className="mt-5 flex flex-wrap items-center gap-2">
              {learner ? (
                enrolled ? (
                  <Link to={`/learner/courses/${course.id}`}><Button variant="gold" icon={<PlayCircle className="h-4 w-4" />}>{course.myEnrollment!.status === 'completed' ? 'Review course' : 'Continue learning'}</Button></Link>
                ) : course.status === 'published' && course.courseType === 'optional' ? (
                  <Button variant="gold" icon={<CheckCircle2 className="h-4 w-4" />} loading={enroll.isPending} onClick={() => enroll.mutate()}>Enroll now</Button>
                ) : (
                  <span className="flex items-center gap-2 text-sm text-ink-500"><Lock className="h-4 w-4" />{course.courseType === 'mandatory' ? 'This mandatory course is assigned by your administrator.' : 'This course is not open for enrollment.'}</span>
                )
              ) : (
                <>
                  {has('course.update') && <Link to={`/courses/${course.id}/edit`}><Button variant="gold" icon={<Pencil className="h-4 w-4" />}>Edit course</Button></Link>}
                  {has('enrollment.assign') && course.status === 'published' && <Button variant="outline" icon={<CalendarPlus className="h-4 w-4" />} onClick={() => navigate(`/assignments?courseId=${course.id}`)}>Assign training</Button>}
                  {has('course.publish') && course.status !== 'published' && <Button variant="outline" icon={<Globe className="h-4 w-4" />} loading={publish.isPending} onClick={() => publish.mutate('published')}>Publish</Button>}
                  {has('course.publish') && course.status === 'published' && <Button variant="outline" icon={<Archive className="h-4 w-4" />} loading={publish.isPending} onClick={() => publish.mutate('archived')}>Archive</Button>}
                  {has('course.delete') && <Button variant="danger" icon={<Trash2 className="h-4 w-4" />} onClick={() => setDelOpen(true)}>Delete</Button>}
                </>
              )}
            </div>
          </div>
        </div>
      </Card>

      {learner && enrolled && (
        <Card className="mb-6 p-5">
          <div className="flex items-center justify-between gap-4">
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink-800">Your progress</p>
              <div className="mt-2 flex items-center gap-3"><ProgressBar value={course.myEnrollment!.progressPercent} className="flex-1" /><span className="text-sm font-bold text-gold-700">{formatPercent(course.myEnrollment!.progressPercent)}</span></div>
            </div>
            <Badge tone={STATUS_TONES[course.myEnrollment!.status]}>{titleCase(course.myEnrollment!.status)}</Badge>
          </div>
        </Card>
      )}

      {!learner && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <MiniStat icon={<Layers className="h-4 w-4" />} label="Modules" value={course.moduleCount} />
          <MiniStat icon={<BookOpen className="h-4 w-4" />} label="Lessons" value={totalLessons} />
          <MiniStat icon={<ClipboardList className="h-4 w-4" />} label="Assessments" value={course.quizzes.length} />
          <MiniStat icon={<Users className="h-4 w-4" />} label="Enrollments" value={enrollments?.total ?? 0} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 font-bold text-ink-900">Curriculum</h3>
          {course.modules.length === 0 ? <EmptyState title="No modules yet" message={learner ? 'Content is being prepared.' : 'Edit the course to add modules and lessons.'} icon={<Layers className="h-7 w-7" />} /> : (
            <div className="space-y-4">
              {course.modules.map((m, mi) => (
                <div key={m.id} className="rounded-xl border border-ink-100">
                  <div className="flex items-center gap-2 border-b border-ink-100 bg-ink-50/50 px-4 py-3">
                    <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700">{mi + 1}</span>
                    <p className="font-semibold text-ink-800">{m.title}</p>
                    <span className="ml-auto text-xs text-ink-400">{m.lessons.length} lessons</span>
                  </div>
                  <div className="divide-y divide-ink-50">
                    {m.lessons.map((l) => { const Icon = contentIcon(l.contentType); return (
                      <div key={l.id} className="flex items-center gap-3 px-4 py-2.5">
                        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-ink-100 text-ink-500"><Icon className="h-4 w-4" /></span>
                        <span className="min-w-0 flex-1 truncate text-sm text-ink-700">{l.title}</span>
                        {l.isRequired && <Badge tone="bg-gold-50 text-gold-700">Required</Badge>}
                        <span className="text-xs text-ink-400">{l.durationMinutes} min</span>
                      </div>
                    ); })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-bold text-ink-900"><ClipboardList className="h-4 w-4 text-gold-500" /> Assessments</h3>
          {course.quizzes.length === 0 ? <EmptyState title="No assessments" /> : (
            <div className="space-y-3">
              {course.quizzes.map((q) => (
                <div key={q.id} className="rounded-xl border border-ink-100 p-3">
                  <p className="text-sm font-semibold text-ink-800">{q.title}</p>
                  <p className="mt-1 text-xs text-ink-400">Pass {formatPercent(q.passing_score)} · {q.max_attempts} attempts{q.time_limit_minutes ? ` · ${q.time_limit_minutes} min` : ''}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Badge tone={q.is_active ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{q.is_active ? 'Active' : 'Inactive'}</Badge>
                    {!learner && has('quiz.manage') && <Link to={`/quizzes/${q.id}/edit`} className="ml-auto text-xs font-semibold text-gold-600 hover:text-gold-700">Edit</Link>}
                    {!learner && has('quiz.view') && <Link to={`/quizzes/${q.id}/attempts`} className="text-xs font-semibold text-ink-500 hover:text-ink-700">Attempts</Link>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {course.certificateEnabled && <p className="mt-4 flex items-center gap-2 rounded-xl bg-gold-50 px-3 py-2.5 text-xs text-gold-700"><Award className="h-4 w-4" /> Certificate awarded on completion{course.signatoryName ? ` · ${course.signatoryName}` : ''}</p>}
        </Card>
      </div>

      <ConfirmDialog open={delOpen} onClose={() => setDelOpen(false)} onConfirm={() => remove.mutate()}
        title="Delete course" message={`Delete "${course.title}"? Courses with enrollments cannot be deleted — archive instead.`} confirmLabel="Delete" danger loading={remove.isPending} />
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-50 text-gold-600">{icon}</span>
      <div><p className="text-xl font-bold text-ink-950">{formatNumber(value)}</p><p className="text-[11px] text-ink-400">{label}</p></div>
    </Card>
  );
}
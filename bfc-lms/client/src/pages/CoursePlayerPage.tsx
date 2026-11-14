import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft, CheckCircle2, Circle, PlayCircle, Download, FileText, Link2, ClipboardList, Award,
  ChevronLeft, ChevronRight, Lock, ExternalLink,
} from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import type { CourseDetail, EnrollmentDetail, LessonPlayer, Material } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { fileSize, formatPercent, titleCase } from '@/lib/format';
import { STATUS_TONES } from '@/lib/access';
import { PageHeader, Card, Button, Badge, LoadingBlock, ProgressBar, EmptyState } from '@/components/ui';
import { contentIcon } from './CourseBuilderPage';

export function CoursePlayerPage() {
  const { courseId: cid } = useParams();
  const courseId = Number(cid);
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: course, isLoading: courseLoading } = useQuery({ queryKey: ['course', courseId], queryFn: () => api.get<CourseDetail>(`/courses/${courseId}`) });
  const enrollmentId = course?.myEnrollment?.id ?? null;
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['enrollment', enrollmentId],
    queryFn: () => api.get<EnrollmentDetail>(`/learning/enrollments/${enrollmentId}`),
    enabled: !!enrollmentId,
  });

  const allLessons = useMemo(() => (detail?.modules ?? []).flatMap((m) => m.lessons.map((l) => ({ ...l, moduleTitle: m.title }))), [detail]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  useEffect(() => {
    if (allLessons.length && selectedId === null) {
      const next = allLessons.find((l) => !l.isCompleted) ?? allLessons[0];
      setSelectedId(next.id);
    }
  }, [allLessons, selectedId]);

  const { data: lesson, isLoading: lessonLoading } = useQuery({
    queryKey: ['lesson', selectedId],
    queryFn: () => api.get<LessonPlayer>(`/learning/lessons/${selectedId}`),
    enabled: !!selectedId,
  });

  const complete = useMutation({
    mutationFn: () => api.post<{ progressPercent: number; courseCompleted: boolean; certificateNumber: string | null }>(`/learning/lessons/${selectedId}/complete`),
    onSuccess: (res) => {
      if (res.courseCompleted) toast.success(res.certificateNumber ? `Course completed! Certificate ${res.certificateNumber} issued.` : 'Course completed!');
      else toast.success('Lesson marked complete');
      void qc.invalidateQueries({ queryKey: ['enrollment', enrollmentId] });
      void qc.invalidateQueries({ queryKey: ['lesson', selectedId] });
      void qc.invalidateQueries({ queryKey: ['my-courses'] });
      void qc.invalidateQueries({ queryKey: ['course', courseId] });
      void qc.invalidateQueries({ queryKey: ['dashboard'] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (courseLoading) return <LoadingBlock label="Loading course…" />;
  if (!course) return <EmptyState title="Course not found" />;
  if (!enrollmentId) {
    return (
      <div>
        <PageHeader title={course.title} />
        <Card><EmptyState title="You're not enrolled in this course" message="Enroll from the catalog to start learning." icon={<Lock className="h-7 w-7" />}
          action={<Link to="/learner/catalog"><Button variant="gold" size="sm">Browse catalog</Button></Link>} /></Card>
      </div>
    );
  }
  if (detailLoading || !detail) return <LoadingBlock label="Loading your course…" />;

  const idx = allLessons.findIndex((l) => l.id === selectedId);
  const progress = detail.enrollment.progressPercent;

  return (
    <div>
      <div className="mb-4"><Link to="/learner" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> My courses</Link></div>
      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-ink-950">{detail.course.title}</h1>
          <p className="text-xs text-ink-400">{detail.course.code} · {detail.course.category_name}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-40"><ProgressBar value={progress} tone={detail.enrollment.status === 'completed' ? 'bg-emerald-500' : 'bg-gold-500'} /></div>
          <span className="text-sm font-bold text-gold-700">{formatPercent(progress)}</span>
          <Badge tone={STATUS_TONES[detail.enrollment.status]}>{titleCase(detail.enrollment.status)}</Badge>
        </div>
      </div>

      {detail.enrollment.status === 'completed' && (
        <Card className="mb-5 flex items-center gap-3 border-emerald-200 bg-emerald-50 p-4">
          <Award className="h-6 w-6 shrink-0 text-emerald-600" />
          <div className="flex-1"><p className="font-semibold text-emerald-800">Course completed — congratulations!</p><p className="text-xs text-emerald-600">Your certificate is available in My Certificates.</p></div>
          <Link to="/learner/certificates"><Button variant="gold" size="sm">View certificate</Button></Link>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-1">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-ink-100 px-4 py-3"><h3 className="text-sm font-bold text-ink-900">Course content</h3></div>
            <div className="max-h-[60vh] overflow-y-auto">
              {detail.modules.map((m, mi) => (
                <div key={m.id}>
                  <p className="bg-ink-50/70 px-4 py-2 text-xs font-bold uppercase tracking-wide text-ink-500">{mi + 1}. {m.title}</p>
                  {m.lessons.map((l) => { const Icon = contentIcon(l.contentType); const active = l.id === selectedId; return (
                    <button key={l.id} onClick={() => setSelectedId(l.id)}
                      className={`flex w-full items-center gap-2.5 px-4 py-2.5 text-left text-sm transition ${active ? 'bg-gold-50 text-gold-800' : 'text-ink-600 hover:bg-ink-50'}`}>
                      {l.isCompleted ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : <Circle className="h-4 w-4 shrink-0 text-ink-300" />}
                      <Icon className="h-4 w-4 shrink-0 text-ink-400" />
                      <span className="min-w-0 flex-1 truncate">{l.title}</span>
                      {l.isRequired && <span className="text-[10px] text-ink-300">*</span>}
                    </button>
                  ); })}
                </div>
              ))}
            </div>
          </Card>

          {detail.quizzes.length > 0 && (
            <Card className="p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-bold text-ink-900"><ClipboardList className="h-4 w-4 text-gold-500" /> Assessments</h3>
              <div className="space-y-3">
                {detail.quizzes.map((q) => (
                  <div key={q.id} className="rounded-xl border border-ink-100 p-3">
                    <p className="text-sm font-semibold text-ink-800">{q.title}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">Pass {formatPercent(q.passingScore)} · {q.attemptsUsed}/{q.maxAttempts} attempts{q.bestPercentage !== null ? ` · Best ${formatPercent(q.bestPercentage)}` : ''}</p>
                    <div className="mt-2 flex items-center gap-2">
                      {q.bestPassed ? <Badge tone="bg-emerald-50 text-emerald-700">Passed</Badge> : q.attemptsUsed >= q.maxAttempts ? <Badge tone="bg-red-50 text-red-700">No attempts left</Badge> : null}
                      <Button variant={q.bestPassed ? 'outline' : 'gold'} size="sm" className="ml-auto" disabled={q.attemptsUsed >= q.maxAttempts && !q.bestPassed}
                        icon={<PlayCircle className="h-3.5 w-3.5" />} onClick={() => navigate(`/learner/quizzes/${q.id}/take`)}>
                        {q.bestPassed ? 'Retake' : q.attemptsUsed > 0 ? 'Try again' : 'Start'}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="lg:col-span-2">
          {lessonLoading || !lesson ? <Card><LoadingBlock label="Loading lesson…" /></Card> : (
            <Card className="p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs text-ink-400">{allLessons[idx]?.moduleTitle}</p>
                  <h2 className="text-lg font-bold text-ink-950">{lesson.title}</h2>
                  <p className="mt-0.5 text-xs text-ink-400">{titleCase(lesson.contentType)} · {lesson.durationMinutes} min{lesson.isRequired ? ' · Required' : ''}</p>
                </div>
                {lesson.isCompleted && <Badge tone="bg-emerald-50 text-emerald-700"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Completed</Badge>}
              </div>

              <LessonContent lesson={lesson} />

              {lesson.materials.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-400">Materials</p>
                  <div className="space-y-2">
                    {lesson.materials.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 rounded-xl border border-ink-100 px-3 py-2.5">
                        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-100 text-ink-500"><FileText className="h-4 w-4" /></span>
                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-ink-800">{m.originalName}</p><p className="text-[11px] text-ink-400">{titleCase(m.materialType)} · {fileSize(m.fileSize)}</p></div>
                        <Button variant="outline" size="sm" icon={<Download className="h-3.5 w-3.5" />} onClick={() => void downloadFile(`/materials/${m.id}/download`, m.originalName)}>Download</Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-6 flex items-center justify-between gap-3 border-t border-ink-100 pt-4">
                <Button variant="ghost" size="sm" icon={<ChevronLeft className="h-4 w-4" />} disabled={idx <= 0} onClick={() => setSelectedId(allLessons[idx - 1].id)}>Previous</Button>
                {lesson.isCompleted ? (
                  <span className="flex items-center gap-1.5 text-sm font-semibold text-emerald-600"><CheckCircle2 className="h-4 w-4" /> Completed</span>
                ) : (
                  <Button variant="gold" icon={<CheckCircle2 className="h-4 w-4" />} loading={complete.isPending} onClick={() => complete.mutate()}>Mark as complete</Button>
                )}
                <Button variant="ghost" size="sm" disabled={idx >= allLessons.length - 1} onClick={() => setSelectedId(allLessons[idx + 1].id)}>Next <ChevronRight className="h-4 w-4" /></Button>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function LessonContent({ lesson }: { lesson: LessonPlayer }) {
  const video = lesson.materials.find((m) => m.materialType === 'video');
  const pdf = lesson.materials.find((m) => m.materialType === 'pdf');
  const image = lesson.materials.find((m) => m.materialType === 'image');

  if (lesson.contentType === 'text') {
    return lesson.content
      ? <div className="whitespace-pre-wrap rounded-xl bg-ink-50/50 p-4 text-sm leading-relaxed text-ink-700">{lesson.content}</div>
      : <EmptyState title="No content" message="This lesson has no text content yet." />;
  }
  if (lesson.contentType === 'link') {
    return lesson.externalUrl ? (
      <div className="rounded-xl border border-ink-100 p-5 text-center">
        <Link2 className="mx-auto h-8 w-8 text-gold-500" />
        <p className="mt-2 text-sm text-ink-600">This lesson links to an external resource.</p>
        <a href={lesson.externalUrl} target="_blank" rel="noopener noreferrer"><Button variant="gold" className="mt-3" icon={<ExternalLink className="h-4 w-4" />}>Open resource</Button></a>
        <p className="mt-2 truncate text-xs text-ink-400">{lesson.externalUrl}</p>
      </div>
    ) : <EmptyState title="No link configured" />;
  }
  if (lesson.contentType === 'video') {
    return video ? <MediaPreview material={video} /> : <EmptyState title="Video coming soon" message="No video has been uploaded for this lesson yet." icon={<PlayCircle className="h-7 w-7" />} />;
  }
  if (lesson.contentType === 'pdf') {
    return pdf ? <MediaPreview material={pdf} /> : <EmptyState title="PDF coming soon" message="No PDF has been uploaded for this lesson yet." />;
  }
  if (lesson.contentType === 'image') {
    return image ? <MediaPreview material={image} /> : <EmptyState title="Image coming soon" />;
  }
  // presentation / document
  return (
    <div className="rounded-xl border border-ink-100 p-5 text-center">
      <FileText className="mx-auto h-8 w-8 text-gold-500" />
      <p className="mt-2 text-sm text-ink-600">Download the {lesson.contentType} material below to view this lesson.</p>
      {lesson.content && <div className="mt-3 whitespace-pre-wrap text-left text-sm text-ink-600">{lesson.content}</div>}
    </div>
  );
}

function MediaPreview({ material }: { material: Material }) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let objUrl: string | null = null;
    api.blob(`/materials/${material.id}/download`)
      .then((b) => { if (active) { objUrl = URL.createObjectURL(b); setUrl(objUrl); } })
      .catch(() => { if (active) setError(true); });
    return () => { active = false; if (objUrl) URL.revokeObjectURL(objUrl); };
  }, [material.id]);

  if (error) return <EmptyState title="Unable to load media" message="You may not have access to this file." />;
  if (!url) return <LoadingBlock label="Loading media…" />;
  if (material.materialType === 'video') return <video src={url} controls className="w-full rounded-xl bg-black" />;
  if (material.materialType === 'pdf') return <iframe src={url} title={material.originalName} className="h-[70vh] w-full rounded-xl border border-ink-100" />;
  if (material.materialType === 'image') return <img src={url} alt={material.originalName} className="w-full rounded-xl" />;
  return null;
}
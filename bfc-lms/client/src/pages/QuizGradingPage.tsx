import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, CheckCircle2, XCircle, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import type { AttemptResult, GradeResult } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { formatPercent, titleCase } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Input } from '@/components/ui';

interface Grade { pointsAwarded: number; isCorrect: boolean }

export function QuizGradingPage() {
  const { attemptId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['attempt', attemptId], queryFn: () => api.get<AttemptResult>(`/quizzes/attempts/${attemptId}`) });
  const [grades, setGrades] = useState<Record<number, Grade>>({});

  const gradable = (data?.answers ?? []).filter((a) => a.needsManualReview || a.questionType === 'short_answer');
  useEffect(() => {
    if (data) {
      const init: Record<number, Grade> = {};
      data.answers.filter((a) => a.needsManualReview || a.questionType === 'short_answer')
        .forEach((a) => { init[a.questionId] = { pointsAwarded: a.pointsAwarded, isCorrect: Boolean(a.isCorrect) }; });
      setGrades(init);
    }
  }, [data]);

  const submit = useMutation({
    mutationFn: () => api.post<GradeResult>(`/quizzes/attempts/${attemptId}/grade`, {
      grades: Object.entries(grades).map(([qid, g]) => ({ questionId: Number(qid), pointsAwarded: g.pointsAwarded, isCorrect: g.isCorrect })),
    }),
    onSuccess: (res) => {
      toast.success(res.courseCompleted ? 'Graded — course completed!' : 'Grades saved');
      void qc.invalidateQueries({ queryKey: ['attempt', attemptId] });
      void qc.invalidateQueries({ queryKey: ['quiz-attempts'] });
      navigate(`/quizzes/attempts/${attemptId}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading || !data) return <LoadingBlock label="Loading attempt…" />;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4"><Link to={`/quizzes/${data.quizId}/attempts`} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Attempts</Link></div>
      <PageHeader title="Grade attempt" subtitle={`${data.quizTitle} · ${data.employee?.name ?? 'Learner'} · Attempt #${data.attemptNumber}`}
        actions={<Button variant="gold" icon={<Save className="h-4 w-4" />} loading={submit.isPending} disabled={gradable.length === 0} onClick={() => submit.mutate()}>Save grades</Button>} />

      <Card className="mb-5 flex items-center gap-4 p-4">
        <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-50 text-gold-600"><ClipboardList className="h-5 w-5" /></span>
        <div className="flex-1 text-sm">
          <p className="font-semibold text-ink-800">Current score: {formatPercent(data.percentage)} ({data.score}/{data.maxScore})</p>
          <p className="text-xs text-ink-400">Passing {formatPercent(data.passingScore)} · {gradable.length} answer{gradable.length === 1 ? '' : 's'} need manual review</p>
        </div>
        <Badge tone={data.passed === true ? 'bg-emerald-50 text-emerald-700' : data.passed === false ? 'bg-red-50 text-red-700' : 'bg-gold-50 text-gold-700'}>{data.passed === true ? 'Passed' : data.passed === false ? 'Failed' : 'Pending'}</Badge>
      </Card>

      {gradable.length === 0 ? (
        <Card><EmptyState title="Nothing to grade" message="This attempt has no answers requiring manual review." icon={<CheckCircle2 className="h-7 w-7" />}
          action={<Link to={`/quizzes/attempts/${attemptId}`}><Button variant="outline" size="sm">View result</Button></Link>} /></Card>
      ) : (
        <div className="space-y-4">
          {data.answers.map((a, i) => {
            const isGradable = gradable.some((g) => g.questionId === a.questionId);
            const g = grades[a.questionId];
            return (
              <Card key={a.questionId} className={`p-5 ${isGradable ? 'ring-1 ring-gold-200' : ''}`}>
                <div className="mb-2 flex items-start gap-3">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">{i + 1}</span>
                  <div className="flex-1">
                    <p className="font-semibold text-ink-900">{a.questionText}</p>
                    <p className="mt-0.5 text-[11px] text-ink-400">{titleCase(a.questionType)} · max {a.points} points</p>
                  </div>
                  {!isGradable && <Badge tone={a.isCorrect ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>{a.pointsAwarded}/{a.points} auto</Badge>}
                </div>

                {a.textAnswer !== null && <div className="mb-3 rounded-lg bg-ink-50 px-3 py-2.5 text-sm text-ink-700"><span className="text-xs font-semibold text-ink-400">Learner answer: </span>{a.textAnswer || <em className="text-ink-400">blank</em>}</div>}
                {a.options.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {a.options.map((o) => (
                      <div key={o.id} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm ${a.selectedOptionIds?.includes(o.id) ? 'bg-gold-50 text-gold-800' : 'text-ink-500'}`}>
                        {a.selectedOptionIds?.includes(o.id) ? <CheckCircle2 className="h-4 w-4 text-gold-500" /> : <span className="h-4 w-4" />}{o.optionText}
                      </div>
                    ))}
                  </div>
                )}

                {isGradable && g && (
                  <div className="flex flex-wrap items-end gap-4 border-t border-ink-100 pt-3">
                    <div>
                      <label className="label">Points awarded</label>
                      <Input type="number" min={0} max={a.points} step={0.5} value={g.pointsAwarded} className="w-28"
                        onChange={(e) => setGrades({ ...grades, [a.questionId]: { ...g, pointsAwarded: Math.min(a.points, Math.max(0, Number(e.target.value))) } })} />
                    </div>
                    <div>
                      <label className="label">Mark as</label>
                      <div className="flex gap-2">
                        <button onClick={() => setGrades({ ...grades, [a.questionId]: { ...g, isCorrect: true } })}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${g.isCorrect ? 'border-emerald-400 bg-emerald-50 text-emerald-700' : 'border-ink-100 text-ink-500 hover:border-emerald-200'}`}>
                          <CheckCircle2 className="h-4 w-4" /> Correct
                        </button>
                        <button onClick={() => setGrades({ ...grades, [a.questionId]: { ...g, isCorrect: false } })}
                          className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-semibold transition ${!g.isCorrect ? 'border-red-400 bg-red-50 text-red-700' : 'border-ink-100 text-ink-500 hover:border-red-200'}`}>
                          <XCircle className="h-4 w-4" /> Incorrect
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, XCircle, Clock, Award, MinusCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { AttemptResult } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime, formatPercent, titleCase } from '@/lib/format';
import { isLearner, STATUS_TONES } from '@/lib/access';
import { Card, Button, Badge, LoadingBlock, EmptyState, ProgressBar } from '@/components/ui';

export function AttemptResultPage() {
  const { attemptId } = useParams();
  const { auth } = useAuth();
  const learner = isLearner(auth);
  const { data, isLoading } = useQuery({ queryKey: ['attempt', attemptId], queryFn: () => api.get<AttemptResult>(`/quizzes/attempts/${attemptId}`) });

  if (isLoading || !data) return <LoadingBlock label="Loading result…" />;
  const pending = data.status === 'submitted' && data.passed === null;
  const backTo = learner ? '/learner' : '/quizzes';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4"><Link to={backTo} className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> {learner ? 'My courses' : 'Assessments'}</Link></div>

      <Card className="mb-5 overflow-hidden p-0">
        <div className={`p-6 text-center ${data.passed === true ? 'bg-emerald-50' : data.passed === false ? 'bg-red-50' : 'bg-gold-50'}`}>
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-full ${data.passed === true ? 'bg-emerald-100 text-emerald-600' : data.passed === false ? 'bg-red-100 text-red-600' : 'bg-gold-100 text-gold-600'}`}>
            {data.passed === true ? <CheckCircle2 className="h-8 w-8" /> : data.passed === false ? <XCircle className="h-8 w-8" /> : <Clock className="h-8 w-8" />}
          </div>
          <h1 className="mt-3 text-2xl font-bold text-ink-950">{formatPercent(data.percentage)}</h1>
          <p className="text-sm text-ink-500">{data.score} / {data.maxScore} points · Passing {formatPercent(data.passingScore)}</p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Badge tone={data.passed === true ? 'bg-emerald-500 text-white' : data.passed === false ? 'bg-red-500 text-white' : 'bg-gold-500 text-white'}>
              {data.passed === true ? 'Passed' : data.passed === false ? 'Failed' : 'Awaiting review'}
            </Badge>
            <Badge tone={STATUS_TONES[data.status] ?? 'bg-ink-100 text-ink-600'}>{titleCase(data.status)}</Badge>
          </div>
        </div>
        <div className="space-y-1.5 p-5 text-sm">
          <div className="flex justify-between"><span className="text-ink-400">Assessment</span><span className="font-semibold text-ink-800">{data.quizTitle}</span></div>
          <div className="flex justify-between"><span className="text-ink-400">Attempt</span><span className="text-ink-700">#{data.attemptNumber}</span></div>
          {data.employee && <div className="flex justify-between"><span className="text-ink-400">Employee</span><span className="text-ink-700">{data.employee.name} ({data.employee.employeeNo})</span></div>}
          <div className="flex justify-between"><span className="text-ink-400">Submitted</span><span className="text-ink-700">{formatDateTime(data.submittedAt)}</span></div>
          <div className="pt-2"><ProgressBar value={data.percentage} tone={data.passed === true ? 'bg-emerald-500' : data.passed === false ? 'bg-red-500' : 'bg-gold-500'} /></div>
        </div>
      </Card>

      {pending && (
        <Card className="mb-5 flex items-center gap-3 border-gold-200 bg-gold-50 p-4">
          <Clock className="h-5 w-5 shrink-0 text-gold-600" />
          <p className="text-sm text-gold-800">Some answers require manual grading. Your final result will appear here once a trainer reviews them.</p>
        </Card>
      )}
      {data.passed === true && (
        <Card className="mb-5 flex items-center gap-3 border-emerald-200 bg-emerald-50 p-4">
          <Award className="h-5 w-5 shrink-0 text-emerald-600" />
          <p className="flex-1 text-sm text-emerald-800">You passed this assessment. If all course requirements are met, your certificate is issued automatically.</p>
          {learner && <Link to="/learner/certificates"><Button variant="gold" size="sm">My certificates</Button></Link>}
        </Card>
      )}

      <h3 className="mb-3 font-bold text-ink-900">Answer review</h3>
      <div className="space-y-3">
        {data.answers.map((a, i) => (
          <Card key={a.questionId} className="p-5">
            <div className="mb-2 flex items-start gap-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">{i + 1}</span>
              <div className="flex-1">
                <p className="font-semibold text-ink-900">{a.questionText}</p>
                <p className="mt-0.5 text-[11px] text-ink-400">{titleCase(a.questionType)} · {a.points} points</p>
              </div>
              <Badge tone={a.needsManualReview ? 'bg-gold-50 text-gold-700' : a.isCorrect ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}>
                {a.needsManualReview ? 'Pending' : a.isCorrect ? 'Correct' : 'Incorrect'} · {a.pointsAwarded}/{a.points}
              </Badge>
            </div>

            {a.options.length > 0 && (
              <div className="mt-2 space-y-1.5">
                {a.options.map((o) => {
                  const chosen = a.selectedOptionIds?.includes(o.id);
                  const correct = o.isCorrect;
                  return (
                    <div key={o.id} className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${correct ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : chosen ? 'border-red-200 bg-red-50 text-red-800' : 'border-ink-100 text-ink-600'}`}>
                      {correct ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" /> : chosen ? <XCircle className="h-4 w-4 shrink-0 text-red-500" /> : <MinusCircle className="h-4 w-4 shrink-0 text-ink-300" />}
                      <span className="flex-1">{o.optionText}</span>
                      {chosen && <span className="text-[10px] font-semibold uppercase">Your answer</span>}
                    </div>
                  );
                })}
              </div>
            )}

            {a.textAnswer !== null && (
              <div className="mt-2 rounded-lg bg-ink-50 px-3 py-2 text-sm text-ink-700"><span className="text-xs font-semibold text-ink-400">Your answer: </span>{a.textAnswer || <em className="text-ink-400">blank</em>}</div>
            )}
            {a.correctAnswer && (
              <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800"><span className="text-xs font-semibold">Accepted answer: </span>{a.correctAnswer}</div>
            )}
            {a.explanation && <p className="mt-2 text-xs text-ink-500"><span className="font-semibold">Explanation: </span>{a.explanation}</p>}
          </Card>
        ))}
        {data.answers.length === 0 && <Card><EmptyState title="No answers recorded" /></Card>}
      </div>
    </div>
  );
}
import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Clock, Send, AlertTriangle, ClipboardList } from 'lucide-react';
import { api } from '@/lib/api';
import type { AttemptStart, AttemptSubmitResult } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { Card, Button, Badge, LoadingBlock, EmptyState, Input, Textarea, ConfirmDialog } from '@/components/ui';

interface Answer { selectedOptionIds: number[]; textAnswer: string }

export function QuizTakerPage() {
  const { quizId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [attempt, setAttempt] = useState<AttemptStart | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<number, Answer>>({});
  const [remaining, setRemaining] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const startedRef = useRef(false);

  const start = useMutation({
    mutationFn: () => api.post<AttemptStart>(`/quizzes/${quizId}/start`),
    onSuccess: (res) => {
      setAttempt(res);
      const init: Record<number, Answer> = {};
      res.questions.forEach((q) => { init[q.id] = { selectedOptionIds: [], textAnswer: '' }; });
      setAnswers(init);
    },
    onError: (e: Error) => setError(e.message),
  });

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    start.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useMutation({
    mutationFn: () => {
      const payload = attempt!.questions.map((q) => {
        const a = answers[q.id] ?? { selectedOptionIds: [], textAnswer: '' };
        return { questionId: q.id, selectedOptionIds: a.selectedOptionIds.length ? a.selectedOptionIds : undefined, textAnswer: a.textAnswer || undefined };
      });
      return api.post<AttemptSubmitResult>(`/quizzes/attempts/${attempt!.attemptId}/submit`, { answers: payload });
    },
    onSuccess: (res) => {
      toast.success(res.awaitingReview ? 'Submitted — awaiting manual review' : 'Assessment submitted');
      navigate(`/learner/attempts/${res.attemptId}`, { replace: true });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  useEffect(() => {
    if (!attempt?.expiresAt) return;
    const expiry = new Date(attempt.expiresAt.replace(' ', 'T')).getTime();
    const tick = () => {
      const secs = Math.max(0, Math.round((expiry - Date.now()) / 1000));
      setRemaining(secs);
      if (secs <= 0) { clearInterval(timer); submit.mutate(); }
    };
    const timer = setInterval(tick, 1000);
    tick();
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt?.expiresAt]);

  if (error) {
    return (
      <div>
        <div className="mb-4"><Link to="/learner" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> My courses</Link></div>
        <Card><EmptyState title="Cannot start assessment" message={error} icon={<AlertTriangle className="h-7 w-7" />}
          action={<Link to="/learner"><Button variant="gold" size="sm">Back to my courses</Button></Link>} /></Card>
      </div>
    );
  }
  if (!attempt) return <LoadingBlock label="Preparing your assessment…" />;

  const answeredCount = attempt.questions.filter((q) => { const a = answers[q.id]; return a && (a.selectedOptionIds.length > 0 || a.textAnswer.trim()); }).length;
  const mm = remaining !== null ? String(Math.floor(remaining / 60)).padStart(2, '0') : null;
  const ss = remaining !== null ? String(remaining % 60).padStart(2, '0') : null;

  function setOption(qid: number, oid: number, multi: boolean) {
    setAnswers((prev) => {
      const cur = prev[qid] ?? { selectedOptionIds: [], textAnswer: '' };
      const ids = multi
        ? (cur.selectedOptionIds.includes(oid) ? cur.selectedOptionIds.filter((x) => x !== oid) : [...cur.selectedOptionIds, oid])
        : [oid];
      return { ...prev, [qid]: { ...cur, selectedOptionIds: ids } };
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-4 flex items-center justify-between">
        <Link to="/learner" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Exit</Link>
        {remaining !== null && (
          <span className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-bold ${remaining < 60 ? 'bg-red-50 text-red-600' : 'bg-gold-50 text-gold-700'}`}>
            <Clock className="h-4 w-4" /> {mm}:{ss}
          </span>
        )}
      </div>

      <Card className="mb-5 p-5">
        <div className="flex items-start gap-3">
          <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-50 text-gold-600"><ClipboardList className="h-5 w-5" /></span>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-ink-950">{attempt.title}</h1>
            <p className="mt-0.5 text-xs text-ink-400">Attempt {attempt.attemptNumber} of {attempt.maxAttempts} · Passing score {attempt.passingScore}% · {attempt.questions.length} questions</p>
          </div>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-ink-500">
          <Badge tone="bg-ink-100 text-ink-600">{answeredCount}/{attempt.questions.length} answered</Badge>
          {attempt.timeLimitMinutes && <Badge tone="bg-gold-50 text-gold-700">{attempt.timeLimitMinutes} min limit</Badge>}
        </div>
      </Card>

      <div className="space-y-4">
        {attempt.questions.map((q, i) => {
          const a = answers[q.id] ?? { selectedOptionIds: [], textAnswer: '' };
          const multi = q.questionType === 'multiple_select';
          const isOption = q.questionType === 'multiple_choice' || q.questionType === 'true_false' || multi;
          return (
            <Card key={q.id} className="p-5">
              <div className="mb-3 flex items-start gap-3">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-ink-950 text-xs font-bold text-white">{i + 1}</span>
                <div className="flex-1">
                  <p className="font-semibold text-ink-900">{q.questionText}</p>
                  <p className="mt-0.5 text-[11px] text-ink-400">{q.points} point{q.points === 1 ? '' : 's'}{multi ? ' · Select all that apply' : ''}</p>
                </div>
              </div>
              {isOption ? (
                <div className="space-y-2">
                  {q.options.map((o) => {
                    const selected = a.selectedOptionIds.includes(o.id);
                    return (
                      <button key={o.id} type="button" onClick={() => setOption(q.id, o.id, multi)}
                        className={`flex w-full items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm transition ${selected ? 'border-gold-400 bg-gold-50 text-gold-800' : 'border-ink-100 text-ink-700 hover:border-ink-200 hover:bg-ink-50'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center border-2 ${multi ? 'rounded-md' : 'rounded-full'} ${selected ? 'border-gold-500 bg-gold-500' : 'border-ink-300'}`}>
                          {selected && <span className={`bg-white ${multi ? 'h-2 w-2 rounded-sm' : 'h-2 w-2 rounded-full'}`} />}
                        </span>
                        {o.optionText}
                      </button>
                    );
                  })}
                </div>
              ) : q.questionType === 'identification' ? (
                <Input value={a.textAnswer} onChange={(e) => setAnswers({ ...answers, [q.id]: { ...a, textAnswer: e.target.value } })} placeholder="Type your answer…" maxLength={500} />
              ) : (
                <Textarea value={a.textAnswer} onChange={(e) => setAnswers({ ...answers, [q.id]: { ...a, textAnswer: e.target.value } })} placeholder="Write your answer…" maxLength={5000} className="min-h-[120px]" />
              )}
            </Card>
          );
        })}
      </div>

      <div className="sticky bottom-4 mt-6">
        <Card className="flex items-center justify-between gap-3 p-4 shadow-lg">
          <p className="text-sm text-ink-500">{answeredCount === attempt.questions.length ? 'All questions answered.' : `${attempt.questions.length - answeredCount} unanswered — you can still submit.`}</p>
          <Button variant="gold" icon={<Send className="h-4 w-4" />} loading={submit.isPending} onClick={() => setConfirmOpen(true)}>Submit assessment</Button>
        </Card>
      </div>

      <ConfirmDialog open={confirmOpen} onClose={() => setConfirmOpen(false)} onConfirm={() => { setConfirmOpen(false); submit.mutate(); }}
        title="Submit assessment?" message={answeredCount < attempt.questions.length ? `You have ${attempt.questions.length - answeredCount} unanswered question(s). Submitting will finalize this attempt.` : 'This will finalize your attempt and record your score.'}
        confirmLabel="Submit" loading={submit.isPending} />
    </div>
  );
}
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, GripVertical, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import type { QuizDetail, Course, Paginated, QuestionType } from '@/lib/types';
import { useToast } from '@/context/ToastContext';
import { titleCase } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, Field, Input, Textarea, Select } from '@/components/ui';

const TYPES: { value: QuestionType; label: string }[] = [
  { value: 'multiple_choice', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'multiple_select', label: 'Multiple select' },
  { value: 'identification', label: 'Identification' },
  { value: 'short_answer', label: 'Short answer' },
];
const NEEDS_OPTIONS: QuestionType[] = ['multiple_choice', 'true_false', 'multiple_select'];

interface OptionDraft { optionText: string; isCorrect: boolean }
interface QuestionDraft { questionType: QuestionType; questionText: string; points: number; correctAnswer: string; explanation: string; options: OptionDraft[] }

function blankQuestion(type: QuestionType = 'multiple_choice'): QuestionDraft {
  const options = type === 'true_false'
    ? [{ optionText: 'True', isCorrect: false }, { optionText: 'False', isCorrect: false }]
    : NEEDS_OPTIONS.includes(type) ? [{ optionText: '', isCorrect: false }, { optionText: '', isCorrect: false }] : [];
  return { questionType: type, questionText: '', points: 1, correctAnswer: '', explanation: '', options };
}

interface Settings {
  courseId: string; title: string; description: string; passingScore: number; timeLimitMinutes: string; maxAttempts: number;
  questionsPerAttempt: string; randomizeQuestions: boolean; randomizeOptions: boolean; showResults: boolean; isActive: boolean;
}
const EMPTY_SETTINGS: Settings = {
  courseId: '', title: '', description: '', passingScore: 75, timeLimitMinutes: '', maxAttempts: 3,
  questionsPerAttempt: '', randomizeQuestions: false, randomizeOptions: false, showResults: true, isActive: true,
};

export function QuizBuilderPage() {
  const { id } = useParams();
  const quizId = id ? Number(id) : null;
  const isNew = quizId === null;
  const navigate = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();

  const { data: courses } = useQuery({ queryKey: ['courses-all'], queryFn: () => api.get<Paginated<Course>>('/courses/?pageSize=200&sortBy=title') });
  const { data: quiz, isLoading } = useQuery({ queryKey: ['quiz', quizId], queryFn: () => api.get<QuizDetail>(`/quizzes/${quizId}`), enabled: !isNew });

  const [settings, setSettings] = useState<Settings>(EMPTY_SETTINGS);
  const [questions, setQuestions] = useState<QuestionDraft[]>([blankQuestion()]);

  useEffect(() => {
    if (quiz) {
      setSettings({
        courseId: String(quiz.courseId), title: quiz.title, description: quiz.description ?? '', passingScore: quiz.passingScore,
        timeLimitMinutes: quiz.timeLimitMinutes ? String(quiz.timeLimitMinutes) : '', maxAttempts: quiz.maxAttempts,
        questionsPerAttempt: '', randomizeQuestions: quiz.randomizeQuestions, randomizeOptions: quiz.randomizeOptions,
        showResults: quiz.showResults, isActive: quiz.isActive,
      });
      setQuestions(quiz.questions.map((q) => ({
        questionType: q.questionType, questionText: q.questionText, points: q.points, correctAnswer: q.correctAnswer ?? '',
        explanation: q.explanation ?? '', options: q.options.map((o) => ({ optionText: o.optionText, isCorrect: Boolean(o.isCorrect) })),
      })));
    }
  }, [quiz]);

  const save = useMutation({
    mutationFn: () => {
      const body = {
        courseId: Number(settings.courseId), title: settings.title, description: settings.description || null,
        passingScore: settings.passingScore, timeLimitMinutes: settings.timeLimitMinutes ? Number(settings.timeLimitMinutes) : null,
        maxAttempts: settings.maxAttempts, questionsPerAttempt: settings.questionsPerAttempt ? Number(settings.questionsPerAttempt) : null,
        randomizeQuestions: settings.randomizeQuestions, randomizeOptions: settings.randomizeOptions,
        showResults: settings.showResults, isActive: settings.isActive,
        questions: questions.map((q) => ({
          questionType: q.questionType, questionText: q.questionText, points: q.points,
          correctAnswer: q.correctAnswer || null, explanation: q.explanation || null,
          ...(NEEDS_OPTIONS.includes(q.questionType) ? { options: q.options.map((o) => ({ optionText: o.optionText, isCorrect: o.isCorrect })) } : {}),
        })),
      };
      return isNew ? api.post<{ id: number }>('/quizzes/', body) : api.put(`/quizzes/${quizId}`, body);
    },
    onSuccess: () => {
      toast.success(isNew ? 'Assessment created' : 'Assessment saved');
      void qc.invalidateQueries({ queryKey: ['quizzes'] });
      if (!isNew) void qc.invalidateQueries({ queryKey: ['quiz', quizId] });
      navigate('/quizzes');
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function validate(): string | null {
    if (!settings.courseId) return 'Select a course.';
    if (!settings.title.trim()) return 'Enter a title.';
    if (questions.length === 0) return 'Add at least one question.';
    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.questionText.trim()) return `Question ${i + 1}: enter the question text.`;
      if (NEEDS_OPTIONS.includes(q.questionType)) {
        const opts = q.options.filter((o) => o.optionText.trim());
        if (opts.length < 2) return `Question ${i + 1}: provide at least 2 options.`;
        const correct = q.options.filter((o) => o.isCorrect && o.optionText.trim()).length;
        if (q.questionType === 'multiple_select' && correct < 1) return `Question ${i + 1}: select at least one correct option.`;
        if (q.questionType !== 'multiple_select' && correct !== 1) return `Question ${i + 1}: select exactly one correct option.`;
      }
      if (q.questionType === 'identification' && !q.correctAnswer.trim()) return `Question ${i + 1}: provide the accepted answer(s).`;
    }
    return null;
  }

  function attemptSave() {
    const err = validate();
    if (err) { toast.error(err); return; }
    save.mutate();
  }

  if (!isNew && isLoading) return <LoadingBlock label="Loading assessment…" />;

  return (
    <div>
      <div className="mb-4"><Link to="/quizzes" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Back to assessments</Link></div>
      <PageHeader title={isNew ? 'Create assessment' : `Edit: ${quiz?.title ?? ''}`} subtitle="Configure scoring and build questions."
        actions={<Button variant="gold" icon={<Save className="h-4 w-4" />} loading={save.isPending} onClick={attemptSave}>{isNew ? 'Create assessment' : 'Save changes'}</Button>} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-1">
          <h3 className="mb-4 font-bold text-ink-900">Settings</h3>
          <div className="space-y-4">
            <Field label="Course" required>
              <Select value={settings.courseId} onChange={(e) => setSettings({ ...settings, courseId: e.target.value })} disabled={!isNew}>
                <option value="">Select course</option>{(courses?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
              </Select>
            </Field>
            <Field label="Title" required><Input value={settings.title} onChange={(e) => setSettings({ ...settings, title: e.target.value })} maxLength={200} /></Field>
            <Field label="Description"><Textarea value={settings.description} onChange={(e) => setSettings({ ...settings, description: e.target.value })} maxLength={2000} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Passing score (%)"><Input type="number" min={1} max={100} value={settings.passingScore} onChange={(e) => setSettings({ ...settings, passingScore: Number(e.target.value) })} /></Field>
              <Field label="Max attempts"><Input type="number" min={1} max={10} value={settings.maxAttempts} onChange={(e) => setSettings({ ...settings, maxAttempts: Number(e.target.value) })} /></Field>
              <Field label="Time limit (min)" hint="Empty = no limit"><Input type="number" min={1} max={480} value={settings.timeLimitMinutes} onChange={(e) => setSettings({ ...settings, timeLimitMinutes: e.target.value })} /></Field>
              <Field label="Questions/attempt" hint="Empty = all"><Input type="number" min={1} value={settings.questionsPerAttempt} onChange={(e) => setSettings({ ...settings, questionsPerAttempt: e.target.value })} /></Field>
            </div>
            <div className="space-y-2.5 border-t border-ink-100 pt-4">
              <Toggle label="Randomize question order" checked={settings.randomizeQuestions} onChange={(v) => setSettings({ ...settings, randomizeQuestions: v })} />
              <Toggle label="Randomize option order" checked={settings.randomizeOptions} onChange={(v) => setSettings({ ...settings, randomizeOptions: v })} />
              <Toggle label="Show results to learners" checked={settings.showResults} onChange={(v) => setSettings({ ...settings, showResults: v })} />
              <Toggle label="Active" checked={settings.isActive} onChange={(v) => setSettings({ ...settings, isActive: v })} />
            </div>
          </div>
        </Card>

        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-ink-900">Questions ({questions.length})</h3>
            <Button variant="outline" size="sm" icon={<Plus className="h-4 w-4" />} onClick={() => setQuestions([...questions, blankQuestion()])}>Add question</Button>
          </div>
          {questions.map((q, i) => (
            <QuestionCard key={i} index={i} question={q}
              onChange={(next) => setQuestions(questions.map((x, xi) => xi === i ? next : x))}
              onRemove={() => setQuestions(questions.filter((_, xi) => xi !== i))} />
          ))}
          {questions.length === 0 && <Card><p className="px-4 py-8 text-center text-sm text-ink-400">No questions. Add your first question.</p></Card>}
        </div>
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-ink-700">
      {label}
      <button type="button" onClick={() => onChange(!checked)} className={`relative h-6 w-11 shrink-0 rounded-full transition ${checked ? 'bg-gold-500' : 'bg-ink-200'}`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function QuestionCard({ index, question, onChange, onRemove }: { index: number; question: QuestionDraft; onChange: (q: QuestionDraft) => void; onRemove: () => void }) {
  const q = question;
  function setType(type: QuestionType) {
    const base = blankQuestion(type);
    onChange({ ...q, questionType: type, options: base.options, correctAnswer: type === 'identification' ? q.correctAnswer : '' });
  }
  function setOption(i: number, patch: Partial<OptionDraft>) { onChange({ ...q, options: q.options.map((o, oi) => oi === i ? { ...o, ...patch } : o) }); }
  function markCorrect(i: number) {
    if (q.questionType === 'multiple_select') setOption(i, { isCorrect: !q.options[i].isCorrect });
    else onChange({ ...q, options: q.options.map((o, oi) => ({ ...o, isCorrect: oi === i })) });
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-ink-300" />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold-100 text-xs font-bold text-gold-700">{index + 1}</span>
        <Badge tone="bg-ink-100 text-ink-600">{titleCase(q.questionType)}</Badge>
        <div className="ml-auto flex items-center gap-2">
          <Field label=""><Input type="number" min={0.5} max={100} step={0.5} value={q.points} onChange={(e) => onChange({ ...q, points: Number(e.target.value) })} className="w-20 py-1.5 text-xs" /></Field>
          <span className="text-xs text-ink-400">pts</span>
          <button onClick={onRemove} className="ml-1 text-ink-400 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
        </div>
      </div>
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="sm:col-span-2"><Field label="Question text" required><Textarea value={q.questionText} onChange={(e) => onChange({ ...q, questionText: e.target.value })} className="min-h-[60px]" maxLength={2000} /></Field></div>
          <Field label="Type"><Select value={q.questionType} onChange={(e) => setType(e.target.value as QuestionType)}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select></Field>
        </div>

        {NEEDS_OPTIONS.includes(q.questionType) && (
          <div>
            <p className="label">Options {q.questionType === 'multiple_select' ? '(check all correct)' : '(select one correct)'}</p>
            <div className="space-y-2">
              {q.options.map((o, oi) => (
                <div key={oi} className="flex items-center gap-2">
                  <button type="button" onClick={() => markCorrect(oi)}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${o.isCorrect ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-ink-200 text-transparent hover:border-emerald-300'}`}>
                    <CheckCircle2 className="h-4 w-4" />
                  </button>
                  <Input value={o.optionText} onChange={(e) => setOption(oi, { optionText: e.target.value })} placeholder={`Option ${oi + 1}`} maxLength={500} disabled={q.questionType === 'true_false'} />
                  {q.questionType !== 'true_false' && q.options.length > 2 && <button onClick={() => onChange({ ...q, options: q.options.filter((_, xi) => xi !== oi) })} className="text-ink-300 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>}
                </div>
              ))}
            </div>
            {q.questionType !== 'true_false' && <Button variant="ghost" size="sm" icon={<Plus className="h-3.5 w-3.5" />} className="mt-2" onClick={() => onChange({ ...q, options: [...q.options, { optionText: '', isCorrect: false }] })}>Add option</Button>}
          </div>
        )}

        {q.questionType === 'identification' && (
          <Field label="Accepted answer(s)" required hint="Separate multiple accepted answers with | (e.g. espresso|espresso shot). Matching is case-insensitive.">
            <Input value={q.correctAnswer} onChange={(e) => onChange({ ...q, correctAnswer: e.target.value })} maxLength={500} />
          </Field>
        )}
        {q.questionType === 'short_answer' && <p className="rounded-lg bg-gold-50 px-3 py-2 text-xs text-gold-700">Short answers are graded manually by a trainer after submission.</p>}

        <Field label="Explanation (optional)" hint="Shown to learners after grading if results are visible."><Input value={q.explanation} onChange={(e) => onChange({ ...q, explanation: e.target.value })} maxLength={2000} /></Field>
      </div>
    </Card>
  );
}
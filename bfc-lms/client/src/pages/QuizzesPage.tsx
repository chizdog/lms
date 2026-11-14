import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, ClipboardList, ListChecks, Users } from 'lucide-react';
import { api } from '@/lib/api';
import type { QuizListItem, Course, Paginated } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { useToast } from '@/context/ToastContext';
import { formatPercent } from '@/lib/format';
import { PageHeader, Card, Button, Badge, LoadingBlock, EmptyState, Select, ConfirmDialog, IconButton } from '@/components/ui';

export function QuizzesPage() {
  const { has } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const canManage = has('quiz.manage');
  const [courseId, setCourseId] = useState('');

  const { data: courses } = useQuery({ queryKey: ['courses-all'], queryFn: () => api.get<Paginated<Course>>('/courses/?pageSize=200&sortBy=title') });
  const { data, isLoading } = useQuery({ queryKey: ['quizzes', courseId], queryFn: () => api.get<{ items: QuizListItem[] }>(`/quizzes/${courseId ? `?courseId=${courseId}` : ''}`) });
  const items = data?.items ?? [];

  const remove = useMutation({
    mutationFn: (id: number) => api.del(`/quizzes/${id}`),
    onSuccess: () => { toast.success('Assessment deleted'); void qc.invalidateQueries({ queryKey: ['quizzes'] }); },
    onError: (e: Error) => toast.error(e.message),
  });
  const [deleting, setDeleting] = useState<QuizListItem | null>(null);

  return (
    <div>
      <PageHeader title="Assessments" subtitle="Create quizzes and track learner performance."
        actions={canManage && <Button variant="gold" icon={<Plus className="h-4 w-4" />} onClick={() => navigate('/quizzes/new')}>New assessment</Button>} />

      <Card className="mb-5 p-4">
        <div className="max-w-xs">
          <Select value={courseId} onChange={(e) => setCourseId(e.target.value)}>
            <option value="">All courses</option>
            {(courses?.items ?? []).map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}
          </Select>
        </div>
      </Card>

      <Card>
        {isLoading ? <LoadingBlock /> : items.length === 0 ? (
          <EmptyState title="No assessments yet" message={canManage ? 'Create a quiz to evaluate learner understanding.' : 'No assessments are available.'} icon={<ClipboardList className="h-7 w-7" />}
            action={canManage && <Button variant="gold" size="sm" onClick={() => navigate('/quizzes/new')}>New assessment</Button>} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-100 text-left">
                <th className="th">Assessment</th><th className="th">Course</th><th className="th text-center">Questions</th>
                <th className="th text-center">Pass mark</th><th className="th text-center">Attempts</th><th className="th text-center">Passed</th>
                <th className="th text-center">Status</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {items.map((q) => (
                  <tr key={q.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                    <td className="td font-semibold text-ink-800">{q.title}</td>
                    <td className="td text-ink-600">{q.courseTitle}<span className="block font-mono text-[11px] text-ink-400">{q.courseCode}</span></td>
                    <td className="td text-center text-ink-600">{q.questionCount}</td>
                    <td className="td text-center text-ink-600">{formatPercent(q.passingScore)}</td>
                    <td className="td text-center text-ink-600">{q.attemptCount}</td>
                    <td className="td text-center font-semibold text-emerald-600">{q.passedCount}</td>
                    <td className="td text-center"><Badge tone={q.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-ink-100 text-ink-500'}>{q.isActive ? 'Active' : 'Inactive'}</Badge></td>
                    <td className="td"><div className="flex justify-end gap-1">
                      <IconButton label="View attempts" onClick={() => navigate(`/quizzes/${q.id}/attempts`)}><Users className="h-4 w-4" /></IconButton>
                      {canManage && <IconButton label="Edit" onClick={() => navigate(`/quizzes/${q.id}/edit`)}><Pencil className="h-4 w-4" /></IconButton>}
                      {canManage && <IconButton label="Delete" className="hover:bg-red-50 hover:text-red-600" onClick={() => setDeleting(q)}><Trash2 className="h-4 w-4" /></IconButton>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog open={!!deleting} onClose={() => setDeleting(null)} onConfirm={() => deleting && remove.mutate(deleting.id)}
        title="Delete assessment" message={`Delete "${deleting?.title}"? Assessments with attempt history cannot be deleted — deactivate instead.`}
        confirmLabel="Delete" danger loading={remove.isPending} />
      <Link to="/courses" className="mt-4 inline-flex items-center gap-1.5 text-xs text-ink-400 hover:text-gold-700"><ListChecks className="h-3.5 w-3.5" /> Assessments are attached to courses</Link>
    </div>
  );
}
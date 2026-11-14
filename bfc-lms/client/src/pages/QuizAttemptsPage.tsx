import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Pencil, ClipboardList, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type { QuizAttemptListItem, QuizDetail } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { formatDateTime, formatPercent, titleCase } from '@/lib/format';
import { STATUS_TONES } from '@/lib/access';
import { PageHeader, Card, Badge, Avatar, LoadingBlock, EmptyState, IconButton, Tabs } from '@/components/ui';

export function QuizAttemptsPage() {
  const { id } = useParams();
  const quizId = Number(id);
  const navigate = useNavigate();
  const { has } = useAuth();
  const canGrade = has('quiz.grade');
  const [tab, setTab] = useState('all');

  const { data: quiz } = useQuery({ queryKey: ['quiz', quizId], queryFn: () => api.get<QuizDetail>(`/quizzes/${quizId}`) });
  const { data, isLoading } = useQuery({ queryKey: ['quiz-attempts', quizId], queryFn: () => api.get<{ items: QuizAttemptListItem[] }>(`/quizzes/${quizId}/attempts`) });
  const items = data?.items ?? [];
  const pendingCount = items.filter((a) => a.pendingReview > 0).length;
  const filtered = tab === 'pending' ? items.filter((a) => a.pendingReview > 0) : items;

  return (
    <div>
      <div className="mb-4"><Link to="/quizzes" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-500 hover:text-gold-700"><ArrowLeft className="h-4 w-4" /> Assessments</Link></div>
      <PageHeader title={quiz?.title ?? 'Attempts'} subtitle={quiz ? `${items.length} attempts · passing score ${quiz.passingScore}%` : 'Attempt history'} />
      <div className="mb-5"><Tabs tabs={[{ key: 'all', label: 'All attempts', count: items.length }, { key: 'pending', label: 'Needs grading', count: pendingCount }]} active={tab} onChange={setTab} /></div>

      <Card>
        {isLoading ? <LoadingBlock /> : filtered.length === 0 ? (
          <EmptyState title={tab === 'pending' ? 'Nothing to grade' : 'No attempts yet'} message={tab === 'pending' ? 'All submissions have been graded.' : 'Learner attempts will appear here.'} icon={<ClipboardList className="h-7 w-7" />} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-ink-100 text-left">
                <th className="th">Employee</th><th className="th text-center">Attempt</th><th className="th text-center">Score</th>
                <th className="th text-center">Result</th><th className="th text-center">Status</th><th className="th">Submitted</th><th className="th text-right">Actions</th>
              </tr></thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} className="border-b border-ink-50 last:border-0 hover:bg-ink-50/50">
                    <td className="td"><span className="flex items-center gap-3"><Avatar name={a.employee.name} size="sm" />
                      <span><span className="block font-semibold text-ink-800">{a.employee.name}</span><span className="block text-xs text-ink-400">{a.employee.employeeNo}{a.employee.departmentName ? ` · ${a.employee.departmentName}` : ''}</span></span></span></td>
                    <td className="td text-center text-ink-600">#{a.attemptNumber}</td>
                    <td className="td text-center font-semibold text-ink-700">{formatPercent(a.percentage)}<span className="block text-[11px] font-normal text-ink-400">{a.score}/{a.maxScore}</span></td>
                    <td className="td text-center"><Badge tone={a.passed === true ? 'bg-emerald-50 text-emerald-700' : a.passed === false ? 'bg-red-50 text-red-700' : 'bg-gold-50 text-gold-700'}>{a.passed === true ? 'Passed' : a.passed === false ? 'Failed' : 'Pending'}</Badge></td>
                    <td className="td text-center">
                      <Badge tone={STATUS_TONES[a.status] ?? 'bg-ink-100 text-ink-600'}>{titleCase(a.status)}</Badge>
                      {a.pendingReview > 0 && <span className="mt-1 flex items-center justify-center gap-1 text-[10px] text-gold-600"><AlertCircle className="h-3 w-3" />{a.pendingReview} to grade</span>}
                    </td>
                    <td className="td text-xs text-ink-500">{formatDateTime(a.submittedAt)}</td>
                    <td className="td"><div className="flex justify-end gap-1">
                      <IconButton label="View result" onClick={() => navigate(`/quizzes/attempts/${a.id}`)}><Eye className="h-4 w-4" /></IconButton>
                      {canGrade && a.pendingReview > 0 && <IconButton label="Grade" className="hover:bg-gold-50 hover:text-gold-700" onClick={() => navigate(`/quizzes/attempts/${a.id}/grade`)}><Pencil className="h-4 w-4" /></IconButton>}
                    </div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
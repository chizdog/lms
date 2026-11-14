import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import {
  Users, BookOpen, TrendingUp, AlertTriangle, GraduationCap, Award, ClipboardList, CheckCircle2,
  Activity, CalendarClock, ArrowRight, Layers,
} from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from 'recharts';
import { api } from '@/lib/api';
import type { Dashboard } from '@/lib/types';
import { useAuth } from '@/context/AuthContext';
import { formatMonth, formatNumber, formatPercent, formatDate, relativeTime } from '@/lib/format';
import { Card, StatCard, PageHeader, LoadingBlock, Badge, ProgressBar, EmptyState, Button } from '@/components/ui';
import { CourseThumb } from '@/components/media';

const CHART = ['#C8952F', '#1a1917', '#10b981', '#0ea5e9', '#8b5cf6', '#ef4444', '#f59e0b', '#14b8a6'];

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-3 py-2 shadow-lg">
      {label && <p className="mb-1 text-xs font-semibold text-ink-700">{label}</p>}
      {payload.map((p, i) => (
        <p key={i} className="flex items-center gap-2 text-xs text-ink-600">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} /> {p.name}: <span className="font-semibold">{p.value}</span>
        </p>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { auth } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['dashboard'], queryFn: () => api.get<Dashboard>('/dashboard') });

  if (isLoading || !data) return <LoadingBlock label="Loading your dashboard…" />;

  const firstName = auth?.employee.firstName ?? 'there';
  const greeting = (
    <PageHeader
      title={`Hello, ${firstName} ☕`}
      subtitle={data.role === 'admin' ? 'Here is how training is progressing across But First, Coffee.' : 'Pick up where you left off and keep your skills fresh.'}
    />
  );

  return data.role === 'admin' ? <>{greeting}<AdminView data={data} /></> : <>{greeting}<LearnerView data={data} /></>;
}

function AdminView({ data }: { data: Extract<Dashboard, { role: 'admin' }> }) {
  const s = data.stats;
  const assessmentData = [
    { name: 'Passed', value: s.assessmentsPassed },
    { name: 'Failed', value: s.assessmentsFailed },
    { name: 'Pending', value: s.assessmentsPending },
  ];
  const trend = data.monthlyCompletions.map((m) => ({ ...m, label: formatMonth(m.month) }));
  const deptData = data.departmentPerformance.slice(0, 7).map((d) => ({ name: d.name.length > 16 ? `${d.name.slice(0, 15)}…` : d.name, rate: d.completionRate, enrollments: d.enrollments }));

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Employees" value={formatNumber(s.totalEmployees)} hint="Active staff" icon={<Users className="h-5 w-5" />} accent="ink" />
        <StatCard label="Active Courses" value={formatNumber(s.activeCourses)} hint={`${s.totalCourses} total · ${s.draftCourses} draft`} icon={<BookOpen className="h-5 w-5" />} accent="gold" />
        <StatCard label="Completion Rate" value={formatPercent(s.completionRate, 1)} hint={`${formatNumber(s.completedEnrollments)} of ${formatNumber(s.totalEnrollments)} done`} icon={<TrendingUp className="h-5 w-5" />} accent="green" />
        <StatCard label="Overdue Training" value={formatNumber(s.overdueTraining)} hint="Past deadline" icon={<AlertTriangle className="h-5 w-5" />} accent="red" />
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MiniStat icon={<Layers className="h-4 w-4" />} label="In Progress" value={s.inProgressEnrollments} />
        <MiniStat icon={<ClipboardList className="h-4 w-4" />} label="Assessments Taken" value={s.assessmentsTaken} />
        <MiniStat icon={<Award className="h-4 w-4" />} label="Certificates Issued" value={s.certificatesIssued} />
        <MiniStat icon={<CheckCircle2 className="h-4 w-4" />} label="Assessments Passed" value={s.assessmentsPassed} />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-ink-900">Course completions</h3>
            <Badge tone="bg-gold-50 text-gold-700">Last 6 months</Badge>
          </div>
          {trend.length === 0 ? <EmptyState title="No completions yet" message="Completed courses will appear here." /> : (
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="goldFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#C8952F" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#C8952F" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e7e5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#86857f' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#86857f' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="completed" name="Completions" stroke="#C8952F" strokeWidth={2.5} fill="url(#goldFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 font-bold text-ink-900">Assessment outcomes</h3>
          {s.assessmentsTaken === 0 ? <EmptyState title="No attempts yet" /> : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={assessmentData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                    {assessmentData.map((_, i) => <Cell key={i} fill={[CHART[2], CHART[5], CHART[6]][i]} />)}
                  </Pie>
                  <Tooltip content={<ChartTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-2">
                {assessmentData.map((d, i) => (
                  <div key={d.name} className="flex items-center justify-between text-sm">
                    <span className="flex items-center gap-2 text-ink-600"><span className="h-2.5 w-2.5 rounded-full" style={{ background: [CHART[2], CHART[5], CHART[6]][i] }} />{d.name}</span>
                    <span className="font-semibold text-ink-900">{formatNumber(d.value)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 font-bold text-ink-900">Department performance</h3>
          {deptData.length === 0 ? <EmptyState title="No department data" /> : (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={deptData} layout="vertical" margin={{ top: 0, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e7e5" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: '#86857f' }} axisLine={false} tickLine={false} unit="%" />
                <YAxis type="category" dataKey="name" width={110} tick={{ fontSize: 11, fill: '#55544f' }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: '#f6f6f5' }} />
                <Bar dataKey="rate" name="Completion %" radius={[0, 6, 6, 0]} barSize={16}>
                  {deptData.map((_, i) => <Cell key={i} fill={CHART[i % CHART.length]} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="font-bold text-ink-900">Top courses</h3>
            <Link to="/courses" className="text-xs font-semibold text-gold-600 hover:text-gold-700">View all</Link>
          </div>
          <div className="space-y-3">
            {data.topCourses.map((c) => (
              <div key={c.id} className="flex items-center gap-3">
                <CourseThumb courseId={c.id} title={c.title} className="h-12 w-16 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-ink-800">{c.title}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <ProgressBar value={c.avgProgress} className="h-1.5 flex-1" />
                    <span className="text-xs text-ink-400">{formatPercent(c.avgProgress)}</span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold text-ink-900">{c.enrollments}</p>
                  <p className="text-[11px] text-ink-400">enrolled</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-bold text-ink-900"><Activity className="h-4 w-4 text-gold-500" /> Recent activity</h3>
          <div className="space-y-3">
            {data.recentActivities.length === 0 ? <EmptyState title="No recent activity" /> : data.recentActivities.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold-400" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-700">{a.description}</p>
                  <p className="text-[11px] text-ink-400">{a.actor} · {relativeTime(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="flex items-center gap-2 font-bold text-ink-900"><AlertTriangle className="h-4 w-4 text-red-500" /> Overdue training</h3>
            <Link to="/assignments?overdue=true" className="text-xs font-semibold text-gold-600 hover:text-gold-700">View all</Link>
          </div>
          {data.overdueList.length === 0 ? <EmptyState title="Nothing overdue" message="All assigned training is on track." icon={<CheckCircle2 className="h-7 w-7" />} /> : (
            <div className="space-y-2.5">
              {data.overdueList.map((o) => (
                <div key={o.enrollmentId} className="flex items-center justify-between gap-3 rounded-xl bg-red-50/50 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-800">{o.employeeName}</p>
                    <p className="truncate text-xs text-ink-500">{o.courseTitle}</p>
                  </div>
                  <Badge tone="bg-red-100 text-red-700">Due {formatDate(o.dueDate)}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function MiniStat({ icon, label, value }: { icon: ReactNode; label: string; value: number }) {
  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-ink-50 text-ink-500">{icon}</span>
      <div>
        <p className="text-lg font-bold text-ink-950">{formatNumber(value)}</p>
        <p className="text-[11px] text-ink-400">{label}</p>
      </div>
    </Card>
  );
}

function LearnerView({ data }: { data: Extract<Dashboard, { role: 'learner' }> }) {
  const s = data.stats;
  const trend = data.learningTrend.map((m) => ({ ...m, label: formatMonth(m.month) }));
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Assigned" value={s.assigned} icon={<Layers className="h-5 w-5" />} accent="sky" />
        <StatCard label="In Progress" value={s.inProgress} icon={<BookOpen className="h-5 w-5" />} accent="gold" />
        <StatCard label="Completed" value={s.completed} icon={<CheckCircle2 className="h-5 w-5" />} accent="green" />
        <StatCard label="Overdue" value={s.overdue} icon={<AlertTriangle className="h-5 w-5" />} accent="red" />
        <StatCard label="Assessments" value={s.pendingAssessments} hint="Pending" icon={<ClipboardList className="h-5 w-5" />} accent="ink" />
        <StatCard label="Certificates" value={s.certificates} icon={<Award className="h-5 w-5" />} accent="gold" />
      </div>

      <Card className="p-5">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold text-ink-900">Continue learning</h3>
          <Link to="/learner" className="flex items-center gap-1 text-xs font-semibold text-gold-600 hover:text-gold-700">My courses <ArrowRight className="h-3.5 w-3.5" /></Link>
        </div>
        {data.inProgress.length === 0 ? (
          <EmptyState title="No courses in progress" message="Enroll in a course from the catalog to get started." icon={<GraduationCap className="h-7 w-7" />}
            action={<Link to="/learner/catalog"><Button variant="gold" size="sm">Browse catalog</Button></Link>} />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {data.inProgress.map((c) => (
              <Link key={c.enrollmentId} to={`/learner/courses/${c.courseId}`} className="group overflow-hidden rounded-2xl border border-ink-100 transition hover:border-gold-300 hover:shadow-md">
                <CourseThumb courseId={c.courseId} title={c.title} className="h-32 w-full" rounded="rounded-none" />
                <div className="p-4">
                  <p className="truncate text-sm font-semibold text-ink-800 group-hover:text-gold-700">{c.title}</p>
                  <div className="mt-3 flex items-center gap-2">
                    <ProgressBar value={c.progressPercent} className="flex-1" />
                    <span className="text-xs font-semibold text-ink-500">{formatPercent(c.progressPercent)}</span>
                  </div>
                  {c.dueDate && <p className={`mt-2 text-[11px] ${c.isOverdue ? 'text-red-600' : 'text-ink-400'}`}>{c.isOverdue ? 'Overdue · ' : 'Due '}{formatDate(c.dueDate)}</p>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <h3 className="mb-4 font-bold text-ink-900">Your learning trend</h3>
          {trend.length === 0 ? <EmptyState title="No completions yet" message="Your completed courses will chart here." /> : (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={trend} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="learnerFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e7e5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#86857f' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 12, fill: '#86857f' }} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="completed" name="Completed" stroke="#10b981" strokeWidth={2.5} fill="url(#learnerFill)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-bold text-ink-900"><CalendarClock className="h-4 w-4 text-gold-500" /> Upcoming deadlines</h3>
          {data.upcoming.length === 0 ? <EmptyState title="No upcoming deadlines" /> : (
            <div className="space-y-3">
              {data.upcoming.map((u) => (
                <Link key={u.enrollmentId} to={`/learner/courses/${u.courseId}`} className="flex items-center justify-between gap-2 rounded-xl border border-ink-100 px-3 py-2.5 hover:border-gold-300">
                  <span className="truncate text-sm font-medium text-ink-700">{u.title}</span>
                  <Badge tone="bg-gold-50 text-gold-700">{formatDate(u.dueDate)}</Badge>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </div>

      {data.recentCompleted.length > 0 && (
        <Card className="p-5">
          <h3 className="mb-4 flex items-center gap-2 font-bold text-ink-900"><Award className="h-4 w-4 text-gold-500" /> Recently completed</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.recentCompleted.map((c, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl bg-emerald-50/50 px-3 py-2.5">
                <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-ink-800">{c.title}</p>
                  <p className="text-[11px] text-ink-400">{formatDate(c.completedAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
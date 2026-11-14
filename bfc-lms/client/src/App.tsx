import { Navigate, Route, Routes, Link } from 'react-router-dom';
import type { ReactNode } from 'react';
import { ShieldAlert, Compass } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { LoadingBlock, Card, EmptyState, Button } from '@/components/ui';
import { AppLayout } from '@/components/layout/AppLayout';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { EmployeesPage } from '@/pages/EmployeesPage';
import { OrganizationPage } from '@/pages/OrganizationPage';
import { UsersPage } from '@/pages/UsersPage';
import { CoursesPage } from '@/pages/CoursesPage';
import { CourseBuilderPage } from '@/pages/CourseBuilderPage';
import { CourseDetailPage } from '@/pages/CourseDetailPage';
import { CategoriesPage } from '@/pages/CategoriesPage';
import { QuizzesPage } from '@/pages/QuizzesPage';
import { QuizBuilderPage } from '@/pages/QuizBuilderPage';
import { QuizAttemptsPage } from '@/pages/QuizAttemptsPage';
import { QuizGradingPage } from '@/pages/QuizGradingPage';
import { AttemptResultPage } from '@/pages/AttemptResultPage';
import { AssignmentsPage } from '@/pages/AssignmentsPage';
import { CertificatesPage } from '@/pages/CertificatesPage';
import { ReportsPage } from '@/pages/ReportsPage';
import { NotificationsPage } from '@/pages/NotificationsPage';
import { SettingsPage } from '@/pages/SettingsPage';
import { ProfilePage } from '@/pages/ProfilePage';
import { LearnerMyCoursesPage } from '@/pages/LearnerMyCoursesPage';
import { CatalogPage } from '@/pages/CatalogPage';
import { LearnerCertificatesPage } from '@/pages/LearnerCertificatesPage';
import { CoursePlayerPage } from '@/pages/CoursePlayerPage';
import { QuizTakerPage } from '@/pages/QuizTakerPage';

function RequireAuth({ children }: { children: ReactNode }) {
  const { auth, loading } = useAuth();
  if (loading) return <div className="flex min-h-screen items-center justify-center"><LoadingBlock label="Starting BFC Learning Hub…" /></div>;
  if (!auth) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function Guard({ perm, children }: { perm: string[]; children: ReactNode }) {
  const { has } = useAuth();
  if (!has(...perm)) {
    return (
      <Card>
        <EmptyState title="Access denied" message="Your role does not have permission to view this page." icon={<ShieldAlert className="h-7 w-7" />}
          action={<Link to="/"><Button variant="outline" icon={<Compass className="h-4 w-4" />}>Back to dashboard</Button></Link>} />
      </Card>
    );
  }
  return <>{children}</>;
}

function NotFound() {
  return (
    <Card>
      <EmptyState title="Page not found" message="The page you are looking for does not exist." icon={<Compass className="h-7 w-7" />}
        action={<Link to="/"><Button variant="outline">Back to dashboard</Button></Link>} />
    </Card>
  );
}

export default function App() {
  const { auth, loading } = useAuth();
  return (
    <Routes>
      <Route path="/login" element={loading ? null : auth ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route path="/" element={<DashboardPage />} />

        {/* People */}
        <Route path="/employees" element={<Guard perm={['employee.view']}><EmployeesPage /></Guard>} />
        <Route path="/organization" element={<Guard perm={['department.view', 'branch.view']}><OrganizationPage /></Guard>} />
        <Route path="/users" element={<Guard perm={['user.view']}><UsersPage /></Guard>} />

        {/* Courses */}
        <Route path="/courses" element={<Guard perm={['course.view']}><CoursesPage /></Guard>} />
        <Route path="/courses/new" element={<Guard perm={['course.create']}><CourseBuilderPage /></Guard>} />
        <Route path="/courses/:id" element={<Guard perm={['course.view']}><CourseDetailPage /></Guard>} />
        <Route path="/courses/:id/edit" element={<Guard perm={['course.update']}><CourseBuilderPage /></Guard>} />
        <Route path="/categories" element={<Guard perm={['category.view']}><CategoriesPage /></Guard>} />

        {/* Assessments */}
        <Route path="/quizzes" element={<Guard perm={['quiz.view']}><QuizzesPage /></Guard>} />
        <Route path="/quizzes/new" element={<Guard perm={['quiz.manage']}><QuizBuilderPage /></Guard>} />
        <Route path="/quizzes/attempts/:attemptId" element={<Guard perm={['quiz.view']}><AttemptResultPage /></Guard>} />
        <Route path="/quizzes/attempts/:attemptId/grade" element={<Guard perm={['quiz.grade']}><QuizGradingPage /></Guard>} />
        <Route path="/quizzes/:id/edit" element={<Guard perm={['quiz.manage']}><QuizBuilderPage /></Guard>} />
        <Route path="/quizzes/:id/attempts" element={<Guard perm={['quiz.view']}><QuizAttemptsPage /></Guard>} />

        {/* Training & insights */}
        <Route path="/assignments" element={<Guard perm={['enrollment.view']}><AssignmentsPage /></Guard>} />
        <Route path="/certificates" element={<Guard perm={['certificate.view']}><CertificatesPage /></Guard>} />
        <Route path="/reports" element={<Guard perm={['report.view']}><ReportsPage /></Guard>} />

        {/* System & account */}
        <Route path="/notifications" element={<Guard perm={['notification.view']}><NotificationsPage /></Guard>} />
        <Route path="/settings" element={<Guard perm={['settings.manage', 'audit.view', 'backup.manage']}><SettingsPage /></Guard>} />
        <Route path="/profile" element={<ProfilePage />} />

        {/* Learner */}
        <Route path="/learner" element={<Guard perm={['learner.learn']}><LearnerMyCoursesPage /></Guard>} />
        <Route path="/learner/catalog" element={<Guard perm={['learner.enroll']}><CatalogPage /></Guard>} />
        <Route path="/learner/certificates" element={<Guard perm={['certificate.view']}><LearnerCertificatesPage /></Guard>} />
        <Route path="/learner/courses/:courseId" element={<Guard perm={['learner.learn']}><CoursePlayerPage /></Guard>} />
        <Route path="/learner/quizzes/:quizId/take" element={<Guard perm={['learner.learn']}><QuizTakerPage /></Guard>} />
        <Route path="/learner/attempts/:attemptId" element={<Guard perm={['quiz.view']}><AttemptResultPage /></Guard>} />

        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
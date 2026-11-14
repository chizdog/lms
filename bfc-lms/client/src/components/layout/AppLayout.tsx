import { useState, type ReactNode } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard, Users, Building2, ShieldCheck, BookOpen, Tags, ClipboardList, CalendarClock,
  Award, BarChart3, Bell, Settings, GraduationCap, Library, Menu, X, LogOut, UserCircle2, ChevronDown, Coffee,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { isLearner, ROLE_LABELS } from '@/lib/access';
import { Avatar } from '@/components/ui';
import { NotificationBell } from './NotificationBell';

interface NavItem { to: string; label: string; icon: ReactNode; perm: string[]; end?: boolean }
interface NavSection { title: string; items: NavItem[] }

const I = (Icon: typeof LayoutDashboard) => <Icon className="h-[18px] w-[18px]" />;

const ADMIN_NAV: NavSection[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: I(LayoutDashboard), perm: ['dashboard.view'], end: true }] },
  {
    title: 'People',
    items: [
      { to: '/employees', label: 'Employees', icon: I(Users), perm: ['employee.view'] },
      { to: '/organization', label: 'Organization', icon: I(Building2), perm: ['department.view', 'branch.view'] },
      { to: '/users', label: 'Users & Roles', icon: I(ShieldCheck), perm: ['user.view'] },
    ],
  },
  {
    title: 'Learning',
    items: [
      { to: '/courses', label: 'Courses', icon: I(BookOpen), perm: ['course.view'] },
      { to: '/categories', label: 'Categories', icon: I(Tags), perm: ['category.view'] },
      { to: '/quizzes', label: 'Assessments', icon: I(ClipboardList), perm: ['quiz.view'] },
      { to: '/assignments', label: 'Assignments', icon: I(CalendarClock), perm: ['enrollment.view'] },
    ],
  },
  {
    title: 'Insights',
    items: [
      { to: '/certificates', label: 'Certificates', icon: I(Award), perm: ['certificate.view'] },
      { to: '/reports', label: 'Reports', icon: I(BarChart3), perm: ['report.view'] },
    ],
  },
  {
    title: 'System',
    items: [
      { to: '/notifications', label: 'Notifications', icon: I(Bell), perm: ['notification.view'] },
      { to: '/settings', label: 'Settings', icon: I(Settings), perm: ['settings.manage', 'audit.view', 'backup.manage'] },
    ],
  },
];

const LEARNER_NAV: NavSection[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', icon: I(LayoutDashboard), perm: ['dashboard.view'], end: true }] },
  {
    title: 'My Learning',
    items: [
      { to: '/learner', label: 'My Courses', icon: I(GraduationCap), perm: ['learner.learn'], end: true },
      { to: '/learner/catalog', label: 'Course Catalog', icon: I(Library), perm: ['learner.enroll'] },
      { to: '/learner/certificates', label: 'My Certificates', icon: I(Award), perm: ['certificate.view'] },
    ],
  },
  {
    title: 'Account',
    items: [
      { to: '/notifications', label: 'Notifications', icon: I(Bell), perm: ['notification.view'] },
      { to: '/profile', label: 'My Profile', icon: I(UserCircle2), perm: ['dashboard.view'] },
    ],
  },
];

function Brand() {
  return (
    <div className="flex items-center gap-3 px-5 py-5">
      <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gold-500 text-white shadow-sm">
        <Coffee className="h-5 w-5" />
      </span>
      <span className="leading-tight">
        <span className="block text-sm font-extrabold tracking-tight text-white">But First, Coffee</span>
        <span className="block text-[11px] font-medium uppercase tracking-widest text-gold-300">Learning Hub</span>
      </span>
    </div>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  const { auth, has } = useAuth();
  const sections = isLearner(auth) ? LEARNER_NAV : ADMIN_NAV;
  return (
    <div className="flex h-full flex-col bg-ink-950">
      <Brand />
      <nav className="flex-1 space-y-6 overflow-y-auto px-3 pb-6">
        {sections.map((section) => {
          const items = section.items.filter((item) => has(...item.perm));
          if (items.length === 0) return null;
          return (
            <div key={section.title}>
              <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-widest text-ink-500">{section.title}</p>
              <div className="space-y-1">
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.end} onClick={onNavigate}
                    className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-gold-500 text-white shadow-sm' : 'text-ink-300 hover:bg-white/5 hover:text-white'}`}>
                    {item.icon}
                    {item.label}
                  </NavLink>
                ))}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="border-t border-white/10 px-5 py-4">
        <p className="text-[11px] text-ink-500">© 2026 But First, Coffee</p>
        <p className="text-[11px] text-ink-600">Learning Management System</p>
      </div>
    </div>
  );
}

function UserMenu() {
  const { auth, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  if (!auth) return null;
  const name = `${auth.employee.firstName} ${auth.employee.lastName}`;
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2.5 rounded-xl py-1.5 pl-1.5 pr-2.5 transition hover:bg-ink-100">
        <Avatar name={name} size="sm" />
        <span className="hidden text-left sm:block">
          <span className="block text-sm font-semibold leading-tight text-ink-900">{name}</span>
          <span className="block text-[11px] leading-tight text-ink-400">{ROLE_LABELS[auth.roleCode] ?? auth.roleName}</span>
        </span>
        <ChevronDown className="hidden h-4 w-4 text-ink-400 sm:block" />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-40 mt-2 w-56 overflow-hidden rounded-2xl border border-ink-100 bg-white py-1.5 shadow-xl">
            <div className="border-b border-ink-100 px-4 py-3">
              <p className="text-sm font-semibold text-ink-900">{name}</p>
              <p className="truncate text-xs text-ink-400">{auth.employee.email}</p>
            </div>
            <button onClick={() => { setOpen(false); navigate('/profile'); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-ink-600 hover:bg-ink-50">
              <UserCircle2 className="h-4 w-4" /> My Profile
            </button>
            <button onClick={() => { setOpen(false); void logout().then(() => navigate('/login')); }} className="flex w-full items-center gap-2.5 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50">
              <LogOut className="h-4 w-4" /> Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export function AppLayout() {
  const [mobileOpen, setMobileOpen] = useState(false);
  return (
    <div className="flex min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 lg:block">
        <SidebarContent />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-sm" onClick={() => setMobileOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 animate-[slideIn_.2s_ease-out]">
            <button onClick={() => setMobileOpen(false)} className="absolute right-3 top-5 z-10 text-ink-400 hover:text-white"><X className="h-5 w-5" /></button>
            <SidebarContent onNavigate={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-ink-100 bg-white/85 px-4 backdrop-blur-md sm:px-6">
          <button onClick={() => setMobileOpen(true)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-ink-600 hover:bg-ink-100 lg:hidden" aria-label="Open menu">
            <Menu className="h-5 w-5" />
          </button>
          <div className="hidden items-center gap-2 text-sm text-ink-400 lg:flex">
            <span className="font-semibold text-ink-700">BFC Learning Management System</span>
          </div>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <div className="mx-1 hidden h-6 w-px bg-ink-100 sm:block" />
            <UserMenu />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <div className="mx-auto max-w-7xl">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Coffee, Eye, EyeOff, GraduationCap, ShieldCheck, BarChart3, Award, ArrowRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { ApiError } from '@/lib/api';
import { Button, Input, Field } from '@/components/ui';

const DEMO_ACCOUNTS = [
  { label: 'Super Admin', identifier: 'superadmin', desc: 'IT · full access' },
  { label: 'L&D Admin', identifier: 'ld.admin', desc: 'Courses & training' },
  { label: 'HR Admin', identifier: 'hr.admin', desc: 'People & compliance' },
  { label: 'Dept Trainer', identifier: 'dept.admin', desc: 'Department scope' },
  { label: 'Employee', identifier: 'employee', desc: 'Learner experience' },
];

const FEATURES = [
  { icon: <GraduationCap className="h-5 w-5" />, title: 'Structured learning', text: 'Courses, modules and multimedia lessons for every branch.' },
  { icon: <ShieldCheck className="h-5 w-5" />, title: 'Role-based access', text: 'Scoped dashboards for IT, L&D, HR, trainers and staff.' },
  { icon: <BarChart3 className="h-5 w-5" />, title: 'Live analytics', text: 'Completion, compliance and assessment insights in real time.' },
  { icon: <Award className="h-5 w-5" />, title: 'Certification', text: 'Auto-issued, downloadable certificates on completion.' },
];

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const auth = await login(identifier.trim(), password);
      navigate(auth.mustChangePassword ? '/profile' : '/', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to sign in. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const quickFill = (id: string) => {
    setIdentifier(id);
    setPassword('Bfc@2026');
    setError('');
  };

  return (
    <div className="flex min-h-screen">
      {/* Brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden bg-ink-950 p-12 lg:flex">
        <div className="pointer-events-none absolute inset-0">
          <div className="absolute -left-24 -top-24 h-96 w-96 rounded-full bg-gold-500/20 blur-3xl" />
          <div className="absolute bottom-0 right-0 h-[28rem] w-[28rem] translate-x-1/3 translate-y-1/3 rounded-full bg-gold-600/15 blur-3xl" />
          <div className="absolute inset-0 opacity-[0.04]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, white 1px, transparent 0)', backgroundSize: '28px 28px' }} />
        </div>

        <div className="relative flex items-center gap-3">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gold-500 text-white"><Coffee className="h-6 w-6" /></span>
          <div>
            <p className="text-lg font-extrabold tracking-tight text-white">But First, Coffee</p>
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-gold-300">Learning Hub</p>
          </div>
        </div>

        <div className="relative">
          <h1 className="max-w-md text-4xl font-extrabold leading-tight tracking-tight text-white">
            Grow your team,<br /><span className="text-gold-400">one cup at a time.</span>
          </h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-300">
            The centralized training platform for BFC corporate, branch and franchise teams — from espresso craft to compliance.
          </p>
          <div className="mt-10 grid grid-cols-2 gap-5">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-2xl border border-white/10 bg-white/5 p-4 backdrop-blur-sm">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gold-500/20 text-gold-300">{f.icon}</span>
                <p className="mt-3 text-sm font-semibold text-white">{f.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-ink-400">{f.text}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-ink-500">© 2026 But First, Coffee · Learning & Development</p>
      </div>

      {/* Form panel */}
      <div className="flex flex-1 items-center justify-center bg-surface px-6 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 flex items-center gap-3 lg:hidden">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gold-500 text-white"><Coffee className="h-5 w-5" /></span>
            <div>
              <p className="text-base font-extrabold tracking-tight text-ink-950">But First, Coffee</p>
              <p className="text-[11px] font-medium uppercase tracking-widest text-gold-600">Learning Hub</p>
            </div>
          </div>

          <h2 className="text-2xl font-bold tracking-tight text-ink-950">Welcome back</h2>
          <p className="mt-1 text-sm text-ink-500">Sign in to continue to your learning dashboard.</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <Field label="Username or email" required>
              <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} placeholder="e.g. superadmin" autoComplete="username" required />
            </Field>
            <Field label="Password" required>
              <div className="relative">
                <Input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" autoComplete="current-password" required className="pr-11" />
                <button type="button" onClick={() => setShowPassword((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700" aria-label={showPassword ? 'Hide password' : 'Show password'}>
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </Field>

            {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}

            <Button type="submit" variant="gold" loading={loading} className="w-full" icon={!loading ? <ArrowRight className="h-4 w-4" /> : undefined}>
              Sign in
            </Button>
          </form>

          <div className="mt-8">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-ink-400">Demo accounts · password Bfc@2026</p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {DEMO_ACCOUNTS.map((a) => (
                <button key={a.identifier} onClick={() => quickFill(a.identifier)} type="button"
                  className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition hover:border-gold-400 hover:bg-gold-50 ${identifier === a.identifier ? 'border-gold-500 bg-gold-50' : 'border-ink-200 bg-white'}`}>
                  <span>
                    <span className="block text-sm font-semibold text-ink-800">{a.label}</span>
                    <span className="block text-[11px] text-ink-400">{a.desc}</span>
                  </span>
                  <span className="text-[11px] font-medium text-ink-300">{a.identifier}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Award, Download, Coffee } from 'lucide-react';
import { api, downloadFile } from '@/lib/api';
import type { MyCertificate } from '@/lib/types';
import { formatDate, formatPercent } from '@/lib/format';
import { PageHeader, Card, Button, LoadingBlock, EmptyState } from '@/components/ui';

export function LearnerCertificatesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['my-certificates'], queryFn: () => api.get<{ items: MyCertificate[] }>('/learning/my-certificates') });
  const items = data?.items ?? [];

  return (
    <div>
      <PageHeader title="My Certificates" subtitle="Download certificates for your completed training." />
      {isLoading ? <Card><LoadingBlock /></Card> : items.length === 0 ? (
        <Card><EmptyState title="No certificates yet" message="Complete a course and its assessments to earn your first certificate." icon={<Award className="h-7 w-7" />}
          action={<Link to="/learner"><Button variant="gold" size="sm">View my courses</Button></Link>} /></Card>
      ) : (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((c) => (
            <Card key={c.id} className="overflow-hidden p-0">
              <div className="relative flex h-32 items-center justify-center bg-gradient-to-br from-ink-900 to-ink-950">
                <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #C8952F 1px, transparent 0)', backgroundSize: '18px 18px' }} />
                <div className="relative text-center">
                  <Award className="mx-auto h-9 w-9 text-gold-400" />
                  <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-gold-300">Certificate</p>
                </div>
                <Coffee className="absolute right-3 top-3 h-5 w-5 text-white/20" />
              </div>
              <div className="p-4">
                <p className="font-mono text-xs font-semibold text-gold-700">{c.certificateNumber}</p>
                <h3 className="mt-1 line-clamp-2 font-bold text-ink-900">{c.courseTitle}</h3>
                <div className="mt-2 space-y-0.5 text-xs text-ink-500">
                  <p>Completed {formatDate(c.completionDate)}</p>
                  {c.score !== null && <p>Score {formatPercent(c.score)}</p>}
                </div>
                <Button variant="gold" size="sm" className="mt-3 w-full" icon={<Download className="h-4 w-4" />}
                  onClick={() => void downloadFile(`/certificates/${c.id}/download`, `${c.certificateNumber}.pdf`)}>Download PDF</Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
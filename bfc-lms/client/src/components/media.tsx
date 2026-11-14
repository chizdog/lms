import { useState } from 'react';
import { Coffee } from 'lucide-react';

export function thumbUrl(courseId: number): string {
  return `/api/courses/${courseId}/thumbnail`;
}

export function CourseThumb({ courseId, title, className = '', rounded = 'rounded-xl' }: { courseId?: number | null; title: string; className?: string; rounded?: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = courseId && !failed;
  return (
    <div className={`relative overflow-hidden bg-gradient-to-br from-ink-800 to-ink-950 ${rounded} ${className}`}>
      {showImage ? (
        <img src={thumbUrl(courseId)} alt={title} loading="lazy" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, #C8952F 1px, transparent 0)', backgroundSize: '20px 20px' }} />
          <Coffee className="relative h-8 w-8 text-gold-500/70" />
        </div>
      )}
    </div>
  );
}
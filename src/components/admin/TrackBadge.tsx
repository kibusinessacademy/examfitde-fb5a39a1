import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { BookOpen, Target } from 'lucide-react';
import type { ProductTrack, CertificationType } from '@/hooks/useTrackConfig';
import { CERT_TYPE_LABELS, TRACK_LABELS } from '@/hooks/useTrackConfig';

interface TrackBadgeProps {
  track?: string;
  certType?: string;
  showCertType?: boolean;
  size?: 'sm' | 'xs';
}

export default function TrackBadge({ track, certType, showCertType = false, size = 'xs' }: TrackBadgeProps) {
  const t = (track || 'AUSBILDUNG_VOLL') as ProductTrack;
  const isExamFirst = t === 'EXAM_FIRST';
  const textSize = size === 'sm' ? 'text-xs' : 'text-[10px]';

  return (
    <span className="inline-flex items-center gap-1">
      <Badge
        variant="outline"
        className={cn(
          textSize,
          isExamFirst
            ? 'bg-accent/20 text-accent-foreground border-accent/40'
            : 'bg-primary/10 text-primary border-primary/30'
        )}
      >
        {isExamFirst ? <Target className="h-3 w-3 mr-0.5" /> : <BookOpen className="h-3 w-3 mr-0.5" />}
        {TRACK_LABELS[t]}
      </Badge>
      {showCertType && certType && (
        <Badge variant="outline" className={cn(textSize, 'text-muted-foreground')}>
          {CERT_TYPE_LABELS[certType as CertificationType] || certType}
        </Badge>
      )}
    </span>
  );
}

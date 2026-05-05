import { useState, useEffect, useRef } from 'react';
import { Badge } from '@/components/ui/badge';
import { Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExamTimerProps {
  timeLimitMinutes: number;
  startedAt: string;
  onTimeUp?: () => void;
}

export function ExamTimer({ timeLimitMinutes, startedAt, onTimeUp }: ExamTimerProps) {
  const [remaining, setRemaining] = useState<number>(0);
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;

  useEffect(() => {
    const endTime = new Date(startedAt).getTime() + timeLimitMinutes * 60 * 1000;

    const tick = () => {
      const left = Math.max(0, Math.floor((endTime - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) onTimeUpRef.current?.();
    };

    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [timeLimitMinutes, startedAt]);

  const totalSeconds = timeLimitMinutes * 60;
  const pct = totalSeconds > 0 ? remaining / totalSeconds : 0;
  const isLast20 = pct <= 0.2;
  const isLast5 = remaining <= 300;

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  return (
    <Badge
      variant="secondary"
      className={cn(
        'gap-1.5 text-sm font-mono tabular-nums transition-colors',
        isLast5 && 'bg-destructive-bg-subtle text-destructive animate-pulse',
        isLast20 && !isLast5 && 'bg-yellow-500/20 text-yellow-600 dark:text-yellow-400',
      )}
    >
      {isLast20 ? (
        <AlertTriangle className="h-3.5 w-3.5" />
      ) : (
        <Clock className="h-3.5 w-3.5" />
      )}
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </Badge>
  );
}

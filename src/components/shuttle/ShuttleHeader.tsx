import { Zap, Flame, Star } from 'lucide-react';
import type { ShuttleStats } from '@/hooks/useShuttleMode';

interface ShuttleHeaderProps {
  stats: ShuttleStats;
  onEnd: () => void;
  onBack: () => void;
}

export function ShuttleHeader({ stats, onEnd, onBack }: ShuttleHeaderProps) {
  return (
    <header className="flex items-center justify-between px-4 py-3 border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
      <button
        onClick={() => { onEnd(); onBack(); }}
        className="p-2 -ml-2 text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Zurück"
      >
        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
      </button>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1">
          <Zap className="h-3.5 w-3.5 text-primary" />
          <span className="text-sm font-semibold text-foreground tabular-nums">
            {stats.questions_answered}
          </span>
        </div>

        {stats.current_streak > 0 && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/20">
            <Flame className="h-3 w-3 text-orange-500" />
            <span className="text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums">
              {stats.current_streak}
            </span>
          </div>
        )}

        {stats.xp_earned > 0 && (
          <div className="flex items-center gap-1">
            <Star className="h-3 w-3 text-primary" />
            <span className="text-xs font-semibold text-primary tabular-nums">
              {stats.xp_earned}
            </span>
          </div>
        )}
      </div>

      <div className="text-sm text-muted-foreground tabular-nums min-w-[60px] text-right">
        {stats.questions_answered > 0 && (
          <span className="text-green-600 dark:text-green-400 font-medium">{stats.accuracy}%</span>
        )}
      </div>
    </header>
  );
}

import { Zap, Flame, Target, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ShuttleModeTabs } from './ShuttleModeTabs';
import type { ShuttleMode, ShuttleDashboardSummary } from '@/hooks/useShuttleMode';

interface ShuttleEntryCardProps {
  mode: ShuttleMode;
  onModeChange: (mode: ShuttleMode) => void;
  onStart: (mode: ShuttleMode) => void;
  summary: ShuttleDashboardSummary | null;
  loading?: boolean;
}

export function ShuttleEntryCard({ mode, onModeChange, onStart, summary, loading }: ShuttleEntryCardProps) {
  return (
    <div className="flex flex-col gap-5 w-full max-w-lg mx-auto px-4">
      {/* Hero */}
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-primary/10 mb-4">
          <Zap className="h-8 w-8 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground">Schnelltraining</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Trainiere gezielt und effizient — eine Frage nach der anderen.
        </p>
      </div>

      {/* Stats Pills */}
      {summary && (
        <div className="grid grid-cols-3 gap-2">
          <div className="bg-card rounded-xl p-3 border text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Target className="h-3.5 w-3.5 text-primary" />
            </div>
            <p className="text-lg font-bold text-foreground tabular-nums">{summary.today_answered}</p>
            <p className="text-[11px] text-muted-foreground">Heute</p>
          </div>
          <div className="bg-card rounded-xl p-3 border text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <Flame className="h-3.5 w-3.5 text-orange-500" />
            </div>
            <p className="text-lg font-bold text-foreground tabular-nums">{summary.current_streak}</p>
            <p className="text-[11px] text-muted-foreground">Streak</p>
          </div>
          <div className="bg-card rounded-xl p-3 border text-center">
            <div className="flex items-center justify-center gap-1 mb-1">
              <TrendingUp className="h-3.5 w-3.5 text-green-500" />
            </div>
            <p className="text-lg font-bold text-foreground tabular-nums">{summary.today_accuracy}%</p>
            <p className="text-[11px] text-muted-foreground">Quote</p>
          </div>
        </div>
      )}

      {/* Weakest Competency Hint */}
      {summary?.weakest_competency && (
        <div className="bg-amber-50 dark:bg-amber-900/10 rounded-xl p-3 border border-amber-200 dark:border-amber-800">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
            Schwächste Kompetenz: <span className="font-semibold">{summary.weakest_competency.title}</span> ({summary.weakest_competency.score}%)
          </p>
        </div>
      )}

      {/* Mode Selector */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Trainingsmodus</p>
        <ShuttleModeTabs
          selected={mode}
          onSelect={onModeChange}
          recommended={summary?.recommended_mode}
        />
      </div>

      {/* Start CTA */}
      <Button
        onClick={() => onStart(mode)}
        size="lg"
        className="w-full text-base h-12"
        disabled={loading}
      >
        <Zap className="mr-2 h-5 w-5" />
        Jetzt trainieren
      </Button>
    </div>
  );
}

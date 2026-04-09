import { Trophy, Zap, Target, Flame, Star, ArrowRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ShuttleStats, ShuttleMode } from '@/hooks/useShuttleMode';

interface ShuttleSessionSummaryProps {
  stats: ShuttleStats;
  mode: ShuttleMode;
  onRestart: () => void;
  onExit: () => void;
}

const MODE_LABELS: Record<ShuttleMode, string> = {
  adaptive: 'Adaptiv',
  random: 'Zufall',
  weakness: 'Schwächen',
  speed: 'Speed',
  exam_lite: 'Prüfung',
};

export function ShuttleSessionSummary({ stats, mode, onRestart, onExit }: ShuttleSessionSummaryProps) {
  const grade = stats.accuracy >= 80 ? 'Stark!' : stats.accuracy >= 60 ? 'Solide!' : 'Weiter üben!';
  const gradeEmoji = stats.accuracy >= 80 ? '🏆' : stats.accuracy >= 60 ? '💪' : '📚';

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-sm mx-auto px-4 text-center animate-in fade-in zoom-in-95 duration-500">
      {/* Trophy */}
      <div className="relative">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Trophy className="h-10 w-10 text-primary" />
        </div>
      </div>

      {/* Headline */}
      <div>
        <h2 className="text-2xl font-bold text-foreground">{gradeEmoji} {grade}</h2>
        <p className="text-sm text-muted-foreground mt-1">
          {MODE_LABELS[mode]}-Training abgeschlossen
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3 w-full">
        <div className="bg-card rounded-2xl p-4 border text-center">
          <Target className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-foreground tabular-nums">{stats.questions_answered}</p>
          <p className="text-xs text-muted-foreground">Fragen</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border text-center">
          <div className="h-5 w-5 mx-auto mb-1 text-green-500 font-bold text-lg leading-5">✓</div>
          <p className="text-2xl font-bold text-green-600 tabular-nums">{stats.accuracy}%</p>
          <p className="text-xs text-muted-foreground">Quote</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border text-center">
          <Flame className="h-5 w-5 text-orange-500 mx-auto mb-1" />
          <p className="text-2xl font-bold text-foreground tabular-nums">{stats.best_streak}</p>
          <p className="text-xs text-muted-foreground">Beste Serie</p>
        </div>
        <div className="bg-card rounded-2xl p-4 border text-center">
          <Star className="h-5 w-5 text-primary mx-auto mb-1" />
          <p className="text-2xl font-bold text-primary tabular-nums">+{stats.xp_earned}</p>
          <p className="text-xs text-muted-foreground">XP</p>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2 w-full mt-2">
        <Button onClick={onRestart} className="w-full h-12" size="lg">
          <RotateCcw className="mr-2 h-4 w-4" /> Nochmal trainieren
        </Button>
        <Button onClick={onExit} variant="outline" className="w-full">
          Zurück zum Dashboard
        </Button>
      </div>
    </div>
  );
}

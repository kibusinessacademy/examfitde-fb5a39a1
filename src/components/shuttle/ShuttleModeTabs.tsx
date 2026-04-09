import { Zap, Shuffle, Target, Timer, BookOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ShuttleMode } from '@/hooks/useShuttleMode';

const MODES: { key: ShuttleMode; label: string; icon: React.ElementType; desc: string }[] = [
  { key: 'adaptive', label: 'Adaptiv', icon: Zap, desc: 'Intelligente Auswahl' },
  { key: 'random', label: 'Zufall', icon: Shuffle, desc: 'Zufällige Fragen' },
  { key: 'weakness', label: 'Schwächen', icon: Target, desc: 'Fokus auf Lücken' },
  { key: 'speed', label: 'Speed', icon: Timer, desc: 'Schnelles Drill' },
  { key: 'exam_lite', label: 'Prüfung', icon: BookOpen, desc: 'Prüfungsnah' },
];

interface ShuttleModeTabsProps {
  selected: ShuttleMode;
  onSelect: (mode: ShuttleMode) => void;
  recommended?: ShuttleMode;
}

export function ShuttleModeTabs({ selected, onSelect, recommended }: ShuttleModeTabsProps) {
  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {MODES.map(({ key, label, icon: Icon }) => (
        <button
          key={key}
          onClick={() => onSelect(key)}
          className={cn(
            "flex items-center gap-1.5 px-3 py-2 rounded-xl text-sm font-medium whitespace-nowrap transition-all",
            "border",
            selected === key
              ? "bg-primary text-primary-foreground border-primary shadow-sm"
              : "bg-card text-muted-foreground border-border hover:border-primary/30 hover:text-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
          {recommended === key && selected !== key && (
            <span className="ml-1 text-[10px] px-1 py-0.5 rounded bg-primary/10 text-primary font-semibold">
              Empfohlen
            </span>
          )}
        </button>
      ))}
    </div>
  );
}

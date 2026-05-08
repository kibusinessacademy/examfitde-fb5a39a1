interface Props {
  current: number;
  total: number;
}

export function QuizProgressBar({ current, total }: Props) {
  const pct = Math.round(((current + 1) / total) * 100);
  return (
    <div
      className="w-full"
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      aria-label={`Prüfungsreife-Check Fortschritt: Frage ${Math.min(current + 1, total)} von ${total}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-text-secondary">
          Frage {Math.min(current + 1, total)} von {total}
        </span>
        <span className="text-xs font-medium text-text-secondary">
          {pct} %
        </span>
      </div>
      <div className="flex gap-1">
        {Array.from({ length: total }).map((_, i) => (
          <div
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${
              i < current ? "bg-primary" : i === current ? "bg-primary/60" : "bg-surface-sunken"
            }`}
          />
        ))}
      </div>
    </div>
  );
}

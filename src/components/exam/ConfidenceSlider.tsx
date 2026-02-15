import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';

interface ConfidenceSliderProps {
  value: number;
  onChange: (val: number) => void;
  disabled?: boolean;
}

const LABELS = [
  { max: 25, text: 'Geraten', color: 'text-destructive' },
  { max: 50, text: 'Unsicher', color: 'text-yellow-500' },
  { max: 75, text: 'Ziemlich sicher', color: 'text-blue-500' },
  { max: 100, text: 'Sehr sicher', color: 'text-green-500' },
];

export function ConfidenceSlider({ value, onChange, disabled }: ConfidenceSliderProps) {
  const label = LABELS.find(l => value <= l.max) || LABELS[3];

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">Wie sicher bist du?</span>
        <span className={cn('font-medium', label.color)}>
          {label.text} ({value}%)
        </span>
      </div>
      <Slider
        value={[value]}
        onValueChange={([v]) => onChange(v)}
        min={0}
        max={100}
        step={5}
        disabled={disabled}
        className="w-full"
      />
    </div>
  );
}

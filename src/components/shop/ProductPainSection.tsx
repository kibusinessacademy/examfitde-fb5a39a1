import { AlertTriangle, XCircle } from 'lucide-react';

interface Props {
  cleanTitle: string;
}

const PAIN_POINTS = [
  'Zu viel Theorie, zu wenig Prüfungspraxis',
  'Keine echten Prüfungsfragen zum Üben',
  'Unsicherheit: „Reicht das, was ich kann?"',
];

export function ProductPainSection({ cleanTitle }: Props) {
  return (
    <section className="py-12 md:py-16 bg-destructive/5 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-3xl mx-auto px-4 text-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-destructive/10 text-destructive mb-6">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm font-medium">Die Realität</span>
        </div>

        <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
          Viele {cleanTitle} lernen monatelang – und fallen trotzdem durch.
        </h2>

        <div className="space-y-3 mt-8 max-w-md mx-auto text-left">
          {PAIN_POINTS.map((point) => (
            <div key={point} className="flex items-start gap-3 text-base">
              <XCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <span>{point}</span>
            </div>
          ))}
        </div>

        <p className="mt-8 text-muted-foreground text-lg">
          → Ergebnis: <strong className="text-foreground">Stress, Zweifel oder Durchfallen</strong>
        </p>
      </div>
    </section>
  );
}

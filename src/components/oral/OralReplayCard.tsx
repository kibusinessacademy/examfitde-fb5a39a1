import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Activity, Clock, MessageSquare, Sparkles, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface TurnMetric {
  /** Question index (0-based). */
  questionIndex: number;
  /** Word count of the submitted answer. */
  answerWords: number;
  /** Time from question shown → answer submitted (ms). */
  responseMs: number;
  /** Did this turn receive a follow-up question? */
  hadFollowUp: boolean;
}

interface Props {
  turns: TurnMetric[];
  durationMs: number | null;
  className?: string;
}

/**
 * Cinematic Replay-Karte am Session-Ende.
 *
 * Verhaltens-Insights statt Score-Wiederholung. Erzeugt eine knappe Erzählung
 * darüber, *wie* der Lernende geantwortet hat — Reaktionszeit, Antwortlänge,
 * Follow-up-Quote, Konsistenz. Datenbasis: client-seitig getrackte Turn-Metriken
 * (kein neuer Tabellen-Schreibpfad).
 */
export function OralReplayCard({ turns, durationMs, className }: Props) {
  if (!turns.length) return null;

  const totalTurns = turns.length;
  const avgWords = Math.round(turns.reduce((s, t) => s + t.answerWords, 0) / totalTurns);
  const avgResponseSec = Math.round(turns.reduce((s, t) => s + t.responseMs, 0) / totalTurns / 1000);
  const followUps = turns.filter((t) => t.hadFollowUp).length;
  const followUpRate = Math.round((followUps / totalTurns) * 100);

  // Variation in answer length — coarse proxy for adaptability
  const lengths = turns.map((t) => t.answerWords);
  const variance = lengths.reduce((s, x) => s + Math.pow(x - avgWords, 2), 0) / totalTurns;
  const stdev = Math.sqrt(variance);
  const consistency = avgWords > 0 ? Math.max(0, 1 - stdev / Math.max(avgWords, 1)) : 0;

  const durationMin = durationMs ? Math.max(1, Math.round(durationMs / 60000)) : null;

  // Narrative-Snippets — deterministisch aus Metriken
  const snippets: string[] = [];
  if (avgResponseSec < 5) snippets.push("Du hast sehr schnell reagiert — gut für Souveränität, aber prüfe, ob du auch genug überlegst.");
  else if (avgResponseSec > 20) snippets.push("Du hast dir Zeit zum Überlegen genommen — strukturiert, aber Prüfer erwarten oft schnellere Antworten.");
  else snippets.push("Deine Reaktionszeit war prüfungsgerecht.");

  if (avgWords < 20) snippets.push("Deine Antworten waren eher kurz — übe längere, strukturierte Ausführungen.");
  else if (avgWords > 80) snippets.push("Deine Antworten waren sehr ausführlich — übe knappe, präzise Formulierungen.");
  else snippets.push("Deine Antwortlänge war angemessen.");

  if (followUpRate >= 60) snippets.push(`Bei ${followUpRate}% deiner Antworten hat der Prüfer nachgefragt — typisches Zeichen für oberflächliche Antworten.`);
  else if (followUpRate > 0) snippets.push(`Bei ${followUpRate}% gab es Nachfragen — du hast überwiegend vollständig geantwortet.`);

  if (consistency > 0.7) snippets.push("Deine Antworten waren in der Länge sehr konsistent.");

  return (
    <Card className={cn("glass-card premium-reveal", className)}>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Dein Prüfungs-Replay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Metrik-Strip */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 premium-stagger">
          <MetricTile
            icon={<MessageSquare className="h-4 w-4" />}
            label="Turns"
            value={String(totalTurns)}
          />
          <MetricTile
            icon={<Clock className="h-4 w-4" />}
            label="Ø Reaktion"
            value={`${avgResponseSec}s`}
          />
          <MetricTile
            icon={<Activity className="h-4 w-4" />}
            label="Ø Antwortlänge"
            value={`${avgWords} W`}
          />
          <MetricTile
            icon={<TrendingUp className="h-4 w-4" />}
            label="Nachfragen"
            value={`${followUpRate}%`}
            tone={followUpRate >= 60 ? "warn" : "ok"}
          />
        </div>

        {/* Erzählung */}
        <div className="rounded-lg border border-border-subtle bg-surface-sunken p-4 space-y-2">
          <div className="text-xs uppercase tracking-wide text-text-tertiary">Verhaltens-Insights</div>
          {snippets.map((s, i) => (
            <p key={i} className="text-sm text-text-primary leading-relaxed">
              <span className="text-primary mr-2">•</span>
              {s}
            </p>
          ))}
        </div>

        {durationMin != null && (
          <div className="text-xs text-text-secondary text-center">
            Gesamtdauer: <Badge variant="outline" className="ml-1">{durationMin} min</Badge>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MetricTile({
  icon, label, value, tone = "neutral",
}: { icon: React.ReactNode; label: string; value: string; tone?: "neutral" | "ok" | "warn" }) {
  return (
    <div className={cn(
      "rounded-lg border p-3 premium-lift transition-colors",
      tone === "warn"
        ? "border-status-warning-border bg-status-warning-bg-subtle"
        : tone === "ok"
        ? "border-status-success-border bg-status-success-bg-subtle"
        : "border-border-subtle bg-surface-raised",
    )}>
      <div className="flex items-center gap-1.5 text-xs text-text-secondary mb-1">
        {icon}
        {label}
      </div>
      <div className="text-xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}

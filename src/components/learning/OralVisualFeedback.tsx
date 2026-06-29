/**
 * Learner-safe Renderer für strukturelles Oral-Visual-Feedback (Cut 9).
 *
 * Harte Regeln (siehe oral-visual-policy.ts):
 *  - keine DB-/HTTP-Aufrufe, keine Mutationen, keine AI-Aufrufe
 *  - keine eigene Bewertung; nur Anzeige vorbereiteter Projection
 *  - keine Aussagen zu Prüfungsergebnis oder Prüfungsreife
 *  - keine internen Workflow-/Backstage-Texte
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, HelpCircle, Sparkles } from "lucide-react";
import type {
  OralVisualLearnerHint,
  OralVisualLearnerProjection,
} from "@/lib/visual-learning-os/oral-visual-feedback";

interface Props {
  projection?: OralVisualLearnerProjection;
}

function iconFor(kind: OralVisualLearnerHint["kind"]) {
  switch (kind) {
    case "structure_aligned":
    case "good_practice_reference":
      return <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden />;
    case "misconception_risk":
      return <AlertCircle className="h-4 w-4 text-destructive" aria-hidden />;
    case "needs_followup_question":
      return <HelpCircle className="h-4 w-4 text-muted-foreground" aria-hidden />;
    default:
      return <Sparkles className="h-4 w-4 text-muted-foreground" aria-hidden />;
  }
}

function badgeLabelFor(kind: OralVisualLearnerHint["kind"]) {
  switch (kind) {
    case "key_node_missing":
      return "Fehlender Kernpunkt";
    case "relation_missing":
      return "Fehlende Beziehung";
    case "misconception_risk":
      return "Typische Verwechslung";
    case "structure_aligned":
      return "Gut erkennbare Struktur";
    case "answer_too_unstructured":
      return "Wenig Struktur";
    case "needs_followup_question":
      return "Rückfrage sinnvoll";
    case "good_practice_reference":
      return "Gutes Antwortmuster";
  }
}

export function OralVisualFeedback({ projection }: Props) {
  const empty =
    !projection ||
    !projection.learner_visible ||
    projection.empty ||
    projection.hints.length === 0;

  return (
    <Card aria-label="Struktur deiner Antwort" className="rounded-2xl">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-display">
          Struktur deiner Antwort
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          Diese Hinweise zeigen dir, welche Zusammenhänge in deiner Antwort
          wichtig waren.
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {empty ? (
          <p className="text-sm text-muted-foreground">
            Für diese Antwort liegt noch kein visuelles Strukturfeedback vor.
          </p>
        ) : (
          <ul className="space-y-2" aria-label="Strukturhinweise">
            {projection!.hints.map((h, i) => (
              <li
                key={`${h.kind}-${i}`}
                className="flex items-start gap-2 rounded-xl border bg-card/50 p-3"
              >
                <div className="mt-0.5 shrink-0">{iconFor(h.kind)}</div>
                <div className="min-w-0 space-y-1">
                  <Badge
                    variant="secondary"
                    className="text-[11px] px-2 py-0.5"
                  >
                    {badgeLabelFor(h.kind)}
                  </Badge>
                  <p className="text-sm leading-snug">{h.message}</p>
                  <p className="sr-only">{h.text_alt}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

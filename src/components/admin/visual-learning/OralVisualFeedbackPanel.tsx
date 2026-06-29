/**
 * Admin Renderer für Oral-Visual-Feedback (Cut 9).
 *
 * Reine Anzeige der Admin-Projection. Keine Mutationen, keine AI-Aufrufe,
 * keine eigene Signalberechnung. Kein direkter Table-Read.
 */
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { OralVisualAdminProjection } from "@/lib/visual-learning-os/oral-visual-feedback";

interface Props {
  projection: OralVisualAdminProjection;
}

function listOrDash(arr: string[]) {
  return arr.length === 0 ? "—" : arr.join(", ");
}

export function OralVisualFeedbackPanel({ projection }: Props) {
  return (
    <Card className="rounded-2xl">
      <CardHeader>
        <CardTitle className="text-base">Oral Visual Feedback (Strukturfeedback)</CardTitle>
        <p className="text-xs text-muted-foreground">{projection.note}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <section className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
          <Field label="oral_question_id" value={projection.oral_question_id} />
          <Field label="competence_id" value={projection.competence_id} />
          <Field
            label="visual_artifact_id"
            value={projection.visual_artifact_id ?? "—"}
          />
        </section>

        <Separator />

        <section className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
          <Field
            label="Erwartete Nodes"
            value={listOrDash(projection.expected_node_ids)}
          />
          <Field
            label="Abgedeckte Nodes"
            value={listOrDash(projection.covered_node_ids)}
          />
          <Field
            label="Erwartete Edges"
            value={listOrDash(projection.expected_edge_ids)}
          />
          <Field
            label="Abgedeckte Edges"
            value={listOrDash(projection.covered_edge_ids)}
          />
          <Field
            label="Fehlende Nodes"
            value={listOrDash(projection.missing_node_ids)}
          />
          <Field
            label="Fehlende Edges"
            value={listOrDash(projection.missing_edge_ids)}
          />
          <Field
            label="Misconception-Risiken"
            value={listOrDash(projection.misconception_ids)}
          />
        </section>

        <Separator />

        <section className="space-y-2">
          <h3 className="text-sm font-semibold">Signale</h3>
          {projection.signals.length === 0 ? (
            <p className="text-xs text-muted-foreground">Keine Signale.</p>
          ) : (
            <ul className="space-y-2">
              {projection.signals.map((s, i) => (
                <li
                  key={`${s.signal_kind}-${i}`}
                  className="rounded-lg border p-2 text-xs space-y-1"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{s.signal_kind}</Badge>
                    <Badge variant="secondary">conf: {s.confidence}</Badge>
                    <span className="text-muted-foreground">
                      severity {s.severity}
                    </span>
                  </div>
                  <p className="text-foreground">{s.reason}</p>
                  {(s.node_id || s.edge_id || s.misconception_id) && (
                    <p className="text-muted-foreground">
                      {s.node_id && <>node: {s.node_id} </>}
                      {s.edge_id && <>edge: {s.edge_id} </>}
                      {s.misconception_id && <>mc: {s.misconception_id}</>}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {projection.warnings.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold">Warnings</h3>
            <ul className="text-xs text-muted-foreground space-y-1">
              {projection.warnings.map((w, i) => (
                <li key={i}>
                  <span className="font-mono">{w.code}</span> — {w.detail}
                </li>
              ))}
            </ul>
          </section>
        )}

        {projection.blockers.length > 0 && (
          <section className="space-y-1">
            <h3 className="text-sm font-semibold text-destructive">Blockers</h3>
            <ul className="text-xs text-destructive/90 space-y-1">
              {projection.blockers.map((b, i) => (
                <li key={i}>
                  <span className="font-mono">{b.code}</span> — {b.detail}
                </li>
              ))}
            </ul>
          </section>
        )}
      </CardContent>
    </Card>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="font-mono text-xs break-all">{value}</div>
    </div>
  );
}

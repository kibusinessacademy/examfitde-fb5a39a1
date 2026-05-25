/**
 * Berufs-KI WorkflowRunner — DRY component.
 *
 * Renders dynamic input form from WorkflowDefinition.input_schema and
 * displays the rendered output_text returned by the edge function.
 * Handles tier-lock and entitlement_required errors.
 */
import { useMemo, useState } from "react";
import { Loader2, Lock, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { runWorkflow } from "@/lib/berufs-ki/api";
import { CATEGORY_LABEL, lockMessage, tierLabel } from "@/lib/berufs-ki/copy";
import type { WorkflowDefinition, WorkflowRunResult } from "@/lib/berufs-ki/types";
import { useOsBeruf } from "@/lib/os/os-identity";

interface Props {
  workflow: WorkflowDefinition;
  onClose?: () => void;
}

function parseSections(text: string, sections: string[]): Array<{ heading: string; body: string }> | null {
  if (!text || sections.length === 0) return null;
  // Normalize section keys → human labels for matching
  const labels = sections.map((s) => s.replace(/_/g, " "));
  const pattern = new RegExp(
    `(^|\\n)\\s*(?:#+\\s*|\\*\\*)?(${labels.map((l) => l.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")).join("|")})(?:\\*\\*|:)?\\s*\\n`,
    "gi",
  );
  const matches: Array<{ idx: number; heading: string }> = [];
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(text)) !== null) {
    matches.push({ idx: m.index + (m[1]?.length ?? 0), heading: m[2] });
  }
  if (matches.length < 2) return null;
  const result: Array<{ heading: string; body: string }> = [];
  for (let i = 0; i < matches.length; i++) {
    const start = matches[i].idx;
    const end = i + 1 < matches.length ? matches[i + 1].idx : text.length;
    const slice = text.slice(start, end);
    const body = slice.replace(/^.*\n/, "").trim();
    result.push({ heading: matches[i].heading, body });
  }
  return result;
}

export default function WorkflowRunner({ workflow, onClose }: Props) {
  const beruf = useOsBeruf();
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    if (beruf?.label) {
      const berufField = workflow.input_schema.fields.find((f) => f.key === "beruf");
      if (berufField) seed.beruf = beruf.short ?? beruf.label;
    }
    return seed;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkflowRunResult | null>(null);
  const [lockError, setLockError] = useState<string | null>(null);

  const sections = useMemo(
    () => (result ? parseSections(result.output_text, workflow.output_schema.sections ?? []) : null),
    [result, workflow.output_schema.sections],
  );

  function setField(key: string, val: string) {
    setInputs((prev) => ({ ...prev, [key]: val }));
  }

  async function handleRun() {
    setRunning(true);
    setResult(null);
    setLockError(null);
    try {
      const res = await runWorkflow(workflow.slug, inputs, beruf?.slug);
      setResult(res);
    } catch (e) {
      const err = e as Error & { code?: string; reason?: string };
      if (err.code === "entitlement_required") {
        setLockError(err.message);
      } else {
        toast.error(err.message || "Berufs-KI Lauf fehlgeschlagen.");
      }
    } finally {
      setRunning(false);
    }
  }

  const isLocked = workflow.tier_required !== "free";
  const ssotChips = [
    workflow.curriculum_id && { label: "Lernpaket-Bindung", icon: "📦" },
    workflow.learning_field_id && { label: "Lernfeld-Bezug", icon: "📚" },
    workflow.competency_id && { label: "Kompetenz-Bezug", icon: "🎯" },
    workflow.blueprint_id && { label: "Blueprint-Bezug", icon: "🧩" },
  ].filter(Boolean) as Array<{ label: string; icon: string }>;

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{CATEGORY_LABEL[workflow.category]}</Badge>
              <Badge variant={isLocked ? "default" : "secondary"} className="gap-1">
                {isLocked && <Lock className="h-3 w-3" />}
                {tierLabel(workflow.tier_required)}
              </Badge>
              {workflow.risk_level !== "low" && (
                <Badge variant="outline" className="text-xs">Risiko: {workflow.risk_level}</Badge>
              )}
            </div>
            <CardTitle className="text-xl">{workflow.title}</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">{workflow.description}</p>
            {ssotChips.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {ssotChips.map((c) => (
                  <span
                    key={c.label}
                    className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5 text-[11px] text-muted-foreground"
                  >
                    <span aria-hidden>{c.icon}</span> {c.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          {onClose && (
            <Button variant="ghost" size="sm" onClick={onClose}>
              Schließen
            </Button>
          )}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {workflow.input_schema.fields.map((f) => (
          <div key={f.key} className="space-y-1.5">
            <Label htmlFor={`bki-${f.key}`}>
              {f.label}
              {f.required && <span className="ml-1 text-destructive">*</span>}
            </Label>
            {f.type === "textarea" && (
              <Textarea
                id={`bki-${f.key}`}
                placeholder={f.placeholder}
                value={inputs[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
                rows={5}
              />
            )}
            {f.type === "text" && (
              <Input
                id={`bki-${f.key}`}
                placeholder={f.placeholder}
                value={inputs[f.key] ?? ""}
                onChange={(e) => setField(f.key, e.target.value)}
              />
            )}
            {f.type === "select" && (
              <Select value={inputs[f.key] ?? ""} onValueChange={(v) => setField(f.key, v)}>
                <SelectTrigger id={`bki-${f.key}`}>
                  <SelectValue placeholder="Bitte wählen…" />
                </SelectTrigger>
                <SelectContent>
                  {(f.options ?? []).map((opt) => (
                    <SelectItem key={opt} value={opt}>
                      {opt}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {f.help && <p className="text-xs text-muted-foreground">{f.help}</p>}
          </div>
        ))}

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button onClick={handleRun} disabled={running} size="lg">
            {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
            {running ? "Berufs-KI arbeitet…" : "Workflow starten"}
          </Button>
          <p className="text-xs text-muted-foreground">Ergebnis bleibt nur für dich sichtbar.</p>
        </div>

        {lockError && (
          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-900/40 dark:bg-amber-900/10">
            <div className="flex items-start gap-3">
              <Lock className="mt-0.5 h-5 w-5 text-amber-700 dark:text-amber-400" />
              <div className="flex-1">
                <div className="text-sm font-medium">{lockMessage(workflow.tier_required, beruf?.short ?? beruf?.label)}</div>
                <p className="mt-1 text-xs text-muted-foreground">{lockError}</p>
                <div className="mt-3 flex gap-2">
                  <Button asChild size="sm">
                    <Link to="/paket">Lernpaket ansehen</Link>
                  </Button>
                  {workflow.tier_required === "business" && (
                    <Button asChild size="sm" variant="outline">
                      <Link to="/work">Business-Lizenz</Link>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {result && (
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Ergebnis</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {result.model_used} · {(result.latency_ms / 1000).toFixed(1)}s
              </span>
            </div>

            {sections ? (
              <div className="space-y-3">
                {sections.map((s, i) => (
                  <div key={i} className="rounded-lg border bg-card p-4">
                    <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      {s.heading}
                    </div>
                    <div className="whitespace-pre-wrap text-sm leading-relaxed">{s.body}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border bg-muted/30 p-4">
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{result.output_text}</div>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

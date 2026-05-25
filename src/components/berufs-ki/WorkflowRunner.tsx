/**
 * Berufs-KI WorkflowRunner — DRY component.
 *
 * Renders dynamic input form from WorkflowDefinition.input_schema and
 * displays the rendered output_text returned by the edge function.
 */
import { useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { runWorkflow } from "@/lib/berufs-ki/api";
import { CATEGORY_LABEL } from "@/lib/berufs-ki/copy";
import type { WorkflowDefinition, WorkflowRunResult } from "@/lib/berufs-ki/types";
import { useOsBeruf } from "@/lib/os/os-identity";

interface Props {
  workflow: WorkflowDefinition;
  onClose?: () => void;
}

export default function WorkflowRunner({ workflow, onClose }: Props) {
  const beruf = useOsBeruf();
  const [inputs, setInputs] = useState<Record<string, string>>(() => {
    // Pre-fill "beruf" field from OS identity if present
    const seed: Record<string, string> = {};
    if (beruf?.label) {
      const berufField = workflow.input_schema.fields.find((f) => f.key === "beruf");
      if (berufField) seed.beruf = beruf.short ?? beruf.label;
    }
    return seed;
  });
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<WorkflowRunResult | null>(null);

  function setField(key: string, val: string) {
    setInputs((prev) => ({ ...prev, [key]: val }));
  }

  async function handleRun() {
    setRunning(true);
    setResult(null);
    try {
      const res = await runWorkflow(workflow.slug, inputs, beruf?.slug);
      setResult(res);
    } catch (e) {
      toast.error((e as Error).message || "Berufs-KI Lauf fehlgeschlagen.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <Card className="w-full">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Badge variant="secondary">{CATEGORY_LABEL[workflow.category]}</Badge>
              {workflow.risk_level !== "low" && (
                <Badge variant="outline" className="text-xs">Risiko: {workflow.risk_level}</Badge>
              )}
            </div>
            <CardTitle className="text-xl">{workflow.title}</CardTitle>
            <p className="mt-2 text-sm text-muted-foreground">{workflow.description}</p>
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
          <p className="text-xs text-muted-foreground">
            Ergebnis bleibt nur für dich sichtbar.
          </p>
        </div>

        {result && (
          <div className="mt-4 rounded-lg border bg-muted/30 p-4">
            <div className="mb-2 flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-medium">Ergebnis</span>
              <span className="ml-auto text-xs text-muted-foreground">
                {result.model_used} · {(result.latency_ms / 1000).toFixed(1)}s
              </span>
            </div>
            <div className="whitespace-pre-wrap text-sm leading-relaxed">{result.output_text}</div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

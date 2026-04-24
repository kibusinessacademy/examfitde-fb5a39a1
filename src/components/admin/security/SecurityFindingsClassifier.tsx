/**
 * SecurityFindingsClassifier
 * ──────────────────────────
 * UI-Klassifizierung von Linter-/Scanner-Findings in P0–P3 mit:
 *  - JSON-Upload (File-Picker) inkl. Schema-Validierung
 *  - Persistente Exceptions (DB-gestützt, "akzeptiert bis Audit vX")
 *  - Workflow-Verknüpfung (öffnet betroffene .github/workflows/*.yml)
 *  - Renovate-Empfehlung für „unpinned actions" (P2)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ExternalLink,
  ListChecks,
  Pencil,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Upload,
  Wrench,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useToast } from "@/hooks/use-toast";
import {
  classifyAll,
  summarize,
  type ClassifiedFinding,
  type FindingPriority,
  type RawFinding,
} from "@/lib/admin/security/findingClassifier";
import { parseFindingsJson } from "@/lib/admin/security/findingSchema";
import {
  listFindingExceptions,
  indexExceptions,
  type FindingException,
} from "@/lib/admin/security/findingExceptionsApi";
import {
  loadWorkflowIndex,
  findRelatedWorkflows,
  type WorkflowIndex,
  type RelatedWorkflow,
} from "@/lib/admin/security/workflowIndex";
import { FindingExceptionDialog } from "./FindingExceptionDialog";
import { RenovateRecommendationCard } from "./RenovateRecommendationCard";

const PRIO_META: Record<
  FindingPriority,
  { label: string; tone: string; icon: typeof ShieldAlert; description: string }
> = {
  P0: {
    label: "P0 — Kritisch",
    tone: "bg-destructive text-destructive-foreground",
    icon: ShieldAlert,
    description: "Akuter Public-Leak oder Privilege-Escalation. Sofort fixen.",
  },
  P1: {
    label: "P1 — Hoch",
    tone: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
    icon: AlertCircle,
    description: "Authenticated-Access auf sensitive Daten. Sprint-Plan erforderlich.",
  },
  P2: {
    label: "P2 — Mittel",
    tone: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30",
    icon: Shield,
    description: "Defense-in-Depth-Empfehlung. Bei Releases beobachten.",
  },
  P3: {
    label: "P3 — Niedrig",
    tone: "bg-muted text-muted-foreground border-border",
    icon: ShieldCheck,
    description: "Internal/Utility — meist als Ausnahme dokumentierbar.",
  },
};

const SAMPLE_PAYLOAD = `[
  {
    "scanner_name": "supabase_lov",
    "id": "EXAM_INTEGRITY_BYPASS",
    "internal_id": "exam_question_variants_authenticated_read_all",
    "name": "All exam question variants including correct answers readable by any logged-in user",
    "description": "The 'exam_question_variants' table has policy USING (true) for authenticated.",
    "level": "error"
  },
  {
    "scanner_name": "supabase",
    "id": "SUPA_security_definer_view",
    "internal_id": "SUPA_security_definer_view",
    "name": "Security Definer View",
    "level": "error"
  },
  {
    "scanner_name": "github_actions_audit",
    "id": "GHA_UNPINNED_ACTION",
    "internal_id": "ci_yml_unpinned",
    "name": "Unpinned GitHub Action in ci.yml",
    "description": "Multiple actions referenced via @v4 instead of full SHA.",
    "level": "warn"
  }
]`;

interface Props {
  initialFindings?: RawFinding[];
}

export function SecurityFindingsClassifier({ initialFindings = [] }: Props) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [raw, setRaw] = useState<string>(
    initialFindings.length ? JSON.stringify(initialFindings, null, 2) : "",
  );
  const [parseError, setParseError] = useState<string | null>(null);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);

  const [exceptions, setExceptions] = useState<Record<string, FindingException>>({});
  const [workflowIndex, setWorkflowIndex] = useState<WorkflowIndex | null>(null);

  const [dialogState, setDialogState] = useState<{
    open: boolean;
    scannerName: string;
    internalId: string;
    findingId?: string;
    priority?: FindingPriority;
    existing?: FindingException | null;
  }>({ open: false, scannerName: "", internalId: "" });

  // Initial laden
  useEffect(() => {
    void refreshExceptions();
    void loadWorkflowIndex().then(setWorkflowIndex);
  }, []);

  async function refreshExceptions() {
    try {
      const rows = await listFindingExceptions();
      setExceptions(indexExceptions(rows));
    } catch (e) {
      // RLS verweigert für Nicht-Admins — still fail
      console.warn("[SecurityFindingsClassifier] Exceptions nicht ladbar:", e);
    }
  }

  // Parse + Classify (merged with persistent exceptions)
  const findings = useMemo<ClassifiedFinding[]>(() => {
    if (!raw.trim()) {
      setParseError(null);
      setParseWarnings([]);
      return [];
    }
    const result = parseFindingsJson(raw);
    setParseError(result.errors[0] ?? null);
    setParseWarnings(result.warnings);
    if (!result.ok) return [];

    // Merge persistente Exceptions (UI-Override für ignore/ignore_reason)
    const merged: RawFinding[] = result.findings.map((f) => {
      const key = `${f.scanner_name ?? ""}::${f.internal_id ?? f.id ?? ""}`;
      const ex = exceptions[key];
      if (ex) {
        return {
          ...f,
          ignore: true,
          ignore_reason: `[${ex.status}${ex.accepted_until_audit ? ` · bis ${ex.accepted_until_audit}` : ""}] ${ex.reason}`,
        };
      }
      return f as RawFinding;
    });
    return classifyAll(merged);
  }, [raw, exceptions]);

  const summary = useMemo(() => summarize(findings), [findings]);

  // P2 unpinned-Hinweis sichtbar?
  const hasUnpinnedFinding = useMemo(
    () =>
      findings.some((f) =>
        /unpinned|sha[_\s-]?pin|@v\d/i.test(
          `${f.id ?? ""} ${f.internal_id ?? ""} ${f.name ?? ""} ${f.description ?? ""}`,
        ),
      ),
    [findings],
  );

  async function handleFileUpload(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Datei zu groß (>5MB)", variant: "destructive" });
      return;
    }
    try {
      const text = await file.text();
      const result = parseFindingsJson(text);
      if (!result.ok) {
        toast({
          title: "Schema-Validierung fehlgeschlagen",
          description: result.errors.slice(0, 3).join(" · "),
          variant: "destructive",
        });
        return;
      }
      setRaw(text);
      toast({
        title: `${result.findings.length} Findings importiert`,
        description: result.warnings.length ? `${result.warnings.length} Warnungen` : undefined,
      });
    } catch (e) {
      toast({
        title: "Datei nicht lesbar",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  }

  return (
    <div className="space-y-4">
      <Helmet>
        <title>Findings-Klassifizierung · Admin</title>
        <meta
          name="description"
          content="Klassifiziert Linter- und Scanner-Findings nach P0–P3, persistiert Ausnahmen und verknüpft betroffene Workflows."
        />
      </Helmet>

      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-md bg-primary/10 p-2 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Findings-Klassifizierung</h1>
            <p className="text-xs text-muted-foreground">
              P0–P3 Heuristik · persistente Ausnahmen · Workflow-Verknüpfung · Renovate-Patch.
            </p>
          </div>
        </div>
        {workflowIndex && (
          <div className="hidden text-right text-[11px] text-muted-foreground md:block">
            Workflow-Index: {workflowIndex.summary.total} Files ·{" "}
            {workflowIndex.summary.unpinnedActions} unpinned ·{" "}
            {workflowIndex.summary.missingPermissions} ohne perms
          </div>
        )}
      </header>

      {/* Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4" /> Findings importieren
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFileUpload(f);
              e.target.value = "";
            }}
          />
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='[{"scanner_name":"supabase_lov","id":"...","level":"error",...}]'
            className="min-h-32 font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="mr-1 h-3.5 w-3.5" /> JSON-Datei hochladen
            </Button>
            <Button size="sm" variant="outline" onClick={() => setRaw(SAMPLE_PAYLOAD)}>
              Beispiel laden
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRaw("")}>
              Leeren
            </Button>
            {parseError && (
              <span className="text-xs text-destructive">⚠ {parseError}</span>
            )}
          </div>
          {parseWarnings.length > 0 && (
            <ul className="space-y-0.5 text-[11px] text-amber-600 dark:text-amber-400">
              {parseWarnings.slice(0, 4).map((w, i) => (
                <li key={i}>⚠ {w}</li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Renovate Recommendation — nur wenn relevant */}
      {hasUnpinnedFinding && <RenovateRecommendationCard />}

      {/* Summary */}
      {findings.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {(Object.keys(PRIO_META) as FindingPriority[]).map((p) => {
            const meta = PRIO_META[p];
            const Icon = meta.icon;
            const count = summary.byPrio[p];
            return (
              <Card key={p}>
                <CardContent className="flex items-center justify-between p-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{meta.label}</div>
                    <div className="text-2xl font-semibold tabular-nums">{count}</div>
                  </div>
                  <Icon className="h-5 w-5 text-muted-foreground" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {findings.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {summary.total} Findings · {summary.open} offen · {summary.ignored} mit Ausnahme
        </p>
      )}

      {/* Findings List */}
      {findings.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <ListChecks className="h-4 w-4" /> Klassifizierte Findings
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <Accordion type="multiple" className="divide-y">
              {findings.map((f, idx) => {
                const meta = PRIO_META[f.priority];
                const id = `${f.internal_id ?? f.id ?? "f"}-${idx}`;
                const exKey = `${f.scanner_name ?? ""}::${f.internal_id ?? f.id ?? ""}`;
                const existing = exceptions[exKey] ?? null;
                const related: RelatedWorkflow[] = workflowIndex
                  ? findRelatedWorkflows(workflowIndex, f)
                  : [];
                return (
                  <AccordionItem key={id} value={id} className="border-0 px-3">
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex flex-1 items-center gap-3 text-left">
                        <Badge className={`shrink-0 ${meta.tone}`}>{f.priority}</Badge>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">
                            {f.name ?? f.id ?? f.internal_id ?? "(unbenannt)"}
                          </div>
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <span className="truncate font-mono">
                              {f.scanner_name ?? "—"} · {f.internal_id ?? f.id ?? "—"}
                            </span>
                            <span>·</span>
                            <span>Score {f.score}</span>
                            {existing && (
                              <>
                                <span>·</span>
                                <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                  {existing.status}
                                  {existing.accepted_until_audit
                                    ? ` · ${existing.accepted_until_audit}`
                                    : ""}
                                </Badge>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    </AccordionTrigger>
                    <AccordionContent className="space-y-3 pb-4">
                      {f.description && (
                        <p className="text-xs text-muted-foreground">{f.description}</p>
                      )}

                      {/* Signals */}
                      <div className="flex flex-wrap gap-1.5">
                        {Object.entries(f.signals).map(([k, v]) =>
                          v ? (
                            <Badge key={k} variant="outline" className="text-[10px] uppercase tracking-wide">
                              {k}
                            </Badge>
                          ) : null,
                        )}
                      </div>

                      {/* Reasoning */}
                      {f.reasoning.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">Heuristik</div>
                          <ul className="space-y-1 text-xs">
                            {f.reasoning.map((r, i) => (
                              <li key={i} className="flex gap-1.5">
                                <ChevronRight className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recommended Checks */}
                      <div>
                        <div className="mb-1 text-xs font-medium text-muted-foreground">
                          Empfohlene Folge-Prüfungen
                        </div>
                        <ul className="space-y-1.5 text-xs">
                          {f.recommendedChecks.map((c, i) => (
                            <li key={i} className="flex gap-1.5">
                              <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px]">
                                {c}
                              </code>
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Related Workflows */}
                      {related.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            Betroffene GitHub-Workflows ({related.length})
                          </div>
                          <ul className="space-y-1 text-xs">
                            {related.slice(0, 12).map((r, i) => (
                              <li key={i} className="flex items-center gap-1.5">
                                <ExternalLink className="h-3 w-3 shrink-0 text-muted-foreground" />
                                <code className="font-mono text-[11px]">{r.file}</code>
                                {r.jobName && (
                                  <Badge variant="outline" className="h-4 px-1 text-[10px]">
                                    job: {r.jobName}
                                  </Badge>
                                )}
                                <span className="text-muted-foreground">— {r.reason}</span>
                              </li>
                            ))}
                            {related.length > 12 && (
                              <li className="text-muted-foreground">
                                … +{related.length - 12} weitere
                              </li>
                            )}
                          </ul>
                        </div>
                      )}

                      {/* Existing exception display */}
                      {existing && (
                        <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-2 text-xs">
                          <div className="flex items-center justify-between">
                            <div className="font-medium">Ausnahme aktiv</div>
                            <Badge variant="outline" className="h-4 px-1 text-[10px]">
                              {existing.status}
                            </Badge>
                          </div>
                          <p className="mt-1 text-muted-foreground">{existing.reason}</p>
                          {(existing.accepted_until_audit || existing.accepted_until_date) && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              gültig bis:{" "}
                              {existing.accepted_until_audit ?? ""}
                              {existing.accepted_until_audit && existing.accepted_until_date ? " · " : ""}
                              {existing.accepted_until_date ?? ""}
                            </p>
                          )}
                        </div>
                      )}

                      {/* Action: Exception verwalten */}
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button
                          size="sm"
                          variant={existing ? "outline" : "default"}
                          onClick={() =>
                            setDialogState({
                              open: true,
                              scannerName: f.scanner_name ?? "unknown",
                              internalId: f.internal_id ?? f.id ?? `idx_${idx}`,
                              findingId: f.id,
                              priority: f.priority,
                              existing,
                            })
                          }
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          {existing ? "Ausnahme bearbeiten" : "Als Ausnahme markieren"}
                        </Button>
                        {/unpinned|sha[_\s-]?pin|@v\d/i.test(
                          `${f.id ?? ""} ${f.internal_id ?? ""} ${f.name ?? ""}`,
                        ) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              const el = document.querySelector("[data-renovate-card]");
                              el?.scrollIntoView({ behavior: "smooth", block: "start" });
                            }}
                          >
                            <Wrench className="mr-1 h-3 w-3" />
                            Renovate-Patch öffnen
                          </Button>
                        )}
                      </div>
                    </AccordionContent>
                  </AccordionItem>
                );
              })}
            </Accordion>
          </CardContent>
        </Card>
      )}

      {findings.length === 0 && !parseError && (
        <Card>
          <CardContent className="p-6 text-center text-sm text-muted-foreground">
            Lade eine JSON-Datei hoch, füge Findings ein oder klicke „Beispiel laden".
          </CardContent>
        </Card>
      )}

      <FindingExceptionDialog
        open={dialogState.open}
        onOpenChange={(o) => setDialogState((s) => ({ ...s, open: o }))}
        scannerName={dialogState.scannerName}
        internalId={dialogState.internalId}
        findingId={dialogState.findingId}
        priority={dialogState.priority}
        existing={dialogState.existing}
        onSaved={() => void refreshExceptions()}
      />
    </div>
  );
}

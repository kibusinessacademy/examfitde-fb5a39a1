/**
 * SecurityFindingsClassifier
 * ──────────────────────────
 * UI-Klassifizierung von Linter-/Scanner-Findings in P0–P3.
 *
 * - Lädt Findings clientseitig aus einer JSON-Quelle (Default: Lovable
 *   Security-Scanner Snapshot; alternativ direkt einfügbar via Textarea).
 * - Wendet `classifyAll()` aus `findingClassifier.ts` an.
 * - Zeigt Score, Heuristik-Signale, Reasoning und konkrete Folge-Prüfungen.
 */
import { useMemo, useState } from "react";
import { Helmet } from "react-helmet-async";
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Upload,
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
import {
  classifyAll,
  summarize,
  type ClassifiedFinding,
  type FindingPriority,
  type RawFinding,
} from "@/lib/admin/security/findingClassifier";

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
    "description": "The 'exam_question_variants' table has policy USING (true) for authenticated. Any registered user can query correct answers.",
    "level": "error"
  },
  {
    "scanner_name": "supabase",
    "id": "SUPA_security_definer_view",
    "internal_id": "SUPA_security_definer_view",
    "name": "Security Definer View",
    "level": "error",
    "ignore": true,
    "ignore_reason": "service_role-only, no anon/auth grants"
  }
]`;

interface Props {
  /**
   * Optional preloaded findings (z. B. vom security--get_scan_results Snapshot).
   * Falls leer, kann der Operator über die Textarea welche einfügen.
   */
  initialFindings?: RawFinding[];
}

export function SecurityFindingsClassifier({ initialFindings = [] }: Props) {
  const [raw, setRaw] = useState<string>(
    initialFindings.length ? JSON.stringify(initialFindings, null, 2) : "",
  );
  const [parseError, setParseError] = useState<string | null>(null);

  const findings = useMemo<ClassifiedFinding[]>(() => {
    if (!raw.trim()) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      const arr = Array.isArray(parsed) ? parsed : [parsed];
      setParseError(null);
      return classifyAll(arr as RawFinding[]);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Parse error");
      return [];
    }
  }, [raw]);

  const summary = useMemo(() => summarize(findings), [findings]);

  return (
    <div className="space-y-4">
      <Helmet>
        <title>Findings-Klassifizierung · Admin</title>
        <meta
          name="description"
          content="Klassifiziert Linter- und Scanner-Findings automatisch nach P0–P3 und schlägt Folge-Prüfungen vor."
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
              Heuristische P0–P3 Einordnung + empfohlene Folge-Checks.
            </p>
          </div>
        </div>
      </header>

      {/* Input */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Upload className="h-4 w-4" /> Findings einfügen (JSON)
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Textarea
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            placeholder='[{"scanner_name":"supabase_lov","id":"...","level":"error",...}]'
            className="min-h-32 font-mono text-xs"
            spellCheck={false}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setRaw(SAMPLE_PAYLOAD)}
            >
              Beispiel laden
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setRaw("")}>
              Leeren
            </Button>
            {parseError && (
              <span className="text-xs text-destructive">⚠ {parseError}</span>
            )}
          </div>
        </CardContent>
      </Card>

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
          {summary.total} Findings · {summary.open} offen · {summary.ignored} ignoriert
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
                return (
                  <AccordionItem key={id} value={id} className="border-0 px-3">
                    <AccordionTrigger className="py-3 hover:no-underline">
                      <div className="flex flex-1 items-center gap-3 text-left">
                        <Badge className={`shrink-0 ${meta.tone}`}>
                          {f.priority}
                        </Badge>
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
                            {f.ignore && (
                              <>
                                <span>·</span>
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  ignoriert
                                </span>
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
                            <Badge
                              key={k}
                              variant="outline"
                              className="text-[10px] uppercase tracking-wide"
                            >
                              {k}
                            </Badge>
                          ) : null,
                        )}
                      </div>

                      {/* Reasoning */}
                      {f.reasoning.length > 0 && (
                        <div>
                          <div className="mb-1 text-xs font-medium text-muted-foreground">
                            Heuristik
                          </div>
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

                      {f.ignore && f.ignore_reason && (
                        <div className="rounded-md border border-border bg-muted/50 p-2 text-xs">
                          <div className="font-medium">Ignored-Begründung</div>
                          <p className="mt-1 text-muted-foreground">{f.ignore_reason}</p>
                        </div>
                      )}
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
            Füge Scanner-Findings als JSON ein oder klicke „Beispiel laden".
          </CardContent>
        </Card>
      )}
    </div>
  );
}

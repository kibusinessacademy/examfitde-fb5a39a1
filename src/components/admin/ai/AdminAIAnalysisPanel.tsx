import { useState, useEffect, useCallback, useMemo } from "react";
import { Sparkles, Copy, Check, Loader2, AlertCircle, Clock, ChevronDown, ChevronUp, GitCompare, Plus, Minus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

type Severity = "low" | "medium" | "high";

interface AnalysisItem {
  title: string;
  detail: string;
  evidence?: string;
}
interface OptItem extends AnalysisItem {
  impact: Severity;
  effort: Severity;
}
interface CrossItem extends AnalysisItem {
  affected_areas?: string[];
}
interface NextAction {
  priority: 1 | 2 | 3;
  title: string;
  outcome: string;
  impact: Severity;
  effort: Severity;
  deeplink_hint?: string;
}
interface Analysis {
  summary: string;
  bottlenecks: AnalysisItem[];
  gaps: AnalysisItem[];
  optimizations: OptItem[];
  cross_system: CrossItem[];
  next_actions: NextAction[];
}

interface HistoryEntry {
  id: string;
  route_key: string;
  model: string;
  analysis: Analysis | null;
  markdown: string | null;
  created_at: string;
  latency_ms: number | null;
  status: string;
  error_message: string | null;
  user_id?: string | null;
}

interface Props {
  routeKey: string;
  routePath?: string;
  /** Optional: short, redacted hint about what is currently visible (e.g. active filter/tab). */
  visibleHints?: string;
  /** Visual position. Default: inline panel. */
  variant?: "inline" | "compact";
  /** Override title shown at the top */
  title?: string;
}

const SEVERITY_COLOR: Record<Severity, string> = {
  low: "bg-muted text-muted-foreground",
  medium: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  high: "bg-destructive/15 text-destructive",
};

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const onClick = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "Kopiert", description: `${label} in Zwischenablage.` });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: "Kopieren fehlgeschlagen", variant: "destructive" });
    }
  };
  return (
    <Button size="sm" variant="outline" onClick={onClick} className="gap-1.5">
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {label}
    </Button>
  );
}

function SeverityChip({ value }: { value: Severity }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${SEVERITY_COLOR[value]}`}>
      {value}
    </span>
  );
}

function safeArr<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function AnalysisView({ a }: { a: Analysis }) {
  // Defensive: server can return partial / null / non-array fields. Guard everything.
  const bottlenecks = safeArr<AnalysisItem>(a?.bottlenecks);
  const gaps = safeArr<AnalysisItem>(a?.gaps);
  const optimizations = safeArr<OptItem>(a?.optimizations);
  const cross = safeArr<CrossItem>(a?.cross_system);
  const nextActions = safeArr<NextAction>(a?.next_actions);
  const summary = typeof a?.summary === "string" ? a.summary : "";

  return (
    <div className="space-y-5">
      {summary && (
        <div className="rounded-xl border bg-muted/40 p-3 text-sm leading-relaxed">{summary}</div>
      )}

      {nextActions.length > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold flex items-center gap-2">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            Top-3 nächste Aktionen
          </h4>
          <div className="space-y-2">
            {nextActions.map((n, idx) => (
              <div key={n?.priority ?? idx} className="rounded-xl border p-3">
                <div className="flex items-start gap-3">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-bold text-primary">
                    {n?.priority ?? idx + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-sm">{n?.title ?? "—"}</span>
                      {n?.impact && <SeverityChip value={n.impact} />}
                      <span className="text-[10px] text-muted-foreground">Aufwand:</span>
                      {n?.effort && <SeverityChip value={n.effort} />}
                    </div>
                    {n?.outcome && <div className="mt-1 text-sm text-muted-foreground">{n.outcome}</div>}
                    {n?.deeplink_hint && (
                      <div className="mt-1 text-[11px] text-muted-foreground/80">→ {n.deeplink_hint}</div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {bottlenecks.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Engpässe</h4>
            <ul className="space-y-2">
              {bottlenecks.map((b, i) => (
                <li key={i} className="rounded-lg border p-2.5 text-sm">
                  <div className="font-medium">{b?.title ?? "—"}</div>
                  {b?.detail && <div className="text-muted-foreground">{b.detail}</div>}
                  {b?.evidence && (
                    <div className="mt-1 text-[11px] text-muted-foreground/80">Evidenz: {b.evidence}</div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {gaps.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Lücken</h4>
            <ul className="space-y-2">
              {gaps.map((g, i) => (
                <li key={i} className="rounded-lg border p-2.5 text-sm">
                  <div className="font-medium">{g?.title ?? "—"}</div>
                  {g?.detail && <div className="text-muted-foreground">{g.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {optimizations.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Optimierungen</h4>
            <ul className="space-y-2">
              {optimizations.map((o, i) => (
                <li key={i} className="rounded-lg border p-2.5 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{o?.title ?? "—"}</span>
                    {o?.impact && <SeverityChip value={o.impact} />}
                    <span className="text-[10px] text-muted-foreground">Aufwand:</span>
                    {o?.effort && <SeverityChip value={o.effort} />}
                  </div>
                  {o?.detail && <div className="text-muted-foreground">{o.detail}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        {cross.length > 0 && (
          <section>
            <h4 className="mb-2 text-sm font-semibold">Cross-System</h4>
            <ul className="space-y-2">
              {cross.map((c, i) => (
                <li key={i} className="rounded-lg border p-2.5 text-sm">
                  <div className="font-medium">{c?.title ?? "—"}</div>
                  {c?.detail && <div className="text-muted-foreground">{c.detail}</div>}
                  {Array.isArray(c?.affected_areas) && c.affected_areas.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {c.affected_areas.map((area) => (
                        <Badge key={area} variant="outline" className="text-[10px]">{area}</Badge>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Compute diff between two analyses (latest vs previous).
 * Compares titles within each section + next_actions to surface added / removed items.
 */
type DiffBlock = { added: string[]; removed: string[] };
type AnalysisDiff = {
  bottlenecks: DiffBlock;
  gaps: DiffBlock;
  optimizations: DiffBlock;
  cross_system: DiffBlock;
  next_actions: DiffBlock;
  summaryChanged: boolean;
};

function diffArray(prev: { title: string }[] | undefined, curr: { title: string }[] | undefined): DiffBlock {
  const p = new Set((prev ?? []).map((x) => x.title));
  const c = new Set((curr ?? []).map((x) => x.title));
  return {
    added: [...c].filter((t) => !p.has(t)),
    removed: [...p].filter((t) => !c.has(t)),
  };
}

function computeDiff(prev: Analysis, curr: Analysis): AnalysisDiff {
  return {
    bottlenecks: diffArray(prev.bottlenecks, curr.bottlenecks),
    gaps: diffArray(prev.gaps, curr.gaps),
    optimizations: diffArray(prev.optimizations, curr.optimizations),
    cross_system: diffArray(prev.cross_system, curr.cross_system),
    next_actions: diffArray(prev.next_actions, curr.next_actions),
    summaryChanged: (prev.summary || "").trim() !== (curr.summary || "").trim(),
  };
}

function diffIsEmpty(d: AnalysisDiff): boolean {
  return (
    !d.summaryChanged &&
    [d.bottlenecks, d.gaps, d.optimizations, d.cross_system, d.next_actions].every(
      (b) => b.added.length === 0 && b.removed.length === 0,
    )
  );
}

function DiffSection({ label, diff }: { label: string; diff: DiffBlock }) {
  if (diff.added.length === 0 && diff.removed.length === 0) return null;
  return (
    <div className="rounded-lg border p-2.5 text-xs">
      <div className="mb-1 font-semibold">{label}</div>
      {diff.added.map((t) => (
        <div key={`+${t}`} className="flex items-start gap-1 text-emerald-600 dark:text-emerald-400">
          <Plus className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{t}</span>
        </div>
      ))}
      {diff.removed.map((t) => (
        <div key={`-${t}`} className="flex items-start gap-1 text-rose-600 dark:text-rose-400">
          <Minus className="h-3 w-3 mt-0.5 shrink-0" />
          <span>{t}</span>
        </div>
      ))}
    </div>
  );
}

export function AdminAIAnalysisPanel({ routeKey, routePath, visibleHints, variant = "inline", title }: Props) {
  const [open, setOpen] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<{
    analysis: Analysis;
    markdown: string;
    model: string;
    latencyMs: number;
    createdAt: string;
  } | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [diffOpen, setDiffOpen] = useState(false);
  const { toast } = useToast();

  /** Diff between latest two successful analyses for this route. */
  const diff = useMemo<{ d: AnalysisDiff; prev: HistoryEntry; curr: HistoryEntry } | null>(() => {
    const success = history.filter((h) => h.status !== "error" && h.analysis?.summary);
    if (success.length < 2) return null;
    const [curr, prev] = success;
    return { d: computeDiff(prev.analysis as Analysis, curr.analysis as Analysis), prev, curr };
  }, [history]);


  const loadHistory = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke("admin-ai-page-analysis", {
      body: { action: "history", route_key: routeKey },
    });
    if (error) return;
    if (data?.history) setHistory(data.history as HistoryEntry[]);
  }, [routeKey]);

  useEffect(() => {
    if (open) void loadHistory();
  }, [open, loadHistory]);

  const runAnalysis = async () => {
    setRunning(true);
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-ai-page-analysis", {
        body: {
          action: "analyze",
          route_key: routeKey,
          route_path: routePath ?? window.location.pathname,
          visible_hints: visibleHints,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setCurrent({
        analysis: data.analysis,
        markdown: data.markdown,
        model: data.model,
        latencyMs: data.latency_ms,
        createdAt: data.created_at ?? new Date().toISOString(),
      });
      toast({ title: "Analyse fertig", description: `Modell: ${data.model}` });
      void loadHistory();
    } catch (e: any) {
      const msg = e?.message ?? "Unbekannter Fehler";
      setError(msg);
      toast({ title: "Analyse fehlgeschlagen", description: msg, variant: "destructive" });
    } finally {
      setRunning(false);
    }
  };

  const headerLabel = title ?? "KI-Qualitätsanalyse";

  return (
    <div className="rounded-2xl border bg-card">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="flex items-center gap-2 min-w-0">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/15">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold truncate">{headerLabel}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              Seitenspezifisch · Live-Snapshot · Auto-Modell
            </div>
          </div>
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {open && (
        <div className="border-t px-4 py-4 space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={runAnalysis} disabled={running} size="sm" className="gap-1.5">
              {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              {running ? "Analysiere…" : current ? "Neu analysieren" : "Analyse starten"}
            </Button>
            {current && (
              <>
                <CopyButton text={current.markdown} label="Markdown" />
                <CopyButton text={JSON.stringify(current.analysis, null, 2)} label="JSON" />
                <span className="text-[11px] text-muted-foreground">
                  {current.model} · {current.latencyMs}ms · {new Date(current.createdAt).toLocaleTimeString("de-DE")}
                </span>
              </>
            )}
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {!current && !running && !error && (
            <div className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Klicke „Analyse starten" — die KI lädt einen frischen Server-Snapshot dieser Seite und liefert
              eine 4-Block-Analyse: Engpässe · Lücken · Optimierungen · Cross-System + 3 priorisierte Aktionen.
            </div>
          )}

          {current && <AnalysisView a={current.analysis} />}

          {diff && (
            <div className="border-t pt-3">
              <button
                onClick={() => setDiffOpen((v) => !v)}
                className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <GitCompare className="h-3.5 w-3.5" />
                Diff: aktuelle vs. vorletzte Analyse{diffIsEmpty(diff.d) ? " (keine Änderungen)" : ""}
                {diffOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
              {diffOpen && (
                <div className="mt-2 space-y-2">
                  <div className="text-[11px] text-muted-foreground">
                    {new Date(diff.prev.created_at).toLocaleString("de-DE")} → {new Date(diff.curr.created_at).toLocaleString("de-DE")}
                  </div>
                  {diff.d.summaryChanged && (
                    <div className="rounded-lg border p-2.5 text-xs">
                      <div className="font-semibold mb-1">Zusammenfassung geändert</div>
                      <div className="text-rose-600 dark:text-rose-400 line-clamp-2">− {diff.prev.analysis?.summary}</div>
                      <div className="text-emerald-600 dark:text-emerald-400 line-clamp-2">+ {diff.curr.analysis?.summary}</div>
                    </div>
                  )}
                  <div className="grid gap-2 md:grid-cols-2">
                    <DiffSection label="Engpässe" diff={diff.d.bottlenecks} />
                    <DiffSection label="Lücken" diff={diff.d.gaps} />
                    <DiffSection label="Optimierungen" diff={diff.d.optimizations} />
                    <DiffSection label="Cross-System" diff={diff.d.cross_system} />
                    <DiffSection label="Top-3 Aktionen" diff={diff.d.next_actions} />
                  </div>
                  {diffIsEmpty(diff.d) && (
                    <div className="text-xs text-muted-foreground">
                      Keine Titel-Änderungen zwischen den letzten beiden Analysen.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="border-t pt-3">
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"
            >
              <Clock className="h-3.5 w-3.5" />
              Verlauf ({history.length})
              {historyOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </button>
            {historyOpen && (
              <div className="mt-2 space-y-2">
                {history.length === 0 && (
                  <div className="text-xs text-muted-foreground">Noch keine Analyse für diese Seite.</div>
                )}
                {history.map((h) => (
                  <div key={h.id} className="rounded-lg border p-2.5 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {new Date(h.created_at).toLocaleString("de-DE")} · {h.model}
                      </span>
                      <div className="flex gap-1.5">
                        {h.markdown && <CopyButton text={h.markdown} label="MD" />}
                        {h.analysis && (
                          <CopyButton text={JSON.stringify(h.analysis, null, 2)} label="JSON" />
                        )}
                      </div>
                    </div>
                    {h.status === "error" ? (
                      <div className="mt-1 text-destructive">{h.error_message}</div>
                    ) : (
                      <div className="mt-1 text-muted-foreground line-clamp-2">{h.analysis?.summary}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminAIAnalysisPanel;

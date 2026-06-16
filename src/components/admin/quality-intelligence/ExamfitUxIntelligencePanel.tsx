import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Brain, Play, ChevronDown, ChevronUp } from "lucide-react";

type ScopeKind = "route" | "journey" | "component" | "feature" | "product";
type Product = "examfit" | "berufos" | "shared";

interface UxReport {
  id: string;
  created_at: string;
  scope_kind: ScopeKind;
  scope_target: string;
  persona: string | null;
  product: Product;
  model: string;
  duration_ms: number | null;
  trust_score: number | null;
  conversion_score: number | null;
  activation_score: number | null;
  motivation_score: number | null;
  discoverability_score: number | null;
  workflow_efficiency_score: number | null;
  mobile_readiness_score: number | null;
  cognitive_load_score: number | null;
  overall_grade: string | null;
  report: any;
  status: string;
  error_text: string | null;
}

const SCORE_KEYS: Array<[keyof UxReport, string]> = [
  ["trust_score", "Trust"],
  ["conversion_score", "Conversion"],
  ["activation_score", "Activation"],
  ["motivation_score", "Motivation"],
  ["discoverability_score", "Discoverability"],
  ["workflow_efficiency_score", "Workflow"],
  ["mobile_readiness_score", "Mobile"],
  ["cognitive_load_score", "Cog-Load"],
];

function scoreTone(value: number | null, inverse = false): string {
  if (value === null) return "bg-muted text-muted-foreground";
  const good = inverse ? value <= 30 : value >= 70;
  const mid = inverse ? value <= 50 : value >= 50;
  if (good) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30";
  if (mid)  return "bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30";
  return "bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30";
}

export function ExamfitUxIntelligencePanel() {
  const { toast } = useToast();
  const [reports, setReports] = useState<UxReport[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [scopeKind, setScopeKind] = useState<ScopeKind>("route");
  const [scopeTarget, setScopeTarget] = useState<string>("/");
  const [product, setProduct] = useState<Product>("examfit");
  const [persona, setPersona] = useState<string>("none");
  const [context, setContext] = useState<string>("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("quality_intelligence_ux_reports")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(30);
    if (error) toast({ title: "Reports laden fehlgeschlagen", description: error.message, variant: "destructive" });
    setReports((data ?? []) as unknown as UxReport[]);
    setLoading(false);
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function runAnalysis() {
    if (!scopeTarget.trim()) {
      toast({ title: "Scope-Target fehlt", variant: "destructive" });
      return;
    }
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("kimi-examfit-ux-intelligence", {
        body: {
          scope_kind: scopeKind,
          scope_target: scopeTarget.trim(),
          product,
          persona: persona === "none" ? null : persona,
          context: context.trim() || undefined,
        },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast({
        title: "Report erstellt",
        description: `Grade: ${(data as any)?.report?.overall_grade ?? "—"} · ${(data as any)?.duration_ms} ms`,
      });
      await load();
    } catch (e: any) {
      toast({ title: "Analyse fehlgeschlagen", description: e?.message ?? String(e), variant: "destructive" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-primary" />
            KIMI.EXAMFIT UX &amp; PRODUCT INTELLIGENCE
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Experten-Council (Senior PM, UX Researcher, IHK-Prüfer, Ausbildungsleiter, Azubi, Berufsschullehrer,
            B2B-Entscheider, Conversion-Spezialist) bewertet eine Route, Journey, Komponente, Feature oder das
            gesamte Produkt gegen das ExamFit-Kernziel: Prüfungsreife mit minimalem Aufwand, maximalem Vertrauen
            und maximaler Conversion.
          </p>

          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-1">
              <Label className="text-xs">Scope-Kind</Label>
              <Select value={scopeKind} onValueChange={(v) => setScopeKind(v as ScopeKind)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="route">Route</SelectItem>
                  <SelectItem value="journey">Journey</SelectItem>
                  <SelectItem value="component">Component</SelectItem>
                  <SelectItem value="feature">Feature</SelectItem>
                  <SelectItem value="product">Product</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Scope-Target</Label>
              <Input
                value={scopeTarget}
                onChange={(e) => setScopeTarget(e.target.value)}
                placeholder="/ oder /kurs/[slug] oder onboarding oder checkout"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Produkt</Label>
              <Select value={product} onValueChange={(v) => setProduct(v as Product)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="examfit">ExamFit</SelectItem>
                  <SelectItem value="berufos">BerufOS</SelectItem>
                  <SelectItem value="shared">Shared</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Persona-Fokus (optional)</Label>
              <Select value={persona} onValueChange={setPersona}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— alle Personas (Council) —</SelectItem>
                  <SelectItem value="azubi_neu">Azubi (neu)</SelectItem>
                  <SelectItem value="pruefungsangst">Azubi (Prüfungsangst)</SelectItem>
                  <SelectItem value="kurz_vor_pruefung">Azubi (kurz vor Prüfung)</SelectItem>
                  <SelectItem value="betrieb">Ausbildungsbetrieb</SelectItem>
                  <SelectItem value="institution">Berufsschule / Institution</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button onClick={runAnalysis} disabled={running} className="w-full">
                {running ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Play className="h-4 w-4 mr-2" />}
                Council-Analyse starten
              </Button>
            </div>
            <div className="md:col-span-4 space-y-1">
              <Label className="text-xs">Kontext / Snapshot (optional, max ~8000 Zeichen)</Label>
              <Textarea
                value={context}
                onChange={(e) => setContext(e.target.value)}
                placeholder="Sichtbare Texte, Buttons, CTAs, Erwartungen, bekannte Reibungspunkte, User-Quote…"
                rows={4}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Letzte Reports</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {loading && <Loader2 className="h-5 w-5 animate-spin" />}
          {!loading && reports.length === 0 && (
            <p className="text-sm text-muted-foreground">Noch keine Reports. Starte oben eine Council-Analyse.</p>
          )}
          {reports.map((r) => {
            const expanded = expandedId === r.id;
            const failed = r.status === "failed";
            return (
              <div key={r.id} className="border rounded-lg p-3 space-y-2 bg-card">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="outline">{r.scope_kind}</Badge>
                  <code className="text-xs">{r.scope_target}</code>
                  <Badge variant="secondary">{r.product}</Badge>
                  {r.persona && <Badge variant="outline">Persona: {r.persona}</Badge>}
                  {failed
                    ? <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-300">failed</Badge>
                    : <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
                        Grade {r.overall_grade ?? "—"}
                      </Badge>
                  }
                  <span className="text-xs text-muted-foreground ml-auto">
                    {new Date(r.created_at).toLocaleString()} · {r.duration_ms ?? "—"} ms
                  </span>
                </div>

                {!failed && (
                  <div className="flex flex-wrap gap-1.5">
                    {SCORE_KEYS.map(([key, label]) => {
                      const v = r[key] as number | null;
                      const inverse = key === "cognitive_load_score";
                      return (
                        <span
                          key={String(key)}
                          className={`text-xs px-2 py-0.5 rounded ${scoreTone(v, inverse)}`}
                          title={inverse ? "Niedriger = besser" : "Höher = besser"}
                        >
                          {label}: {v ?? "—"}
                        </span>
                      );
                    })}
                  </div>
                )}

                {failed && r.error_text && (
                  <p className="text-xs text-rose-600 dark:text-rose-400">{r.error_text}</p>
                )}

                {!failed && r.report?.executive_summary && (
                  <p className="text-sm">{r.report.executive_summary}</p>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  className="h-7 px-2 text-xs"
                >
                  {expanded ? <ChevronUp className="h-3 w-3 mr-1" /> : <ChevronDown className="h-3 w-3 mr-1" />}
                  {expanded ? "Einklappen" : "Vollen Report anzeigen"}
                </Button>

                {expanded && !failed && <ReportDetail report={r.report} />}
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Section({ title, items, render }: { title: string; items: any[]; render: (it: any, i: number) => React.ReactNode }) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return (
    <div className="space-y-1">
      <h4 className="text-sm font-semibold">{title} <span className="text-muted-foreground font-normal">({items.length})</span></h4>
      <ul className="space-y-1 text-sm pl-4 list-disc">{items.slice(0, 20).map(render)}</ul>
    </div>
  );
}

function ReportDetail({ report }: { report: any }) {
  if (!report || typeof report !== "object") return null;
  const persona = report.persona_simulation ?? {};
  const onboarding = report.onboarding ?? {};
  const disc = report.feature_discoverability ?? {};
  const roadmap = report.roadmap ?? {};
  const votes: Array<{ role: string; score: number; statement: string }> = Array.isArray(report.council_votes) ? report.council_votes : [];

  return (
    <div className="grid gap-4 mt-2 pt-3 border-t md:grid-cols-2">
      <Section title="Top UX-Probleme" items={report.top_ux_problems ?? []} render={(p, i) => (
        <li key={i}><b>[{p.severity ?? "P2"}] {p.title}</b> — {p.problem} <span className="text-muted-foreground">({p.persona_impact})</span></li>
      )} />
      <Section title="Quick Wins" items={report.quick_wins ?? []} render={(q, i) => (
        <li key={i}><b>{q.title}</b> ({q.effort ?? "?"}) — {q.change} <span className="text-muted-foreground">→ {q.impact}</span></li>
      )} />
      <Section title="Conversion-Hebel" items={report.conversion_levers ?? []} render={(c, i) => (
        <li key={i}><b>[{c.priority ?? "P2"}] {c.title}</b> — {c.hypothesis} <span className="text-muted-foreground">({c.expected_uplift})</span></li>
      )} />
      <Section title="Motivations-Hebel" items={report.motivation_levers ?? []} render={(m, i) => (
        <li key={i}><b>{m.title}</b> — {m.intervention} <span className="text-muted-foreground">→ {m.expected_effect}</span></li>
      )} />
      <Section title="One-Click-Chancen" items={report.one_click_opportunities ?? []} render={(o, i) => (
        <li key={i}><b>{o.location}</b>: {o.current_flow} → <b>{o.optimized_flow}</b> <span className="text-muted-foreground">({o.impact})</span></li>
      )} />
      <Section title="UX Bridges Missing" items={report.ux_bridges_missing ?? []} render={(b, i) => (
        <li key={i}><b>{b.from_state}</b> → <b>{b.to_state}</b>: {b.why_critical} — Fix: {b.fix}</li>
      )} />
      <Section title="Cognitive Load Findings" items={report.cognitive_load_findings ?? []} render={(c, i) => (
        <li key={i}><b>{c.element}</b>: {c.issue} — {c.recommendation}</li>
      )} />

      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Onboarding</h4>
        <p className="text-sm">Time-to-First-Exam: <b>{onboarding.time_to_first_exam ?? "—"}</b> ({onboarding.rating ?? "—"})</p>
        {Array.isArray(onboarding.blockers) && onboarding.blockers.length > 0 && (
          <ul className="text-sm pl-4 list-disc">{onboarding.blockers.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul>
        )}
      </div>

      <div className="space-y-1">
        <h4 className="text-sm font-semibold">Feature-Discoverability</h4>
        <p className="text-sm">Score: <b>{disc.score ?? "—"}</b></p>
        {Array.isArray(disc.not_found) && disc.not_found.length > 0 && (
          <p className="text-sm text-rose-600 dark:text-rose-400">Nicht gefunden: {disc.not_found.join(", ")}</p>
        )}
      </div>

      <div className="space-y-1 md:col-span-2">
        <h4 className="text-sm font-semibold">Persona-Simulation</h4>
        <div className="grid gap-1 text-sm md:grid-cols-2">
          {Object.entries(persona).map(([k, v]) => (
            <p key={k}><b className="capitalize">{k.replace(/_/g, " ")}:</b> {String(v)}</p>
          ))}
        </div>
      </div>

      {votes.length > 0 && (
        <div className="space-y-1 md:col-span-2">
          <h4 className="text-sm font-semibold">Council-Votes</h4>
          <div className="grid gap-1 md:grid-cols-2 text-sm">
            {votes.map((v, i) => (
              <p key={i}>
                <span className={`inline-block w-10 text-center text-xs px-1 py-0.5 rounded mr-2 ${scoreTone(v.score)}`}>{v.score}</span>
                <b className="capitalize">{v.role.replace(/_/g, " ")}:</b> {v.statement}
              </p>
            ))}
          </div>
        </div>
      )}

      <div className="space-y-1 md:col-span-2">
        <h4 className="text-sm font-semibold">Roadmap</h4>
        <div className="grid gap-2 md:grid-cols-3 text-sm">
          <div>
            <p className="font-medium">Sofort</p>
            <ul className="pl-4 list-disc">{(roadmap.sofort ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Nächster Sprint</p>
            <ul className="pl-4 list-disc">{(roadmap.naechster_sprint ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
          </div>
          <div>
            <p className="font-medium">Später</p>
            <ul className="pl-4 list-disc">{(roadmap.spaeter ?? []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
          </div>
        </div>
      </div>
    </div>
  );
}

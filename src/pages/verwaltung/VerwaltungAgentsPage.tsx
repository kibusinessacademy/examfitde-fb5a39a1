/**
 * VerwaltungsAgentOS — Operations Console
 *
 * Route: /admin/verwaltung/agents
 *
 * Das ist KEIN Chat. Das ist eine kommunale Operations Console für
 * Fachbereichs-Workflows + Strict-RAG-Antwort mit Quellenpflicht.
 *
 * Linke Spalte: Fachbereiche (DNA + Workflow-Count).
 * Mitte: aktive Workflows (process / communication / governance / fachverfahren).
 * Rechts: Strict-RAG-Query mit deterministischen [SOURCES].
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  listVerwaltungAgents,
  getVerwaltungAgent,
  type VAgentSummary,
  type VAgentBundle,
  type VAgentWorkflow,
} from "@/lib/berufs-ki/occupational-intelligence";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Building2, Workflow, ShieldCheck, AlertTriangle, FileText, Radio, Loader2 } from "lucide-react";

interface AgentResponse {
  answer: string;
  sources: string[];
  department_key: string;
  department_name?: string;
  workflows_available?: number;
  workflows_considered?: number;
  llm_error?: string | null;
}

function categoryTone(c: VAgentWorkflow["category"]): string {
  switch (c) {
    case "process": return "bg-status-bg-info-subtle text-status-fg-info border-status-border-info";
    case "communication": return "bg-status-bg-success-subtle text-status-fg-success border-status-border-success";
    case "governance": return "bg-status-bg-warning-subtle text-status-fg-warning border-status-border-warning";
    case "fachverfahren": return "bg-status-bg-danger-subtle text-status-fg-danger border-status-border-danger";
    default: return "bg-muted text-muted-foreground border-border";
  }
}

export default function VerwaltungAgentsPage() {
  const [agents, setAgents] = useState<VAgentSummary[]>([]);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [bundle, setBundle] = useState<VAgentBundle | null>(null);
  const [bundleLoading, setBundleLoading] = useState(false);

  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [response, setResponse] = useState<AgentResponse | null>(null);

  useEffect(() => {
    listVerwaltungAgents().then((a) => {
      setAgents(a);
      if (a.length && !selected) setSelected(a[0].department_key);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selected) return;
    setBundleLoading(true);
    setResponse(null);
    getVerwaltungAgent(selected).then((b) => {
      setBundle(b);
      setBundleLoading(false);
    });
  }, [selected]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter((a) =>
      a.department_name.toLowerCase().includes(q) ||
      a.department_key.toLowerCase().includes(q) ||
      a.category.toLowerCase().includes(q));
  }, [agents, filter]);

  async function runAgent() {
    if (!selected || question.trim().length < 4) return;
    setRunning(true);
    setResponse(null);
    try {
      const { data, error } = await supabase.functions.invoke("verwaltung-agent", {
        body: { department_key: selected, question: question.trim() },
      });
      if (error) {
        setResponse({
          answer: "Anfrage fehlgeschlagen: " + (error.message ?? "unknown"),
          sources: [], department_key: selected, llm_error: error.message ?? null,
        });
      } else {
        setResponse(data as AgentResponse);
      }
    } finally {
      setRunning(false);
    }
  }

  const totalWorkflows = useMemo(() => agents.reduce((s, a) => s + (a.workflow_count ?? 0), 0), [agents]);

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card/40">
        <div className="container max-w-screen-2xl mx-auto px-4 py-5">
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-primary/10 p-2.5"><Building2 className="h-6 w-6 text-primary" /></div>
            <div className="flex-1 min-w-0">
              <h1 className="text-xl font-semibold tracking-tight">VerwaltungsAgentOS</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Operative Verwaltungsprozess-Intelligenz — Strict-RAG auf realen Fachverfahren, Workflows, Governance.
                Jede Antwort führt Quellen. Keine generischen KI-Antworten.
              </p>
            </div>
            <div className="hidden md:flex items-center gap-4 text-xs text-muted-foreground">
              <div className="text-right">
                <div className="font-mono text-base text-foreground tabular-nums">{agents.length}</div>
                <div>Fachbereiche</div>
              </div>
              <div className="text-right">
                <div className="font-mono text-base text-foreground tabular-nums">{totalWorkflows}</div>
                <div>aktive Workflows</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="container max-w-screen-2xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-12 gap-4">
        {/* Left: Fachbereichs-Liste */}
        <Card className="lg:col-span-3 p-3 h-[calc(100vh-180px)] flex flex-col">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Fachbereich suchen…"
            className="mb-2 h-9"
          />
          <ScrollArea className="flex-1 -mx-1">
            <div className="px-1 space-y-1">
              {agents.length === 0 ? (
                <>{[...Array(8)].map((_, i) => <Skeleton key={i} className="h-12" />)}</>
              ) : filtered.length === 0 ? (
                <p className="text-xs text-muted-foreground p-2">Kein Treffer.</p>
              ) : (
                filtered.map((a) => (
                  <button
                    key={a.department_key}
                    onClick={() => setSelected(a.department_key)}
                    className={`w-full text-left rounded-md px-2.5 py-2 border transition ${
                      selected === a.department_key
                        ? "border-primary bg-primary/5"
                        : "border-transparent hover:bg-muted/60"
                    }`}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-medium truncate">{a.department_name}</div>
                      <Badge variant="outline" className="text-[10px] tabular-nums">{a.workflow_count}</Badge>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{a.category}</div>
                  </button>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Middle: Workflows */}
        <Card className="lg:col-span-5 p-4 h-[calc(100vh-180px)] flex flex-col">
          <div className="flex items-center gap-2 mb-3">
            <Workflow className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Aktive Workflows</h2>
            {bundle?.workflows && (
              <Badge variant="outline" className="ml-auto tabular-nums">{bundle.workflows.length}</Badge>
            )}
          </div>
          <ScrollArea className="flex-1 -mx-1">
            <div className="px-1 space-y-3">
              {bundleLoading ? (
                [...Array(4)].map((_, i) => <Skeleton key={i} className="h-32" />)
              ) : !bundle?.workflows?.length ? (
                <p className="text-sm text-muted-foreground p-2">Keine aktiven Workflows.</p>
              ) : (
                bundle.workflows.map((w) => (
                  <div key={w.workflow_key} className="rounded-lg border border-border bg-card/40 p-3">
                    <div className="flex items-start gap-2">
                      <Badge variant="outline" className={`text-[10px] uppercase ${categoryTone(w.category)}`}>{w.category}</Badge>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-semibold truncate">{w.workflow_name}</h3>
                        <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{w.summary}</p>
                      </div>
                    </div>
                    {Array.isArray(w.process_steps) && w.process_steps.length > 0 && (
                      <ol className="mt-2.5 space-y-1 text-xs list-decimal pl-5 marker:text-muted-foreground">
                        {w.process_steps.slice(0, 5).map((s, i) => (
                          <li key={i} className="text-foreground/90">{s.step}</li>
                        ))}
                      </ol>
                    )}
                    <div className="grid grid-cols-3 gap-2 mt-3 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{(w.doc_outputs?.length ?? 0)} Docs</span>
                      <span className="flex items-center gap-1"><AlertTriangle className="h-3 w-3" />{(w.escalation_triggers?.length ?? 0)} Eskal.</span>
                      <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{(w.kpi_targets?.length ?? 0)} KPIs</span>
                    </div>
                    {w.governance_notes && (
                      <p className="mt-2 text-[11px] text-muted-foreground border-l-2 border-status-border-warning pl-2">
                        <span className="font-semibold">SSOT:</span> {w.governance_notes}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </Card>

        {/* Right: Strict-RAG Query */}
        <Card className="lg:col-span-4 p-4 h-[calc(100vh-180px)] flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <Radio className="h-4 w-4 text-muted-foreground" />
            <h2 className="text-sm font-semibold">Agent-Abfrage (Strict-RAG)</h2>
          </div>
          <p className="text-[11px] text-muted-foreground mb-3">
            Antworten basieren ausschließlich auf den oben gelisteten Workflows. Ohne tragende Quelle erfolgt eine Refusal-Antwort. Jede Anfrage wird auditiert.
          </p>
          <Textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="z. B. Wie laufen Eskalationen bei einem Drittwiderspruch?"
            className="min-h-[100px] text-sm"
          />
          <Button onClick={runAgent} disabled={running || !selected || question.trim().length < 4} className="mt-3 w-full">
            {running ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Anfrage läuft…</> : "Agent abfragen"}
          </Button>

          <ScrollArea className="flex-1 mt-3 -mx-1">
            <div className="px-1">
              {!response && !running && (
                <p className="text-xs text-muted-foreground p-2">Noch keine Anfrage. Wähle einen Fachbereich, stelle eine konkrete Frage.</p>
              )}
              {response && (
                <div className="space-y-3">
                  <div className="rounded-md border border-border bg-card/40 p-3">
                    <pre className="whitespace-pre-wrap text-xs text-foreground/95 font-sans leading-relaxed">{response.answer}</pre>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {response.sources.length === 0 ? (
                      <Badge variant="outline" className="text-[10px] bg-status-bg-warning-subtle text-status-fg-warning border-status-border-warning">
                        keine SSOT-Quelle zitiert
                      </Badge>
                    ) : (
                      response.sources.map((s) => (
                        <Badge key={s} variant="outline" className="text-[10px] font-mono">{s}</Badge>
                      ))
                    )}
                  </div>
                  {response.llm_error && (
                    <p className="text-[10px] text-status-fg-danger">
                      Hinweis: {response.llm_error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>
    </div>
  );
}

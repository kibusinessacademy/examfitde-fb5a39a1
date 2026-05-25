import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  fetchControlCenter, listAgentRuns, decideAgentRun,
  type AgentRun, type AgentRunStatus,
} from "@/lib/berufs-ki/agents";

const STATUS_FILTERS: (AgentRunStatus | "all")[] = ["awaiting_approval", "completed", "rejected", "escalated", "failed", "all"];

export default function BerufsKIControlCenterPage() {
  const { toast } = useToast();
  const [cc, setCc] = useState<Awaited<ReturnType<typeof fetchControlCenter>> | null>(null);
  const [runs, setRuns] = useState<AgentRun[]>([]);
  const [filter, setFilter] = useState<AgentRunStatus | "all">("awaiting_approval");

  const load = async () => {
    try {
      const [c, r] = await Promise.all([fetchControlCenter(), listAgentRuns(filter, 100)]);
      setCc(c);
      setRuns(r);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const onDecide = async (id: string, d: "approve" | "reject" | "escalate") => {
    try {
      await decideAgentRun(id, d);
      toast({ title: `Entscheidung: ${d}` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">AI Workforce Control Center</h1>
        <p className="text-muted-foreground">Phase 6F · Agenten, Approvals, Governance, Graph</p>
      </div>

      {cc && (
        <div className="grid gap-4 md:grid-cols-4">
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Aktive Agenten</div>
            <div className="text-2xl font-semibold">{cc.agents.active} / {cc.agents.total}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Runs 24h</div>
            <div className="text-2xl font-semibold">{cc.runs_24h.total}</div>
            <div className="text-xs text-muted-foreground">awaiting: {cc.runs_24h.awaiting_approval} · escalated: {cc.runs_24h.escalated} · failed: {cc.runs_24h.failed}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Governance HITL</div>
            <div className="text-2xl font-semibold">{cc.governance.agents_requiring_approval}</div>
            <div className="text-xs text-muted-foreground">Evolution offen: {cc.governance.pending_evolution}</div>
          </Card>
          <Card className="p-4">
            <div className="text-xs text-muted-foreground">Knowledge Graph</div>
            <div className="text-2xl font-semibold">{cc.graph.nodes} N / {cc.graph.edges} E</div>
            <div className="text-xs text-muted-foreground">Orchestrationen: {cc.orchestrations}</div>
          </Card>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>{s}</Button>
        ))}
      </div>

      <div className="space-y-3">
        {runs.map((r) => {
          const isPending = r.status === "awaiting_approval";
          return (
            <Card key={r.id} className="p-4 space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline">{r.agent_category}</Badge>
                <span className="font-medium">{r.agent_name}</span>
                <Badge variant={isPending ? "default" : "secondary"}>{r.status}</Badge>
                {r.confidence_score !== null && <Badge variant="outline">conf {r.confidence_score}</Badge>}
                <span className="text-xs text-muted-foreground ml-auto">{new Date(r.created_at).toLocaleString()}</span>
              </div>
              {r.input?.prompt && (
                <div className="text-xs text-muted-foreground">
                  <span className="font-medium">Prompt:</span> {r.input.prompt.slice(0, 200)}
                </div>
              )}
              {r.output?.text && (
                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-48 overflow-auto">{r.output.text}</pre>
              )}
              {r.error_message && <div className="text-xs text-destructive">{r.error_message}</div>}
              {isPending && (
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => onDecide(r.id, "approve")}>Approve</Button>
                  <Button size="sm" variant="destructive" onClick={() => onDecide(r.id, "reject")}>Reject</Button>
                  <Button size="sm" variant="outline" onClick={() => onDecide(r.id, "escalate")}>Escalate</Button>
                </div>
              )}
            </Card>
          );
        })}
        {runs.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground text-center">Keine Runs in diesem Filter.</Card>
        )}
      </div>
    </div>
  );
}

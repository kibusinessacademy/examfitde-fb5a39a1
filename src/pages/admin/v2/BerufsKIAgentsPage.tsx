import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import {
  listAgents, upsertAgent, runAgent, fetchAgentPerformance,
  AGENT_CATEGORIES, type Agent, type AgentCategory,
} from "@/lib/berufs-ki/agents";

export default function BerufsKIAgentsPage() {
  const { toast } = useToast();
  const [agents, setAgents] = useState<Agent[]>([]);
  const [perf, setPerf] = useState<Awaited<ReturnType<typeof fetchAgentPerformance>>>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [runOpen, setRunOpen] = useState<Agent | null>(null);
  const [runPrompt, setRunPrompt] = useState("");
  const [runResult, setRunResult] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  // form
  const [form, setForm] = useState<Partial<Agent> & { category: AgentCategory; role: string; slug: string; name: string }>(
    { slug: "", name: "", category: "communication", role: "communication", requires_human_approval: true, confidence_threshold: 0.75, is_active: true },
  );

  const refresh = async () => {
    try {
      const [a, p] = await Promise.all([listAgents(), fetchAgentPerformance(7)]);
      setAgents(a);
      setPerf(p);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };
  useEffect(() => { refresh(); }, []);

  const onSave = async () => {
    if (!form.slug || !form.name) return;
    try {
      await upsertAgent({
        slug: form.slug, name: form.name, description: form.description ?? "",
        category: form.category, role: form.role,
        requires_human_approval: form.requires_human_approval ?? true,
        confidence_threshold: Number(form.confidence_threshold ?? 0.75),
        is_active: form.is_active ?? true,
      });
      toast({ title: "Agent gespeichert" });
      setEditOpen(false);
      await refresh();
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onRun = async () => {
    if (!runOpen || !runPrompt.trim()) return;
    setRunning(true);
    setRunResult(null);
    try {
      const r = await runAgent(runOpen.slug, runPrompt.trim());
      setRunResult(`Status: ${r.status} · Confidence: ${r.confidence.toFixed(2)}\n\n${r.output}`);
    } catch (e: unknown) {
      setRunResult(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Berufs-KI Agenten</h1>
          <p className="text-muted-foreground">Phase 6 · Agent Operating System · Governance + HITL</p>
        </div>
        <Dialog open={editOpen} onOpenChange={setEditOpen}>
          <DialogTrigger asChild><Button>Neuer Agent</Button></DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader><DialogTitle>Agent anlegen / aktualisieren</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Slug</Label><Input value={form.slug ?? ""} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></div>
              <div><Label>Name</Label><Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
              <div><Label>Beschreibung</Label><Textarea value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Kategorie</Label>
                  <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v as AgentCategory })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{AGENT_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Rolle</Label><Input value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} /></div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Confidence-Threshold</Label>
                  <Input type="number" min={0} max={1} step={0.05} value={form.confidence_threshold ?? 0.75} onChange={(e) => setForm({ ...form, confidence_threshold: Number(e.target.value) })} />
                </div>
                <div className="flex items-center gap-2 mt-6">
                  <Switch checked={!!form.requires_human_approval} onCheckedChange={(v) => setForm({ ...form, requires_human_approval: v })} />
                  <Label>HITL-Approval</Label>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={!!form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                <Label>Aktiv</Label>
              </div>
            </div>
            <DialogFooter><Button onClick={onSave}>Speichern</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {agents.map((a) => {
          const stats = perf.find((p) => p.agent_id === a.id);
          return (
            <Card key={a.id} className="p-4 space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="font-semibold">{a.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{a.slug}</div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant="outline">{a.category}</Badge>
                  {a.requires_human_approval && <Badge variant="secondary" className="text-[10px]">HITL</Badge>}
                  {!a.is_active && <Badge variant="destructive" className="text-[10px]">inaktiv</Badge>}
                </div>
              </div>
              {a.description && <p className="text-xs text-muted-foreground line-clamp-3">{a.description}</p>}
              <div className="text-xs text-muted-foreground grid grid-cols-2 gap-1">
                <span>Threshold: {a.confidence_threshold}</span>
                <span>Runs 7d: {stats?.run_count ?? 0}</span>
                <span>Approvals offen: {stats?.awaiting_count ?? 0}</span>
                <span>∅ Conf: {stats?.avg_confidence ?? "—"}</span>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => {
                  setForm({ slug: a.slug, name: a.name, description: a.description ?? "",
                    category: a.category, role: a.role,
                    requires_human_approval: a.requires_human_approval, confidence_threshold: a.confidence_threshold,
                    is_active: a.is_active });
                  setEditOpen(true);
                }}>Bearbeiten</Button>
                <Button size="sm" disabled={!a.is_active} onClick={() => { setRunOpen(a); setRunResult(null); setRunPrompt(""); }}>
                  Run
                </Button>
              </div>
            </Card>
          );
        })}
      </div>

      <Dialog open={!!runOpen} onOpenChange={(o) => !o && setRunOpen(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Run · {runOpen?.name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <Textarea rows={6} placeholder="Aufgabe / Prompt…" value={runPrompt} onChange={(e) => setRunPrompt(e.target.value)} />
            <Button onClick={onRun} disabled={!runPrompt.trim() || running}>{running ? "Läuft…" : "Ausführen"}</Button>
            {runResult && (
              <Card className="p-3">
                <pre className="text-xs whitespace-pre-wrap">{runResult}</pre>
              </Card>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

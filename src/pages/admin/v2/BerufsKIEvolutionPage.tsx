import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  detectEvolutionCandidates, listEvolutionCandidates, decideEvolutionCandidate,
  type EvolutionCandidate,
} from "@/lib/berufs-ki/graph";

const RISK_VARIANT: Record<string, "default" | "secondary" | "destructive"> = {
  low: "secondary", medium: "default", high: "destructive",
};

export default function BerufsKIEvolutionPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<EvolutionCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<string>("detected");

  const load = async () => {
    setLoading(true);
    try {
      const data = await listEvolutionCandidates(filter === "all" ? undefined : filter);
      setItems(data);
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [filter]);

  const onDetect = async () => {
    try {
      const r = await detectEvolutionCandidates();
      toast({ title: "Detection abgeschlossen", description: `${r.inserted} neue Kandidaten` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  const onDecide = async (id: string, decision: "approve" | "reject" | "review") => {
    try {
      await decideEvolutionCandidate(id, decision);
      toast({ title: `Entscheidung: ${decision}` });
      await load();
    } catch (e: unknown) {
      toast({ title: "Fehler", description: e instanceof Error ? e.message : String(e), variant: "destructive" });
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Berufs-KI Evolution Engine</h1>
        <p className="text-muted-foreground">Phase 5D · Muster-Detection und Governance-Entscheidung</p>
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <Button onClick={onDetect}>Patterns neu erkennen</Button>
        {["detected", "under_review", "approved", "rejected", "all"].map((s) => (
          <Button key={s} size="sm" variant={filter === s ? "default" : "outline"} onClick={() => setFilter(s)}>{s}</Button>
        ))}
        <Button size="sm" variant="ghost" onClick={load} disabled={loading}>Aktualisieren</Button>
      </div>

      <div className="space-y-3">
        {items.map((c) => (
          <Card key={c.id} className="p-4 space-y-3">
            <div className="flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-0">
                <div className="font-medium">{c.detected_pattern}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  Pattern: {c.pattern_type} · Confidence: {c.confidence_score} · Quality Δ: {c.quality_delta ?? "—"}
                </div>
              </div>
              <Badge variant={RISK_VARIANT[c.governance_risk] ?? "default"}>Risk: {c.governance_risk}</Badge>
              <Badge variant="outline">{c.status}</Badge>
            </div>
            <pre className="text-xs bg-muted p-2 rounded overflow-auto">
              {JSON.stringify(c.suggested_improvements, null, 2)}
            </pre>
            {c.status === "detected" || c.status === "under_review" ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => onDecide(c.id, "approve")}>Approve</Button>
                <Button size="sm" variant="outline" onClick={() => onDecide(c.id, "review")}>Review</Button>
                <Button size="sm" variant="destructive" onClick={() => onDecide(c.id, "reject")}>Reject</Button>
              </div>
            ) : null}
          </Card>
        ))}
        {items.length === 0 && (
          <Card className="p-6 text-sm text-muted-foreground text-center">
            Keine Kandidaten in diesem Filter. Klick auf „Patterns neu erkennen", um zu detecten.
          </Card>
        )}
      </div>
    </div>
  );
}

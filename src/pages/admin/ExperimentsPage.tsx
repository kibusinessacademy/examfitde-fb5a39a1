import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  FlaskConical, Play, Pause, Square, Plus, Loader2, BarChart3, Users
} from "lucide-react";

const statusColors: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  running: "bg-success/10 text-success",
  paused: "bg-warning/10 text-warning",
  ended: "bg-primary/10 text-primary",
};

export default function ExperimentsPage() {
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [statsId, setStatsId] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", type: "learning" as string, councilId: "education", hypothesis: "", kpiName: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("experiment-api", { body: { action: "list" } });
      if (error) throw error;
      return data?.experiments || [];
    },
  });

  const { data: statsData, isLoading: statsLoading } = useQuery({
    queryKey: ["experiment-stats", statsId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("experiment-api", {
        body: { action: "stats", experimentId: statsId },
      });
      if (error) throw error;
      return data;
    },
    enabled: !!statsId,
  });

  const createMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("experiment-api", {
        body: { action: "create", ...form },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      toast.success("Experiment erstellt");
      qc.invalidateQueries({ queryKey: ["experiments"] });
      setShowCreate(false);
      setForm({ name: "", type: "learning", councilId: "education", hypothesis: "", kpiName: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statusMut = useMutation({
    mutationFn: async ({ experimentId, status }: { experimentId: string; status: string }) => {
      const { data, error } = await supabase.functions.invoke("experiment-api", {
        body: { action: "update_status", experimentId, status },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      toast.success("Status aktualisiert");
      qc.invalidateQueries({ queryKey: ["experiments"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const statsExperiment = statsId ? (data || []).find((e: Record<string, unknown>) => e.id === statsId) : null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground flex items-center gap-2">
            <FlaskConical className="h-6 w-6 text-primary" /> Experiment Engine
          </h1>
          <p className="text-sm text-muted-foreground">A/B Tests für SEO, Sales & Learning</p>
        </div>
        <Dialog open={showCreate} onOpenChange={setShowCreate}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-1" /> Neues Experiment</Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Experiment erstellen</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <Input placeholder="Name" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
              <Select value={form.type} onValueChange={v => setForm(f => ({ ...f, type: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="learning">Learning</SelectItem>
                  <SelectItem value="seo">SEO</SelectItem>
                  <SelectItem value="sales">Sales</SelectItem>
                </SelectContent>
              </Select>
              <Select value={form.councilId} onValueChange={v => setForm(f => ({ ...f, councilId: v }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["education", "marketing", "product", "tech", "analytics"].map(c => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input placeholder="Hypothese" value={form.hypothesis} onChange={e => setForm(f => ({ ...f, hypothesis: e.target.value }))} />
              <Input placeholder="KPI (z.B. conversion_rate)" value={form.kpiName} onChange={e => setForm(f => ({ ...f, kpiName: e.target.value }))} />
              <Button className="w-full" disabled={!form.name || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Erstellen
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Stats Modal */}
      <Dialog open={!!statsId} onOpenChange={(open) => { if (!open) setStatsId(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Stats: {(statsExperiment as Record<string, unknown>)?.name as string || "Experiment"}
            </DialogTitle>
          </DialogHeader>
          {statsLoading ? (
            <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-primary" /></div>
          ) : statsData ? (
            <div className="space-y-4">
              {/* Participants */}
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1">
                  <Users className="h-4 w-4 text-muted-foreground" /> Teilnehmer
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 text-center">
                    <p className="text-2xl font-bold text-foreground">{statsData.participants?.A ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Variante A</p>
                  </div>
                  <div className="p-3 rounded-lg bg-accent/30 border border-accent/40 text-center">
                    <p className="text-2xl font-bold text-foreground">{statsData.participants?.B ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Variante B</p>
                  </div>
                </div>
              </div>

              {/* Events by Variant */}
              <div>
                <h4 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1">
                  <BarChart3 className="h-4 w-4 text-muted-foreground" /> Events nach Variante
                </h4>
                {(() => {
                  const evA = (statsData.events?.A || {}) as Record<string, number>;
                  const evB = (statsData.events?.B || {}) as Record<string, number>;
                  const allTypes = [...new Set([...Object.keys(evA), ...Object.keys(evB)])];

                  if (allTypes.length === 0) {
                    return <p className="text-xs text-muted-foreground">Noch keine Events erfasst.</p>;
                  }

                  return (
                    <div className="border border-border rounded-lg overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="bg-muted/30">
                            <th className="text-left p-2 text-xs text-muted-foreground font-medium">Event</th>
                            <th className="text-center p-2 text-xs text-muted-foreground font-medium">A</th>
                            <th className="text-center p-2 text-xs text-muted-foreground font-medium">B</th>
                          </tr>
                        </thead>
                        <tbody>
                          {allTypes.map(type => (
                            <tr key={type} className="border-t border-border">
                              <td className="p-2 text-foreground">{type}</td>
                              <td className="p-2 text-center font-medium text-foreground">{evA[type] || 0}</td>
                              <td className="p-2 text-center font-medium text-foreground">{evB[type] || 0}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Keine Daten verfügbar.</p>
          )}
        </DialogContent>
      </Dialog>

      {isLoading ? (
        <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>
      ) : (data || []).length === 0 ? (
        <Card className="glass-card"><CardContent className="py-8 text-center text-muted-foreground">Keine Experimente vorhanden.</CardContent></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {(data || []).map((exp: Record<string, unknown>) => (
            <Card key={exp.id as string} className="glass-card">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base">{exp.name as string}</CardTitle>
                  <Badge className={statusColors[exp.status as string] || statusColors.draft}>{exp.status as string}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex gap-2">
                  <Badge variant="outline">{exp.type as string}</Badge>
                  <Badge variant="secondary">{exp.council_id as string}</Badge>
                </div>
                {exp.hypothesis && <p className="text-xs text-muted-foreground">{exp.hypothesis as string}</p>}
                {exp.kpi_name && <p className="text-xs text-muted-foreground">KPI: <strong>{exp.kpi_name as string}</strong></p>}
                <div className="flex gap-1.5 pt-2">
                  <Button size="sm" variant="outline" onClick={() => setStatsId(exp.id as string)}>
                    <BarChart3 className="h-3.5 w-3.5 mr-1" /> Stats
                  </Button>
                  {exp.status === "draft" && (
                    <Button size="sm" onClick={() => statusMut.mutate({ experimentId: exp.id as string, status: "running" })} disabled={statusMut.isPending}>
                      <Play className="h-3.5 w-3.5 mr-1" /> Starten
                    </Button>
                  )}
                  {exp.status === "running" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => statusMut.mutate({ experimentId: exp.id as string, status: "paused" })} disabled={statusMut.isPending}>
                        <Pause className="h-3.5 w-3.5 mr-1" /> Pause
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => statusMut.mutate({ experimentId: exp.id as string, status: "ended" })} disabled={statusMut.isPending}>
                        <Square className="h-3.5 w-3.5 mr-1" /> Beenden
                      </Button>
                    </>
                  )}
                  {exp.status === "paused" && (
                    <Button size="sm" onClick={() => statusMut.mutate({ experimentId: exp.id as string, status: "running" })} disabled={statusMut.isPending}>
                      <Play className="h-3.5 w-3.5 mr-1" /> Fortsetzen
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const [form, setForm] = useState({ name: "", type: "learning" as string, councilId: "education", hypothesis: "", kpiName: "" });

  const { data, isLoading } = useQuery({
    queryKey: ["experiments"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("experiment-api", { body: { action: "list" } });
      if (error) throw error;
      return data?.experiments || [];
    },
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

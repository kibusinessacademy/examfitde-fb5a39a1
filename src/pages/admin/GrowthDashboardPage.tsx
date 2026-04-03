import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Rocket, TrendingUp, Trophy, Play, RefreshCw, BarChart3, 
  FileText, Video, Clock, CheckCircle, XCircle, Loader2
} from "lucide-react";

function statusColor(s: string) {
  const map: Record<string, string> = {
    pending: "bg-yellow-500/10 text-yellow-700",
    dispatched: "bg-blue-500/10 text-blue-700",
    done: "bg-green-500/10 text-green-700",
    published: "bg-green-500/10 text-green-700",
    failed: "bg-red-500/10 text-red-700",
    dead: "bg-red-700/10 text-red-800",
    processing: "bg-purple-500/10 text-purple-700",
    queued: "bg-orange-500/10 text-orange-700",
  };
  return map[s] || "bg-muted text-muted-foreground";
}

export default function GrowthDashboardPage() {
  const qc = useQueryClient();
  const [perfForm, setPerfForm] = useState({ content_id: "", platform: "tiktok", views: 0, clicks: 0, conversions: 0 });

  // Queue items
  const { data: queueItems, isLoading: qLoading } = useQuery({
    queryKey: ["growth-queue"],
    queryFn: async () => {
      const { data } = await supabase
        .from("distribution_queue")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  // Performance data
  const { data: perfData } = useQuery({
    queryKey: ["growth-performance"],
    queryFn: async () => {
      const { data } = await supabase
        .from("content_performance")
        .select("*")
        .order("views", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  // Blog articles
  const { data: blogs } = useQuery({
    queryKey: ["growth-blogs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_articles")
        .select("id, title, slug, status, performance_score, total_views, is_winner, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  // Video scripts
  const { data: videos } = useQuery({
    queryKey: ["growth-videos"],
    queryFn: async () => {
      const { data } = await supabase
        .from("video_scripts")
        .select("id, format_type, hook_text, status, performance_score, total_views, is_winner, created_at")
        .order("created_at", { ascending: false })
        .limit(30);
      return data ?? [];
    },
  });

  // Distribution runs
  const { data: runs } = useQuery({
    queryKey: ["growth-runs"],
    queryFn: async () => {
      const { data } = await supabase
        .from("distribution_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  // Trigger distribution cron
  const runCron = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("distribution-cron", { body: {} });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`Distribution-Zyklus abgeschlossen: ${data?.steps?.length ?? 0} Steps`);
      qc.invalidateQueries({ queryKey: ["growth-queue"] });
      qc.invalidateQueries({ queryKey: ["growth-runs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Submit manual performance
  const submitPerf = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.functions.invoke("distribution-webhook", {
        body: {
          content_type: "video_script",
          content_id: perfForm.content_id,
          platform: perfForm.platform,
          views: perfForm.views,
          clicks: perfForm.clicks,
          conversions: perfForm.conversions,
        },
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Performance-Daten gespeichert");
      qc.invalidateQueries({ queryKey: ["growth-performance"] });
      setPerfForm({ content_id: "", platform: "tiktok", views: 0, clicks: 0, conversions: 0 });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Trigger content generation
  const genBlogs = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("content-blog-generate", { body: { count: 5 } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`${d?.generated ?? 0} Blog-Artikel generiert`);
      qc.invalidateQueries({ queryKey: ["growth-blogs"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const genVideos = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("content-video-generate", { body: { count: 5 } });
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      toast.success(`${d?.generated ?? 0} Video-Skripte generiert`);
      qc.invalidateQueries({ queryKey: ["growth-videos"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const totalBlogs = blogs?.length ?? 0;
  const totalVideos = videos?.length ?? 0;
  const winners = [...(blogs?.filter(b => b.is_winner) ?? []), ...(videos?.filter(v => v.is_winner) ?? [])];
  const pendingQueue = queueItems?.filter(q => q.status === "pending")?.length ?? 0;

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Growth Engine</h1>
          <p className="text-muted-foreground">Content-Automation, Distribution & Performance</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => genBlogs.mutate()} disabled={genBlogs.isPending}>
            {genBlogs.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <FileText className="w-4 h-4 mr-1" />}
            Blog generieren
          </Button>
          <Button variant="outline" size="sm" onClick={() => genVideos.mutate()} disabled={genVideos.isPending}>
            {genVideos.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Video className="w-4 h-4 mr-1" />}
            Video generieren
          </Button>
          <Button onClick={() => runCron.mutate()} disabled={runCron.isPending}>
            {runCron.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Rocket className="w-4 h-4 mr-1" />}
            Distribution starten
          </Button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><FileText className="w-4 h-4" /> Blog-Artikel</div>
            <div className="text-2xl font-bold mt-1">{totalBlogs}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Video className="w-4 h-4" /> Video-Skripte</div>
            <div className="text-2xl font-bold mt-1">{totalVideos}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Clock className="w-4 h-4" /> Queue (pending)</div>
            <div className="text-2xl font-bold mt-1">{pendingQueue}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-muted-foreground text-sm"><Trophy className="w-4 h-4" /> Winner</div>
            <div className="text-2xl font-bold mt-1">{winners.length}</div>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="queue">
        <TabsList>
          <TabsTrigger value="queue">Distribution Queue</TabsTrigger>
          <TabsTrigger value="content">Content</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
          <TabsTrigger value="manual">Manuelles Tracking</TabsTrigger>
          <TabsTrigger value="runs">Runs</TabsTrigger>
        </TabsList>

        {/* Queue Tab */}
        <TabsContent value="queue" className="space-y-2">
          {qLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" /> Lade Queue…
            </div>
          ) : (
            <div className="rounded-md border overflow-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left p-2">Kanal</th>
                    <th className="text-left p-2">Typ</th>
                    <th className="text-left p-2">Status</th>
                    <th className="text-left p-2">Geplant</th>
                    <th className="text-left p-2">Versuche</th>
                  </tr>
                </thead>
                <tbody>
                  {(queueItems ?? []).map((item: any) => (
                    <tr key={item.id} className="border-t">
                      <td className="p-2 font-mono text-xs">{item.channel_key}</td>
                      <td className="p-2 text-xs">{item.payload?.content_type ?? "campaign"}</td>
                      <td className="p-2"><Badge className={statusColor(item.status)}>{item.status}</Badge></td>
                      <td className="p-2 text-xs">{item.run_after ? new Date(item.run_after).toLocaleString("de") : "—"}</td>
                      <td className="p-2 text-xs">{item.attempts ?? 0}/{item.max_attempts ?? 5}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </TabsContent>

        {/* Content Tab */}
        <TabsContent value="content" className="space-y-4">
          <h3 className="font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Blog-Artikel</h3>
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Titel</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Score</th>
                  <th className="text-left p-2">Views</th>
                  <th className="text-left p-2">Winner</th>
                </tr>
              </thead>
              <tbody>
                {(blogs ?? []).map((b: any) => (
                  <tr key={b.id} className="border-t">
                    <td className="p-2 max-w-[300px] truncate">{b.title}</td>
                    <td className="p-2"><Badge className={statusColor(b.status)}>{b.status}</Badge></td>
                    <td className="p-2 font-mono">{Number(b.performance_score ?? 0).toFixed(1)}</td>
                    <td className="p-2">{b.total_views ?? 0}</td>
                    <td className="p-2">{b.is_winner ? <Trophy className="w-4 h-4 text-yellow-500" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="font-semibold flex items-center gap-2 mt-6"><Video className="w-4 h-4" /> Video-Skripte</h3>
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Hook</th>
                  <th className="text-left p-2">Format</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Score</th>
                  <th className="text-left p-2">Views</th>
                  <th className="text-left p-2">Winner</th>
                </tr>
              </thead>
              <tbody>
                {(videos ?? []).map((v: any) => (
                  <tr key={v.id} className="border-t">
                    <td className="p-2 max-w-[250px] truncate">{v.hook_text}</td>
                    <td className="p-2 text-xs font-mono">{v.format_type}</td>
                    <td className="p-2"><Badge className={statusColor(v.status)}>{v.status}</Badge></td>
                    <td className="p-2 font-mono">{Number(v.performance_score ?? 0).toFixed(1)}</td>
                    <td className="p-2">{v.total_views ?? 0}</td>
                    <td className="p-2">{v.is_winner ? <Trophy className="w-4 h-4 text-yellow-500" /> : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Performance Tab */}
        <TabsContent value="performance" className="space-y-2">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={async () => {
              try {
                const { data, error } = await supabase.functions.invoke("growth-score", { body: {} });
                if (error) throw error;
                toast.success(`Scores aktualisiert: ${data?.result?.scored ?? 0} bewertet, ${data?.result?.winners_updated ?? 0} Winner`);
                qc.invalidateQueries({ queryKey: ["growth-performance"] });
                qc.invalidateQueries({ queryKey: ["growth-blogs"] });
                qc.invalidateQueries({ queryKey: ["growth-videos"] });
              } catch (e: any) {
                toast.error(e.message);
              }
            }}>
              <RefreshCw className="w-4 h-4 mr-1" /> Scores berechnen
            </Button>
          </div>
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Plattform</th>
                  <th className="text-left p-2">Views</th>
                  <th className="text-left p-2">Clicks</th>
                  <th className="text-left p-2">CTR</th>
                  <th className="text-left p-2">Conversions</th>
                  <th className="text-left p-2">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {(perfData ?? []).map((p: any) => (
                  <tr key={p.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{p.platform}</td>
                    <td className="p-2">{p.views}</td>
                    <td className="p-2">{p.clicks}</td>
                    <td className="p-2 font-mono">{(Number(p.ctr ?? 0) * 100).toFixed(1)}%</td>
                    <td className="p-2">{p.conversions}</td>
                    <td className="p-2">{Number(p.revenue_eur ?? 0).toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        {/* Manual Tracking Tab */}
        <TabsContent value="manual" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-lg">Performance manuell eintragen</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-sm text-muted-foreground">Content-ID (UUID)</label>
                  <Input value={perfForm.content_id} onChange={e => setPerfForm(f => ({ ...f, content_id: e.target.value }))} placeholder="uuid..." />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Plattform</label>
                  <select className="w-full border rounded-md px-3 py-2 text-sm bg-background" value={perfForm.platform} onChange={e => setPerfForm(f => ({ ...f, platform: e.target.value }))}>
                    <option value="tiktok">TikTok</option>
                    <option value="instagram">Instagram</option>
                    <option value="youtube">YouTube</option>
                    <option value="blog">Blog/SEO</option>
                  </select>
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Views</label>
                  <Input type="number" value={perfForm.views} onChange={e => setPerfForm(f => ({ ...f, views: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Clicks</label>
                  <Input type="number" value={perfForm.clicks} onChange={e => setPerfForm(f => ({ ...f, clicks: Number(e.target.value) }))} />
                </div>
                <div>
                  <label className="text-sm text-muted-foreground">Conversions</label>
                  <Input type="number" value={perfForm.conversions} onChange={e => setPerfForm(f => ({ ...f, conversions: Number(e.target.value) }))} />
                </div>
              </div>
              <Button onClick={() => submitPerf.mutate()} disabled={submitPerf.isPending || !perfForm.content_id}>
                {submitPerf.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <BarChart3 className="w-4 h-4 mr-1" />}
                Speichern
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Runs Tab */}
        <TabsContent value="runs" className="space-y-2">
          <div className="rounded-md border overflow-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left p-2">Typ</th>
                  <th className="text-left p-2">Status</th>
                  <th className="text-left p-2">Verarbeitet</th>
                  <th className="text-left p-2">Erstellt</th>
                  <th className="text-left p-2">Gestartet</th>
                </tr>
              </thead>
              <tbody>
                {(runs ?? []).map((r: any) => (
                  <tr key={r.id} className="border-t">
                    <td className="p-2 font-mono text-xs">{r.run_type}</td>
                    <td className="p-2"><Badge className={statusColor(r.status)}>{r.status}</Badge></td>
                    <td className="p-2">{r.processed_count}</td>
                    <td className="p-2">{r.created_count}</td>
                    <td className="p-2 text-xs">{r.started_at ? new Date(r.started_at).toLocaleString("de") : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}

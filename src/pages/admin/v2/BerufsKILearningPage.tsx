/**
 * Berufs-KI Phase 5A/B — Workflow Learning Engine
 * Cluster Detection + Blueprint Materialization (admin-gated, governance-first).
 */
import { useEffect, useState } from "react";
import { Helmet } from "react-helmet-async";
import { Loader2, GitBranch, Sparkles, Layers, ArrowRight } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  adminListClusters,
  adminListBlueprintCandidates,
  adminRecomputeClusters,
  adminPromoteClusterToCandidate,
  adminMaterializeBlueprintCandidate,
  type ClusterRow,
  type BlueprintCandidateRow,
} from "@/lib/berufs-ki/learning";

export default function BerufsKILearningPage() {
  const [tab, setTab] = useState<"clusters" | "candidates">("clusters");
  const [clusters, setClusters] = useState<ClusterRow[] | null>(null);
  const [candidates, setCandidates] = useState<BlueprintCandidateRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [promoteFor, setPromoteFor] = useState<ClusterRow | null>(null);
  const [materializeFor, setMaterializeFor] = useState<BlueprintCandidateRow | null>(null);

  const load = async () => {
    try {
      const [c, b] = await Promise.all([adminListClusters(), adminListBlueprintCandidates()]);
      setClusters(c);
      setCandidates(b);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };
  useEffect(() => { void load(); }, []);

  const onRecompute = async () => {
    setBusy(true);
    try {
      const r = await adminRecomputeClusters(3);
      toast.success(`Cluster aktualisiert (+${r.inserted} neu, ${r.updated} aktualisiert).`);
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="container max-w-7xl py-8 space-y-6">
      <Helmet><title>Berufs-KI · Learning Engine</title></Helmet>

      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Workflow Learning Engine</h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Erkennt Muster über Community-Workflows, schlägt offizielle Blueprints vor und materialisiert sie nach Admin-Review zu Berufs-KI-Definitionen.
          </p>
        </div>
        <Button onClick={onRecompute} disabled={busy} variant="default">
          {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
          Cluster neu berechnen
        </Button>
      </header>

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="clusters" className="gap-2"><GitBranch className="h-4 w-4" /> Cluster ({clusters?.length ?? "…"})</TabsTrigger>
          <TabsTrigger value="candidates" className="gap-2"><Layers className="h-4 w-4" /> Blueprint-Kandidaten ({candidates?.length ?? "…"})</TabsTrigger>
        </TabsList>

        <TabsContent value="clusters" className="mt-6">
          {clusters === null ? <Skel /> : clusters.length === 0 ? (
            <Empty hint="Noch keine Cluster erkannt. Klicke „Cluster neu berechnen", sobald genug Submissions vorliegen." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {clusters.map((c) => (
                <Card key={c.id} className="overflow-hidden">
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-base truncate">{c.cluster_signature}</CardTitle>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge variant="secondary">{c.category}</Badge>
                          {c.beruf_slug && <Badge variant="outline">{c.beruf_slug}</Badge>}
                          <Badge variant={c.status === "promoted" ? "default" : "outline"}>{c.status}</Badge>
                          <Badge variant="outline">Confidence {(c.merge_confidence * 100).toFixed(0)}%</Badge>
                        </div>
                      </div>
                      <Badge className="shrink-0">{c.submission_count} Submissions</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {c.output_section_refs.length > 0 && (
                      <div>
                        <div className="text-xs uppercase text-muted-foreground mb-1">Häufige Output-Sektionen</div>
                        <div className="flex flex-wrap gap-1">
                          {c.output_section_refs.slice(0, 8).map((s) => <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>)}
                        </div>
                      </div>
                    )}
                    {c.common_patterns?.titles && c.common_patterns.titles.length > 0 && (
                      <div className="text-xs text-muted-foreground line-clamp-2">
                        Beispiele: {c.common_patterns.titles.slice(0, 3).join(" · ")}
                      </div>
                    )}
                    <div className="flex justify-end pt-1">
                      <Button size="sm" variant={c.status === "promoted" ? "outline" : "default"}
                        disabled={c.status === "promoted"}
                        onClick={() => setPromoteFor(c)}>
                        {c.status === "promoted" ? "Bereits gefördert" : (<>Zu Blueprint-Kandidat <ArrowRight className="ml-1.5 h-3.5 w-3.5" /></>)}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="candidates" className="mt-6">
          {candidates === null ? <Skel /> : candidates.length === 0 ? (
            <Empty hint="Noch keine Blueprint-Kandidaten. Fördere zuerst einen Cluster aus dem Tab links." />
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {candidates.map((b) => (
                <Card key={b.id}>
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="space-y-1 min-w-0">
                        <CardTitle className="text-base">{b.title}</CardTitle>
                        <p className="text-sm text-muted-foreground line-clamp-2">{b.description}</p>
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          <Badge variant="secondary">{b.category}</Badge>
                          <Badge variant={b.review_status === "materialized" ? "default" : "outline"}>{b.review_status}</Badge>
                          <Badge variant="outline">Confidence {(b.confidence_score * 100).toFixed(0)}%</Badge>
                        </div>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-3">
                    {b.suggested_output_schema?.sections && (
                      <div>
                        <div className="text-xs uppercase text-muted-foreground mb-1">Vorgeschlagene Sektionen</div>
                        <div className="flex flex-wrap gap-1">
                          {(b.suggested_output_schema.sections ?? []).slice(0, 8).map((s: string) =>
                            <Badge key={s} variant="secondary" className="font-normal">{s}</Badge>)}
                        </div>
                      </div>
                    )}
                    <div className="flex justify-end pt-1">
                      <Button size="sm" disabled={b.review_status === "materialized"}
                        onClick={() => setMaterializeFor(b)}>
                        {b.review_status === "materialized" ? "Materialisiert" : "Zu offizieller Definition"}
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {promoteFor && (
        <PromoteDialog cluster={promoteFor} onClose={() => setPromoteFor(null)} onDone={load} />
      )}
      {materializeFor && (
        <MaterializeDialog candidate={materializeFor} onClose={() => setMaterializeFor(null)} onDone={load} />
      )}
    </div>
  );
}

function Skel() { return <div className="text-sm text-muted-foreground"><Loader2 className="inline h-4 w-4 animate-spin mr-2" />Lade …</div>; }
function Empty({ hint }: { hint: string }) {
  return <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">{hint}</CardContent></Card>;
}

function PromoteDialog({ cluster, onClose, onDone }: { cluster: ClusterRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [title, setTitle] = useState(`Blueprint: ${cluster.category}${cluster.beruf_slug ? " · " + cluster.beruf_slug : ""}`);
  const [desc, setDesc] = useState(`Aus ${cluster.submission_count} Community-Workflows verdichteter Berufs-KI-Blueprint.`);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const r = await adminPromoteClusterToCandidate(cluster.id, title.trim(), desc.trim());
      toast.success(`Kandidat erstellt. ${r.notified} Beitragende benachrichtigt.`);
      await onDone();
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Cluster zu Blueprint-Kandidat fördern</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><label className="text-xs uppercase text-muted-foreground">Titel</label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div><label className="text-xs uppercase text-muted-foreground">Beschreibung</label><Textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={4} /></div>
          <p className="text-xs text-muted-foreground">Beitragende werden automatisch benachrichtigt.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy || !title.trim()}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Fördern</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MaterializeDialog({ candidate, onClose, onDone }: { candidate: BlueprintCandidateRow; onClose: () => void; onDone: () => Promise<void> }) {
  const [slug, setSlug] = useState(candidate.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60));
  const [systemPrompt, setSystemPrompt] = useState(
    `Du bist eine Berufs-KI-Spezialistin für ${candidate.category}. Liefere strukturierte, präzise Berufs-Outputs entlang der Sektionen: ${(candidate.suggested_output_schema?.sections ?? []).join(", ")}.`,
  );
  const [userPrompt, setUserPrompt] = useState(`Aufgabe: ${candidate.title}\n\nKontext: {{context}}\n\nLiefere strukturierte Sektionen.`);
  const [tier, setTier] = useState<"free" | "pro" | "business">("pro");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await adminMaterializeBlueprintCandidate({
        candidateId: candidate.id, slug: slug.trim(),
        systemPrompt: systemPrompt.trim(), userPromptTemplate: userPrompt.trim(), tier,
      });
      toast.success(`Definition erstellt: ${r.slug}`);
      await onDone();
      onClose();
    } catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Blueprint-Kandidat materialisieren</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="text-xs uppercase text-muted-foreground">Slug</label><Input value={slug} onChange={(e) => setSlug(e.target.value)} /></div>
            <div><label className="text-xs uppercase text-muted-foreground">Tier</label>
              <select className="w-full border rounded h-10 px-3 bg-background" value={tier} onChange={(e) => setTier(e.target.value as typeof tier)}>
                <option value="free">free</option><option value="pro">pro</option><option value="business">business</option>
              </select>
            </div>
          </div>
          <div><label className="text-xs uppercase text-muted-foreground">System Prompt</label><Textarea rows={4} value={systemPrompt} onChange={(e) => setSystemPrompt(e.target.value)} /></div>
          <div><label className="text-xs uppercase text-muted-foreground">User Prompt Template</label><Textarea rows={5} value={userPrompt} onChange={(e) => setUserPrompt(e.target.value)} /></div>
          <p className="text-xs text-muted-foreground">Wird als <code>workflow_class=blueprint_materialized</code> gespeichert. Beitragende werden benachrichtigt.</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Abbrechen</Button>
          <Button onClick={submit} disabled={busy || !slug.trim() || !systemPrompt.trim() || !userPrompt.trim()}>
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Materialisieren
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

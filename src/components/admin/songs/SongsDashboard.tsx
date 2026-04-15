import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Textarea } from "@/components/ui/textarea";
import {
  Music, Copy, ChevronDown, Loader2, CheckCircle, FileText, Type, Paintbrush,
  Sparkles, Wand2, ListMusic, BarChart3, Download, RefreshCw, Clipboard, Check, Zap, Upload
} from "lucide-react";
import { toast } from "sonner";
import { SongUploadDropzone } from "./SongUploadDropzone";

/* ─────────── helpers ─────────── */
function CopyBtn({ text, label, icon: Icon, variant = "outline" }: { text: string; label: string; icon: any; variant?: "outline" | "default" }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(`${label} kopiert`);
      setTimeout(() => setCopied(false), 2000);
    } catch { toast.error("Kopieren fehlgeschlagen"); }
  };
  return (
    <Button variant={variant} size="sm" onClick={copy} className="gap-1">
      {copied ? <Check className="h-3 w-3 text-primary" /> : <Icon className="h-3 w-3" />}
      {label}
    </Button>
  );
}

const STYLE_STANDARD = "Educational pop, German lyrics, very clear articulation, medium tempo, natural voice, minimal autotune, simple melody, motivational, clean production, focus on intelligibility";

export default function SongsDashboard() {
  const qc = useQueryClient();
  const [selectedCurriculum, setSelectedCurriculum] = useState<string>("");
  const [expandedSong, setExpandedSong] = useState<string | null>(null);
  const [aiResult, setAiResult] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [editingLyrics, setEditingLyrics] = useState<string | null>(null);
  const [editText, setEditText] = useState("");

  // Fetch all curricula
  const { data: curricula } = useQuery({
    queryKey: ["curricula-for-songs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("curricula")
        .select("id, title, short_title")
        .order("title");
      if (error) throw error;
      return data;
    },
  });

  // Fetch learning fields for selected curriculum
  const { data: learningFields } = useQuery({
    queryKey: ["lf-for-songs", selectedCurriculum],
    enabled: !!selectedCurriculum,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_fields")
        .select("id, code, title, description, weight_percent")
        .eq("curriculum_id", selectedCurriculum)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  // Fetch songs for selected curriculum
  const { data: songs, isLoading: songsLoading } = useQuery({
    queryKey: ["learning-field-songs", selectedCurriculum],
    enabled: !!selectedCurriculum,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_field_songs" as any)
        .select("*")
        .eq("curriculum_id", selectedCurriculum)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  // Fetch competencies for context
  const { data: competencies } = useQuery({
    queryKey: ["comps-for-songs", selectedCurriculum],
    enabled: !!selectedCurriculum,
    queryFn: async () => {
      const lfIds = learningFields?.map(lf => lf.id) || [];
      if (!lfIds.length) return [];
      const { data } = await supabase
        .from("competencies")
        .select("learning_field_id, title, action_verb")
        .in("learning_field_id", lfIds)
        .limit(500);
      return data || [];
    },
    enabled: !!learningFields?.length,
  });

  const compsByLf = useMemo(() => {
    const m: Record<string, string[]> = {};
    (competencies || []).forEach(c => {
      if (!m[c.learning_field_id]) m[c.learning_field_id] = [];
      m[c.learning_field_id].push(`${c.action_verb || ""} ${c.title}`.trim());
    });
    return m;
  }, [competencies]);

  const lfMap = useMemo(() => {
    const m = new Map<string, { code?: string; title?: string }>();
    (learningFields || []).forEach(lf => m.set(lf.id, { code: lf.code, title: lf.title }));
    return m;
  }, [learningFields]);

  const lfWithActiveSong = useMemo(
    () => new Set((songs || []).filter((s: any) => s.status !== "archived").map((s: any) => s.learning_field_id)),
    [songs]
  );

  const lfsWithoutSong = learningFields?.filter(lf => !lfWithActiveSong.has(lf.id)) || [];
  const currTitle = curricula?.find(c => c.id === selectedCurriculum)?.title || "";

  // Stats
  const totalSongs = songs?.length || 0;
  const drafts = songs?.filter((s: any) => s.status === "draft").length || 0;
  const exported = songs?.filter((s: any) => s.status === "exported").length || 0;
  const withAudio = songs?.filter((s: any) => s.status === "audio_uploaded").length || 0;
  const totalLfs = learningFields?.length || 0;
  const coverage = totalLfs ? Math.round((lfWithActiveSong.size / totalLfs) * 100) : 0;

  // Generate songs via edge function
  const generateMutation = useMutation({
    mutationFn: async (lfIds: string[]) => {
      const { data, error } = await supabase.functions.invoke("create-song-texts", {
        body: { curriculum_id: selectedCurriculum, learning_field_ids: lfIds },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.created} Songs erstellt, ${data.skipped} übersprungen`);
      qc.invalidateQueries({ queryKey: ["learning-field-songs", selectedCurriculum] });
    },
    onError: (err) => toast.error("Fehler: " + (err as Error).message),
  });

  // AI assistant call
  const callAI = async (action: string, context: string) => {
    setAiLoading(true);
    setAiResult("");
    try {
      const { data, error } = await supabase.functions.invoke("admin-ai-assistant", {
        body: { role: "songwriter", action, context },
      });
      if (error) throw error;
      setAiResult(data.result || "Keine Antwort");
    } catch (err) {
      toast.error("KI-Fehler: " + (err as Error).message);
    } finally {
      setAiLoading(false);
    }
  };

  // Bulk generate all missing
  const handleBulkGenerate = async () => {
    if (!lfsWithoutSong.length) {
      toast.info("Alle Lernfelder haben bereits Songs");
      return;
    }
    setBulkLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("create-song-texts", {
        body: { curriculum_id: selectedCurriculum, learning_field_ids: lfsWithoutSong.map(lf => lf.id) },
      });
      if (error) throw error;
      toast.success(`${data.created} Songs generiert!`);
      qc.invalidateQueries({ queryKey: ["learning-field-songs", selectedCurriculum] });
    } catch (err) {
      toast.error("Bulk-Fehler: " + (err as Error).message);
    } finally {
      setBulkLoading(false);
    }
  };

  // Export handler
  const handleExport = async (format: "json" | "csv" | "suno_txt") => {
    try {
      const { data, error } = await supabase.functions.invoke("export-learning-field-songs", {
        body: { curriculum_id: selectedCurriculum, format },
      });
      if (error) throw error;
      const content = typeof data === "string" ? data : JSON.stringify(data, null, 2);
      const ext = format === "suno_txt" ? "txt" : format;
      const mime = format === "csv" ? "text/csv" : format === "suno_txt" ? "text/plain" : "application/json";
      const blob = new Blob([content], { type: `${mime};charset=utf-8` });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `songs-${selectedCurriculum.slice(0, 8)}.${ext}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success(`${format.toUpperCase()} exportiert`);
    } catch (err) {
      toast.error("Export-Fehler: " + (err as Error).message);
    }
  };

  // Improve single song lyrics via AI
  const handleImproveLyrics = (song: any) => {
    const lf = lfMap.get(song.learning_field_id);
    callAI("improve_lyrics", `Lernfeld: ${lf?.code} – ${lf?.title}\n\nAktueller Songtext:\n${song.lyrics}`);
  };

  // Suggest style for LF
  const handleSuggestStyle = (lf: any) => {
    const comps = (compsByLf[lf.id] || []).slice(0, 6).join(", ");
    callAI("suggest_style", `Lernfeld: ${lf.code} – ${lf.title}\nBeschreibung: ${lf.description || "—"}\nGewichtung: ${lf.weight_percent || "?"}%\nKompetenzen: ${comps}`);
  };

  // Generate single song via AI
  const handleGenerateSingle = (lf: any) => {
    const comps = (compsByLf[lf.id] || []).slice(0, 8).join("\n- ");
    callAI("generate_song", `Kurs: ${currTitle}\nLernfeld: ${lf.code} – ${lf.title}\nBeschreibung: ${lf.description || "—"}\nGewichtung: ${lf.weight_percent || "?"}%\n${comps ? `Kompetenzen:\n- ${comps}` : ""}`);
  };

  const buildSunoCopyBlock = (song: any) => {
    const lf = lfMap.get(song.learning_field_id);
    const style = (song.style_prompt || STYLE_STANDARD).trim();
    const token = (song.export_token || "").trim();
    return [
      lf?.code ? `[${lf.code}] ${lf.title} — ${song.title}` : song.title,
      "", "=== SONGTEXT ===", (song.lyrics || "").trim(),
      "", "=== STYLE ===", style,
      "", "=== TOKEN ===", token, "",
    ].join("\n");
  };

  const statusBadge = (status: string) => {
    const map: Record<string, { label: string; variant: "default" | "secondary" | "destructive" | "outline" }> = {
      draft: { label: "Entwurf", variant: "secondary" },
      exported: { label: "Exportiert", variant: "outline" },
      audio_uploaded: { label: "Audio ✓", variant: "default" },
      archived: { label: "Archiviert", variant: "destructive" },
    };
    const s = map[status] || { label: status, variant: "secondary" as const };
    return <Badge variant={s.variant}>{s.label}</Badge>;
  };

  return (
    <div className="space-y-4">
      {/* Header + Kurs-Auswahl */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2">
            <Music className="h-5 w-5 text-primary" />
            Lernfeld-Songs · KI-Songwriter
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[240px]">
              <label className="text-xs font-medium text-muted-foreground mb-1 block">Kurs auswählen</label>
              <Select value={selectedCurriculum} onValueChange={setSelectedCurriculum}>
                <SelectTrigger><SelectValue placeholder="Kurs wählen…" /></SelectTrigger>
                <SelectContent>
                  {(curricula || []).map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.short_title || c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {selectedCurriculum && (
              <div className="flex gap-2">
                <Button size="sm" onClick={handleBulkGenerate} disabled={bulkLoading || !lfsWithoutSong.length} className="gap-1">
                  {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                  Alle fehlenden generieren ({lfsWithoutSong.length})
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!selectedCurriculum ? (
        <Card><CardContent className="py-12 text-center">
          <Music className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
          <p className="text-sm text-muted-foreground">Wähle einen Kurs aus, um Songs zu verwalten und zu generieren.</p>
        </CardContent></Card>
      ) : (
        <Tabs defaultValue="overview" className="w-full">
          <TabsList className="flex flex-wrap h-auto gap-1 bg-muted/50 p-1 rounded-xl">
            <TabsTrigger value="overview" className="text-xs py-1.5 gap-1 rounded-lg"><BarChart3 className="h-3 w-3" /> Übersicht</TabsTrigger>
            <TabsTrigger value="songs" className="text-xs py-1.5 gap-1 rounded-lg"><ListMusic className="h-3 w-3" /> Songs ({totalSongs})</TabsTrigger>
            <TabsTrigger value="generate" className="text-xs py-1.5 gap-1 rounded-lg"><Sparkles className="h-3 w-3" /> KI-Generator</TabsTrigger>
            <TabsTrigger value="export" className="text-xs py-1.5 gap-1 rounded-lg"><Download className="h-3 w-3" /> Export</TabsTrigger>
          </TabsList>

          {/* ────── OVERVIEW ────── */}
          <TabsContent value="overview" className="mt-4 space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Gesamt", value: totalSongs, icon: Music },
                { label: "Entwürfe", value: drafts, icon: FileText },
                { label: "Exportiert", value: exported, icon: Download },
                { label: "Mit Audio", value: withAudio, icon: CheckCircle },
                { label: "Abdeckung", value: `${coverage}%`, icon: BarChart3 },
              ].map(kpi => (
                <Card key={kpi.label}>
                  <CardContent className="p-4 text-center">
                    <kpi.icon className="h-5 w-5 mx-auto text-primary mb-1" />
                    <p className="text-2xl font-bold">{kpi.value}</p>
                    <p className="text-xs text-muted-foreground">{kpi.label}</p>
                  </CardContent>
                </Card>
              ))}
            </div>

            {lfsWithoutSong.length > 0 && (
              <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
                <CardContent className="p-4">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
                    ⚠️ {lfsWithoutSong.length} Lernfelder ohne Song
                  </p>
                  <div className="flex flex-wrap gap-1 mb-3">
                    {lfsWithoutSong.slice(0, 10).map(lf => (
                      <Badge key={lf.id} variant="outline" className="text-xs">{lf.code}</Badge>
                    ))}
                    {lfsWithoutSong.length > 10 && <Badge variant="outline" className="text-xs">+{lfsWithoutSong.length - 10}</Badge>}
                  </div>
                  <Button size="sm" onClick={handleBulkGenerate} disabled={bulkLoading} className="gap-1">
                    {bulkLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                    Alle auf einmal generieren
                  </Button>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ────── SONGS LIST ────── */}
          <TabsContent value="songs" className="mt-4 space-y-3">
            {songsLoading ? (
              <div className="flex justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : !songs?.length ? (
              <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">
                Noch keine Songs. Gehe zum KI-Generator Tab.
              </CardContent></Card>
            ) : (
              songs.map((song: any) => {
                const lf = lfMap.get(song.learning_field_id);
                return (
                  <Collapsible key={song.id} open={expandedSong === song.id} onOpenChange={open => setExpandedSong(open ? song.id : null)}>
                    <div className="border rounded-lg p-3">
                      <CollapsibleTrigger asChild>
                        <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded p-1 -m-1">
                          <div className="flex items-center gap-3 min-w-0">
                            {song.status === "audio_uploaded" ? <CheckCircle className="h-4 w-4 text-primary shrink-0" /> : <Music className="h-4 w-4 text-muted-foreground shrink-0" />}
                            <div className="min-w-0">
                              <span className="text-sm font-medium truncate block">{song.title}</span>
                              <span className="text-xs text-muted-foreground">{lf?.code}</span>
                            </div>
                            {statusBadge(song.status)}
                          </div>
                          <div className="flex items-center gap-2">
                            <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded hidden sm:inline">{song.export_token}</code>
                            <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform" />
                          </div>
                        </div>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-3 space-y-3">
                        {/* Copy buttons */}
                        <div className="flex flex-wrap gap-1.5">
                          <CopyBtn text={song.lyrics || ""} label="Songtext" icon={Type} />
                          <CopyBtn text={song.style_prompt || ""} label="Style" icon={Paintbrush} />
                          <CopyBtn text={song.export_token || ""} label="Token" icon={Clipboard} />
                          <CopyBtn text={buildSunoCopyBlock(song)} label="Suno Block" icon={Copy} variant="default" />
                        </div>

                        {/* Lyrics */}
                        <div className="bg-muted/50 rounded p-3">
                          <p className="text-xs text-muted-foreground mb-2">Style: {song.style_prompt}</p>
                          {editingLyrics === song.id ? (
                            <div className="space-y-2">
                              <Textarea value={editText} onChange={e => setEditText(e.target.value)} rows={12} className="font-mono text-sm" />
                              <div className="flex gap-2">
                                <Button size="sm" onClick={async () => {
                                  await supabase.from("learning_field_songs" as any).update({ lyrics: editText, updated_at: new Date().toISOString() }).eq("id", song.id);
                                  toast.success("Songtext gespeichert");
                                  setEditingLyrics(null);
                                  qc.invalidateQueries({ queryKey: ["learning-field-songs", selectedCurriculum] });
                                }}>Speichern</Button>
                                <Button variant="ghost" size="sm" onClick={() => setEditingLyrics(null)}>Abbrechen</Button>
                              </div>
                            </div>
                          ) : (
                            <pre className="text-sm whitespace-pre-wrap font-mono bg-background rounded p-3 max-h-64 overflow-y-auto cursor-pointer hover:ring-1 hover:ring-primary/30" onClick={() => { setEditingLyrics(song.id); setEditText(song.lyrics || ""); }}>
                              {song.lyrics}
                            </pre>
                          )}
                        </div>

                        {/* AI Actions */}
                        <div className="flex flex-wrap gap-1.5">
                          <Button variant="outline" size="sm" onClick={() => handleImproveLyrics(song)} disabled={aiLoading} className="gap-1">
                            <Wand2 className="h-3 w-3" /> KI: Text verbessern
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => {
                            const lf2 = lfMap.get(song.learning_field_id);
                            handleSuggestStyle(lf2 ? { ...lf2, id: song.learning_field_id, description: "", weight_percent: null } : { id: song.learning_field_id, code: "?", title: "?", description: "", weight_percent: null });
                          }} disabled={aiLoading} className="gap-1">
                            <Sparkles className="h-3 w-3" /> KI: Style-Empfehlung
                          </Button>
                        </div>

                        {/* Upload */}
                        {song.status !== "audio_uploaded" ? (
                          <SongUploadDropzone songId={song.id} exportToken={song.export_token} onSuccess={() => qc.invalidateQueries({ queryKey: ["learning-field-songs", selectedCurriculum] })} />
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-primary">
                            <CheckCircle className="h-4 w-4" />
                            Audio hochgeladen am {new Date(song.audio_uploaded_at).toLocaleDateString("de-DE")}
                          </div>
                        )}
                      </CollapsibleContent>
                    </div>
                  </Collapsible>
                );
              })
            )}
          </TabsContent>

          {/* ────── AI GENERATOR ────── */}
          <TabsContent value="generate" className="mt-4 space-y-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> KI-Songwriter
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Wähle ein Lernfeld aus und generiere auf Knopfdruck einen professionellen Lernsong. Die KI nutzt echte Lerninhalte, Kompetenzen und IHK-Schwerpunkte.
                </p>

                {/* Per LF generation */}
                <div className="space-y-2">
                  {learningFields?.map(lf => {
                    const hasSong = lfWithActiveSong.has(lf.id);
                    return (
                      <div key={lf.id} className={`flex items-center justify-between p-3 rounded-lg border ${hasSong ? "bg-muted/30" : "hover:bg-muted/50"}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs text-muted-foreground">{lf.code}</span>
                            <span className="text-sm font-medium truncate">{lf.title}</span>
                            {hasSong && <Badge variant="outline" className="text-xs">✓ Song</Badge>}
                          </div>
                          {lf.description && <p className="text-xs text-muted-foreground truncate mt-0.5">{lf.description}</p>}
                        </div>
                        <div className="flex gap-1 ml-2 shrink-0">
                          <Button variant="ghost" size="sm" onClick={() => handleSuggestStyle(lf)} disabled={aiLoading} title="Style-Empfehlung">
                            <Paintbrush className="h-3.5 w-3.5" />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => handleGenerateSingle(lf)} disabled={aiLoading} title="Song-Preview generieren">
                            <Sparkles className="h-3.5 w-3.5" />
                          </Button>
                          {!hasSong && (
                            <Button size="sm" onClick={() => generateMutation.mutate([lf.id])} disabled={generateMutation.isPending} className="gap-1">
                              {generateMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Zap className="h-3 w-3" />}
                              Erstellen
                            </Button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>

            {/* AI Result */}
            {(aiLoading || aiResult) && (
              <Card className="border-primary/30">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Wand2 className="h-4 w-4 text-primary" /> KI-Ergebnis
                    {aiLoading && <Loader2 className="h-4 w-4 animate-spin" />}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {aiResult ? (
                    <div className="space-y-3">
                      <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/50 rounded p-4 max-h-96 overflow-y-auto">{aiResult}</pre>
                      <div className="flex gap-2">
                        <CopyBtn text={aiResult} label="Ergebnis kopieren" icon={Copy} variant="default" />
                        <Button variant="ghost" size="sm" onClick={() => setAiResult("")}>Schließen</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> KI generiert…
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </TabsContent>

          {/* ────── EXPORT ────── */}
          <TabsContent value="export" className="mt-4 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Download className="h-4 w-4" /> Export & Suno-Integration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Exportiere alle Songs für externe Tools wie Suno AI. Der Suno-Block enthält Songtext, Style-Prompt und Token für Audio-Matching.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={() => handleExport("suno_txt")} disabled={!totalSongs} className="gap-1">
                    <Download className="h-4 w-4" /> Suno TXT Pack
                  </Button>
                  <Button variant="outline" onClick={() => handleExport("csv")} disabled={!totalSongs} className="gap-1">
                    <Download className="h-4 w-4" /> CSV
                  </Button>
                  <Button variant="outline" onClick={() => handleExport("json")} disabled={!totalSongs} className="gap-1">
                    <Download className="h-4 w-4" /> JSON
                  </Button>
                </div>

                {totalSongs > 0 && (
                  <div className="border rounded-lg p-4 bg-muted/30">
                    <p className="text-sm font-medium mb-2">Quick-Copy: Alle Suno-Blocks</p>
                    <p className="text-xs text-muted-foreground mb-3">Kopiert alle Songs als zusammenhängenden Text – ideal für Batch-Generierung in Suno.</p>
                    <CopyBtn
                      text={(songs || []).map((s: any) => buildSunoCopyBlock(s)).join("\n\n---\n\n")}
                      label={`Alle ${totalSongs} Suno-Blocks kopieren`}
                      icon={Copy}
                      variant="default"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

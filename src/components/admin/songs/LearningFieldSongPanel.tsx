import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Music, Copy, ChevronDown, Loader2, CheckCircle, FileText, Type, Paintbrush } from "lucide-react";
import { toast } from "sonner";
import { SongUploadDropzone } from "./SongUploadDropzone";
import { SongExportButton } from "./SongExportButton";

interface Props {
  curriculumId: string;
}

export function LearningFieldSongPanel({ curriculumId }: Props) {
  const qc = useQueryClient();
  const [expandedSong, setExpandedSong] = useState<string | null>(null);
  const [selectedLfIds, setSelectedLfIds] = useState<string[]>([]);

  // Fetch learning fields for selection
  const { data: learningFields } = useQuery({
    queryKey: ["learning-fields-for-songs", curriculumId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_fields")
        .select("id, code, title")
        .eq("curriculum_id", curriculumId)
        .order("sort_order");
      if (error) throw error;
      return data;
    },
  });

  const { data: songs, isLoading } = useQuery({
    queryKey: ["learning-field-songs", curriculumId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("learning_field_songs" as any)
        .select("*")
        .eq("curriculum_id", curriculumId)
        .order("created_at");
      if (error) throw error;
      return data as any[];
    },
  });

  const generateMutation = useMutation({
    mutationFn: async () => {
      const body: any = { curriculum_id: curriculumId };
      if (selectedLfIds.length > 0) {
        body.learning_field_ids = selectedLfIds;
      }
      const { data, error } = await supabase.functions.invoke("create-song-texts", { body });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      toast.success(`${data.created} erstellt, ${data.skipped} übersprungen${data.updated ? `, ${data.updated} aktualisiert` : ""}`);
      qc.invalidateQueries({ queryKey: ["learning-field-songs", curriculumId] });
      setSelectedLfIds([]);
    },
    onError: (err) => toast.error("Fehler: " + (err as Error).message),
  });

  const toggleLf = (lfId: string) => {
    setSelectedLfIds((prev) =>
      prev.includes(lfId) ? prev.filter((id) => id !== lfId) : [...prev, lfId]
    );
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

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    toast.success(`${label} kopiert`);
  };

  const buildSunoCopyBlock = (song: any) => {
    const lf = song.learning_field_code || "";
    const lfTitle = song.learning_field_title || "";
    return (
      song.suno_copy_block ||
      [
        lf ? `[${lf}] ${lfTitle} — ${song.title}` : song.title,
        "",
        "=== SONGTEXT ===",
        (song.lyrics || "").trim(),
        "",
        "=== STYLE ===",
        (song.style_prompt || "").trim(),
        "",
        "=== TOKEN ===",
        (song.export_token || "").trim(),
        "",
      ].join("\n")
    );
  };

  // Determine which LFs already have songs
  const lfWithSong = new Set(songs?.map((s: any) => s.learning_field_id) || []);
  // LFs without songs yet (for the selection)
  const lfsWithoutSong = learningFields?.filter((lf) => !lfWithSong.has(lf.id)) || [];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <Music className="h-5 w-5" />
          Bonus-Lernsongs
        </CardTitle>
        <div className="flex gap-2">
          <SongExportButton curriculumId={curriculumId} disabled={!songs?.length} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* LF Selection for generation */}
        {lfsWithoutSong.length > 0 && (
          <div className="border rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium text-muted-foreground">
              Lernfelder ohne Song ({lfsWithoutSong.length})
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 max-h-48 overflow-y-auto">
              {lfsWithoutSong.map((lf) => (
                <label
                  key={lf.id}
                  className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted/50 rounded px-2 py-1"
                >
                  <Checkbox
                    checked={selectedLfIds.includes(lf.id)}
                    onCheckedChange={() => toggleLf(lf.id)}
                  />
                  <span className="font-mono text-xs text-muted-foreground">{lf.code}</span>
                  <span className="truncate">{lf.title}</span>
                </label>
              ))}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Button
                onClick={() => generateMutation.mutate()}
                disabled={generateMutation.isPending}
                size="sm"
              >
                {generateMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                ) : (
                  <FileText className="h-4 w-4 mr-1" />
                )}
                {selectedLfIds.length > 0
                  ? `${selectedLfIds.length} Songtexte generieren`
                  : "Alle fehlenden generieren"}
              </Button>
              {selectedLfIds.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setSelectedLfIds([])}>
                  Auswahl aufheben
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Song list */}
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : !songs?.length ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Noch keine Songtexte vorhanden. Wähle oben Lernfelder aus und klicke auf „Songtexte generieren".
          </p>
        ) : (
          <div className="space-y-3">
            {songs.map((song: any) => (
              <Collapsible
                key={song.id}
                open={expandedSong === song.id}
                onOpenChange={(open) => setExpandedSong(open ? song.id : null)}
              >
                <div className="border rounded-lg p-3">
                  <CollapsibleTrigger asChild>
                    <div className="flex items-center justify-between cursor-pointer hover:bg-muted/50 rounded p-1 -m-1">
                      <div className="flex items-center gap-3 min-w-0">
                        {song.status === "audio_uploaded" ? (
                          <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                        ) : (
                          <Music className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-sm font-medium truncate">{song.title}</span>
                        {statusBadge(song.status)}
                      </div>
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                          {song.export_token}
                        </code>
                        <ChevronDown className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-3 space-y-3">
                    {/* Copy buttons row */}
                    <div className="flex flex-wrap gap-1.5">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyText(song.lyrics || "", "Songtext")}
                      >
                        <Type className="h-3 w-3 mr-1" />
                        Songtext
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => copyText(song.style_prompt || "", "Style")}
                      >
                        <Paintbrush className="h-3 w-3 mr-1" />
                        Style
                      </Button>
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => copyText(buildSunoCopyBlock(song), "Suno Copy-Block")}
                      >
                        <Copy className="h-3 w-3 mr-1" />
                        Suno Block
                      </Button>
                    </div>

                    {/* Lyrics preview */}
                    <div className="bg-muted/50 rounded p-3">
                      <p className="text-xs text-muted-foreground mb-2">
                        Style: {song.style_prompt}
                      </p>
                      <pre className="text-sm whitespace-pre-wrap font-mono bg-background rounded p-3 max-h-64 overflow-y-auto">
                        {song.lyrics}
                      </pre>
                    </div>

                    {/* Upload or status */}
                    {song.status !== "audio_uploaded" ? (
                      <SongUploadDropzone
                        songId={song.id}
                        exportToken={song.export_token}
                        onSuccess={() =>
                          qc.invalidateQueries({ queryKey: ["learning-field-songs", curriculumId] })
                        }
                      />
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-primary">
                        <CheckCircle className="h-4 w-4" />
                        Audio hochgeladen am{" "}
                        {new Date(song.audio_uploaded_at).toLocaleDateString("de-DE")}
                      </div>
                    )}
                  </CollapsibleContent>
                </div>
              </Collapsible>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

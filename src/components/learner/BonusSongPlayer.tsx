import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Music, ChevronDown, FileText } from "lucide-react";

interface Props {
  curriculumId: string;
  learningFieldId: string;
}

/**
 * Conditional bonus song player — only renders when audio is uploaded.
 */
export function BonusSongPlayer({ curriculumId, learningFieldId }: Props) {
  const [showLyrics, setShowLyrics] = useState(false);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const { data: song } = useQuery({
    queryKey: ["bonus-song", curriculumId, learningFieldId],
    queryFn: async () => {
      // Use raw rpc/fetch to avoid type issues with new table
      const { data, error } = await (supabase as any)
        .from("learning_field_songs")
        .select("id, title, lyrics, audio_storage_path, export_token")
        .eq("curriculum_id", curriculumId)
        .eq("learning_field_id", learningFieldId)
        .eq("status", "audio_uploaded")
        .limit(1)
        .maybeSingle();

      if (error || !data) return null;
      const row = data as { id: string; title: string; lyrics: string; audio_storage_path: string | null; export_token: string };

      // Get signed URL for audio
      if (row.audio_storage_path) {
        const { data: urlData } = await supabase.storage
          .from("bonus-songs")
          .createSignedUrl(row.audio_storage_path, 3600);

        if (urlData?.signedUrl) {
          setAudioUrl(urlData.signedUrl);
        }
      }

      return row;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Don't render anything if no uploaded song exists
  if (!song) return null;

  return (
    <div className="rounded-lg border bg-card p-4 mt-4">
      <div className="flex items-center gap-2 mb-3">
        <Music className="h-5 w-5 text-primary" />
        <span className="font-medium text-sm">🎵 Bonus: Lernsong</span>
      </div>

      <p className="text-sm text-muted-foreground mb-3">{song.title}</p>

      {audioUrl && (
        <audio controls className="w-full mb-3" preload="none">
          <source src={audioUrl} />
          Dein Browser unterstützt kein Audio.
        </audio>
      )}

      <Collapsible open={showLyrics} onOpenChange={setShowLyrics}>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="sm" className="text-xs">
            <FileText className="h-3 w-3 mr-1" />
            Songtext {showLyrics ? "ausblenden" : "anzeigen"}
            <ChevronDown className={`h-3 w-3 ml-1 transition-transform ${showLyrics ? "rotate-180" : ""}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="text-sm whitespace-pre-wrap font-mono bg-muted/50 rounded p-3 mt-2 max-h-48 overflow-y-auto">
            {song.lyrics}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button";
import { Upload, Loader2, CheckCircle } from "lucide-react";
import { toast } from "sonner";

interface Props {
  songId: string;
  exportToken: string;
  onSuccess: () => void;
}

export function SongUploadDropzone({ songId, exportToken, onSuccess }: Props) {
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const uploadFile = useCallback(
    async (file: File) => {
      if (!file.type.match(/^audio\//i) && !file.name.match(/\.(mp3|wav|ogg|webm)$/i)) {
        toast.error("Nur Audiodateien (MP3, WAV, OGG, WebM) erlaubt");
        return;
      }

      setUploading(true);
      try {
        const formData = new FormData();
        formData.append("song_id", songId);
        formData.append("export_token", exportToken);
        formData.append("audio", file);

        const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
        const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

        const res = await fetch(`${supabaseUrl}/functions/v1/upload-bonus-song`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${anonKey}`,
          },
          body: formData,
        });

        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Upload fehlgeschlagen");

        toast.success("Audio hochgeladen und verknüpft!");
        onSuccess();
      } catch (err) {
        toast.error("Upload fehlgeschlagen: " + (err as Error).message);
      } finally {
        setUploading(false);
      }
    },
    [songId, exportToken, onSuccess]
  );

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
  };

  return (
    <div
      className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${
        dragOver ? "border-primary bg-primary/5" : "border-muted-foreground/25"
      }`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {uploading ? (
        <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Wird hochgeladen...
        </div>
      ) : (
        <>
          <Upload className="h-6 w-6 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-2">
            Audio-Datei hierher ziehen oder
          </p>
          <label>
            <input
              type="file"
              accept="audio/*,.mp3,.wav,.ogg,.webm"
              className="hidden"
              onChange={handleFileInput}
            />
            <Button variant="outline" size="sm" asChild>
              <span>Datei auswählen</span>
            </Button>
          </label>
        </>
      )}
    </div>
  );
}

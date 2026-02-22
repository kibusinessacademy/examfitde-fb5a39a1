import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smile, ThumbsUp, ThumbsDown, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

type Humor = {
  id: string;
  text: string;
  humor_type: string;
  tone: "business" | "casual";
  modernity_level: number;
};

interface DailyHumorCardProps {
  certificationId: string;
}

export function DailyHumorCard({ certificationId }: DailyHumorCardProps) {
  const [humor, setHumor] = useState<Humor | null>(null);
  const [fallbackText, setFallbackText] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [vote, setVote] = useState<-1 | 1 | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);

  useEffect(() => {
    let alive = true;

    const fetchHumor = async () => {
      setLoading(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const params = new URLSearchParams({
          certification_id: certificationId,
          tone: "auto",
          modernity: "40-80",
          mode: "daily",
        });

        const res = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-daily-humor?${params}`,
          {
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            },
          }
        );

        const json = await res.json();
        if (!alive) return;

        setHumor(json?.humor ?? null);
        setFallbackText(json?.fallback?.text ?? null);
      } catch (err) {
        console.error("[DailyHumorCard] fetch error", err);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchHumor();
    return () => { alive = false; };
  }, [certificationId]);

  const handleVote = async (v: -1 | 1) => {
    if (!humor || voteSaving) return;
    setVoteSaving(true);
    setVote(v);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("humor_feedback" as any).upsert(
        { humor_id: humor.id, user_id: user.id, vote: v },
        { onConflict: "humor_id,user_id" }
      );
    } catch (err) {
      console.error("[DailyHumorCard] vote error", err);
    } finally {
      setVoteSaving(false);
    }
  };

  const displayText = humor?.text ?? fallbackText;
  if (!displayText && !loading) return null;

  const toneLabel = humor?.tone === "casual" ? "locker" : humor?.tone === "business" ? "business" : "";

  return (
    <Card className="glass-card border-primary/10 overflow-hidden">
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Smile className="h-4 w-4 text-primary" />
            <span className="text-sm font-display font-semibold">Witz des Tages</span>
          </div>
          {toneLabel && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
              {toneLabel}
            </span>
          )}
        </div>

        {loading ? (
          <div className="flex items-center gap-2 py-3">
            <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Lade Humor…</span>
          </div>
        ) : (
          <>
            <p className="text-sm leading-relaxed">{displayText}</p>

            {humor && (
              <div className="flex items-center gap-2 mt-3">
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-7 px-2", vote === 1 && "text-primary bg-primary/10")}
                  onClick={() => handleVote(1)}
                  disabled={voteSaving}
                >
                  <ThumbsUp className="h-3.5 w-3.5 mr-1" />
                  <span className="text-xs">Gut</span>
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={cn("h-7 px-2", vote === -1 && "text-destructive bg-destructive/10")}
                  onClick={() => handleVote(-1)}
                  disabled={voteSaving}
                >
                  <ThumbsDown className="h-3.5 w-3.5 mr-1" />
                  <span className="text-xs">Naja</span>
                </Button>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground mt-2 opacity-60">
              Berufsbezogen • geprüft • sicher
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

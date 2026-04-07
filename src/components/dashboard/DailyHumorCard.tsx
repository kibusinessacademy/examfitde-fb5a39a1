import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Smile, ThumbsUp, ThumbsDown, RefreshCw, EyeOff } from "lucide-react";
import { HumorShareButtons } from "./HumorShareButtons";
import { cn } from "@/lib/utils";
import { useTerminology } from "@/hooks/useProgramType";

type Humor = {
  id: string;
  text: string;
  humor_type: string;
  tone: "business" | "casual";
  modernity_level: number;
};

type HumorPrefs = {
  humor_enabled: boolean;
  humor_push_enabled: boolean;
  tone_preference: string;
  modernity_range: string;
};

type HumorResponse = {
  disabled?: boolean;
  humor?: Humor | null;
  fallback?: { text: string } | null;
  prefs?: HumorPrefs;
};

interface DailyHumorCardProps {
  certificationId?: string;
  curriculumId?: string;
}

export function DailyHumorCard({ certificationId, curriculumId }: DailyHumorCardProps) {
  const [data, setData] = useState<HumorResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [vote, setVote] = useState<-1 | 1 | null>(null);
  const [voteSaving, setVoteSaving] = useState(false);
  const [resolvedCertId, setResolvedCertId] = useState<string | null>(certificationId ?? null);
  const { t } = useTerminology(curriculumId);

  // Resolve certification_id from curriculum_id if needed
  useEffect(() => {
    if (certificationId) {
      setResolvedCertId(certificationId);
      return;
    }
    if (!curriculumId) return;

    (async () => {
      const { data: pkg } = await supabase
        .from("course_packages")
        .select("certification_id")
        .eq("curriculum_id", curriculumId)
        .not("certification_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (pkg?.certification_id) {
        setResolvedCertId(pkg.certification_id);
      }
    })();
  }, [certificationId, curriculumId]);

  useEffect(() => {
    if (!resolvedCertId) return;
    let alive = true;

    const fetchHumor = async () => {
      setLoading(true);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData?.session?.access_token;

        const params = new URLSearchParams({
          certification_id: resolvedCertId,
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
        setData(json);
      } catch (err) {
        console.error("[DailyHumorCard] fetch error", err);
      } finally {
        if (alive) setLoading(false);
      }
    };

    fetchHumor();
    return () => { alive = false; };
  }, [resolvedCertId]);

  const handleVote = async (v: -1 | 1) => {
    if (!data?.humor || voteSaving) return;
    setVoteSaving(true);
    setVote(v);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from("humor_feedback" as any).upsert(
        { humor_id: data.humor.id, user_id: user.id, vote: v },
        { onConflict: "humor_id,user_id" }
      );
    } catch (err) {
      console.error("[DailyHumorCard] vote error", err);
    } finally {
      setVoteSaving(false);
    }
  };

  // Not yet resolved
  if (!resolvedCertId && !loading) return null;

  // Opt-out: show minimal disabled state
  if (!loading && data?.disabled) {
    return (
      <Card className="glass-card border-muted/20 overflow-hidden">
        <CardContent className="p-4">
          <div className="flex items-center gap-2">
            <EyeOff className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Tageswitz deaktiviert</span>
          </div>
          <p className="text-xs text-muted-foreground mt-1 opacity-60">
            Du kannst ihn in den Einstellungen wieder aktivieren.
          </p>
        </CardContent>
      </Card>
    );
  }

  const displayText = data?.humor?.text ?? data?.fallback?.text;
  if (!displayText && !loading) return null;

  const toneLabel = data?.humor?.tone === "casual" ? "locker" : data?.humor?.tone === "business" ? "business" : "";

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

            {data?.humor && (
              <div className="flex items-center gap-2 mt-3 flex-wrap">
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
                <div className="ml-auto">
                  <HumorShareButtons humorId={data.humor.id} humorText={data.humor.text} />
                </div>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground mt-2 opacity-60">
              {t('humorFooter')}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

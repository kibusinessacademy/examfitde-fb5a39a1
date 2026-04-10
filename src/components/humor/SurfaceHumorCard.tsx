import { Smile, ThumbsUp, ThumbsDown, Sparkles } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useHumorForSurface, type HumorSurface } from "@/hooks/useHumorForSurface";

interface SurfaceHumorCardProps {
  certificationId: string | null | undefined;
  surface: HumorSurface;
  competenceId?: string | null;
  lessonId?: string | null;
  /** Compact inline style for lesson/minicheck contexts */
  variant?: "card" | "inline";
  className?: string;
}

const surfaceLabels: Partial<Record<HumorSurface, string>> = {
  lesson_intro: "Zum Start",
  lesson_outro: "Zum Abschluss",
  minicheck_intro: "Kurz durchatmen…",
  minicheck_result: "Gut gemacht!",
  exam_break: "Kurze Pause",
};

const surfaceIcons: Partial<Record<HumorSurface, typeof Smile>> = {
  lesson_intro: Sparkles,
  lesson_outro: Smile,
  minicheck_result: Sparkles,
};

export function SurfaceHumorCard({
  certificationId,
  surface,
  competenceId,
  lessonId,
  variant = "card",
  className,
}: SurfaceHumorCardProps) {
  const { item, loading, disabled, trackReaction } = useHumorForSurface({
    certificationId,
    surface,
    competenceId,
    lessonId,
  });
  const [vote, setVote] = useState<"liked" | "disliked" | null>(null);

  if (loading || disabled || !item) return null;

  const Icon = surfaceIcons[surface] ?? Smile;
  const label = surfaceLabels[surface] ?? "Witz des Tages";

  const handleVote = (v: "liked" | "disliked") => {
    setVote(v);
    trackReaction(v);
  };

  if (variant === "inline") {
    return (
      <div className={cn("flex items-start gap-3 py-3 px-4 rounded-lg bg-muted/30 border border-muted/20", className)}>
        <Icon className="h-4 w-4 text-primary mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">{label}</p>
          <p className="text-sm leading-relaxed">{item.text}</p>
          <div className="flex items-center gap-1 mt-2">
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 px-1.5", vote === "liked" && "text-primary bg-primary/10")}
              onClick={() => handleVote("liked")}
            >
              <ThumbsUp className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className={cn("h-6 px-1.5", vote === "disliked" && "text-destructive bg-destructive/10")}
              onClick={() => handleVote("disliked")}
            >
              <ThumbsDown className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("glass-card rounded-xl p-4 border border-primary/10", className)}>
      <div className="flex items-center gap-2 mb-2">
        <Icon className="h-4 w-4 text-primary" />
        <span className="text-sm font-display font-semibold">{label}</span>
        {item.tone && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground ml-auto">
            {item.tone === "casual" ? "locker" : item.tone === "business" ? "business" : ""}
          </span>
        )}
      </div>
      <p className="text-sm leading-relaxed">{item.text}</p>
      <div className="flex items-center gap-2 mt-3">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2", vote === "liked" && "text-primary bg-primary/10")}
          onClick={() => handleVote("liked")}
        >
          <ThumbsUp className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Gut</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-7 px-2", vote === "disliked" && "text-destructive bg-destructive/10")}
          onClick={() => handleVote("disliked")}
        >
          <ThumbsDown className="h-3.5 w-3.5 mr-1" />
          <span className="text-xs">Naja</span>
        </Button>
      </div>
    </div>
  );
}

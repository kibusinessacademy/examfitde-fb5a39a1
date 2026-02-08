import { useRef, useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { type LessonStatus, getStatusLabel } from "@/hooks/useCourseProgress";
import { CheckCircle, AlertTriangle, XCircle, PlayCircle, Circle, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CompetencyProgress {
  competency_code: string;
  competency_title: string | null;
  status: LessonStatus;
  mastery_level: number;
  lesson_count: number;
}

interface CompetencyProgressGridProps {
  competencies: CompetencyProgress[];
}

const STATUS_CONFIG = {
  mastered: {
    variant: "default" as const,
    className: "bg-green-500 hover:bg-green-600",
    icon: CheckCircle,
    progressColor: "bg-green-500",
    glowColor: "shadow-green-500/20",
  },
  partial: {
    variant: "secondary" as const,
    className: "bg-yellow-500 hover:bg-yellow-600 text-yellow-950",
    icon: AlertTriangle,
    progressColor: "bg-yellow-500",
    glowColor: "shadow-yellow-500/20",
  },
  not_mastered: {
    variant: "destructive" as const,
    className: "",
    icon: XCircle,
    progressColor: "bg-red-500",
    glowColor: "shadow-red-500/20",
  },
  in_progress: {
    variant: "outline" as const,
    className: "border-blue-500 text-blue-500",
    icon: PlayCircle,
    progressColor: "bg-blue-500",
    glowColor: "shadow-blue-500/20",
  },
  not_started: {
    variant: "outline" as const,
    className: "",
    icon: Circle,
    progressColor: "bg-muted-foreground",
    glowColor: "",
  },
} as const;

interface AnimatedCompetencyCardProps {
  competency: CompetencyProgress;
  index: number;
}

function AnimatedCompetencyCard({ competency: c, index }: AnimatedCompetencyCardProps) {
  const [prevMastery, setPrevMastery] = useState(c.mastery_level);
  const [isAnimating, setIsAnimating] = useState(false);
  const [showIncrease, setShowIncrease] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);

  const config = STATUS_CONFIG[c.status];
  const Icon = config.icon;
  const masteryPercent = Math.max(0, Math.min(100, Math.round(c.mastery_level)));

  // Detect mastery level changes and trigger animation
  useEffect(() => {
    if (c.mastery_level !== prevMastery) {
      const increased = c.mastery_level > prevMastery;
      setIsAnimating(true);
      setShowIncrease(increased);
      setPrevMastery(c.mastery_level);

      const timer = setTimeout(() => {
        setIsAnimating(false);
        setShowIncrease(false);
      }, 1000);

      return () => clearTimeout(timer);
    }
  }, [c.mastery_level, prevMastery]);

  return (
    <Card
      ref={cardRef}
      className={cn(
        "glass-card group hover:border-primary/30 transition-all duration-300",
        isAnimating && "animate-scale-in shadow-lg",
        isAnimating && config.glowColor && `shadow-xl ${config.glowColor}`
      )}
      style={{
        animationDelay: `${index * 50}ms`,
      }}
    >
      <CardContent className="p-4 space-y-3 relative overflow-hidden">
        {/* Increase indicator */}
        {showIncrease && (
          <div className="absolute top-2 right-2 animate-fade-in">
            <div className="flex items-center gap-1 text-green-500 text-xs font-medium bg-green-500/10 px-2 py-1 rounded-full">
              <TrendingUp className="h-3 w-3" />
              +{Math.round(c.mastery_level - prevMastery)}%
            </div>
          </div>
        )}

        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className={cn(
              "font-medium truncate transition-colors",
              "group-hover:text-primary",
              isAnimating && c.status === "mastered" && "text-green-500"
            )}>
              {c.competency_title || "Unbekannte Kompetenz"}
            </p>
            <p className="text-xs text-muted-foreground truncate">{c.competency_code}</p>
          </div>
          <Badge 
            variant={config.variant} 
            className={cn(
              config.className,
              "transition-transform",
              isAnimating && "animate-scale-in"
            )}
          >
            <Icon className={cn("h-3 w-3 mr-1", isAnimating && "animate-pulse")} />
            {getStatusLabel(c.status)}
          </Badge>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{c.lesson_count} Lektionen</span>
            <span className={cn(
              "font-medium transition-all",
              isAnimating && "text-primary scale-110"
            )}>
              {masteryPercent}%
            </span>
          </div>
          <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn(
                "h-full transition-all duration-700 ease-out",
                config.progressColor,
                isAnimating && "animate-pulse"
              )}
              style={{ width: `${masteryPercent}%` }}
            />
            {/* Shimmer effect on animation */}
            {isAnimating && (
              <div 
                className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-[shimmer_1s_ease-in-out]"
                style={{
                  backgroundSize: "200% 100%",
                  animation: "shimmer 1s ease-in-out",
                }}
              />
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export function CompetencyProgressGrid({ competencies }: CompetencyProgressGridProps) {
  if (competencies.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-display font-bold">Kompetenz-Fortschritt</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {competencies.map((c, index) => (
          <AnimatedCompetencyCard 
            key={c.competency_code} 
            competency={c} 
            index={index}
          />
        ))}
      </div>
    </div>
  );
}

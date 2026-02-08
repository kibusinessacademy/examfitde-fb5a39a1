import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { type LessonStatus, getStatusLabel } from "@/hooks/useCourseProgress";
import { CheckCircle, AlertTriangle, XCircle, PlayCircle, Circle } from "lucide-react";

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
  },
  partial: {
    variant: "secondary" as const,
    className: "bg-yellow-500 hover:bg-yellow-600 text-yellow-950",
    icon: AlertTriangle,
    progressColor: "bg-yellow-500",
  },
  not_mastered: {
    variant: "destructive" as const,
    className: "",
    icon: XCircle,
    progressColor: "bg-red-500",
  },
  in_progress: {
    variant: "outline" as const,
    className: "border-blue-500 text-blue-500",
    icon: PlayCircle,
    progressColor: "bg-blue-500",
  },
  not_started: {
    variant: "outline" as const,
    className: "",
    icon: Circle,
    progressColor: "bg-muted-foreground",
  },
} as const;

export function CompetencyProgressGrid({ competencies }: CompetencyProgressGridProps) {
  if (competencies.length === 0) return null;

  return (
    <div className="space-y-4">
      <h2 className="text-2xl font-display font-bold">Kompetenz-Fortschritt</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {competencies.map((c) => {
          const config = STATUS_CONFIG[c.status];
          const Icon = config.icon;
          const masteryPercent = Math.max(0, Math.min(100, Math.round(c.mastery_level)));

          return (
            <Card key={c.competency_code} className="glass-card group hover:border-primary/30 transition-colors">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate group-hover:text-primary transition-colors">
                      {c.competency_title || "Unbekannte Kompetenz"}
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{c.competency_code}</p>
                  </div>
                  <Badge variant={config.variant} className={config.className}>
                    <Icon className="h-3 w-3 mr-1" />
                    {getStatusLabel(c.status)}
                  </Badge>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{c.lesson_count} Lektionen</span>
                    <span className="font-medium">{masteryPercent}%</span>
                  </div>
                  <div className="relative h-2 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full transition-all duration-500 ${config.progressColor}`}
                      style={{ width: `${masteryPercent}%` }}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

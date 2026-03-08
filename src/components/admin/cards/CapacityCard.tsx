import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { usePipelineCapacity } from "@/hooks/usePipelineCapacity";
import { Layers, Zap, Shield, Feather } from "lucide-react";

const CLASS_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  heavy:      { label: "Heavy (Content/Exam)",   icon: <Zap className="h-3.5 w-3.5" />,    color: "text-rose-400" },
  medium:     { label: "Medium (Scaffold/BP)",    icon: <Layers className="h-3.5 w-3.5" />,  color: "text-amber-400" },
  validation: { label: "Validation",              icon: <Shield className="h-3.5 w-3.5" />,  color: "text-sky-400" },
  light:      { label: "Light (Publish/Integrity)", icon: <Feather className="h-3.5 w-3.5" />, color: "text-emerald-400" },
};

export function CapacityCard() {
  const { data, isLoading } = usePipelineCapacity();

  if (isLoading || !data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Step-Class Kapazität</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground">Laden…</div>
        </CardContent>
      </Card>
    );
  }

  const globalPct = data.max_packages > 0
    ? Math.round((data.total_active / data.max_packages) * 100)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">
          Step-Class Kapazität
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {data.total_active}/{data.max_packages} Packages aktiv
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span>Global</span>
            <span className="font-mono">{data.total_active}/{data.max_packages}</span>
          </div>
          <Progress value={globalPct} className="h-2" />
        </div>

        {(["heavy", "medium", "validation", "light"] as const).map((cls) => {
          const meta = CLASS_META[cls];
          const active = data.classes[cls];
          const limit = data.limits[cls];
          const pct = limit > 0 ? Math.round((active / limit) * 100) : 0;
          const atLimit = active >= limit;

          return (
            <div key={cls}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className={`flex items-center gap-1 ${meta.color}`}>
                  {meta.icon}
                  {meta.label}
                </span>
                <span className={`font-mono ${atLimit ? "text-rose-400 font-semibold" : ""}`}>
                  {active}/{limit}
                </span>
              </div>
              <Progress
                value={pct}
                className="h-1.5"
              />
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

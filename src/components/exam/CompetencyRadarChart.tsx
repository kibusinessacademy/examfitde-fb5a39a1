import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Loader2, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CompetencyRadarChartProps {
  curriculumId: string;
}

interface AbilityProfile {
  theta_overall: number;
  theta_remember: number;
  theta_apply: number;
  theta_analyze: number;
  pass_probability: number;
  confidence_adjusted_theta: number;
}

const DIMENSIONS = [
  { key: 'theta_remember' as const, label: 'Wissen', angle: -90 },
  { key: 'theta_apply' as const, label: 'Anwendung', angle: -18 },
  { key: 'theta_analyze' as const, label: 'Analyse', angle: 54 },
  { key: 'confidence_adjusted_theta' as const, label: 'Sicherheit', angle: 126 },
  { key: 'theta_overall' as const, label: 'Gesamt', angle: 198 },
];

function thetaToPercent(theta: number): number {
  // Map theta range [-1, 1] to [0, 100]
  return Math.max(0, Math.min(100, (theta + 1) * 50));
}

function polarToCartesian(angle: number, radius: number, cx: number, cy: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

export function CompetencyRadarChart({ curriculumId }: CompetencyRadarChartProps) {
  const { user } = useAuth();

  const { data: profile, isLoading } = useQuery({
    queryKey: ['ability-profile', user?.id, curriculumId],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from('user_ability_profiles')
        .select('*')
        .eq('user_id', user.id)
        .eq('curriculum_id', curriculumId)
        .maybeSingle();
      if (error) throw error;
      return data as AbilityProfile | null;
    },
    enabled: !!user && !!curriculumId,
  });

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[280px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (!profile) return null;

  const cx = 130, cy = 130, maxR = 100;
  const scores = DIMENSIONS.map(d => thetaToPercent(profile[d.key] ?? 0));

  const radarPoints = DIMENSIONS.map((d, i) => {
    const r = (scores[i] / 100) * maxR;
    return polarToCartesian(d.angle, r, cx, cy);
  });
  const radarPath = radarPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

  const gridLevels = [0.25, 0.5, 0.75, 1];
  const passPct = Math.round((profile.pass_probability ?? 0) * 100);

  return (
    <Card className="glass-card overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-lg font-display flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          Kognitive Kompetenz
        </CardTitle>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row items-center gap-4">
          <svg width="260" height="260" viewBox="0 0 260 260" className="flex-shrink-0">
            {gridLevels.map(level => {
              const pts = DIMENSIONS.map(d => {
                const p = polarToCartesian(d.angle, maxR * level, cx, cy);
                return `${p.x},${p.y}`;
              }).join(' ');
              return <polygon key={level} points={pts} fill="none" stroke="hsl(var(--border))" strokeWidth="1" opacity={0.4} />;
            })}
            {DIMENSIONS.map(d => {
              const p = polarToCartesian(d.angle, maxR, cx, cy);
              return <line key={d.key} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="hsl(var(--border))" strokeWidth="1" opacity={0.3} />;
            })}
            <path d={radarPath} fill="hsl(var(--primary))" fillOpacity={0.15} stroke="hsl(var(--primary))" strokeWidth="2" />
            {radarPoints.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="4" fill="hsl(var(--primary))" />
            ))}
            {DIMENSIONS.map((d, i) => {
              const p = polarToCartesian(d.angle, maxR + 22, cx, cy);
              return (
                <text key={d.key} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
                  className="fill-muted-foreground" fontSize="10" fontWeight="500">
                  {d.label}
                </text>
              );
            })}
            <text x={cx} y={cy - 6} textAnchor="middle" className="fill-foreground" fontSize="22" fontWeight="bold">
              {passPct}%
            </text>
            <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="9">
              Bestehenschance
            </text>
          </svg>

          <div className="flex-1 w-full space-y-2.5">
            {DIMENSIONS.map((d, i) => {
              const val = Math.round(scores[i]);
              const barColor = val >= 70 ? 'bg-green-500' : val >= 45 ? 'bg-yellow-500' : 'bg-destructive';
              return (
                <div key={d.key}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-muted-foreground">{d.label}</span>
                    <span className="font-medium">{val}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-muted overflow-hidden">
                    <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${val}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

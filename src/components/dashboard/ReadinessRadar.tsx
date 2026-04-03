import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useReadinessScore } from '@/hooks/useAdaptiveLearning';
import { Loader2, ShieldCheck, ShieldAlert, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTerminology } from '@/hooks/useProgramType';

interface ReadinessRadarProps {
  curriculumId: string;
}

export function ReadinessRadar({ curriculumId }: ReadinessRadarProps) {
  const { data: readiness, isLoading } = useReadinessScore(curriculumId);
  const { t } = useTerminology(curriculumId);

  const DIMENSIONS = [
    { key: 'knowledge', label: 'Fachkompetenz', angle: -90 },
    { key: 'application', label: 'Anwendung', angle: -18 },
    { key: 'speed', label: t('examTempo'), angle: 54 },
    { key: 'repetition', label: 'Wiederholung', angle: 126 },
    { key: 'accuracy', label: 'Fehlerfreiheit', angle: 198 },
  ] as const;

  if (isLoading) {
    return (
      <Card className="glass-card">
        <CardContent className="p-6 flex items-center justify-center min-h-[320px]">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const score = readiness?.overall_readiness || 0;
  const weakCount = readiness?.weak_areas?.length || 0;
  const strongCount = readiness?.strong_areas?.length || 0;

  const totalAreas = weakCount + strongCount || 1;
  const strongRatio = strongCount / totalAreas;
  const knowledgeScore = Math.min(100, Math.round(strongRatio * 100));
  const applicationScore = Math.min(100, Math.round(score * (weakCount === 0 ? 1 : 0.85)));
  const speedScore = Math.min(100, Math.round(score * 0.8 + strongRatio * 20));
  const repetitionScore = Math.min(100, Math.max(10, score - weakCount * 8));
  const accuracyScore = Math.min(100, Math.round(strongRatio * 90 + (score > 70 ? 10 : 0)));

  const dimensionScores = [knowledgeScore, applicationScore, speedScore, repetitionScore, accuracyScore];

  const cx = 140, cy = 140, maxR = 110;

  function polarToCartesian(angle: number, radius: number, cxV: number, cyV: number) {
    const rad = (angle * Math.PI) / 180;
    return { x: cxV + radius * Math.cos(rad), y: cyV + radius * Math.sin(rad) };
  }

  const radarPoints = DIMENSIONS.map((d, i) => {
    const r = (dimensionScores[i] / 100) * maxR;
    return polarToCartesian(d.angle, r, cx, cy);
  });
  const radarPath = radarPoints.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ') + ' Z';

  const gridLevels = [0.25, 0.5, 0.75, 1];

  const getStatusConfig = () => {
    if (score >= 80) return { icon: ShieldCheck, color: 'text-green-500', bg: 'bg-green-500/10', label: t('examReady') };
    if (score >= 50) return { icon: Shield, color: 'text-yellow-500', bg: 'bg-yellow-500/10', label: 'Auf gutem Weg' };
    return { icon: ShieldAlert, color: 'text-orange-500', bg: 'bg-orange-500/10', label: 'Training empfohlen' };
  };

  const status = getStatusConfig();
  const StatusIcon = status.icon;

  return (
    <Card className="glass-card overflow-hidden">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-display flex items-center gap-2">
            <StatusIcon className={cn('h-5 w-5', status.color)} />
            {t('examReadinessRadar')}
          </CardTitle>
          <Badge variant="outline" className={cn('gap-1', status.color)}>
            {status.label}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="flex flex-col md:flex-row items-center gap-6">
          <div className="relative flex-shrink-0">
            <svg width="280" height="280" viewBox="0 0 280 280">
              {gridLevels.map((level) => {
                const points = DIMENSIONS.map((d) => {
                  const p = polarToCartesian(d.angle, maxR * level, cx, cy);
                  return `${p.x},${p.y}`;
                }).join(' ');
                return (
                  <polygon key={level} points={points} fill="none" stroke="hsl(var(--border))" strokeWidth="1" opacity={0.4} />
                );
              })}
              {DIMENSIONS.map((d) => {
                const p = polarToCartesian(d.angle, maxR, cx, cy);
                return <line key={d.key} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="hsl(var(--border))" strokeWidth="1" opacity={0.3} />;
              })}
              <path d={radarPath} fill="hsl(var(--primary))" fillOpacity={0.15} stroke="hsl(var(--primary))" strokeWidth="2" />
              {radarPoints.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r="4" fill="hsl(var(--primary))" />
              ))}
              {DIMENSIONS.map((d) => {
                const p = polarToCartesian(d.angle, maxR + 24, cx, cy);
                return (
                  <text key={d.key} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" fontSize="10" fontWeight="500">
                    {d.label}
                  </text>
                );
              })}
              <text x={cx} y={cy - 8} textAnchor="middle" className="fill-foreground" fontSize="28" fontWeight="bold">
                {Math.round(score)}%
              </text>
              <text x={cx} y={cy + 12} textAnchor="middle" className="fill-muted-foreground" fontSize="10">
                {t('examReadiness')}
              </text>
            </svg>
          </div>

          <div className="flex-1 w-full space-y-3">
            {DIMENSIONS.map((d, i) => {
              const val = dimensionScores[i];
              const barColor = val >= 75 ? 'bg-green-500' : val >= 50 ? 'bg-yellow-500' : 'bg-orange-500';
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

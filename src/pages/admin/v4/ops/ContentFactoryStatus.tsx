import { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, Factory, FileQuestion, Mic, BookOpen, Brain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loading } from './OpsShared';

export default function ContentFactoryStatus() {
  const [packages, setPackages] = useState<any[]>([]);
  const [examTarget, setExamTarget] = useState(1000);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const sb = supabase as any;
      const [factoryRes, rolloutRes] = await Promise.all([
        sb.from('ops_content_factory').select('*'),
        sb.from('rollout_control').select('base_exam_target, ship_level_config').eq('is_active', true).maybeSingle(),
      ]);
      const sorted = (factoryRes.data || []).sort((a: any, b: any) => {
        const aActive = a.status !== 'queued' || a.exam_count > 0 ? 1 : 0;
        const bActive = b.status !== 'queued' || b.exam_count > 0 ? 1 : 0;
        if (bActive !== aActive) return bActive - aActive;
        return (b.exam_count || 0) - (a.exam_count || 0);
      });
      setPackages(sorted.slice(0, 30));
      if (rolloutRes.data?.base_exam_target) {
        setExamTarget(rolloutRes.data.base_exam_target);
      }
      setLoading(false);
    })();
  }, []);

  if (loading) return <Loading />;
  if (packages.length === 0) return null;

  const activeCount = packages.filter((p: any) => p.status !== 'queued' || p.exam_count > 0).length;

  const GateIcon = ({ passed }: { passed: boolean }) => passed
    ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
    : <XCircle className="h-3.5 w-3.5 text-destructive" />;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Factory className="h-4 w-4" /> Content Factory
          <Badge variant="secondary" className="text-[10px]">{activeCount} aktiv / {packages.length} gesamt</Badge>
          <Badge variant="outline" className="text-[10px]">Ziel: {examTarget} Fragen</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border text-muted-foreground">
                <th className="text-left py-2 px-2">Paket</th>
                <th className="text-left py-2 px-2">Status</th>
                <th className="text-center py-2 px-2">Score</th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><FileQuestion className="h-3 w-3" /> Exam</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><Mic className="h-3 w-3" /> Oral</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><BookOpen className="h-3 w-3" /> Handbuch</span>
                </th>
                <th className="text-center py-2 px-2">
                  <span className="flex items-center gap-1 justify-center"><Brain className="h-3 w-3" /> Tutor</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {packages.map(p => {
                const examPct = examTarget > 0 ? Math.round((p.exam_count / examTarget) * 100) : 0;
                return (
                  <tr key={p.package_id} className={cn("border-b border-border/30",
                    p.integrity_score != null && p.integrity_score < 60 && "bg-destructive/5"
                  )}>
                    <td className="py-2 px-2 font-medium truncate max-w-[180px]">{p.title || p.package_id?.substring(0, 8)}</td>
                    <td className="py-2 px-2">
                      <Badge variant="outline" className={cn("text-[10px]",
                        p.status === 'published' ? 'bg-emerald-500/10 text-emerald-600' :
                        p.status === 'building' ? 'bg-primary/10 text-primary' :
                        p.status === 'failed' ? 'bg-destructive/10 text-destructive' : ''
                      )}>{p.status}</Badge>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <span className={cn("font-bold",
                        (p.integrity_score ?? 0) >= 80 ? "text-emerald-600" :
                        (p.integrity_score ?? 0) >= 60 ? "text-yellow-600" : "text-destructive"
                      )}>{p.integrity_score ?? '–'}</span>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-center gap-1">
                        <GateIcon passed={p.exam_gate_passed} />
                        <span className={cn("text-muted-foreground", examPct >= 100 && "text-emerald-600 font-medium")}>
                          {p.exam_count}/{examTarget}
                        </span>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-center gap-1">
                        <GateIcon passed={p.oral_gate_passed} />
                        <span className="text-muted-foreground">{p.oral_count}/20</span>
                      </div>
                    </td>
                    <td className="py-2 px-2">
                      <div className="flex items-center justify-center gap-1">
                        <GateIcon passed={p.handbook_gate_passed && p.sections_gate_passed} />
                        <span className="text-muted-foreground">{p.handbook_chapters}ch/{p.handbook_sections}s</span>
                      </div>
                    </td>
                    <td className="py-2 px-2 text-center">
                      <GateIcon passed={p.tutor_gate_passed} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

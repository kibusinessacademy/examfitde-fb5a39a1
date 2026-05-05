import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  BookOpen, ClipboardCheck, MessageSquare, Bot, FileText, Layers,
  CheckCircle2, XCircle, AlertTriangle, Loader2
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

interface ModuleStats {
  key: string;
  label: string;
  icon: React.ElementType;
  status: 'ok' | 'warning' | 'error' | 'missing' | 'loading';
  count: number;
  target: number;
  health: number;
  detail?: string;
  lastUpdated?: string;
}

interface Props {
  packageId: string;
  courseId: string | null;
  curriculumId: string | null;
  certificationId: string | null;
  featureFlags?: Record<string, boolean> | null;
}

const MODULE_FLAG_MAP: Record<string, string> = {
  learning_course: 'has_learning_course',
  exam_pool: 'has_exam_trainer',
  oral_exam: 'has_oral_exam_trainer',
  ai_tutor: 'has_ai_tutor',
  handbook: 'has_handbook',
};

export default function ProductModuleStatus({ packageId, courseId, curriculumId, certificationId, featureFlags }: Props) {
  const [modules, setModules] = useState<ModuleStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!packageId) return;
    loadModuleStats();
  }, [packageId, courseId, curriculumId]);

  const loadModuleStats = async () => {
    setLoading(true);
    const results: ModuleStats[] = [];

    // 1. Learning Course - count lessons via modules (lessons has no course_id column)
    let lc = 0;
    if (courseId) {
      const { data: moduleIds } = await (supabase as any)
        .from('modules').select('id').eq('course_id', courseId);
      if (moduleIds && moduleIds.length > 0) {
        const ids = moduleIds.map((m: any) => m.id);
        const { count: lessonCount } = await (supabase as any)
          .from('lessons').select('id', { count: 'exact', head: true })
          .in('module_id', ids);
        lc = lessonCount || 0;
      }
    }
    results.push({
      key: 'learning_course', label: 'Lernkurs', icon: BookOpen,
      status: lc >= 20 ? 'ok' : lc > 0 ? 'warning' : 'missing',
      count: lc, target: 0, health: lc > 0 ? Math.min(100, Math.round((lc / 30) * 100)) : 0,
      detail: `${lc} Lektionen`,
    });

    // 2. Exam Pool - count questions (uses curriculum_id, NOT course_id)
    const { count: examCount } = await (supabase as any)
      .from('exam_questions').select('id', { count: 'exact', head: true })
      .eq('curriculum_id', curriculumId || '');
    const eq = examCount || 0;
    results.push({
      key: 'exam_pool', label: 'Prüfungstrainer', icon: ClipboardCheck,
      status: eq >= 1000 ? 'ok' : eq >= 500 ? 'warning' : eq > 0 ? 'error' : 'missing',
      count: eq, target: 1000, health: Math.min(100, Math.round((eq / 1000) * 100)),
      detail: `${eq} Fragen (Ziel: 1000)`,
    });

    // 3. Oral Exam - count blueprints (uses curriculum_id, NOT package_id)
    const { count: oralCount } = await (supabase as any)
      .from('oral_exam_blueprints').select('id', { count: 'exact', head: true })
      .eq('curriculum_id', curriculumId || '');
    const oc = oralCount || 0;
    results.push({
      key: 'oral_exam', label: 'Mündliche Prüfung', icon: MessageSquare,
      status: oc >= 20 ? 'ok' : oc >= 10 ? 'warning' : oc > 0 ? 'error' : 'missing',
      count: oc, target: 20, health: Math.min(100, Math.round((oc / 20) * 100)),
      detail: `${oc} Szenarien (Ziel: 20)`,
    });

    // 4. AI Tutor Index
    const { data: tutorIdx } = await (supabase as any)
      .from('ai_tutor_context_index').select('id, index_version, stats')
      .eq('package_id', packageId).limit(1).maybeSingle();
    results.push({
      key: 'ai_tutor', label: 'AI Tutor', icon: Bot,
      status: tutorIdx ? 'ok' : 'missing',
      count: tutorIdx ? 1 : 0, target: 1,
      health: tutorIdx ? 100 : 0,
      detail: tutorIdx ? `Index v${tutorIdx.index_version}` : 'Kein Index',
    });

    // 5. Handbook - count chapters (uses curriculum_id, NOT package_id)
    const { count: hbCount } = await (supabase as any)
      .from('handbook_chapters').select('id', { count: 'exact', head: true })
      .eq('curriculum_id', curriculumId || '');
    const hc = hbCount || 0;
    results.push({
      key: 'handbook', label: 'Handbuch', icon: FileText,
      status: hc >= 5 ? 'ok' : hc > 0 ? 'warning' : 'missing',
      count: hc, target: 5, health: Math.min(100, Math.round((hc / 5) * 100)),
      detail: `${hc} Kapitel (Ziel: 5)`,
    });

    // Filter by feature flags
    const filtered = featureFlags
      ? results.filter(m => {
          const flag = MODULE_FLAG_MAP[m.key];
          return !flag || featureFlags[flag] !== false;
        })
      : results;

    setModules(filtered);
    setLoading(false);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-primary" />
        </CardContent>
      </Card>
    );
  }

  const overallHealth = modules.length > 0
    ? Math.round(modules.reduce((s, m) => s + m.health, 0) / modules.length)
    : 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="flex items-center gap-2">
            <Layers className="h-4 w-4" /> Produktmodule
          </span>
          <span className={cn("text-xs font-bold px-2 py-0.5 rounded-full",
            overallHealth >= 90 ? 'bg-success-bg-subtle text-success' :
            overallHealth >= 60 ? 'bg-warning-bg-subtle text-warning' :
            'bg-destructive-bg-subtle text-destructive'
          )}>
            {overallHealth}% Gesamt
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {/* Mobile: Card layout */}
        <div className="space-y-2 sm:hidden">
          {modules.map(m => {
            const Icon = m.icon;
            const StatusIcon = m.status === 'ok' ? CheckCircle2 :
              m.status === 'warning' ? AlertTriangle :
              m.status === 'error' ? XCircle : XCircle;
            const statusColor = m.status === 'ok' ? 'text-success' :
              m.status === 'warning' ? 'text-warning' : 'text-destructive';
            return (
              <div key={m.key} className="border rounded-lg p-3 flex items-center gap-3">
                <div className={cn("w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                  m.status === 'ok' ? 'bg-success-bg-subtle' :
                  m.status === 'warning' ? 'bg-warning-bg-subtle' : 'bg-destructive-bg-subtle'
                )}>
                  <Icon className={cn("h-4 w-4", statusColor)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-foreground">{m.label}</span>
                    <StatusIcon className={cn("h-3.5 w-3.5 shrink-0", statusColor)} />
                  </div>
                  <p className="text-[10px] text-muted-foreground mt-0.5">{m.detail}</p>
                  <div className="flex items-center gap-2 mt-1">
                    <Progress value={m.health} className="h-1 flex-1" />
                    <span className="text-[10px] font-mono text-muted-foreground">{m.health}%</span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Desktop: Table layout */}
        <div className="hidden sm:block border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/30">
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Modul</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-20">Status</th>
                <th className="text-left px-3 py-2 font-medium text-muted-foreground">Inhalt</th>
                <th className="text-center px-3 py-2 font-medium text-muted-foreground w-24">Health</th>
              </tr>
            </thead>
            <tbody>
              {modules.map(m => {
                const Icon = m.icon;
                const StatusIcon = m.status === 'ok' ? CheckCircle2 :
                  m.status === 'warning' ? AlertTriangle :
                  m.status === 'error' ? XCircle : XCircle;
                const statusColor = m.status === 'ok' ? 'text-success' :
                  m.status === 'warning' ? 'text-warning' : 'text-destructive';
                return (
                  <tr key={m.key} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                    <td className="px-3 py-2.5">
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        <span className="font-medium text-foreground">{m.label}</span>
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-center">
                      <StatusIcon className={cn("h-4 w-4 mx-auto", statusColor)} />
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-xs text-muted-foreground">{m.detail}</span>
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Progress value={m.health} className="h-1.5 flex-1" />
                        <span className="text-[10px] font-mono text-muted-foreground w-8 text-right">{m.health}%</span>
                      </div>
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

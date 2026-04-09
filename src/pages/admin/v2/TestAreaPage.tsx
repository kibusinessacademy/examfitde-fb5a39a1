import { lazy, Suspense, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, ExternalLink, Play, BookOpen, MessageSquare, Brain, Dices } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const AdminAutoTestQueue = lazy(() =>
  import('@/features/admin/components/AdminAutoTestQueue').then(m => ({ default: m.AdminAutoTestQueue }))
);

type PreviewMode = 'standard' | 'premium' | 'adaptive';

function openLearnerView(curriculumId: string, path: string) {
  window.open(`${path}?curriculum=${curriculumId}&admin_preview=1`, '_blank');
}

function PublishedCourseList() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin-published-courses-for-test'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_admin_published_course_preview' as any)
        .select('*')
        .order('course_title');
      if (error) throw error;
      return (data ?? []) as any[];
    },
  });

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-2">
      {data?.map((course: any) => (
        <div key={course.package_id} className="flex items-center justify-between gap-3 p-3 rounded-lg border border-border hover:bg-muted/30 transition-colors">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{course.course_title}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <Badge variant="outline" className="text-[10px] h-4">{course.package_track || 'standard'}</Badge>
              <span className="text-[10px] text-muted-foreground">{course.approved_exam_questions} Fragen</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/exam-trainer')}>
              <Brain className="h-3.5 w-3.5 mr-1" /> Prüfung
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/oral-exam')}>
              <MessageSquare className="h-3.5 w-3.5 mr-1" /> Mündlich
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/shuttle')}>
              <Dices className="h-3.5 w-3.5 mr-1" /> Shuttle
            </Button>
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openLearnerView(course.curriculum_id, '/handbuch')}>
              <BookOpen className="h-3.5 w-3.5 mr-1" /> Handbuch
            </Button>
          </div>
        </div>
      ))}
      {(!data || data.length === 0) && (
        <p className="text-sm text-muted-foreground text-center py-4">Keine veröffentlichten Kurse gefunden.</p>
      )}
    </div>
  );
}

export default function TestAreaPage() {
  const [previewMode, setPreviewMode] = useState<PreviewMode>('standard');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-foreground flex items-center gap-2">
          <Play className="h-5 w-5 text-primary" />
          Testbereich
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Inhouse-Vorschau aller veröffentlichten Kurse mit Learner-Context
        </p>
      </div>

      {/* Preview Mode Toggle */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">Modus:</span>
        {(['standard', 'premium', 'adaptive'] as PreviewMode[]).map(mode => (
          <Button
            key={mode}
            size="sm"
            variant={previewMode === mode ? 'default' : 'outline'}
            className="h-7 text-xs capitalize"
            onClick={() => setPreviewMode(mode)}
          >
            {mode}
          </Button>
        ))}
      </div>

      {/* Test Priority Queue */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Test-Priorität</CardTitle>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin" /></div>}>
            <AdminAutoTestQueue previewMode={previewMode} limit={15} />
          </Suspense>
        </CardContent>
      </Card>

      {/* Published Courses Quick Access */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Veröffentlichte Kurse — Schnellzugang</CardTitle>
        </CardHeader>
        <CardContent>
          <PublishedCourseList />
        </CardContent>
      </Card>
    </div>
  );
}

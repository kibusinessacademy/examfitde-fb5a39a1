import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { AlertTriangle, CheckCircle2, Edit3, RefreshCw, Loader2, Save, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import { cn } from '@/lib/utils';

interface FailedLesson {
  id: string;
  title: string;
  step: string;
  module_title: string;
  package_title: string;
  package_id: string;
  course_id: string;
  content: any;
  needs_manual_review: boolean;
}

export default function ManualLessonEditor() {
  const [lessons, setLessons] = useState<FailedLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editHtml, setEditHtml] = useState('');
  const [saving, setSaving] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const loadLessons = useCallback(async () => {
    setLoading(true);
    try {
      // Find all placeholder/failed lessons across all packages
      const { data, error } = await (supabase as any)
        .from('lessons')
        .select(`
          id, title, step, content, module_id,
          modules!inner(title, course_id, courses!inner(title, course_packages!inner(id, title, status)))
        `)
        .or('content.is.null,content->_placeholder.eq.true,content->_needs_manual_review.eq.true')
        .order('created_at', { ascending: true })
        .limit(100);

      if (error) throw error;

      const mapped: FailedLesson[] = (data || []).map((l: any) => ({
        id: l.id,
        title: l.title,
        step: l.step,
        module_title: l.modules?.title || '?',
        package_title: l.modules?.courses?.course_packages?.[0]?.title || '?',
        package_id: l.modules?.courses?.course_packages?.[0]?.id || '',
        course_id: l.modules?.course_id || '',
        content: l.content,
        needs_manual_review: l.content?._needs_manual_review === true,
      }));

      setLessons(mapped);
    } catch (e) {
      console.error('Failed to load lessons:', e);
      toast.error('Fehler beim Laden der Lektionen');
    }
    setLoading(false);
  }, []);

  useEffect(() => { loadLessons(); }, [loadLessons]);

  const startEditing = (lesson: FailedLesson) => {
    setEditingId(lesson.id);
    setEditHtml(lesson.content?.html || '');
  };

  const saveLesson = async (lessonId: string) => {
    if (!editHtml.trim() || editHtml.length < 200) {
      toast.error('Inhalt muss mindestens 200 Zeichen haben');
      return;
    }
    setSaving(true);
    try {
      const lesson = lessons.find(l => l.id === lessonId);
      const finalContent = {
        type: 'text',
        html: editHtml,
        objectives: [],
        generated_at: new Date().toISOString(),
        version: 3,
        manually_edited: true,
        edited_at: new Date().toISOString(),
      };

      // Write to lessons table
      const { error } = await (supabase as any)
        .from('lessons')
        .update({ content: finalContent })
        .eq('id', lessonId);

      if (error) throw error;

      // Also create content_version for audit trail
      await (supabase as any).from('content_versions').insert({
        course_id: lesson?.course_id,
        lesson_id: lessonId,
        step_key: `step_${lesson?.step || 'verstehen'}`,
        content_json: finalContent,
        created_by_agent: 'admin-manual-edit',
        status: 'approved',
        council_round: 0,
        entity_type: 'lesson_step',
      }).catch(() => {});

      toast.success('Lektion gespeichert');
      setEditingId(null);
      setEditHtml('');
      loadLessons();
    } catch (e) {
      toast.error(`Speichern fehlgeschlagen: ${(e as Error).message}`);
    }
    setSaving(false);
  };

  const retryWithAI = async (lesson: FailedLesson) => {
    setRetrying(lesson.id);
    try {
      const { data, error } = await supabase.functions.invoke('heal-poison-lessons', {
        body: {
          package_id: lesson.package_id,
          course_id: lesson.course_id,
          poison_lesson_ids: [lesson.id],
        },
      });

      if (error) throw error;
      if (data?.healed > 0) {
        toast.success(`Lektion "${lesson.title}" erfolgreich geheilt`);
      } else {
        toast.warning('Auto-Heal fehlgeschlagen — bitte manuell bearbeiten');
      }
      loadLessons();
    } catch (e) {
      toast.error(`Auto-Heal Fehler: ${(e as Error).message}`);
    }
    setRetrying(null);
  };

  const stepLabels: Record<string, string> = {
    einstieg: 'Einstieg',
    verstehen: 'Verstehen',
    anwenden: 'Anwenden',
    wiederholen: 'Wiederholen',
    mini_check: 'MiniCheck',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  if (lessons.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <CheckCircle2 className="h-12 w-12 text-success mx-auto mb-3" />
          <h3 className="text-lg font-semibold text-foreground">Keine Lücken gefunden</h3>
          <p className="text-sm text-muted-foreground mt-1">Alle Kurse sind vollständig — keine manuelle Nachbearbeitung nötig.</p>
        </CardContent>
      </Card>
    );
  }

  // Group by package
  const grouped = lessons.reduce<Record<string, FailedLesson[]>>((acc, l) => {
    const key = l.package_id || 'unknown';
    (acc[key] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Offene Lücken</p>
            <p className="text-2xl font-bold text-destructive">{lessons.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Manuelle Review</p>
            <p className="text-2xl font-bold text-warning">{lessons.filter(l => l.needs_manual_review).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="py-4 text-center">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Betroffene Pakete</p>
            <p className="text-2xl font-bold text-foreground">{Object.keys(grouped).length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={loadLessons} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4 mr-1", loading && "animate-spin")} />
          Aktualisieren
        </Button>
      </div>

      {/* Lessons grouped by package */}
      {Object.entries(grouped).map(([pkgId, pkgLessons]) => (
        <Card key={pkgId}>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center justify-between">
              <span className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-warning" />
                {pkgLessons[0]?.package_title || pkgId.slice(0, 12)}
              </span>
              <Badge variant="outline" className="text-xs">{pkgLessons.length} Lücke{pkgLessons.length !== 1 ? 'n' : ''}</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {pkgLessons.map(lesson => (
              <div key={lesson.id} className={cn(
                "border rounded-lg p-3",
                lesson.needs_manual_review ? "border-warning/50 bg-warning/5" : "border-border"
              )}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-foreground">{lesson.title}</p>
                      <Badge variant="secondary" className="text-[10px]">{stepLabels[lesson.step] || lesson.step}</Badge>
                      {lesson.needs_manual_review && (
                        <Badge variant="destructive" className="text-[10px]">Auto-Heal fehlgeschlagen</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{lesson.module_title}</p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => retryWithAI(lesson)}
                      disabled={retrying === lesson.id}
                      title="Erneut mit KI versuchen"
                    >
                      {retrying === lesson.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => editingId === lesson.id ? setEditingId(null) : startEditing(lesson)}
                      title="Manuell bearbeiten"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </Button>
                    {lesson.content?.html && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPreviewId(previewId === lesson.id ? null : lesson.id)}
                        title="Vorschau"
                      >
                        {previewId === lesson.id ? <ChevronUp className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </Button>
                    )}
                  </div>
                </div>

                {/* Preview */}
                {previewId === lesson.id && lesson.content?.html && (
                  <div className="mt-3 p-3 bg-muted/30 rounded text-sm prose prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: lesson.content.html }}
                  />
                )}

                {/* Editor */}
                {editingId === lesson.id && (
                  <div className="mt-3 space-y-3">
                    <Textarea
                      value={editHtml}
                      onChange={e => setEditHtml(e.target.value)}
                      placeholder="<h3>Titel</h3><p>Lerninhalt hier eingeben...</p>"
                      className="min-h-[200px] font-mono text-xs"
                    />
                    <div className="flex items-center justify-between">
                      <p className="text-xs text-muted-foreground">
                        {editHtml.length} Zeichen {editHtml.length < 200 && '(min. 200)'}
                      </p>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="sm" onClick={() => setEditingId(null)}>
                          Abbrechen
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => saveLesson(lesson.id)}
                          disabled={saving || editHtml.length < 200}
                        >
                          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />}
                          Speichern
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

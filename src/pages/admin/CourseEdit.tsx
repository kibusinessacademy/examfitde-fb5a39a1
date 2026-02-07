import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from '@/hooks/use-toast';
import {
  Loader2,
  ArrowLeft,
  Save,
  Globe,
  Archive,
  Trash2,
  ChevronDown,
  ChevronUp,
  BookOpen,
  GripVertical,
  Eye
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Course = Tables<'courses'>;
type Module = Tables<'modules'>;
type Lesson = Tables<'lessons'>;

interface ModuleWithLessons extends Module {
  lessons: Lesson[];
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Entwurf', variant: 'secondary' },
  generating: { label: 'Generierung...', variant: 'outline' },
  published: { label: 'Veröffentlicht', variant: 'default' },
  archived: { label: 'Archiviert', variant: 'destructive' },
};

const stepLabels: Record<string, string> = {
  einstieg: 'Einstieg',
  verstehen: 'Verstehen',
  anwenden: 'Anwenden',
  wiederholen: 'Wiederholen',
  mini_check: 'Mini-Check',
};

export default function CourseEdit() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  const [course, setCourse] = useState<Course | null>(null);
  const [modules, setModules] = useState<ModuleWithLessons[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  // Edit states
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editStatus, setEditStatus] = useState('draft');

  useEffect(() => {
    if (courseId) {
      fetchData();
    }
  }, [courseId]);

  const fetchData = async () => {
    if (!courseId) return;

    // Fetch course
    const { data: courseData, error: courseError } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .single();

    if (courseError || !courseData) {
      toast({ title: 'Kurs nicht gefunden', variant: 'destructive' });
      navigate('/admin-v2/courses');
      return;
    }

    setCourse(courseData);
    setEditTitle(courseData.title);
    setEditDescription(courseData.description || '');
    setEditStatus(courseData.status);

    // Fetch modules with lessons
    const { data: modulesData } = await supabase
      .from('modules')
      .select('*')
      .eq('course_id', courseId)
      .order('sort_order');

    if (modulesData && modulesData.length > 0) {
      const moduleIds = modulesData.map(m => m.id);
      const { data: lessonsData } = await supabase
        .from('lessons')
        .select('*')
        .in('module_id', moduleIds)
        .order('sort_order');

      const modulesWithLessons = modulesData.map(mod => ({
        ...mod,
        lessons: lessonsData?.filter(l => l.module_id === mod.id) || [],
      }));

      setModules(modulesWithLessons);

      // Expand first module
      if (modulesWithLessons.length > 0) {
        setExpandedModules(new Set([modulesWithLessons[0].id]));
      }
    }

    setLoading(false);
  };

  const saveCourse = async () => {
    if (!course) return;

    setSaving(true);
    const updateData: Partial<Course> = {
      title: editTitle.trim(),
      description: editDescription.trim() || null,
      status: editStatus as Course['status'],
    };

    if (editStatus === 'published' && course.status !== 'published') {
      updateData.published_at = new Date().toISOString();
    }

    const { error } = await supabase
      .from('courses')
      .update(updateData)
      .eq('id', course.id);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
    } else {
      setCourse({ ...course, ...updateData });
      toast({ title: 'Gespeichert!' });
    }
    setSaving(false);
  };

  const toggleModule = (moduleId: string) => {
    const newExpanded = new Set(expandedModules);
    if (newExpanded.has(moduleId)) {
      newExpanded.delete(moduleId);
    } else {
      newExpanded.add(moduleId);
    }
    setExpandedModules(newExpanded);
  };

  const updateModule = async (moduleId: string, updates: Partial<Module>) => {
    const { error } = await supabase
      .from('modules')
      .update(updates)
      .eq('id', moduleId);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
      return;
    }

    setModules(prev =>
      prev.map(m => m.id === moduleId ? { ...m, ...updates } : m)
    );
    toast({ title: 'Modul aktualisiert' });
  };

  const updateLesson = async (lessonId: string, updates: Partial<Lesson>) => {
    const { error } = await supabase
      .from('lessons')
      .update(updates)
      .eq('id', lessonId);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
      return;
    }

    setModules(prev =>
      prev.map(m => ({
        ...m,
        lessons: m.lessons.map(l => 
          l.id === lessonId ? { ...l, ...updates } : l
        ),
      }))
    );
    toast({ title: 'Lektion aktualisiert' });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!course) return null;

  const status = statusConfig[course.status] || statusConfig.draft;
  const totalLessons = modules.reduce((sum, m) => sum + m.lessons.length, 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/courses">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display font-bold">Kurs bearbeiten</h1>
            <Badge variant={status.variant}>{status.label}</Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {modules.length} Module • {totalLessons} Lektionen
          </p>
        </div>
        <div className="flex gap-2">
          <Link to={`/course/${course.id}`}>
            <Button variant="outline">
              <Eye className="h-4 w-4 mr-2" />
              Vorschau
            </Button>
          </Link>
          <Button 
            onClick={saveCourse} 
            disabled={saving}
            className="gradient-primary text-primary-foreground"
          >
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
            Speichern
          </Button>
        </div>
      </div>

      {/* Basic Info */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Grundinformationen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Titel</Label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="bg-muted/50"
              />
            </div>
            <div className="space-y-2">
              <Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="bg-muted/50">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Entwurf</SelectItem>
                  <SelectItem value="published">Veröffentlicht</SelectItem>
                  <SelectItem value="archived">Archiviert</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Beschreibung</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              className="bg-muted/50 min-h-[100px]"
            />
          </div>
        </CardContent>
      </Card>

      {/* Modules & Lessons */}
      <div className="space-y-4">
        <h2 className="text-xl font-display font-bold">Module & Lektionen</h2>

        {modules.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="py-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Dieser Kurs hat noch keine Module. Generiere sie aus einem Curriculum.
              </p>
            </CardContent>
          </Card>
        ) : (
          modules.map((mod, modIdx) => (
            <Card key={mod.id} className="glass-card border-border/50 overflow-hidden">
              <CardHeader
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => toggleModule(mod.id)}
              >
                <div className="flex items-center gap-4">
                  <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                  <div className="w-10 h-10 rounded-xl gradient-accent flex items-center justify-center text-accent-foreground font-bold">
                    {modIdx + 1}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{mod.title}</CardTitle>
                    <CardDescription>
                      {mod.lessons.length} Lektionen
                    </CardDescription>
                  </div>
                  {expandedModules.has(mod.id) ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>

              {expandedModules.has(mod.id) && (
                <CardContent className="pt-0 pb-4 space-y-4">
                  {/* Module Edit */}
                  <div className="p-4 bg-muted/20 rounded-xl space-y-3">
                    <div className="space-y-2">
                      <Label>Modul-Titel</Label>
                      <Input
                        value={mod.title}
                        onChange={(e) => updateModule(mod.id, { title: e.target.value })}
                        className="bg-background/50"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Beschreibung</Label>
                      <Textarea
                        value={mod.description || ''}
                        onChange={(e) => updateModule(mod.id, { description: e.target.value || null })}
                        className="bg-background/50"
                      />
                    </div>
                  </div>

                  {/* Lessons */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground px-1">Lektionen</p>
                    {mod.lessons.map((lesson) => (
                      <div
                        key={lesson.id}
                        className="p-4 bg-muted/20 rounded-xl border border-border/30"
                      >
                        <div className="flex items-start gap-3">
                          <Badge variant="outline" className="shrink-0 mt-1">
                            {stepLabels[lesson.step] || lesson.step}
                          </Badge>
                          <div className="flex-1 space-y-2">
                            <Input
                              value={lesson.title}
                              onChange={(e) => updateLesson(lesson.id, { title: e.target.value })}
                              className="bg-background/50"
                            />
                            <div className="flex items-center gap-2">
                              <Label className="text-xs">Dauer (Min):</Label>
                              <Input
                                type="number"
                                value={lesson.duration_minutes || ''}
                                onChange={(e) => updateLesson(lesson.id, { duration_minutes: parseInt(e.target.value) || null })}
                                className="bg-background/50 w-20"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

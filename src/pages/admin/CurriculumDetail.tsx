import { useEffect, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import {
  Loader2,
  ArrowLeft,
  Save,
  Lock,
  Unlock,
  Plus,
  Trash2,
  GripVertical,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Sparkles
} from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;
type LearningField = Tables<'learning_fields'>;
type Competency = Tables<'competencies'>;

interface LearningFieldWithCompetencies extends LearningField {
  competencies: Competency[];
}

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; editable: boolean }> = {
  draft: { label: 'Entwurf', variant: 'secondary', editable: true },
  extracting: { label: 'Extrahierung...', variant: 'outline', editable: false },
  normalizing: { label: 'Normalisierung', variant: 'outline', editable: true },
  frozen: { label: 'Eingefroren', variant: 'default', editable: false },
};

export default function CurriculumDetail() {
  const { curriculumId } = useParams<{ curriculumId: string }>();
  const navigate = useNavigate();

  const [curriculum, setCurriculum] = useState<Curriculum | null>(null);
  const [learningFields, setLearningFields] = useState<LearningFieldWithCompetencies[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set());

  // Edit states
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');

  useEffect(() => {
    if (curriculumId) {
      fetchData();
    }
  }, [curriculumId]);

  const fetchData = async () => {
    if (!curriculumId) return;

    // Fetch curriculum
    const { data: curriculumData, error: curriculumError } = await supabase
      .from('curricula')
      .select('*')
      .eq('id', curriculumId)
      .single();

    if (curriculumError || !curriculumData) {
      toast({ title: 'Curriculum nicht gefunden', variant: 'destructive' });
      navigate('/admin-v2/curricula');
      return;
    }

    setCurriculum(curriculumData);
    setEditTitle(curriculumData.title);
    setEditDescription(curriculumData.description || '');

    // Fetch learning fields with competencies
    const { data: fieldsData } = await supabase
      .from('learning_fields')
      .select('*')
      .eq('curriculum_id', curriculumId)
      .order('sort_order');

    if (fieldsData && fieldsData.length > 0) {
      // Fetch all competencies for these learning fields
      const fieldIds = fieldsData.map(f => f.id);
      const { data: competenciesData } = await supabase
        .from('competencies')
        .select('*')
        .in('learning_field_id', fieldIds)
        .order('sort_order');

      // Map competencies to their learning fields
      const fieldsWithComps = fieldsData.map(field => ({
        ...field,
        competencies: competenciesData?.filter(c => c.learning_field_id === field.id) || [],
      }));

      setLearningFields(fieldsWithComps);
      
      // Expand first field by default
      if (fieldsWithComps.length > 0) {
        setExpandedFields(new Set([fieldsWithComps[0].id]));
      }
    }

    setLoading(false);
  };

  const saveCurriculum = async () => {
    if (!curriculum) return;

    setSaving(true);
    const { error } = await supabase
      .from('curricula')
      .update({
        title: editTitle.trim(),
        description: editDescription.trim() || null,
      })
      .eq('id', curriculum.id);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
    } else {
      setCurriculum({ ...curriculum, title: editTitle.trim(), description: editDescription.trim() || null });
      toast({ title: 'Gespeichert!' });
    }
    setSaving(false);
  };

  const toggleField = (fieldId: string) => {
    const newExpanded = new Set(expandedFields);
    if (newExpanded.has(fieldId)) {
      newExpanded.delete(fieldId);
    } else {
      newExpanded.add(fieldId);
    }
    setExpandedFields(newExpanded);
  };

  const updateLearningField = async (fieldId: string, updates: Partial<LearningField>) => {
    const { error } = await supabase
      .from('learning_fields')
      .update(updates)
      .eq('id', fieldId);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
      return;
    }

    setLearningFields(prev => 
      prev.map(f => f.id === fieldId ? { ...f, ...updates } : f)
    );
    toast({ title: 'Lernfeld aktualisiert' });
  };

  const updateCompetency = async (compId: string, updates: Partial<Competency>) => {
    const { error } = await supabase
      .from('competencies')
      .update(updates)
      .eq('id', compId);

    if (error) {
      toast({ title: 'Fehler beim Speichern', variant: 'destructive' });
      return;
    }

    setLearningFields(prev =>
      prev.map(f => ({
        ...f,
        competencies: f.competencies.map(c => 
          c.id === compId ? { ...c, ...updates } : c
        ),
      }))
    );
    toast({ title: 'Kompetenz aktualisiert' });
  };

  const freezeCurriculum = async () => {
    if (!curriculum) return;

    setSaving(true);
    const { error } = await supabase
      .from('curricula')
      .update({
        status: 'frozen',
        frozen_at: new Date().toISOString(),
      })
      .eq('id', curriculum.id);

    if (error) {
      toast({ title: 'Fehler beim Einfrieren', variant: 'destructive' });
    } else {
      setCurriculum({ ...curriculum, status: 'frozen', frozen_at: new Date().toISOString() });
      toast({ 
        title: 'Curriculum eingefroren!',
        description: 'Es kann jetzt für Kurse verwendet werden.',
      });
    }
    setSaving(false);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!curriculum) return null;

  const status = statusConfig[curriculum.status] || statusConfig.draft;
  const isEditable = status.editable;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/admin-v2/curricula">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-5 w-5" />
          </Button>
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-display font-bold">{curriculum.title}</h1>
            <Badge variant={status.variant}>
              {curriculum.status === 'frozen' ? <Lock className="h-3 w-3 mr-1" /> : <Unlock className="h-3 w-3 mr-1" />}
              {status.label}
            </Badge>
          </div>
          <p className="text-muted-foreground mt-1">
            {learningFields.length} Lernfelder • {learningFields.reduce((sum, f) => sum + f.competencies.length, 0)} Kompetenzen
          </p>
        </div>
        <div className="flex gap-2">
          {isEditable && (
            <>
              <Button variant="outline" onClick={saveCurriculum} disabled={saving}>
                <Save className="h-4 w-4 mr-2" />
                Speichern
              </Button>
              <Button 
                onClick={freezeCurriculum} 
                disabled={saving}
                className="gradient-primary text-primary-foreground"
              >
                <Lock className="h-4 w-4 mr-2" />
                Einfrieren
              </Button>
            </>
          )}
          {curriculum.status === 'frozen' && (
            <Link to={`/admin-v2/courses/new?curriculumId=${curriculum.id}`}>
              <Button className="gradient-accent text-accent-foreground">
                <Sparkles className="h-4 w-4 mr-2" />
                Kurs erstellen
              </Button>
            </Link>
          )}
        </div>
      </div>

      {/* Basic Info Card */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Grundinformationen</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Titel</Label>
            <Input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              disabled={!isEditable}
              className="bg-muted/50"
            />
          </div>
          <div className="space-y-2">
            <Label>Beschreibung</Label>
            <Textarea
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={!isEditable}
              className="bg-muted/50 min-h-[100px]"
            />
          </div>
          {curriculum.source_file_name && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <BookOpen className="h-4 w-4" />
              Quelldatei: {curriculum.source_file_name}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Learning Fields */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-display font-bold">Lernfelder</h2>
          {isEditable && learningFields.length === 0 && (
            <Button variant="outline" size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Lernfeld hinzufügen
            </Button>
          )}
        </div>

        {learningFields.length === 0 ? (
          <Card className="glass-card">
            <CardContent className="py-12 text-center">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <p className="text-muted-foreground">
                Noch keine Lernfelder vorhanden.
                {curriculum.status === 'draft' && ' Importieren Sie zuerst ein Curriculum.'}
              </p>
            </CardContent>
          </Card>
        ) : (
          learningFields.map((field, idx) => (
            <Card key={field.id} className="glass-card border-border/50 overflow-hidden">
              <CardHeader 
                className="cursor-pointer hover:bg-muted/30 transition-colors"
                onClick={() => toggleField(field.id)}
              >
                <div className="flex items-center gap-4">
                  {isEditable && (
                    <GripVertical className="h-5 w-5 text-muted-foreground cursor-grab" />
                  )}
                  <div className="w-10 h-10 rounded-xl gradient-primary flex items-center justify-center text-primary-foreground font-bold">
                    {idx + 1}
                  </div>
                  <div className="flex-1">
                    <CardTitle className="text-lg">{field.code}: {field.title}</CardTitle>
                    <CardDescription>
                      {field.hours}h • {field.competencies.length} Kompetenzen
                    </CardDescription>
                  </div>
                  {expandedFields.has(field.id) ? (
                    <ChevronUp className="h-5 w-5 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-5 w-5 text-muted-foreground" />
                  )}
                </div>
              </CardHeader>

              {expandedFields.has(field.id) && (
                <CardContent className="pt-0 pb-4 space-y-4">
                  {/* Field Edit Form */}
                  {isEditable && (
                    <div className="grid md:grid-cols-2 gap-4 p-4 bg-muted/20 rounded-xl">
                      <div className="space-y-2">
                        <Label>Code</Label>
                        <Input
                          value={field.code}
                          onChange={(e) => updateLearningField(field.id, { code: e.target.value })}
                          className="bg-background/50"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Stunden</Label>
                        <Input
                          type="number"
                          value={field.hours || ''}
                          onChange={(e) => updateLearningField(field.id, { hours: parseInt(e.target.value) || null })}
                          className="bg-background/50"
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label>Titel</Label>
                        <Input
                          value={field.title}
                          onChange={(e) => updateLearningField(field.id, { title: e.target.value })}
                          className="bg-background/50"
                        />
                      </div>
                      <div className="md:col-span-2 space-y-2">
                        <Label>Beschreibung</Label>
                        <Textarea
                          value={field.description || ''}
                          onChange={(e) => updateLearningField(field.id, { description: e.target.value || null })}
                          className="bg-background/50"
                        />
                      </div>
                    </div>
                  )}

                  {/* Competencies */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-muted-foreground px-1">Kompetenzen</p>
                    {field.competencies.map((comp, compIdx) => (
                      <div 
                        key={comp.id} 
                        className="p-4 bg-muted/20 rounded-xl border border-border/30 hover:border-border/50 transition-colors"
                      >
                        <div className="flex items-start gap-3">
                          <Badge variant="secondary" className="shrink-0 mt-1">
                            {comp.code}
                          </Badge>
                          <div className="flex-1 space-y-2">
                            {isEditable ? (
                              <>
                                <Input
                                  value={comp.title}
                                  onChange={(e) => updateCompetency(comp.id, { title: e.target.value })}
                                  className="bg-background/50"
                                  placeholder="Titel"
                                />
                                <Textarea
                                  value={comp.description || ''}
                                  onChange={(e) => updateCompetency(comp.id, { description: e.target.value || null })}
                                  className="bg-background/50 min-h-[60px]"
                                  placeholder="Beschreibung"
                                />
                                <div className="flex items-center gap-2">
                                  <Label className="text-xs">Taxonomie:</Label>
                                  <Input
                                    value={comp.taxonomy_level || ''}
                                    onChange={(e) => updateCompetency(comp.id, { taxonomy_level: e.target.value || null })}
                                    className="bg-background/50 w-40"
                                    placeholder="z.B. Anwenden"
                                  />
                                </div>
                              </>
                            ) : (
                              <>
                                <p className="font-medium">{comp.title}</p>
                                {comp.description && (
                                  <p className="text-sm text-muted-foreground">{comp.description}</p>
                                )}
                                {comp.taxonomy_level && (
                                  <Badge variant="outline" className="text-xs">
                                    {comp.taxonomy_level}
                                  </Badge>
                                )}
                              </>
                            )}
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

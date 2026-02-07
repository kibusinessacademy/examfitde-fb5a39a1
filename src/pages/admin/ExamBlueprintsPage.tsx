import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger, 
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  FileText, 
  Plus, 
  Lock, 
  Unlock,
  Clock, 
  Target,
  Loader2,
  Pencil,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { toast } from 'sonner';

interface ExamBlueprint {
  id: string;
  curriculum_id: string;
  title: string;
  description: string | null;
  total_questions: number;
  time_limit_minutes: number;
  pass_threshold: number;
  difficulty_distribution: {
    easy: number;
    medium: number;
    hard: number;
  };
  frozen: boolean;
  frozen_at: string | null;
  created_at: string;
  curricula?: {
    title: string;
  };
}

interface Curriculum {
  id: string;
  title: string;
  status: string;
}

export default function ExamBlueprintsPage() {
  const queryClient = useQueryClient();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingBlueprint, setEditingBlueprint] = useState<ExamBlueprint | null>(null);
  const [formData, setFormData] = useState({
    curriculum_id: '',
    title: '',
    description: '',
    total_questions: 40,
    time_limit_minutes: 90,
    pass_threshold: 0.5,
    easy_percent: 30,
    medium_percent: 50,
    hard_percent: 20,
  });

  // Fetch blueprints
  const { data: blueprints, isLoading } = useQuery({
    queryKey: ['exam-blueprints-admin'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('exam_blueprints')
        .select(`
          *,
          curricula (title)
        `)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      return data.map(b => ({
        ...b,
        difficulty_distribution: b.difficulty_distribution as unknown as ExamBlueprint['difficulty_distribution'],
      })) as ExamBlueprint[];
    },
  });

  // Fetch curricula for dropdown
  const { data: curricula } = useQuery({
    queryKey: ['curricula-frozen'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title, status')
        .eq('status', 'frozen')
        .order('title');
      
      if (error) throw error;
      return data as Curriculum[];
    },
  });

  // Create blueprint
  const createMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const { error } = await supabase
        .from('exam_blueprints')
        .insert({
          curriculum_id: data.curriculum_id,
          title: data.title,
          description: data.description || null,
          total_questions: data.total_questions,
          time_limit_minutes: data.time_limit_minutes,
          pass_threshold: data.pass_threshold,
          difficulty_distribution: {
            easy: data.easy_percent / 100,
            medium: data.medium_percent / 100,
            hard: data.hard_percent / 100,
          },
        });
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-blueprints-admin'] });
      setIsCreateOpen(false);
      resetForm();
      toast.success('Blueprint erstellt');
    },
    onError: (error) => {
      toast.error('Fehler beim Erstellen', { description: String(error) });
    },
  });

  // Update blueprint
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<typeof formData> }) => {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      
      if (data.title) updates.title = data.title;
      if (data.description !== undefined) updates.description = data.description || null;
      if (data.total_questions) updates.total_questions = data.total_questions;
      if (data.time_limit_minutes) updates.time_limit_minutes = data.time_limit_minutes;
      if (data.pass_threshold) updates.pass_threshold = data.pass_threshold;
      if (data.easy_percent !== undefined) {
        updates.difficulty_distribution = {
          easy: (data.easy_percent || 30) / 100,
          medium: (data.medium_percent || 50) / 100,
          hard: (data.hard_percent || 20) / 100,
        };
      }
      
      const { error } = await supabase
        .from('exam_blueprints')
        .update(updates)
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-blueprints-admin'] });
      setEditingBlueprint(null);
      toast.success('Blueprint aktualisiert');
    },
    onError: (error) => {
      toast.error('Fehler beim Aktualisieren', { description: String(error) });
    },
  });

  // Freeze/Unfreeze blueprint
  const freezeMutation = useMutation({
    mutationFn: async ({ id, freeze }: { id: string; freeze: boolean }) => {
      const { error } = await supabase
        .from('exam_blueprints')
        .update({
          frozen: freeze,
          frozen_at: freeze ? new Date().toISOString() : null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: (_, { freeze }) => {
      queryClient.invalidateQueries({ queryKey: ['exam-blueprints-admin'] });
      toast.success(freeze ? 'Blueprint freigegeben' : 'Blueprint entsperrt');
    },
    onError: (error) => {
      toast.error('Fehler', { description: String(error) });
    },
  });

  // Delete blueprint
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('exam_blueprints')
        .delete()
        .eq('id', id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exam-blueprints-admin'] });
      toast.success('Blueprint gelöscht');
    },
    onError: (error) => {
      toast.error('Fehler beim Löschen', { description: String(error) });
    },
  });

  const resetForm = () => {
    setFormData({
      curriculum_id: '',
      title: '',
      description: '',
      total_questions: 40,
      time_limit_minutes: 90,
      pass_threshold: 0.5,
      easy_percent: 30,
      medium_percent: 50,
      hard_percent: 20,
    });
  };

  const openEditDialog = (blueprint: ExamBlueprint) => {
    setEditingBlueprint(blueprint);
    setFormData({
      curriculum_id: blueprint.curriculum_id,
      title: blueprint.title,
      description: blueprint.description || '',
      total_questions: blueprint.total_questions,
      time_limit_minutes: blueprint.time_limit_minutes,
      pass_threshold: blueprint.pass_threshold,
      easy_percent: blueprint.difficulty_distribution.easy * 100,
      medium_percent: blueprint.difficulty_distribution.medium * 100,
      hard_percent: blueprint.difficulty_distribution.hard * 100,
    });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold">Prüfungs-Blueprints</h1>
          <p className="text-muted-foreground">
            Verwalte Prüfungsvorlagen mit IHK-konformer Struktur
          </p>
        </div>
        <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Neuer Blueprint
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Neuer Prüfungs-Blueprint</DialogTitle>
              <DialogDescription>
                Erstelle eine neue Prüfungsvorlage
              </DialogDescription>
            </DialogHeader>
            <BlueprintForm
              formData={formData}
              setFormData={setFormData}
              curricula={curricula || []}
              onSubmit={() => createMutation.mutate(formData)}
              isSubmitting={createMutation.isPending}
              submitLabel="Erstellen"
            />
          </DialogContent>
        </Dialog>
      </div>

      {/* Info Card */}
      <Card className="glass-card border-primary/20">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertCircle className="h-5 w-5 text-primary" />
            SSOT-Regeln für Blueprints
          </CardTitle>
        </CardHeader>
        <CardContent className="text-sm space-y-2">
          <p>• Blueprints müssen <strong>frozen</strong> sein, bevor Nutzer Prüfungen starten können</p>
          <p>• Gefrorene Blueprints können nicht mehr bearbeitet werden</p>
          <p>• Jede Prüfungssession referenziert einen Blueprint mit Seed für Reproduzierbarkeit</p>
        </CardContent>
      </Card>

      {/* Blueprints Table */}
      <Card className="glass-card">
        <CardContent className="pt-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Titel</TableHead>
                <TableHead>Curriculum</TableHead>
                <TableHead className="text-right">Fragen</TableHead>
                <TableHead className="text-right">Zeit</TableHead>
                <TableHead className="text-right">Bestehensgrenze</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {blueprints?.map((blueprint) => (
                <TableRow key={blueprint.id}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      {blueprint.title}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {blueprint.curricula?.title || '-'}
                  </TableCell>
                  <TableCell className="text-right">
                    {blueprint.total_questions}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Clock className="h-3 w-3" />
                      {blueprint.time_limit_minutes} Min
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Target className="h-3 w-3" />
                      {(blueprint.pass_threshold * 100).toFixed(0)}%
                    </div>
                  </TableCell>
                  <TableCell>
                    {blueprint.frozen ? (
                      <Badge className="gap-1 bg-primary/10 text-primary border-primary/20">
                        <Lock className="h-3 w-3" />
                        Freigegeben
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="gap-1">
                        <Unlock className="h-3 w-3" />
                        Entwurf
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      {!blueprint.frozen && (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => openEditDialog(blueprint)}
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            onClick={() => deleteMutation.mutate(blueprint.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      <Button
                        size="sm"
                        variant={blueprint.frozen ? "outline" : "default"}
                        onClick={() => freezeMutation.mutate({ 
                          id: blueprint.id, 
                          freeze: !blueprint.frozen 
                        })}
                      >
                        {blueprint.frozen ? (
                          <>
                            <Unlock className="h-4 w-4 mr-1" />
                            Entsperren
                          </>
                        ) : (
                          <>
                            <Lock className="h-4 w-4 mr-1" />
                            Freigeben
                          </>
                        )}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {blueprints?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Keine Blueprints vorhanden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Edit Dialog */}
      <Dialog open={!!editingBlueprint} onOpenChange={(open) => !open && setEditingBlueprint(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Blueprint bearbeiten</DialogTitle>
            <DialogDescription>
              Bearbeite die Prüfungsvorlage
            </DialogDescription>
          </DialogHeader>
          <BlueprintForm
            formData={formData}
            setFormData={setFormData}
            curricula={curricula || []}
            onSubmit={() => editingBlueprint && updateMutation.mutate({ 
              id: editingBlueprint.id, 
              data: formData 
            })}
            isSubmitting={updateMutation.isPending}
            submitLabel="Speichern"
            isEdit
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}

// Blueprint Form Component
function BlueprintForm({
  formData,
  setFormData,
  curricula,
  onSubmit,
  isSubmitting,
  submitLabel,
  isEdit = false,
}: {
  formData: {
    curriculum_id: string;
    title: string;
    description: string;
    total_questions: number;
    time_limit_minutes: number;
    pass_threshold: number;
    easy_percent: number;
    medium_percent: number;
    hard_percent: number;
  };
  setFormData: (data: typeof formData) => void;
  curricula: Curriculum[];
  onSubmit: () => void;
  isSubmitting: boolean;
  submitLabel: string;
  isEdit?: boolean;
}) {
  const totalPercent = formData.easy_percent + formData.medium_percent + formData.hard_percent;
  const isValidPercent = totalPercent === 100;

  return (
    <div className="space-y-4">
      {!isEdit && (
        <div className="space-y-2">
          <Label>Curriculum</Label>
          <Select
            value={formData.curriculum_id}
            onValueChange={(v) => setFormData({ ...formData, curriculum_id: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Curriculum auswählen" />
            </SelectTrigger>
            <SelectContent>
              {curricula.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      <div className="space-y-2">
        <Label>Titel</Label>
        <Input
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          placeholder="z.B. IHK Abschlussprüfung Teil 1"
        />
      </div>

      <div className="space-y-2">
        <Label>Beschreibung</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="Optionale Beschreibung..."
          rows={2}
        />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="space-y-2">
          <Label>Fragen</Label>
          <Input
            type="number"
            min={5}
            max={100}
            value={formData.total_questions}
            onChange={(e) => setFormData({ ...formData, total_questions: parseInt(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Zeit (Min)</Label>
          <Input
            type="number"
            min={10}
            max={300}
            value={formData.time_limit_minutes}
            onChange={(e) => setFormData({ ...formData, time_limit_minutes: parseInt(e.target.value) })}
          />
        </div>
        <div className="space-y-2">
          <Label>Bestehen (%)</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={formData.pass_threshold * 100}
            onChange={(e) => setFormData({ ...formData, pass_threshold: parseInt(e.target.value) / 100 })}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Schwierigkeitsverteilung</Label>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <Label className="text-xs text-muted-foreground">Leicht (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={formData.easy_percent}
              onChange={(e) => setFormData({ ...formData, easy_percent: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Mittel (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={formData.medium_percent}
              onChange={(e) => setFormData({ ...formData, medium_percent: parseInt(e.target.value) })}
            />
          </div>
          <div>
            <Label className="text-xs text-muted-foreground">Schwer (%)</Label>
            <Input
              type="number"
              min={0}
              max={100}
              value={formData.hard_percent}
              onChange={(e) => setFormData({ ...formData, hard_percent: parseInt(e.target.value) })}
            />
          </div>
        </div>
        {!isValidPercent && (
          <p className="text-sm text-destructive">
            Die Summe muss 100% ergeben (aktuell: {totalPercent}%)
          </p>
        )}
      </div>

      <DialogFooter>
        <Button 
          onClick={onSubmit} 
          disabled={isSubmitting || !formData.title || (!isEdit && !formData.curriculum_id) || !isValidPercent}
        >
          {isSubmitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );
}

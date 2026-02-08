import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { 
  PenLine, 
  Bookmark, 
  RotateCcw, 
  MessageSquare,
  Trash2,
  Plus,
  Save,
  X
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface CourseNotesProps {
  courseId: string;
  lessonId?: string;
  questionId?: string;
  compact?: boolean;
}

interface Note {
  id: string;
  course_id: string;
  lesson_id: string | null;
  question_id: string | null;
  note_type: 'general' | 'question' | 'repeat' | 'bookmark';
  content: string;
  is_flagged_for_repeat: boolean;
  created_at: string;
  updated_at: string;
}

const noteTypeConfig = {
  general: { label: 'Notiz', icon: PenLine, color: 'bg-blue-500' },
  question: { label: 'Frage', icon: MessageSquare, color: 'bg-purple-500' },
  repeat: { label: 'Wiederholen', icon: RotateCcw, color: 'bg-orange-500' },
  bookmark: { label: 'Lesezeichen', icon: Bookmark, color: 'bg-green-500' }
};

export function CourseNotes({ courseId, lessonId, questionId, compact = false }: CourseNotesProps) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newContent, setNewContent] = useState('');
  const [newType, setNewType] = useState<Note['note_type']>('general');
  const [flagForRepeat, setFlagForRepeat] = useState(false);
  const queryClient = useQueryClient();

  const { data: notes, isLoading } = useQuery({
    queryKey: ['course-notes', courseId, lessonId, questionId],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return [];

      let query = supabase
        .from('course_notes')
        .select('*')
        .eq('user_id', user.id)
        .eq('course_id', courseId)
        .order('created_at', { ascending: false });

      if (lessonId) query = query.eq('lesson_id', lessonId);
      if (questionId) query = query.eq('question_id', questionId);

      const { data, error } = await query;
      if (error) throw error;
      return data as Note[];
    }
  });

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Nicht angemeldet');

      const { error } = await supabase
        .from('course_notes')
        .insert({
          user_id: user.id,
          course_id: courseId,
          lesson_id: lessonId || null,
          question_id: questionId || null,
          note_type: newType,
          content: newContent,
          is_flagged_for_repeat: flagForRepeat
        });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-notes'] });
      setIsAdding(false);
      setNewContent('');
      setNewType('general');
      setFlagForRepeat(false);
      toast.success('Notiz gespeichert');
    }
  });

  const updateNoteMutation = useMutation({
    mutationFn: async ({ id, content }: { id: string; content: string }) => {
      const { error } = await supabase
        .from('course_notes')
        .update({ content, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-notes'] });
      setEditingId(null);
      toast.success('Notiz aktualisiert');
    }
  });

  const deleteNoteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('course_notes')
        .delete()
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-notes'] });
      toast.success('Notiz gelöscht');
    }
  });

  const toggleRepeatFlag = useMutation({
    mutationFn: async ({ id, flagged }: { id: string; flagged: boolean }) => {
      const { error } = await supabase
        .from('course_notes')
        .update({ is_flagged_for_repeat: flagged })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['course-notes'] });
    }
  });

  if (compact) {
    return (
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium flex items-center gap-2">
            <PenLine className="h-4 w-4" />
            Notizen ({notes?.length || 0})
          </span>
          <Button 
            variant="ghost" 
            size="sm"
            onClick={() => setIsAdding(!isAdding)}
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        {isAdding && (
          <div className="space-y-2 p-2 rounded-lg bg-muted/50">
            <Textarea
              placeholder="Deine Notiz..."
              value={newContent}
              onChange={(e) => setNewContent(e.target.value)}
              rows={2}
              className="text-sm"
            />
            <div className="flex gap-2">
              <Button 
                size="sm" 
                onClick={() => addNoteMutation.mutate()}
                disabled={!newContent.trim()}
              >
                <Save className="h-3 w-3 mr-1" />
                Speichern
              </Button>
              <Button 
                size="sm" 
                variant="ghost"
                onClick={() => setIsAdding(false)}
              >
                <X className="h-3 w-3" />
              </Button>
            </div>
          </div>
        )}

        {notes?.slice(0, 3).map((note) => (
          <div key={note.id} className="p-2 rounded-lg bg-muted/30 text-sm">
            <p className="line-clamp-2">{note.content}</p>
          </div>
        ))}
      </div>
    );
  }

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span className="flex items-center gap-2">
            <PenLine className="h-5 w-5" />
            Meine Notizen
            {notes && notes.length > 0 && (
              <Badge variant="secondary">{notes.length}</Badge>
            )}
          </span>
          {!isAdding && (
            <Button size="sm" onClick={() => setIsAdding(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Neue Notiz
            </Button>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Add Note Form */}
        {isAdding && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="pt-4 space-y-4">
              <div className="flex gap-2 flex-wrap">
                {(Object.keys(noteTypeConfig) as Note['note_type'][]).map((type) => {
                  const config = noteTypeConfig[type];
                  const Icon = config.icon;
                  return (
                    <Button
                      key={type}
                      variant={newType === type ? "default" : "outline"}
                      size="sm"
                      onClick={() => setNewType(type)}
                    >
                      <Icon className="h-4 w-4 mr-1" />
                      {config.label}
                    </Button>
                  );
                })}
              </div>
              
              <Textarea
                placeholder="Deine Notiz hier eingeben..."
                value={newContent}
                onChange={(e) => setNewContent(e.target.value)}
                rows={3}
              />

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={flagForRepeat}
                    onChange={(e) => setFlagForRepeat(e.target.checked)}
                    className="rounded"
                  />
                  <RotateCcw className="h-4 w-4" />
                  Zur Wiederholung markieren
                </label>
              </div>

              <div className="flex gap-2">
                <Button 
                  onClick={() => addNoteMutation.mutate()}
                  disabled={!newContent.trim() || addNoteMutation.isPending}
                >
                  <Save className="h-4 w-4 mr-2" />
                  Speichern
                </Button>
                <Button variant="ghost" onClick={() => setIsAdding(false)}>
                  Abbrechen
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Notes List */}
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-20 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : notes?.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Noch keine Notizen vorhanden.
          </div>
        ) : (
          <div className="space-y-3">
            {notes?.map((note) => {
              const config = noteTypeConfig[note.note_type];
              const Icon = config.icon;
              const isEditing = editingId === note.id;

              return (
                <Card key={note.id} className={cn(
                  "transition-colors",
                  note.is_flagged_for_repeat && "border-orange-500/30 bg-orange-500/5"
                )}>
                  <CardContent className="pt-4">
                    <div className="flex items-start gap-3">
                      <div className={cn("p-2 rounded-lg", config.color, "bg-opacity-20")}>
                        <Icon className={cn("h-4 w-4", config.color.replace('bg-', 'text-'))} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge variant="outline" className="text-xs">
                            {config.label}
                          </Badge>
                          {note.is_flagged_for_repeat && (
                            <Badge variant="secondary" className="text-xs gap-1">
                              <RotateCcw className="h-3 w-3" />
                              Wiederholen
                            </Badge>
                          )}
                          <span className="text-xs text-muted-foreground ml-auto">
                            {format(new Date(note.updated_at), 'dd.MM.yy HH:mm', { locale: de })}
                          </span>
                        </div>

                        {isEditing ? (
                          <div className="space-y-2">
                            <Textarea
                              defaultValue={note.content}
                              id={`edit-${note.id}`}
                              rows={2}
                            />
                            <div className="flex gap-2">
                              <Button 
                                size="sm"
                                onClick={() => {
                                  const textarea = document.getElementById(`edit-${note.id}`) as HTMLTextAreaElement;
                                  updateNoteMutation.mutate({ id: note.id, content: textarea.value });
                                }}
                              >
                                Speichern
                              </Button>
                              <Button 
                                size="sm" 
                                variant="ghost"
                                onClick={() => setEditingId(null)}
                              >
                                Abbrechen
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-sm whitespace-pre-wrap">{note.content}</p>
                        )}
                      </div>

                      {!isEditing && (
                        <div className="flex gap-1">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => toggleRepeatFlag.mutate({ 
                              id: note.id, 
                              flagged: !note.is_flagged_for_repeat 
                            })}
                            title={note.is_flagged_for_repeat ? "Markierung entfernen" : "Zur Wiederholung markieren"}
                          >
                            <RotateCcw className={cn(
                              "h-4 w-4",
                              note.is_flagged_for_repeat && "text-orange-500"
                            )} />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setEditingId(note.id)}
                          >
                            <PenLine className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => {
                              if (confirm('Notiz wirklich löschen?')) {
                                deleteNoteMutation.mutate(note.id);
                              }
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
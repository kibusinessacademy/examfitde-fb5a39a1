import { useState, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useCanonicalTitles, resolveTitle } from '@/hooks/useCanonicalTitles';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { GripVertical, ArrowRight, Save, RotateCcw, Zap, Clock, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';
import SortableQueueItem from '@/components/admin/queue/SortableQueueItem';

interface QueuePackage {
  id: string;
  title: string | null;
  status: string;
  priority: number;
  build_progress: number;
  created_at: string;
  updated_at: string;
}

export default function QueueManagerPage() {
  const queryClient = useQueryClient();

  const { data: packages, isLoading } = useQuery({
    queryKey: ['queue-manager-packages'],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('course_packages')
        .select('id, title, status, priority, build_progress, created_at, updated_at')
        .in('status', ['queued', 'building', 'planning', 'draft'])
        .order('priority', { ascending: true })
        .order('created_at', { ascending: true });
      if (error) throw error;
      return data as QueuePackage[];
    },
    refetchInterval: 30000,
  });

  // Local order state for drag & drop
  const [localOrder, setLocalOrder] = useState<QueuePackage[] | null>(null);
  const [hasChanges, setHasChanges] = useState(false);

  const displayList = localOrder ?? packages ?? [];

  // Split into active (building) and queued
  const activePackages = useMemo(() => displayList.filter(p => p.status === 'building'), [displayList]);
  const queuedPackages = useMemo(() => displayList.filter(p => p.status !== 'building'), [displayList]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const currentList = localOrder ?? packages ?? [];
    const queueOnly = currentList.filter(p => p.status !== 'building');
    const building = currentList.filter(p => p.status === 'building');

    const oldIndex = queueOnly.findIndex(p => p.id === active.id);
    const newIndex = queueOnly.findIndex(p => p.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = arrayMove(queueOnly, oldIndex, newIndex);
    // Assign new priorities: building keeps theirs, queued gets sequential from 1
    const updated = [
      ...building,
      ...reordered.map((p, i) => ({ ...p, priority: i + 1 })),
    ];

    setLocalOrder(updated);
    setHasChanges(true);
  }, [localOrder, packages]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!localOrder) return;
      const queueOnly = localOrder.filter(p => p.status !== 'building');
      // Batch update priorities
      const updates = queueOnly.map((p, i) => ({
        id: p.id,
        priority: i + 1,
      }));

      for (const u of updates) {
        const { error } = await (supabase as any)
          .from('course_packages')
          .update({ priority: u.priority })
          .eq('id', u.id);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast.success(`Reihenfolge gespeichert (${localOrder?.filter(p => p.status !== 'building').length} Pakete)`);
      setHasChanges(false);
      setLocalOrder(null);
      queryClient.invalidateQueries({ queryKey: ['queue-manager-packages'] });
      queryClient.invalidateQueries({ queryKey: ['course-packages'] });
    },
    onError: (err: any) => {
      toast.error('Fehler beim Speichern: ' + (err?.message || 'Unbekannt'));
    },
  });

  const handleReset = () => {
    setLocalOrder(null);
    setHasChanges(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <Skeleton className="h-10 w-64" />
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-16" />)}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold text-foreground">Queue Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ziehe Kurse per Drag & Drop in die gewünschte Reihenfolge. Oben = höchste Priorität.
          </p>
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={handleReset}>
              <RotateCcw className="h-4 w-4 mr-1" /> Zurücksetzen
            </Button>
          )}
          <Button
            size="sm"
            disabled={!hasChanges || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            <Save className="h-4 w-4 mr-1" />
            {saveMutation.isPending ? 'Speichert…' : 'Reihenfolge speichern'}
          </Button>
        </div>
      </div>

      {hasChanges && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/30 text-sm text-primary">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Ungespeicherte Änderungen – klicke "Reihenfolge speichern" um zu übernehmen.
        </div>
      )}

      {/* Active builds (not draggable) */}
      {activePackages.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              Aktive Builds ({activePackages.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {activePackages.map(pkg => (
              <Link key={pkg.id} to={`/admin/studio/${pkg.id}`} className="block">
                <div className="flex items-center gap-3 p-2.5 rounded-lg hover:bg-muted/50 transition-colors">
                  <div className="w-6" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{pkg.title || pkg.id.substring(0, 12)}</p>
                    <p className="text-xs text-muted-foreground">Prio {pkg.priority} · {pkg.build_progress}%</p>
                  </div>
                  <Badge variant="outline" className="bg-primary/10 text-primary text-xs">
                    Building
                  </Badge>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Draggable queue */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            Warteschlange ({queuedPackages.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          {queuedPackages.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">Keine Pakete in der Warteschlange.</p>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={queuedPackages.map(p => p.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-1">
                  {queuedPackages.map((pkg, index) => (
                    <SortableQueueItem key={pkg.id} pkg={pkg} index={index} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

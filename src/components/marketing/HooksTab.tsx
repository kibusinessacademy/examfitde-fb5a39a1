import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Zap } from 'lucide-react';
import { toast } from 'sonner';

const categoryColors: Record<string, string> = {
  reichweite: 'bg-blue-100 text-blue-800',
  vertrauen: 'bg-amber-100 text-amber-800',
  conversion: 'bg-green-100 text-green-800',
  provokation: 'bg-red-100 text-red-800',
  neugier: 'bg-purple-100 text-purple-800',
};

export default function HooksTab() {
  const queryClient = useQueryClient();
  const [newHook, setNewHook] = useState('');
  const [newCategory, setNewCategory] = useState('reichweite');

  const { data: hooks, isLoading } = useQuery({
    queryKey: ['content-hooks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_hooks')
        .select('*')
        .eq('is_active', true)
        .order('avg_performance_score', { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const addHook = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('content_hooks').insert({
        hook_text: newHook,
        category: newCategory,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['content-hooks'] });
      toast.success('Hook hinzugefügt');
      setNewHook('');
    },
    onError: () => toast.error('Fehler'),
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const grouped = hooks?.reduce((acc, h) => {
    const cat = h.category || 'reichweite';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(h);
    return acc;
  }, {} as Record<string, typeof hooks>) || {};

  return (
    <div className="space-y-6">
      {/* Add Hook */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5 text-primary" />
            Hook-Datenbank
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            <Input
              placeholder="Neuen Hook eingeben..."
              value={newHook}
              onChange={(e) => setNewHook(e.target.value)}
              className="flex-1"
            />
            <Select value={newCategory} onValueChange={setNewCategory}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="reichweite">Reichweite</SelectItem>
                <SelectItem value="vertrauen">Vertrauen</SelectItem>
                <SelectItem value="conversion">Conversion</SelectItem>
                <SelectItem value="provokation">Provokation</SelectItem>
                <SelectItem value="neugier">Neugier</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => addHook.mutate()} disabled={!newHook.trim() || addHook.isPending}>
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hooks by Category */}
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(grouped).map(([category, categoryHooks]) => (
          <Card key={category}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm capitalize flex items-center gap-2">
                <span className={`inline-block w-3 h-3 rounded-full ${categoryColors[category]?.split(' ')[0] || 'bg-gray-100'}`} />
                {category} ({categoryHooks?.length || 0})
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {categoryHooks?.map((hook) => (
                <div key={hook.id} className="flex items-start gap-2 text-sm p-2 rounded bg-muted/50">
                  <span className="flex-1">„{hook.hook_text}"</span>
                  {(hook.usage_count || 0) > 0 && (
                    <Badge variant="outline" className="text-xs shrink-0">{hook.usage_count}×</Badge>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>

      <p className="text-xs text-muted-foreground text-center">
        {hooks?.length || 0} aktive Hooks • Sortiert nach Performance-Score
      </p>
    </div>
  );
}

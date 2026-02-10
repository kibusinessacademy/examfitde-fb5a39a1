import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Package } from 'lucide-react';

export default function BundlesTab() {
  const { data: bundles, isLoading } = useQuery({
    queryKey: ['course-bundles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('course_bundles')
        .select('*')
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Kurs-Bundles und Paketangebote</p>
        <Button><Plus className="h-4 w-4 mr-2" /> Neues Bundle</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {bundles?.map((bundle) => (
          <Card key={bundle.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Package className="h-5 w-5" />
                {bundle.name}
              </CardTitle>
              <CardDescription>{bundle.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-4">
                <span className="text-2xl font-bold">{bundle.bundle_price}€</span>
                {bundle.original_price && (
                  <span className="text-muted-foreground line-through">{bundle.original_price}€</span>
                )}
              </div>
              <Badge variant={bundle.is_active ? 'default' : 'secondary'}>
                {bundle.is_active ? 'Aktiv' : 'Inaktiv'}
              </Badge>
            </CardContent>
          </Card>
        ))}
        {bundles?.length === 0 && (
          <Card className="col-span-full py-8">
            <CardContent className="text-center text-muted-foreground">
              Noch keine Bundles erstellt
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { ShieldCheck, ShieldAlert } from 'lucide-react';

export default function AssetsTab() {
  const { data: assets, isLoading } = useQuery({
    queryKey: ['marketing-assets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('marketing_assets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const byStatus = (s: string) => assets?.filter(a => a.status === s).length || 0;

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-5">
        {['draft', 'generated', 'validated', 'approved', 'published'].map(s => (
          <Card key={s}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm text-muted-foreground capitalize">{s}</CardTitle>
            </CardHeader>
            <CardContent><div className="text-2xl font-bold">{byStatus(s)}</div></CardContent>
          </Card>
        ))}
      </div>

      <p className="text-muted-foreground">Content-Assets (Gemini → Claude Validation)</p>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Titel</TableHead>
            <TableHead>Typ</TableHead>
            <TableHead>Zielgruppe</TableHead>
            <TableHead>LLM</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Legal</TableHead>
            <TableHead>Score</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {assets?.map((a) => (
            <TableRow key={a.id}>
              <TableCell className="font-medium max-w-[200px] truncate">{a.title}</TableCell>
              <TableCell><Badge variant="outline">{a.asset_type}</Badge></TableCell>
              <TableCell><Badge variant="secondary">{a.target_group}</Badge></TableCell>
              <TableCell className="text-xs text-muted-foreground">{a.llm_used}</TableCell>
              <TableCell>
                <Badge variant={a.status === 'published' ? 'default' : a.status === 'rejected' ? 'destructive' : 'secondary'}>
                  {a.status}
                </Badge>
              </TableCell>
              <TableCell>
                {a.legal_check_passed
                  ? <ShieldCheck className="h-4 w-4 text-success" />
                  : <ShieldAlert className="h-4 w-4 text-warning" />}
              </TableCell>
              <TableCell>
                {a.validation_score != null
                  ? <span className={a.validation_score >= 70 ? 'text-success font-bold tabular-nums' : 'text-warning tabular-nums'}>{a.validation_score}%</span>
                  : '–'}
              </TableCell>
            </TableRow>
          ))}
          {assets?.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-center text-muted-foreground py-8">Noch keine Assets</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, FileText, Loader2, Eye, Snowflake, RefreshCw, Pencil } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Curriculum = Tables<'curricula'>;

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  draft: { label: 'Entwurf', variant: 'secondary' },
  extracting: { label: 'Extraktion...', variant: 'outline' },
  normalizing: { label: 'Normalisierung', variant: 'outline' },
  frozen: { label: 'Eingefroren', variant: 'default' },
};

export default function CurriculaList() {
  const [curricula, setCurricula] = useState<Curriculum[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCurricula();
  }, []);

  const fetchCurricula = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('curricula')
      .select('*')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setCurricula(data);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Curricula</h1>
          <p className="text-muted-foreground mt-1">Verwalte Rahmenlehrpläne und importiere neue</p>
        </div>
        <Link to="/admin-v2/curricula/new">
          <Button className="gradient-primary text-primary-foreground shadow-glow-sm">
            <Plus className="h-4 w-4 mr-2" />
            Curriculum importieren
          </Button>
        </Link>
      </div>

      {/* Table */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : curricula.length === 0 ? (
            <div className="text-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">Keine Curricula vorhanden</h3>
              <p className="text-muted-foreground mb-4">Importiere ein neues Curriculum, um zu beginnen.</p>
              <Link to="/admin-v2/curricula/new">
                <Button className="gradient-primary text-primary-foreground">
                  <Plus className="h-4 w-4 mr-2" />
                  Erstes Curriculum importieren
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Titel</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Erstellt am</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {curricula.map((curriculum) => {
                  const status = statusConfig[curriculum.status] || statusConfig.draft;
                  return (
                    <TableRow key={curriculum.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium text-foreground">{curriculum.title}</p>
                          {curriculum.description && (
                            <p className="text-sm text-muted-foreground line-clamp-1">{curriculum.description}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{curriculum.version || '1.0'}</TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="gap-1">
                          {curriculum.status === 'frozen' && <Snowflake className="h-3 w-3" />}
                          {(curriculum.status === 'extracting' || curriculum.status === 'normalizing') && (
                            <RefreshCw className="h-3 w-3 animate-spin" />
                          )}
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(curriculum.created_at).toLocaleDateString('de-DE')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/admin-v2/curricula/${curriculum.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          {curriculum.status !== 'frozen' && (
                            <Link to={`/admin-v2/curricula/${curriculum.id}/edit`}>
                              <Button variant="ghost" size="sm">
                                <Pencil className="h-4 w-4" />
                              </Button>
                            </Link>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

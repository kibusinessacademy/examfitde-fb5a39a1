import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCoursePackages } from '@/hooks/useCoursePackages';
import { useAdminVisiblePackages } from '@/hooks/useAdminVisiblePackages';
import { dedupeVisiblePackages } from '@/lib/admin/dedupeVisiblePackages';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Loader2, Plus, CheckCircle2, XCircle, Clock, Package, Brain, Wrench, Shield, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const STATUS_MAP: Record<string, { label: string; color: string; icon: any }> = {
  planning: { label: 'Planung', color: 'bg-muted text-muted-foreground', icon: Clock },
  council_review: { label: 'Council Review', color: 'bg-warning/20 text-warning', icon: Brain },
  building: { label: 'Build läuft', color: 'bg-primary/20 text-primary', icon: Wrench },
  qa: { label: 'QA', color: 'bg-accent/20 text-accent-foreground', icon: Shield },
  published: { label: 'Veröffentlicht', color: 'bg-success/20 text-success', icon: CheckCircle2 },
  failed: { label: 'Fehlgeschlagen', color: 'bg-destructive/20 text-destructive', icon: XCircle },
};

function PackageList({ onSelect }: { onSelect: (id: string) => void }) {
  const { data: packages, isLoading, createPackage } = useCoursePackages();
  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [certId, setCertId] = useState('');

  const { data: curricula } = useQuery({
    queryKey: ['curricula-list'],
    queryFn: async () => {
      const { data } = await supabase.from('curricula').select('id, title, version').order('title');
      return data || [];
    },
  });

  const handleCreate = () => {
    if (!certId || !title) return;
    createPackage.mutate({ certificationId: certId, curriculumId: certId, title }, {
      onSuccess: (pkg) => onSelect(pkg.id),
    });
  };

  if (isLoading) return <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold">Course Studio</h1>
          <p className="text-xs sm:text-sm text-muted-foreground">ExamFit-Produktpakete erstellen & verwalten</p>
        </div>
        <Button onClick={() => setShowCreate(!showCreate)} size="sm">
          <Plus className="h-4 w-4 mr-1" /> Neues Paket
        </Button>
      </div>

      {showCreate && (
        <Card>
          <CardContent className="pt-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Ausbildungsberuf / Zertifizierung</label>
                <Select value={certId} onValueChange={setCertId}>
                  <SelectTrigger><SelectValue placeholder="Wählen..." /></SelectTrigger>
                  <SelectContent>
                    {(curricula || []).map((c: any) => (
                      <SelectItem key={c.id} value={c.id}>{c.title} (v{c.version})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs font-medium text-muted-foreground mb-1 block">Paketname</label>
                <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="z.B. Kaufleute für Büromanagement 2025" />
              </div>
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={!certId || !title || createPackage.isPending} size="sm">
                {createPackage.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Package className="h-4 w-4 mr-1" />}
                Paket erstellen
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setShowCreate(false)}>Abbrechen</Button>
            </div>
          </CardContent>
        </Card>
      )}

      {(packages || []).length === 0 && !showCreate ? (
        <Card>
          <CardContent className="py-12 text-center">
            <Package className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
            <p className="text-muted-foreground">Noch keine Produktpakete erstellt.</p>
            <Button className="mt-4" onClick={() => setShowCreate(true)}><Plus className="h-4 w-4 mr-1" /> Erstes Paket erstellen</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3">
          {(packages || []).map((pkg) => {
            const statusInfo = STATUS_MAP[pkg.status] || STATUS_MAP.planning;
            const StatusIcon = statusInfo.icon;
            return (
              <Card key={pkg.id} className="cursor-pointer hover:border-primary/30 transition-colors" onClick={() => onSelect(pkg.id)}>
                <CardContent className="p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold text-sm truncate">{pkg.title || 'Unbenannt'}</h3>
                      <Badge variant="outline" className={cn("text-xs shrink-0", statusInfo.color)}>
                        <StatusIcon className="h-3 w-3 mr-1" />{statusInfo.label}
                      </Badge>
                    </div>
                    {pkg.build_progress > 0 && (
                      <Progress value={pkg.build_progress} className="h-1.5 mt-2" />
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function CourseStudioPage() {
  const navigate = useNavigate();
  return <PackageList onSelect={(id) => navigate(`/admin/studio/${id}`)} />;
}

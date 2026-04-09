import React, { useState } from 'react';
import { useSEORedirects, useSEORedirectMutations, type SEORedirect } from '@/hooks/useContentStudio';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import { Plus, Trash2, ArrowRight, Link2, CheckCircle, XCircle } from 'lucide-react';
import { toast } from 'sonner';

export default function SEORedirectManager() {
  const { data: redirects, isLoading } = useSEORedirects();
  const { create, update, remove } = useSEORedirectMutations();
  const [newFrom, setNewFrom] = useState('');
  const [newTo, setNewTo] = useState('');
  const [newCode, setNewCode] = useState('301');

  if (isLoading) return <Skeleton className="h-40" />;

  const handleCreate = () => {
    if (!newFrom || !newTo) { toast.error('Von und Nach sind Pflicht'); return; }
    create.mutate({ from_path: newFrom, to_path: newTo, status_code: parseInt(newCode), is_active: true });
    setNewFrom(''); setNewTo('');
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2"><Link2 className="h-4 w-4" /> Neuer Redirect</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-2 flex-wrap">
            <div className="flex-1 min-w-[120px] space-y-1">
              <Label className="text-[10px]">Von</Label>
              <Input value={newFrom} onChange={e => setNewFrom(e.target.value)} placeholder="/alter-pfad" className="h-8 text-xs" />
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground mb-2" />
            <div className="flex-1 min-w-[120px] space-y-1">
              <Label className="text-[10px]">Nach</Label>
              <Input value={newTo} onChange={e => setNewTo(e.target.value)} placeholder="/neuer-pfad" className="h-8 text-xs" />
            </div>
            <Select value={newCode} onValueChange={setNewCode}>
              <SelectTrigger className="w-20 h-8 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="301">301</SelectItem>
                <SelectItem value="302">302</SelectItem>
                <SelectItem value="307">307</SelectItem>
                <SelectItem value="308">308</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleCreate} className="text-xs gap-1"><Plus className="h-3 w-3" /> Erstellen</Button>
          </div>
        </CardContent>
      </Card>

      <div className="space-y-1">
        {(redirects || []).length === 0 && (
          <Card className="border-dashed"><CardContent className="py-6 text-center text-sm text-muted-foreground">Keine Redirects konfiguriert</CardContent></Card>
        )}
        {(redirects || []).map(r => (
          <Card key={r.id} className="hover:bg-muted/20 transition-colors">
            <CardContent className="py-2 px-4 flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                {r.is_active ? <CheckCircle className="h-3 w-3 text-emerald-500 shrink-0" /> : <XCircle className="h-3 w-3 text-rose-500 shrink-0" />}
                <span className="text-xs font-mono truncate">{r.from_path}</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="text-xs font-mono truncate">{r.to_path}</span>
                <Badge variant="outline" className="text-[9px]">{r.status_code}</Badge>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Switch checked={r.is_active} onCheckedChange={v => update.mutate({ id: r.id, is_active: v })} />
                <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => remove.mutate(r.id)}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

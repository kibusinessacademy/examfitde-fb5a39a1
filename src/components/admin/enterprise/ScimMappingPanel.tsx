import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from 'sonner';
import { ArrowRight, Plus, Trash2, Users, KeyRound, Ticket, Building2, Copy, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const EXAMFIT_USER_FIELDS = ['email', 'first_name', 'last_name', 'display_name', 'status', 'phone', 'external_id'];
const EXAMFIT_ROLES = ['learner', 'manager', 'admin'];
const SCIM_USER_FIELDS = ['userName', 'name.givenName', 'name.familyName', 'displayName', 'active', 'emails[0].value', 'phoneNumbers[0].value', 'externalId'];

interface ScimMapping {
  id: string;
  org_id: string;
  mapping_type: string;
  source_field: string;
  target_field: string;
  transform_rules: any;
  is_active: boolean;
  priority: number;
}

function useMappings() {
  return useQuery({
    queryKey: ['scim-mappings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('scim_mappings').select('*').order('priority');
      if (error) throw error;
      return (data ?? []) as unknown as ScimMapping[];
    },
  });
}

function MappingRow({ mapping, onDelete, onToggle }: {
  mapping: ScimMapping;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const typeIcons: Record<string, React.ReactNode> = {
    user: <Users className="h-3.5 w-3.5" />,
    role: <KeyRound className="h-3.5 w-3.5" />,
    seat: <Ticket className="h-3.5 w-3.5" />,
    department: <Building2 className="h-3.5 w-3.5" />,
  };

  return (
    <div className={cn("flex items-center gap-2 rounded-lg border p-3 transition-opacity", !mapping.is_active && "opacity-50")}>
      <div className="rounded-md bg-muted p-1.5">{typeIcons[mapping.mapping_type] || <Users className="h-3.5 w-3.5" />}</div>
      <Badge variant="outline" className="text-[10px] shrink-0">{mapping.mapping_type}</Badge>
      <code className="text-xs bg-muted px-1.5 py-0.5 rounded flex-1 truncate">{mapping.source_field}</code>
      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
      <code className="text-xs bg-primary/10 text-primary px-1.5 py-0.5 rounded flex-1 truncate">{mapping.target_field}</code>
      <Switch checked={mapping.is_active} onCheckedChange={onToggle} className="shrink-0" />
      <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive" onClick={onDelete}>
        <Trash2 className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export default function ScimMappingPanel() {
  const qc = useQueryClient();
  const { data: mappings, isLoading } = useMappings();
  const [newMapping, setNewMapping] = useState({ mapping_type: 'user', source_field: '', target_field: '' });

  const addMutation = useMutation({
    mutationFn: async (m: typeof newMapping) => {
      const { error } = await supabase.from('scim_mappings').insert({
        org_id: '00000000-0000-0000-0000-000000000000',
        mapping_type: m.mapping_type,
        source_field: m.source_field,
        target_field: m.target_field,
        is_active: true,
        priority: (mappings?.length ?? 0) + 1,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scim-mappings'] }); toast.success('Mapping hinzugefügt'); setNewMapping({ mapping_type: 'user', source_field: '', target_field: '' }); },
    onError: (e: any) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('scim_mappings').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['scim-mappings'] }); toast.success('Mapping gelöscht'); },
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await supabase.from('scim_mappings').update({ is_active } as any).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['scim-mappings'] }),
  });

  const scimEndpoint = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/scim`;

  const userMappings = mappings?.filter(m => m.mapping_type === 'user') ?? [];
  const roleMappings = mappings?.filter(m => m.mapping_type === 'role') ?? [];
  const seatMappings = mappings?.filter(m => m.mapping_type === 'seat') ?? [];
  const deptMappings = mappings?.filter(m => m.mapping_type === 'department') ?? [];

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16" />)}</div>;

  return (
    <div className="space-y-6">
      {/* SCIM Endpoint */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RefreshCw className="h-4 w-4 text-primary" /> SCIM 2.0 Endpunkt
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <div className="flex items-center gap-2">
            <code className="text-xs bg-muted px-2 py-1.5 rounded flex-1 break-all">{scimEndpoint}</code>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { navigator.clipboard.writeText(scimEndpoint); toast.success('Kopiert'); }}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Verwenden Sie diesen Endpunkt in Azure AD, Okta oder Google Workspace für die SCIM-Integration.</p>
        </CardContent>
      </Card>

      {/* Mapping Tabs */}
      <Tabs defaultValue="user" className="w-full">
        <TabsList className="w-full grid grid-cols-4">
          <TabsTrigger value="user" className="text-xs gap-1"><Users className="h-3 w-3" />User ({userMappings.length})</TabsTrigger>
          <TabsTrigger value="role" className="text-xs gap-1"><KeyRound className="h-3 w-3" />Role ({roleMappings.length})</TabsTrigger>
          <TabsTrigger value="seat" className="text-xs gap-1"><Ticket className="h-3 w-3" />Seat ({seatMappings.length})</TabsTrigger>
          <TabsTrigger value="department" className="text-xs gap-1"><Building2 className="h-3 w-3" />Dept ({deptMappings.length})</TabsTrigger>
        </TabsList>

        {(['user', 'role', 'seat', 'department'] as const).map(type => {
          const items = type === 'user' ? userMappings : type === 'role' ? roleMappings : type === 'seat' ? seatMappings : deptMappings;
          return (
            <TabsContent key={type} value={type} className="space-y-3 mt-4">
              {items.length === 0 && (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  Keine {type === 'user' ? 'User' : type === 'role' ? 'Rollen' : type === 'seat' ? 'Seat' : 'Department'}-Mappings konfiguriert.
                </div>
              )}
              {items.map(m => (
                <MappingRow
                  key={m.id}
                  mapping={m}
                  onDelete={() => deleteMutation.mutate(m.id)}
                  onToggle={() => toggleMutation.mutate({ id: m.id, is_active: !m.is_active })}
                />
              ))}
            </TabsContent>
          );
        })}
      </Tabs>

      {/* Add Mapping */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Neues Mapping</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-xs">Typ</Label>
              <Select value={newMapping.mapping_type} onValueChange={v => setNewMapping(p => ({ ...p, mapping_type: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">User</SelectItem>
                  <SelectItem value="role">Role</SelectItem>
                  <SelectItem value="seat">Seat</SelectItem>
                  <SelectItem value="department">Department</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">SCIM Feld</Label>
              <Select value={newMapping.source_field} onValueChange={v => setNewMapping(p => ({ ...p, source_field: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                <SelectContent>
                  {SCIM_USER_FIELDS.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">ExamFit Feld</Label>
              <Select value={newMapping.target_field} onValueChange={v => setNewMapping(p => ({ ...p, target_field: v }))}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Auswählen" /></SelectTrigger>
                <SelectContent>
                  {(newMapping.mapping_type === 'role' ? EXAMFIT_ROLES : EXAMFIT_USER_FIELDS).map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <Button size="sm" disabled={!newMapping.source_field || !newMapping.target_field} onClick={() => addMutation.mutate(newMapping)}>
            <Plus className="h-4 w-4 mr-1" /> Mapping hinzufügen
          </Button>
        </CardContent>
      </Card>

      {/* SCIM Event Log Preview */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">Letzte SCIM Events</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[
              { method: 'POST', path: '/Users', status: 'SUCCESS', detail: 'User erstellt: max@firma.de', time: 'vor 2 Min.' },
              { method: 'PATCH', path: '/Users/abc', status: 'SUCCESS', detail: 'Rolle aktualisiert → manager', time: 'vor 5 Min.' },
              { method: 'DELETE', path: '/Users/xyz', status: 'SUCCESS', detail: 'User deaktiviert, Seat entzogen', time: 'vor 1 Std.' },
            ].map((evt, i) => (
              <div key={i} className="flex items-center gap-2 text-xs rounded-lg border p-2">
                <Badge variant={evt.method === 'DELETE' ? 'destructive' : 'outline'} className="text-[10px] font-mono">{evt.method}</Badge>
                <code className="text-muted-foreground">{evt.path}</code>
                <span className="flex-1 truncate">{evt.detail}</span>
                <Badge className="bg-success/10 text-success border-success/30 text-[10px]">{evt.status}</Badge>
                <span className="text-muted-foreground shrink-0">{evt.time}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

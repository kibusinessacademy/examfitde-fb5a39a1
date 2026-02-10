import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Users, 
  UserCircle,
  MessageSquare,
  Tag,
  Filter,
  Search,
  Plus,
  AlertCircle,
  CheckCircle,
  Clock,
  ArrowRight,
  Mail,
  Phone,
  Calendar,
  Activity,
  Eye
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// Learner Management Tab
function LearnersTab() {
  const [searchQuery, setSearchQuery] = useState('');

  const { data: learners, isLoading } = useQuery({
    queryKey: ['learners', searchQuery],
    queryFn: async () => {
      let query = supabase
        .from('profiles')
        .select(`
          *,
          course_enrollments:course_enrollments(count),
          lesson_outcomes:lesson_outcomes(count)
        `)
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (searchQuery) {
        query = query.ilike('full_name', `%${searchQuery}%`);
      }
      
      const { data, error } = await query;
      if (error) throw error;
      return data;
    }
  });

  const { data: tags } = useQuery({
    queryKey: ['learner-tags-all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learner_tags')
        .select('tag, user_id');
      if (error) throw error;
      return data;
    }
  });

  const getTagsForUser = (userId: string) => {
    return tags?.filter(t => t.user_id === userId).map(t => t.tag) || [];
  };

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="space-y-4">
      <div className="flex gap-4 items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Suche nach Name oder E-Mail..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        <Button variant="outline">
          <Filter className="h-4 w-4 mr-2" /> Filter
        </Button>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Lerner</TableHead>
            <TableHead>Tags</TableHead>
            <TableHead>Kurse</TableHead>
            <TableHead>Lektionen</TableHead>
            <TableHead>Registriert</TableHead>
            <TableHead className="text-right">Aktionen</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {learners?.map((learner) => {
            const userTags = getTagsForUser(learner.user_id);
            return (
              <TableRow key={learner.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <UserCircle className="h-5 w-5 text-primary" />
                    </div>
                    <div>
                      <div className="font-medium">{learner.full_name || 'Unbekannt'}</div>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {userTags.slice(0, 3).map((tag) => (
                      <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
                    ))}
                    {userTags.length > 3 && (
                      <Badge variant="secondary" className="text-xs">+{userTags.length - 3}</Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {(learner.course_enrollments as unknown as { count: number }[])?.[0]?.count || 0}
                </TableCell>
                <TableCell>
                  {(learner.lesson_outcomes as unknown as { count: number }[])?.[0]?.count || 0}
                </TableCell>
                <TableCell>
                  {format(new Date(learner.created_at), 'dd.MM.yyyy', { locale: de })}
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="icon"><Eye className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon"><MessageSquare className="h-4 w-4" /></Button>
                </TableCell>
              </TableRow>
            );
          })}
          {learners?.length === 0 && (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                Keine Lerner gefunden
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}

// Segments Tab
function SegmentsTab() {
  const { data: segments, isLoading } = useQuery({
    queryKey: ['learner-segments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('learner_segments')
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
        <p className="text-muted-foreground">Automatische Segmentierung nach Verhalten und Eigenschaften</p>
        <Button><Plus className="h-4 w-4 mr-2" /> Neues Segment</Button>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {segments?.map((segment) => (
          <Card key={segment.id} className="glass-card">
            <CardHeader>
              <div className="flex items-center gap-2">
                <div 
                  className="h-3 w-3 rounded-full" 
                  style={{ backgroundColor: segment.color || '#6366f1' }}
                />
                <CardTitle className="text-lg">{segment.name}</CardTitle>
              </div>
              <CardDescription>{segment.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <Badge variant={segment.is_dynamic ? 'default' : 'outline'}>
                  {segment.is_dynamic ? 'Dynamisch' : 'Statisch'}
                </Badge>
                <Button variant="ghost" size="sm">Bearbeiten</Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {segments?.length === 0 && (
          <Card className="glass-card col-span-full py-8">
            <CardContent className="text-center text-muted-foreground">
              Noch keine Segmente erstellt
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}

// Support Tickets Tab
function SupportTab() {
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: tickets, isLoading } = useQuery({
    queryKey: ['support-tickets'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  const updateTicketStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('support_tickets')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      toast.success('Status aktualisiert');
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const openTickets = tickets?.filter(t => t.status === 'open').length || 0;
  const inProgressTickets = tickets?.filter(t => t.status === 'in_progress').length || 0;

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'urgent': return 'destructive';
      case 'high': return 'destructive';
      case 'medium': return 'secondary';
      default: return 'outline';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'open': return <AlertCircle className="h-4 w-4 text-orange-500" />;
      case 'in_progress': return <Clock className="h-4 w-4 text-blue-500" />;
      case 'resolved': return <CheckCircle className="h-4 w-4 text-green-500" />;
      default: return <ArrowRight className="h-4 w-4" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card border-orange-500/30 bg-orange-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Offen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-orange-500">{openTickets}</div>
          </CardContent>
        </Card>
        <Card className="glass-card border-blue-500/30 bg-blue-500/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">In Bearbeitung</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-blue-500">{inProgressTickets}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gelöst (heute)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {tickets?.filter(t => 
                t.status === 'resolved' && 
                new Date(t.resolved_at || '').toDateString() === new Date().toDateString()
              ).length || 0}
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gesamt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{tickets?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Tickets Table */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Support-Tickets</CardTitle>
          <CardDescription>Verwalte Kundenanfragen und Support</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Status</TableHead>
                <TableHead>Betreff</TableHead>
                <TableHead>Kategorie</TableHead>
                <TableHead>Priorität</TableHead>
                <TableHead>Erstellt</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tickets?.map((ticket) => (
                <TableRow key={ticket.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getStatusIcon(ticket.status)}
                      <span className="capitalize">{ticket.status.replace('_', ' ')}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-medium max-w-xs truncate">
                    {ticket.subject}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{ticket.category}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={getPriorityColor(ticket.priority) as "default" | "secondary" | "destructive" | "outline"} className="capitalize">
                      {ticket.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {format(new Date(ticket.created_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Select
                      value={ticket.status}
                      onValueChange={(value) => updateTicketStatus.mutate({ id: ticket.id, status: value })}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="open">Offen</SelectItem>
                        <SelectItem value="in_progress">In Bearbeitung</SelectItem>
                        <SelectItem value="waiting">Wartend</SelectItem>
                        <SelectItem value="resolved">Gelöst</SelectItem>
                        <SelectItem value="closed">Geschlossen</SelectItem>
                      </SelectContent>
                    </Select>
                  </TableCell>
                </TableRow>
              ))}
              {tickets?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Keine Tickets vorhanden
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

export default function CRMPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">CRM & Lerner-Management</h1>
        <p className="text-muted-foreground">Verwalte Lerner, Segmente und Support-Tickets</p>
      </div>

      <Tabs defaultValue="learners" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="learners" className="gap-2">
            <Users className="h-4 w-4" /> Lerner
          </TabsTrigger>
          <TabsTrigger value="segments" className="gap-2">
            <Tag className="h-4 w-4" /> Segmente
          </TabsTrigger>
          <TabsTrigger value="support" className="gap-2">
            <MessageSquare className="h-4 w-4" /> Support
          </TabsTrigger>
        </TabsList>

        <TabsContent value="learners">
          <LearnersTab />
        </TabsContent>
        <TabsContent value="segments">
          <SegmentsTab />
        </TabsContent>
        <TabsContent value="support">
          <SupportTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

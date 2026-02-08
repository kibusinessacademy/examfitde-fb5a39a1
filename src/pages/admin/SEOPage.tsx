import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Progress } from '@/components/ui/progress';
import { 
  Search, 
  Link,
  FileText,
  TrendingUp,
  ExternalLink,
  Plus,
  Edit,
  CheckCircle,
  AlertTriangle,
  XCircle,
  Globe,
  Target,
  BarChart3
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

// SEO Settings Tab
function SEOSettingsTab() {
  const { data: seoSettings, isLoading } = useQuery({
    queryKey: ['seo-settings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('seo_settings')
        .select('*')
        .order('page_type');
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const pageTypes = ['homepage', 'course', 'lesson', 'blog', 'landing'];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">Meta-Tags und Structured Data für alle Seitentypen</p>
        <Button><Plus className="h-4 w-4 mr-2" /> Neue Einstellung</Button>
      </div>

      <div className="grid gap-4">
        {pageTypes.map((type) => {
          const settings = seoSettings?.filter(s => s.page_type === type) || [];
          const hasSettings = settings.length > 0;
          
          return (
            <Card key={type} className="glass-card">
              <CardHeader className="flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="capitalize flex items-center gap-2">
                    <Globe className="h-5 w-5" />
                    {type}
                  </CardTitle>
                  <CardDescription>
                    {hasSettings ? `${settings.length} Einstellungen` : 'Keine Einstellungen'}
                  </CardDescription>
                </div>
                <Badge variant={hasSettings ? 'default' : 'outline'}>
                  {hasSettings ? 'Konfiguriert' : 'Standard'}
                </Badge>
              </CardHeader>
              {hasSettings && (
                <CardContent>
                  <div className="space-y-2">
                    {settings.slice(0, 3).map((setting) => (
                      <div key={setting.id} className="flex items-center justify-between text-sm p-2 bg-muted/30 rounded">
                        <span className="truncate flex-1">{setting.meta_title || 'Kein Titel'}</span>
                        <Button variant="ghost" size="icon"><Edit className="h-4 w-4" /></Button>
                      </div>
                    ))}
                  </div>
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

// Backlinks Tab
function BacklinksTab() {
  const queryClient = useQueryClient();

  const { data: backlinks, isLoading } = useQuery({
    queryKey: ['backlinks'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('backlinks')
        .select('*')
        .order('discovered_at', { ascending: false });
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const activeLinks = backlinks?.filter(b => b.status === 'active').length || 0;
  const brokenLinks = backlinks?.filter(b => b.status === 'broken').length || 0;
  const avgDA = backlinks?.length 
    ? Math.round(backlinks.reduce((sum, b) => sum + (b.domain_authority || 0), 0) / backlinks.length)
    : 0;

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active': return <Badge variant="default" className="bg-green-500">Aktiv</Badge>;
      case 'broken': return <Badge variant="destructive">Broken</Badge>;
      case 'removed': return <Badge variant="secondary">Entfernt</Badge>;
      case 'pending': return <Badge variant="outline">Prüfung</Badge>;
      default: return <Badge variant="outline">{status}</Badge>;
    }
  };

  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Aktive Backlinks</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-500">{activeLinks}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Broken Links</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-500">{brokenLinks}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Ø Domain Authority</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{avgDA}</div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Gesamt</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{backlinks?.length || 0}</div>
          </CardContent>
        </Card>
      </div>

      {/* Backlinks Table */}
      <Card className="glass-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Backlink-Übersicht</CardTitle>
            <CardDescription>Eingehende Links von externen Websites</CardDescription>
          </div>
          <Button><Plus className="h-4 w-4 mr-2" /> Link hinzufügen</Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Quelle</TableHead>
                <TableHead>Ziel</TableHead>
                <TableHead>Anker-Text</TableHead>
                <TableHead>DA</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Entdeckt</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {backlinks?.map((link) => (
                <TableRow key={link.id}>
                  <TableCell className="max-w-xs">
                    <a 
                      href={link.source_url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 text-primary hover:underline truncate"
                    >
                      {new URL(link.source_url).hostname}
                      <ExternalLink className="h-3 w-3 flex-shrink-0" />
                    </a>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">{link.target_url}</TableCell>
                  <TableCell className="max-w-xs truncate">{link.anchor_text || '-'}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Progress value={link.domain_authority || 0} className="w-12 h-2" />
                      <span className="text-sm">{link.domain_authority || 0}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {link.link_type || 'dofollow'}
                    </Badge>
                  </TableCell>
                  <TableCell>{getStatusBadge(link.status)}</TableCell>
                  <TableCell>
                    {format(new Date(link.discovered_at), 'dd.MM.yyyy', { locale: de })}
                  </TableCell>
                </TableRow>
              ))}
              {backlinks?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                    Noch keine Backlinks erfasst
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

// Content Optimization Tab
function ContentOptimizationTab() {
  const { data: optimizations, isLoading } = useQuery({
    queryKey: ['content-optimizations'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('content_optimization')
        .select('*')
        .order('analyzed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return data;
    }
  });

  if (isLoading) return <Skeleton className="h-64 w-full" />;

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-yellow-500';
    return 'text-red-500';
  };

  const getScoreIcon = (score: number) => {
    if (score >= 80) return <CheckCircle className="h-4 w-4 text-green-500" />;
    if (score >= 60) return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
    return <XCircle className="h-4 w-4 text-red-500" />;
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <p className="text-muted-foreground">
          Analyse und Optimierungsvorschläge für Inhalte
        </p>
        <Button><BarChart3 className="h-4 w-4 mr-2" /> Neue Analyse</Button>
      </div>

      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Content-Analysen</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Content</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Lesbarkeit</TableHead>
                <TableHead>SEO Score</TableHead>
                <TableHead>Analysiert</TableHead>
                <TableHead className="text-right">Aktionen</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {optimizations?.map((opt) => (
                <TableRow key={opt.id}>
                  <TableCell className="font-mono text-sm">{opt.content_id.slice(0, 8)}...</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="capitalize">{opt.content_type}</Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getScoreIcon(opt.readability_score || 0)}
                      <span className={getScoreColor(opt.readability_score || 0)}>
                        {opt.readability_score || 0}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {getScoreIcon(opt.seo_score || 0)}
                      <span className={getScoreColor(opt.seo_score || 0)}>
                        {opt.seo_score || 0}%
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {format(new Date(opt.analyzed_at), 'dd.MM.yyyy HH:mm', { locale: de })}
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm">Details</Button>
                  </TableCell>
                </TableRow>
              ))}
              {optimizations?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    Noch keine Analysen durchgeführt
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

export default function SEOPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-bold">SEO & Content</h1>
        <p className="text-muted-foreground">Meta-Tags, Backlinks und Content-Optimierung</p>
      </div>

      <Tabs defaultValue="settings" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="settings" className="gap-2">
            <FileText className="h-4 w-4" /> SEO-Einstellungen
          </TabsTrigger>
          <TabsTrigger value="backlinks" className="gap-2">
            <Link className="h-4 w-4" /> Backlinks
          </TabsTrigger>
          <TabsTrigger value="optimization" className="gap-2">
            <Target className="h-4 w-4" /> Optimierung
          </TabsTrigger>
        </TabsList>

        <TabsContent value="settings">
          <SEOSettingsTab />
        </TabsContent>
        <TabsContent value="backlinks">
          <BacklinksTab />
        </TabsContent>
        <TabsContent value="optimization">
          <ContentOptimizationTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}

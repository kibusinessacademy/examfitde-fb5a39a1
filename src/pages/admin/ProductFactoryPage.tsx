import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { 
  Factory, 
  BookOpen, 
  ClipboardCheck, 
  Package, 
  Sparkles, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  ArrowRight,
  Clock,
  Eye,
  RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { Link } from 'react-router-dom';

interface CurriculumProduct {
  id: string;
  curriculum_id: string;
  product_id: string;
  course_id: string | null;
  blueprint_id: string | null;
  generation_status: string;
  generation_error: string | null;
  is_published: boolean;
  slug: string | null;
  created_at: string;
  curriculum_title: string;
  product_name: string;
  product_key: string;
  course_title: string | null;
  blueprint_title: string | null;
  quality_status: Record<string, string> | null;
}

interface Curriculum {
  id: string;
  title: string;
  status: string;
}

interface StoreProduct {
  id: string;
  product_key: string;
  name: string;
  includes_learning_course: boolean;
  includes_exam_trainer: boolean;
}

const STATUS_CONFIG = {
  pending: { label: 'Ausstehend', color: 'bg-muted text-muted-foreground', icon: Clock },
  generating: { label: 'Generiert...', color: 'bg-yellow-500/20 text-yellow-600', icon: Loader2 },
  ready: { label: 'Bereit', color: 'bg-green-500/20 text-green-600', icon: CheckCircle },
  error: { label: 'Fehler', color: 'bg-destructive/20 text-destructive', icon: AlertCircle },
};

export default function ProductFactoryPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string>('');
  const [generationProgress, setGenerationProgress] = useState<Record<string, number>>({});

  // Fetch frozen curricula
  const { data: curricula } = useQuery({
    queryKey: ['curricula-frozen-factory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title, status')
        .eq('status', 'frozen')
        .order('title');
      
      if (error) throw error;
      return data as Curriculum[];
    },
  });

  // Fetch store products
  const { data: storeProducts } = useQuery({
    queryKey: ['store-products-factory'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('store_products')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      
      if (error) throw error;
      return data as StoreProduct[];
    },
  });

  // Fetch curriculum products overview
  const { data: curriculumProducts, isLoading, refetch } = useQuery({
    queryKey: ['curriculum-products-overview'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curriculum_products_overview')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      return data as CurriculumProduct[];
    },
  });

  // Check existing products for a curriculum
  const existingForCurriculum = (curriculumId: string) => {
    return curriculumProducts?.filter(cp => cp.curriculum_id === curriculumId) || [];
  };

  // Create all 3 products for a curriculum
  const createProductsMutation = useMutation({
    mutationFn: async (curriculumId: string) => {
      if (!storeProducts) throw new Error('Store products not loaded');
      
      const results = [];
      for (const product of storeProducts) {
        // Check if already exists
        const existing = curriculumProducts?.find(
          cp => cp.curriculum_id === curriculumId && cp.product_id === product.id
        );
        
        if (!existing) {
          const { data, error } = await supabase
            .from('curriculum_products')
            .insert({
              curriculum_id: curriculumId,
              product_id: product.id,
              created_by: user?.id,
            })
            .select()
            .single();
          
          if (error) throw error;
          results.push(data);
        }
      }
      
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curriculum-products-overview'] });
      toast.success('Produkte angelegt', { description: 'Alle 3 Produkte wurden für das Curriculum erstellt.' });
    },
    onError: (error) => {
      toast.error('Fehler', { description: String(error) });
    },
  });

  // Generate content for a curriculum product
  const generateContentMutation = useMutation({
    mutationFn: async ({ cpId, productKey }: { cpId: string; productKey: string }) => {
      // Update status to generating
      await supabase
        .from('curriculum_products')
        .update({ generation_status: 'generating' })
        .eq('id', cpId);

      // Get curriculum product details
      const { data: cp, error: cpError } = await supabase
        .from('curriculum_products')
        .select('*, curricula(*), store_products(*)')
        .eq('id', cpId)
        .single();
      
      if (cpError) throw cpError;

      // Simulate progress updates
      for (let i = 10; i <= 90; i += 20) {
        setGenerationProgress(prev => ({ ...prev, [cpId]: i }));
        await new Promise(r => setTimeout(r, 500));
      }

      // For learning_course: Create course, modules, lessons
      if (productKey === 'learning_course' || productKey === 'bundle') {
        // Check if course already exists
        if (!cp.course_id) {
          const { data: course, error: courseError } = await supabase
            .from('courses')
            .insert({
              curriculum_id: cp.curriculum_id,
              title: `Lernkurs: ${cp.curricula.title}`,
              status: 'draft',
              created_by: user?.id,
            })
            .select()
            .single();
          
          if (courseError) throw courseError;

          // Update curriculum_products with course_id
          await supabase
            .from('curriculum_products')
            .update({ course_id: course.id })
            .eq('id', cpId);
        }
      }

      // For exam_trainer: Create blueprint
      if (productKey === 'exam_trainer' || productKey === 'bundle') {
        if (!cp.blueprint_id) {
          const { data: blueprint, error: bpError } = await supabase
            .from('exam_blueprints')
            .insert({
              curriculum_id: cp.curriculum_id,
              title: `Prüfungsblueprint: ${cp.curricula.title}`,
              total_questions: 40,
              time_limit_minutes: 90,
              pass_threshold: 0.5,
              difficulty_distribution: { easy: 0.3, medium: 0.5, hard: 0.2 },
            })
            .select()
            .single();
          
          if (bpError) throw bpError;

          await supabase
            .from('curriculum_products')
            .update({ blueprint_id: blueprint.id })
            .eq('id', cpId);
        }
      }

      setGenerationProgress(prev => ({ ...prev, [cpId]: 100 }));

      // Mark as ready
      await supabase
        .from('curriculum_products')
        .update({ 
          generation_status: 'ready',
          generated_at: new Date().toISOString(),
        })
        .eq('id', cpId);

      return cp;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curriculum-products-overview'] });
      toast.success('Inhalt generiert');
    },
    onError: async (error, variables) => {
      await supabase
        .from('curriculum_products')
        .update({ 
          generation_status: 'error',
          generation_error: String(error),
        })
        .eq('id', variables.cpId);
      
      queryClient.invalidateQueries({ queryKey: ['curriculum-products-overview'] });
      toast.error('Generierung fehlgeschlagen', { description: String(error) });
    },
  });

  // Publish a curriculum product
  const publishMutation = useMutation({
    mutationFn: async (cpId: string) => {
      const { error } = await supabase
        .from('curriculum_products')
        .update({ 
          is_published: true,
          published_at: new Date().toISOString(),
        })
        .eq('id', cpId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['curriculum-products-overview'] });
      toast.success('Produkt veröffentlicht');
    },
    onError: (error) => {
      toast.error('Fehler', { description: String(error) });
    },
  });

  const selectedCurriculum = curricula?.find(c => c.id === selectedCurriculumId);
  const existingProducts = selectedCurriculumId ? existingForCurriculum(selectedCurriculumId) : [];
  const allProductsExist = existingProducts.length >= (storeProducts?.length || 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold flex items-center gap-2">
            <Factory className="h-6 w-6 text-accent" />
            Produkt-Factory
          </h1>
          <p className="text-muted-foreground">
            Erstelle automatisch alle 3 Produkte aus einem gefrorenen Curriculum
          </p>
        </div>
        <Button variant="outline" onClick={() => refetch()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Aktualisieren
        </Button>
      </div>

      {/* Workflow Steps */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle className="text-lg">Workflow: Curriculum → 3 Produkte</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-primary/10 text-primary">
              <span className="font-mono text-sm">1</span>
              <span>Curriculum wählen</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
              <span className="font-mono text-sm">2</span>
              <span>Produkte anlegen</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
              <span className="font-mono text-sm">3</span>
              <span>Inhalte generieren</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
              <span className="font-mono text-sm">4</span>
              <span>Quality Gates</span>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-muted">
              <span className="font-mono text-sm">5</span>
              <span>Publish</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Create Section */}
      <Card className="glass-card border-accent/30">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            Schnell-Erstellung
          </CardTitle>
          <CardDescription>
            Wähle ein eingefrorenes Curriculum und erstelle alle Produkte mit einem Klick
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4 items-end">
            <div className="flex-1 space-y-2">
              <label className="text-sm font-medium">Curriculum auswählen</label>
              <Select value={selectedCurriculumId} onValueChange={setSelectedCurriculumId}>
                <SelectTrigger>
                  <SelectValue placeholder="Curriculum wählen..." />
                </SelectTrigger>
                <SelectContent>
                  {curricula?.map(c => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              onClick={() => createProductsMutation.mutate(selectedCurriculumId)}
              disabled={!selectedCurriculumId || createProductsMutation.isPending || allProductsExist}
              className="gradient-accent text-accent-foreground"
            >
              {createProductsMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Package className="h-4 w-4 mr-2" />
              )}
              {allProductsExist ? 'Bereits erstellt' : 'Alle 3 Produkte anlegen'}
            </Button>
          </div>

          {selectedCurriculum && existingProducts.length > 0 && (
            <div className="p-4 rounded-lg bg-muted/30 border border-border">
              <p className="text-sm font-medium mb-2">Existierende Produkte für {selectedCurriculum.title}:</p>
              <div className="flex gap-2 flex-wrap">
                {existingProducts.map(cp => (
                  <Badge key={cp.id} variant="secondary" className="gap-1">
                    {cp.product_name}
                    {cp.is_published && <CheckCircle className="h-3 w-3 text-green-500" />}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Products Overview */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle>Alle Curriculum-Produkte</CardTitle>
          <CardDescription>
            Übersicht aller erstellten Produkt-Verknüpfungen
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : !curriculumProducts?.length ? (
            <div className="text-center py-8 text-muted-foreground">
              <Package className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Noch keine Produkte erstellt.</p>
              <p className="text-sm">Wähle oben ein Curriculum und erstelle Produkte.</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Curriculum</TableHead>
                  <TableHead>Produkt</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Quality Gates</TableHead>
                  <TableHead>Veröffentlicht</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {curriculumProducts.map((cp) => {
                  const statusConfig = STATUS_CONFIG[cp.generation_status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
                  const StatusIcon = statusConfig.icon;
                  const progress = generationProgress[cp.id] || 0;
                  const isGenerating = cp.generation_status === 'generating' || generateContentMutation.isPending;

                  return (
                    <TableRow key={cp.id}>
                      <TableCell className="font-medium">{cp.curriculum_title}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {cp.product_key === 'learning_course' && <BookOpen className="h-4 w-4 text-blue-500" />}
                          {cp.product_key === 'exam_trainer' && <ClipboardCheck className="h-4 w-4 text-orange-500" />}
                          {cp.product_key === 'bundle' && <Package className="h-4 w-4 text-purple-500" />}
                          {cp.product_name}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <Badge className={`gap-1 ${statusConfig.color}`}>
                            <StatusIcon className={`h-3 w-3 ${isGenerating ? 'animate-spin' : ''}`} />
                            {statusConfig.label}
                          </Badge>
                          {isGenerating && progress > 0 && (
                            <Progress value={progress} className="h-1 w-24" />
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        {cp.quality_status ? (
                          <div className="flex gap-1">
                            {Object.entries(cp.quality_status).map(([type, status]) => (
                              <Badge 
                                key={type} 
                                variant="outline" 
                                className={`text-xs ${
                                  status === 'passed' ? 'border-green-500/50 text-green-600' :
                                  status === 'failed' ? 'border-red-500/50 text-red-600' :
                                  'border-muted'
                                }`}
                              >
                                {type.charAt(0).toUpperCase()}
                              </Badge>
                            ))}
                          </div>
                        ) : '-'}
                      </TableCell>
                      <TableCell>
                        {cp.is_published ? (
                          <Badge className="bg-green-500/20 text-green-600">
                            <CheckCircle className="h-3 w-3 mr-1" />
                            Live
                          </Badge>
                        ) : (
                          <Badge variant="outline">Entwurf</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1">
                          {cp.generation_status === 'pending' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => generateContentMutation.mutate({ 
                                cpId: cp.id, 
                                productKey: cp.product_key 
                              })}
                              disabled={generateContentMutation.isPending}
                            >
                              <Sparkles className="h-4 w-4 mr-1" />
                              Generieren
                            </Button>
                          )}
                          {cp.generation_status === 'ready' && !cp.is_published && (
                            <Button
                              size="sm"
                              onClick={() => publishMutation.mutate(cp.id)}
                              disabled={publishMutation.isPending}
                            >
                              Publish
                            </Button>
                          )}
                          <Link to="/admin-v2/quality-gates">
                            <Button size="sm" variant="ghost">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
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

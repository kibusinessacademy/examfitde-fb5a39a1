import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  HelpCircle, AlertTriangle, HeartCrack, Lightbulb, CreditCard,
  BookOpen, ArrowRight, CheckCircle, Loader2
} from 'lucide-react';
import { toast } from 'sonner';

const TICKET_TYPES = [
  { id: 'verstaendnisfrage', label: 'Verständnisfrage', icon: HelpCircle, description: 'Ich verstehe etwas nicht', color: 'text-blue-500' },
  { id: 'technisch', label: 'Technisches Problem', icon: AlertTriangle, description: 'Etwas funktioniert nicht', color: 'text-orange-500' },
  { id: 'pruefungsangst', label: 'Prüfungsangst / Unsicherheit', icon: HeartCrack, description: 'Ich bin unsicher oder gestresst', color: 'text-pink-500' },
  { id: 'lernstrategie', label: 'Lernstrategie', icon: Lightbulb, description: 'Wie lerne ich am besten?', color: 'text-yellow-500' },
  { id: 'abrechnung', label: 'Abrechnung / Zugang', icon: CreditCard, description: 'Bezahlung, Zugang, Abo', color: 'text-green-500' },
] as const;

interface SmartTicketCreateProps {
  onCreated?: () => void;
  contextCourseId?: string;
  contextLessonId?: string;
}

export default function SmartTicketCreate({ onCreated, contextCourseId, contextLessonId }: SmartTicketCreateProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedType, setSelectedType] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);

  // Auto-detect context: current enrollments
  const { data: context } = useQuery({
    queryKey: ['support-context', user?.id],
    queryFn: async () => {
      if (!user?.id) return null;
      const { data: enrollments } = await supabase
        .from('course_enrollments')
        .select('course_id, courses(title)')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5);
      
      const { data: recentOutcomes } = await supabase
        .from('lesson_outcomes')
        .select('lesson_id, passed, lessons(title, competency_id)')
        .eq('user_id', user.id)
        .order('completed_at', { ascending: false })
        .limit(3);

      return { enrollments, recentOutcomes };
    },
    enabled: !!user?.id,
  });

  // Fetch relevant FAQ suggestions when type is selected
  const { data: suggestions, isLoading: suggestionsLoading } = useQuery({
    queryKey: ['support-suggestions', selectedType, contextCourseId],
    queryFn: async () => {
      const { data } = await supabase
        .from('support_faq')
        .select('*')
        .eq('is_published', true)
        .eq('ticket_type', selectedType!)
        .order('usage_count', { ascending: false })
        .limit(3);
      return data;
    },
    enabled: !!selectedType && showSuggestions,
  });

  const createTicket = useMutation({
    mutationFn: async () => {
      if (!user?.id || !selectedType) throw new Error('Missing data');
      
      const ticketData: Record<string, unknown> = {
        user_id: user.id,
        subject: `${TICKET_TYPES.find(t => t.id === selectedType)?.label}: ${description.slice(0, 80)}`,
        description,
        category: selectedType,
        ticket_type: selectedType,
        priority: selectedType === 'technisch' ? 'high' : 'medium',
        status: 'open',
        context_course_id: contextCourseId || null,
        context_lesson_id: contextLessonId || null,
        context_url: window.location.pathname,
      };

      // Detect sentiment from description
      const frustWords = ['frustri', 'nerv', 'geht nicht', 'funktioniert nicht', 'kaputt', 'schlecht'];
      const anxWords = ['angst', 'unsicher', 'sorge', 'panik', 'stress', 'überfordert'];
      const lower = description.toLowerCase();
      
      if (anxWords.some(w => lower.includes(w))) {
        ticketData.sentiment = 'anxious';
      } else if (frustWords.some(w => lower.includes(w))) {
        ticketData.sentiment = 'frustrated';
      }

      const { error } = await supabase.from('support_tickets').insert(ticketData as never);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success('Deine Anfrage wurde eingereicht. Wir melden uns!');
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] });
      setSelectedType(null);
      setDescription('');
      onCreated?.();
    },
    onError: () => toast.error('Fehler beim Erstellen des Tickets'),
  });

  return (
    <div className="space-y-6">
      {/* Context hint */}
      {context?.enrollments && context.enrollments.length > 0 && (
        <Card className="glass-card border-primary/20 bg-primary/5">
          <CardContent className="py-3 px-4 flex items-center gap-3">
            <BookOpen className="h-4 w-4 text-primary flex-shrink-0" />
            <span className="text-sm text-muted-foreground">
              Aktueller Kurs: <strong className="text-foreground">{(context.enrollments[0] as any).courses?.title}</strong>
            </span>
          </CardContent>
        </Card>
      )}

      {/* Step 1: Choose ticket type */}
      <div>
        <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
          Worum geht es?
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TICKET_TYPES.map((type) => {
            const Icon = type.icon;
            const isSelected = selectedType === type.id;
            return (
              <button
                key={type.id}
                onClick={() => {
                  setSelectedType(type.id);
                  setShowSuggestions(true);
                }}
                className={`glass-card p-4 rounded-xl text-left transition-all hover:scale-[1.02] ${
                  isSelected ? 'ring-2 ring-primary bg-primary/5' : 'hover:bg-muted/30'
                }`}
              >
                <div className="flex items-start gap-3">
                  <Icon className={`h-5 w-5 mt-0.5 ${type.color}`} />
                  <div>
                    <div className="font-medium text-sm">{type.label}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{type.description}</div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Step 2: Show auto-suggestions */}
      {selectedType && showSuggestions && (
        <div>
          <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">
            Hilft dir das weiter?
          </h3>
          {suggestionsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : suggestions && suggestions.length > 0 ? (
            <div className="space-y-2">
              {suggestions.map((faq) => (
                <Card key={faq.id} className="glass-card hover:bg-primary/5 transition-colors cursor-pointer">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-start gap-3">
                      <CheckCircle className="h-4 w-4 text-green-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <div className="font-medium text-sm">{faq.question}</div>
                        <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{faq.answer}</div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
              <p className="text-xs text-muted-foreground mt-2">
                Problem gelöst? Wenn nicht, beschreibe dein Anliegen unten.
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Noch keine passenden Hilfen – beschreibe dein Anliegen:
            </p>
          )}
        </div>
      )}

      {/* Step 3: Description + Submit */}
      {selectedType && (
        <div className="space-y-4">
          <Textarea
            placeholder="Beschreibe dein Anliegen so genau wie möglich..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            className="resize-none"
          />
          
          {/* Emotional detection hint */}
          {description.length > 20 && (
            (() => {
              const lower = description.toLowerCase();
              const isAnxious = ['angst', 'unsicher', 'panik', 'überfordert', 'stress'].some(w => lower.includes(w));
              if (isAnxious) {
                return (
                  <Card className="border-pink-500/20 bg-pink-500/5">
                    <CardContent className="py-3 px-4 flex items-center gap-3">
                      <HeartCrack className="h-4 w-4 text-pink-500 flex-shrink-0" />
                      <span className="text-sm">
                        Du bist nicht allein. Prüfungsangst ist völlig normal – wir helfen dir.
                      </span>
                    </CardContent>
                  </Card>
                );
              }
              return null;
            })()
          )}

          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => { setSelectedType(null); setDescription(''); }}>
              Abbrechen
            </Button>
            <Button 
              onClick={() => createTicket.mutate()} 
              disabled={!description.trim() || createTicket.isPending}
            >
              {createTicket.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <ArrowRight className="h-4 w-4 mr-2" />
              )}
              Anfrage senden
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

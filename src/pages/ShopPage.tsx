import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { ProductCards } from '@/components/shop/ProductCards';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Shield, Clock, CreditCard, CheckCircle, Star } from 'lucide-react';
import PageExplainer from '@/components/admin/PageExplainer';
import { SEOHead } from '@/components/seo/SEOHead';
import { SITE_URL } from '@/lib/seo';

export default function ShopPage() {
  const { user } = useAuth();
  const [selectedCurriculumId, setSelectedCurriculumId] = useState<string | null>(null);

  const { data: curricula, isLoading: curriculaLoading } = useQuery({
    queryKey: ['frozen-curricula'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('curricula')
        .select('id, title')
        .eq('status', 'frozen')
        .order('title');
      if (error) throw error;
      return data;
    },
  });

  if (curricula?.length && !selectedCurriculumId) {
    setSelectedCurriculumId(curricula[0].id);
  }

  return (
    <>
      <SEOHead
        title="Prüfungstraining kaufen – 39 € einmalig | ExamFit"
        description="Kaufe dein IHK-Prüfungstraining: Einmalzahlung, 12 Monate Zugang, kein Abo. Für über 50 Ausbildungsberufe."
        canonical={`${SITE_URL}/shop`}
      />

      <div className="container py-6 sm:py-8 md:py-12 px-3 sm:px-4">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full glass-subtle mb-6">
            <Star className="h-4 w-4 text-warning fill-warning" />
            <span className="text-sm text-muted-foreground">98% Bestehensquote</span>
          </div>
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-display font-bold mb-3 md:mb-4">
            Dein intelligentes <span className="text-gradient">Prüfungstraining</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Ein Produkt. Ein Ziel: Deine Prüfung bestehen. 
            Einmalzahlung, 12 Monate Zugang, alles inklusive.
          </p>
        </div>

        <PageExplainer
          title="Wie funktioniert der Shop?"
          description="Wähle deinen Ausbildungsberuf und kaufe das Prüfungstraining als Einmalzahlung. Du erhältst sofort 12 Monate Zugang zu allen Modulen: Lernkurs, Prüfungstrainer, mündliche Prüfung, KI-Tutor und Handbuch."
          actions={[
            'Beruf auswählen → Passende Produktpakete werden angezeigt',
            '"Jetzt kaufen" → Sichere Zahlung über Stripe, sofortiger Zugang',
            'Ab 5 Lizenzen gibt es automatisch Mengenrabatt',
          ]}
          tips={[
            'Einmalzahlung – kein Abo, keine versteckten Kosten',
            'Alle Module sind im Bundle enthalten',
            'Nach dem Kauf wirst du automatisch eingeloggt und kannst sofort lernen',
          ]}
        />

        {/* Trust Badges */}
        <div className="flex flex-wrap justify-center gap-3 sm:gap-6 mb-8 md:mb-12">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Shield className="w-4 h-4 text-primary" />
            <span>Sichere Zahlung via Stripe</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Clock className="w-4 h-4 text-primary" />
            <span>Sofortiger Zugang nach Kauf</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CreditCard className="w-4 h-4 text-primary" />
            <span>Einmalzahlung, kein Abo</span>
          </div>
        </div>

        {/* Curriculum Selector */}
        {curricula && curricula.length > 1 && (
          <div className="max-w-md mx-auto mb-12">
            <label className="block text-sm font-medium mb-2">
              Wähle deinen Ausbildungsberuf
            </label>
            <Select
              value={selectedCurriculumId || ''}
              onValueChange={setSelectedCurriculumId}
            >
              <SelectTrigger>
                <SelectValue placeholder="Beruf auswählen..." />
              </SelectTrigger>
              <SelectContent>
                {curricula.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Products */}
        {selectedCurriculumId ? (
          <ProductCards curriculumId={selectedCurriculumId} />
        ) : curriculaLoading ? (
          <div className="text-center py-12 text-muted-foreground">
            Lade Produkte...
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            Keine Curricula verfügbar.
          </div>
        )}

        {/* Guarantee */}
        <div className="mt-10 sm:mt-16 glass-card rounded-2xl p-4 sm:p-8 max-w-3xl mx-auto text-center">
          <CheckCircle className="h-12 w-12 text-success mx-auto mb-4" />
          <h2 className="text-2xl font-display font-bold mb-4">
            Deine Vorteile auf einen Blick
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 text-left">
            <div>
              <h3 className="font-semibold mb-2">Basierend auf Rahmenlehrplänen</h3>
              <p className="text-sm text-muted-foreground">
                Alle Inhalte orientieren sich an offiziellen Prüfungsordnungen.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Adaptive Lernalgorithmen</h3>
              <p className="text-sm text-muted-foreground">
                Das System erkennt deine Schwächen und trainiert gezielt.
              </p>
            </div>
            <div>
              <h3 className="font-semibold mb-2">Mündliche Prüfung</h3>
              <p className="text-sm text-muted-foreground">
                Simuliere das Prüfungsgespräch mit KI-Feedback.
              </p>
            </div>
          </div>
        </div>

        {/* B2B Info */}
        <div className="mt-16 text-center">
          <Badge variant="outline" className="mb-4">Für Unternehmen & Schulen</Badge>
          <h2 className="text-2xl font-bold mb-2">Mehrere Azubis ausbilden?</h2>
          <p className="text-muted-foreground max-w-xl mx-auto">
            Wähle einfach die gewünschte Menge im Checkout. 
            Ab 5 Lizenzen erhältst du automatisch Mengenrabatt. 
            Keine Anfrage nötig – einfach kaufen!
          </p>
        </div>
      </div>
    </>
  );
}

import { Shield, CheckCircle, Clock, CreditCard, Users, Award } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { PRICING } from '@/config/pricing';

interface Props {
  chamberType: string;
  cleanTitle: string;
}

export function ProductTrustSection({ chamberType, cleanTitle }: Props) {
  return (
    <section className="py-12 md:py-16">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-10">
          <p className="text-primary font-semibold text-sm uppercase tracking-wider mb-2">Vertrauen & Sicherheit</p>
          <h2 className="text-2xl md:text-3xl font-display font-bold">
            Deshalb vertrauen Prüflinge ExamFit
          </h2>
        </div>

        <div className="grid sm:grid-cols-2 gap-4 max-w-2xl mx-auto">
          <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
            <CheckCircle className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Basierend auf {chamberType}-Ausbildungsrahmenplan</p>
              <p className="text-xs text-muted-foreground mt-0.5">Offiziell geprüfte Inhalte</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
            <Award className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Entwickelt für {cleanTitle}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Berufsspezifisches Training</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
            <CreditCard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">Kein Abo – einmal zahlen</p>
              <p className="text-xs text-muted-foreground mt-0.5">Keine versteckten Kosten</p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 rounded-xl bg-card border border-border">
            <Clock className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">{PRICING.defaultAccess} Zugriff</p>
              <p className="text-xs text-muted-foreground mt-0.5">Bis nach der Prüfung und darüber hinaus</p>
            </div>
          </div>
        </div>

        {/* Social proof */}
        <div className="flex flex-wrap justify-center gap-8 mt-10">
          <div className="text-center">
            <p className="text-3xl font-display font-bold text-primary">98%</p>
            <p className="text-xs text-muted-foreground">Bestehensquote</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-display font-bold text-primary">5.000+</p>
            <p className="text-xs text-muted-foreground">Absolventen</p>
          </div>
          <div className="text-center">
            <p className="text-3xl font-display font-bold text-primary">4,8★</p>
            <p className="text-xs text-muted-foreground">Bewertung</p>
          </div>
        </div>
      </div>
    </section>
  );
}

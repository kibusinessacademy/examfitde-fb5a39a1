import { Info } from 'lucide-react';

/**
 * Rechtssicherer Disclaimer-Hinweis für IHK/HWK-Bezüge.
 * Zu verwenden in Footer, Impressum, Produktseiten.
 */
export function LegalDisclaimer({ className = '' }: { className?: string }) {
  return (
    <div className={`text-xs text-muted-foreground ${className}`}>
      <p className="flex items-start gap-2">
        <Info className="h-3 w-3 mt-0.5 shrink-0" />
        <span>
          ExamFit ist ein unabhängiger Anbieter von Lernmaterialien zur Prüfungsvorbereitung. 
          Es besteht keine Zusammenarbeit, Partnerschaft oder offizielle Verbindung mit der 
          Industrie- und Handelskammer (IHK) oder der Handwerkskammer (HWK). 
          Alle Inhalte basieren auf öffentlich zugänglichen Rahmenlehrplänen und Prüfungsordnungen.
        </span>
      </p>
    </div>
  );
}

/**
 * Kompakter Einzeiler für Footer
 */
export function LegalDisclaimerCompact({ className = '' }: { className?: string }) {
  return (
    <p className={`text-xs text-muted-foreground ${className}`}>
      ExamFit ist unabhängig und nicht mit IHK oder HWK verbunden.
    </p>
  );
}

/**
 * DO/DON'T Leitlinien für Content-Erstellung (intern/LLM)
 * 
 * ✅ ERLAUBT (beschreibende Nutzung):
 * - "Prüfungsvorbereitung für die IHK-Prüfung"
 * - "Prüfungstraining basierend auf IHK-Rahmenlehrplänen"
 * - "Prüfungstrainer für IHK-Abschlussprüfungen"
 * - "Vorbereitung auf die schriftliche IHK-Prüfung"
 * - "Mündliche Prüfung – typischer Ablauf bei der IHK"
 * - "Fragen orientiert an IHK-Prüfungsstandards"
 * - "Prüfungsrelevante Fragen nach IHK-Maßstäben"
 * 
 * ❌ VERBOTEN (irreführend/offizieller Anschein):
 * - "Offizieller IHK-Prüfungstrainer"
 * - "Von der IHK empfohlen"
 * - "IHK-zertifizierter Kurs"
 * - "In Kooperation mit der IHK"
 * - "IHK ExamFit" (Markenname-Kombination)
 * - "IHK-Partner"
 * - "Anerkannt von der IHK"
 * - "Mit IHK-Siegel"
 * 
 * ⚠️ VORSICHT (mit Kontext erlaubt):
 * - "IHK-konform" → besser: "orientiert an IHK-Standards"
 * - "Echte IHK-Fragen" → besser: "Fragen nach IHK-Prüfungsmaßstäben"
 * - "IHK-Qualität" → besser: "Prüfungsrelevante Qualität"
 */

export const IHK_TEXT_GUIDELINES = {
  allowed: [
    'Prüfungsvorbereitung für die IHK-Prüfung',
    'Prüfungstraining basierend auf IHK-Rahmenlehrplänen',
    'Prüfungstrainer für IHK-Abschlussprüfungen',
    'Vorbereitung auf die IHK-Abschlussprüfung',
    'Fragen orientiert an IHK-Prüfungsstandards',
    'Prüfungssimulation nach IHK-Maßstäben',
    'Inhalte basierend auf offiziellen Rahmenlehrplänen',
  ],
  forbidden: [
    'Offizieller IHK-Prüfungstrainer',
    'Von der IHK empfohlen',
    'IHK-zertifiziert',
    'In Kooperation mit der IHK',
    'IHK-Partner',
    'Anerkannt von der IHK',
    'Mit IHK-Siegel',
  ],
  replacements: {
    'IHK-konforme Inhalte': 'Inhalte basierend auf offiziellen Rahmenlehrplänen',
    'echte IHK-Fragen': 'Fragen nach IHK-Prüfungsmaßstäben',
    'echte IHK-Prüfungsfragen': 'prüfungsrelevante Fragen nach IHK-Standards',
    'IHK-Qualität': 'prüfungsrelevante Qualität',
    'IHK-konform': 'orientiert an IHK-Standards',
  },
} as const;

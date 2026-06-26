import { GraduationCap, BadgeCheck } from 'lucide-react';

interface Props {
  beruf: string;
  kammer: string;
  /** Echtes Produktbild (z. B. Geräte-Mockup), sobald für diesen Beruf erzeugt. */
  imageUrl?: string | null;
  imageAlt?: string | null;
  className?: string;
}

/**
 * Markenkonsistenter Produkt-Visual-Slot für alle Berufsseiten.
 * Rendert ein echtes Bild, sobald `imageUrl` gesetzt ist (Rollout läuft Beruf für
 * Beruf), bis dahin eine generative Icon-Box, damit nie ein leerer Hero entsteht.
 */
export function BerufProductVisual({ beruf, kammer, imageUrl, imageAlt, className }: Props) {
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={imageAlt || `ExamFit Prüfungstraining ${beruf}`}
        className={`w-full rounded-2xl object-cover shadow-elev-3 ${className ?? ''}`}
        loading="eager"
        width={640}
        height={480}
      />
    );
  }

  return (
    <div
      className={`relative w-full aspect-[4/3] rounded-2xl overflow-hidden shadow-elev-3 flex flex-col items-center justify-center gap-4 text-center px-6 ${className ?? ''}`}
      style={{
        background:
          'linear-gradient(135deg, hsl(168 64% 32%) 0%, hsl(181 61% 24%) 100%)',
      }}
      role="img"
      aria-label={`ExamFit Prüfungstraining ${beruf}`}
    >
      <div className="absolute top-4 right-4">
        <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-[11px] font-semibold text-white backdrop-blur">
          <BadgeCheck className="h-3.5 w-3.5" />
          {kammer}-Prüfung
        </span>
      </div>
      <GraduationCap className="h-16 w-16 text-white/90" />
      <p className="text-lg font-display font-bold text-white leading-snug">
        Prüfungstraining
        <br />
        {beruf}
      </p>
    </div>
  );
}

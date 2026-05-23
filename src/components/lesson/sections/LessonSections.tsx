import { useState } from 'react';
import DOMPurify from 'dompurify';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  BookOpenText,
  Lightbulb,
  Sparkles,
  AlertTriangle,
  ShieldAlert,
  HelpCircle,
  Eye,
} from 'lucide-react';
import {
  extractLessonSections,
  SECTION_ORDER,
  type SectionKey,
} from './extractSections';

interface LessonSectionsProps {
  content: unknown;
}

const ALLOWED_INLINE_TAGS = ['p', 'br', 'strong', 'em', 'u', 'ul', 'ol', 'li', 'code', 'a', 'span'];
const ALLOWED_HTML_TAGS = [
  'h1','h2','h3','h4','h5','h6','p','br','strong','em','u','ul','ol','li','blockquote',
  'code','pre','a','img','table','thead','tbody','tr','th','td','span','div','sub','sup','hr',
];

function sanitizeInline(text: string): string {
  return DOMPurify.sanitize(text, {
    ALLOWED_TAGS: ALLOWED_INLINE_TAGS,
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
    ALLOW_DATA_ATTR: false,
  });
}

function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_HTML_TAGS,
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'id', 'target', 'rel'],
    ALLOW_DATA_ATTR: false,
  });
}

interface SectionMeta {
  label: string;
  description: string;
  icon: React.ElementType;
  /** Tailwind classes for the icon chip. Uses semantic tokens only. */
  chipClass: string;
  /** Border accent for the card. */
  borderClass: string;
}

const SECTION_META: Record<SectionKey, SectionMeta> = {
  shortExplanation: {
    label: 'Kurz erklärt',
    description: 'Worum es geht — in einem Absatz.',
    icon: BookOpenText,
    chipClass: 'bg-primary/10 text-primary',
    borderClass: 'border-l-4 border-l-primary/60',
  },
  keyTakeaway: {
    label: 'Merksatz',
    description: 'Das musst du dir merken.',
    icon: Lightbulb,
    chipClass: 'bg-warning-bg-subtle text-warning',
    borderClass: 'border-l-4 border-l-warning/60',
  },
  example: {
    label: 'Beispiel',
    description: 'So sieht es in der Praxis aus.',
    icon: Sparkles,
    chipClass: 'bg-success-bg-subtle text-success',
    borderClass: 'border-l-4 border-l-success/60',
  },
  counterExample: {
    label: 'Gegenbeispiel & Abgrenzung',
    description: 'So ist es gerade nicht gemeint.',
    icon: AlertTriangle,
    chipClass: 'bg-muted text-muted-foreground',
    borderClass: 'border-l-4 border-l-muted-foreground/40',
  },
  examPitfall: {
    label: 'Typische Prüfungsfalle',
    description: 'Hier verlieren die meisten Punkte.',
    icon: ShieldAlert,
    chipClass: 'bg-destructive-bg-subtle text-destructive',
    borderClass: 'border-l-4 border-l-destructive/60',
  },
  selfCheck: {
    label: 'Mini-Selbstcheck',
    description: 'Frag dich selbst — bevor du weiterliest.',
    icon: HelpCircle,
    chipClass: 'bg-accent/15 text-accent-foreground',
    borderClass: 'border-l-4 border-l-accent/60',
  },
};

function SectionCard({
  sectionKey,
  children,
  testId,
}: {
  sectionKey: SectionKey;
  children: React.ReactNode;
  testId: string;
}) {
  const meta = SECTION_META[sectionKey];
  const Icon = meta.icon;
  return (
    <Card
      className={`${meta.borderClass} bg-card`}
      data-testid={testId}
      data-section={sectionKey}
    >
      <CardContent className="p-4 md:p-6">
        <div className="flex items-start gap-3">
          <div
            className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center ${meta.chipClass}`}
            aria-hidden="true"
          >
            <Icon className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 mb-2">
              <h3 className="text-sm font-semibold tracking-tight text-foreground">
                {meta.label}
              </h3>
              <span className="text-xs text-muted-foreground">{meta.description}</span>
            </div>
            <div className="text-sm md:text-base text-foreground/90 leading-relaxed">
              {children}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function InlineHtml({ html }: { html: string }) {
  return (
    <div
      className="prose prose-invert max-w-none prose-p:my-1.5 prose-li:my-0.5 prose-strong:text-foreground"
      dangerouslySetInnerHTML={{ __html: sanitizeInline(html) }}
    />
  );
}

function SelfCheckCard({ question, answer, testId }: { question: string; answer?: string; testId: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <SectionCard sectionKey="selfCheck" testId={testId}>
      <p className="font-medium text-foreground">{question}</p>
      {answer ? (
        <div className="mt-3">
          {revealed ? (
            <div
              className="rounded-md bg-muted/40 p-3 text-sm"
              data-testid="lesson-self-check-answer"
            >
              <InlineHtml html={answer} />
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setRevealed(true)}
              data-testid="lesson-self-check-reveal"
            >
              <Eye className="h-4 w-4" aria-hidden="true" />
              Antwort anzeigen
            </Button>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Beantworte die Frage in Gedanken — oder im AI-Tutor.
        </p>
      )}
    </SectionCard>
  );
}

/**
 * Learning Content Sectioning v1.
 *
 * Renders structured didactic sections from lesson.content. If no structured
 * sections are present, falls back to the legacy `content.html` block so
 * existing lessons stay fully functional.
 */
export default function LessonSections({ content }: LessonSectionsProps) {
  const sections = extractLessonSections(content);

  // Fallback: legacy lessons with html-only content keep working.
  if (!sections.hasStructuredSections) {
    if (sections.fallbackHtml) {
      return (
        <div
          className="prose prose-invert max-w-none"
          data-testid="lesson-sections-fallback-html"
          dangerouslySetInnerHTML={{ __html: sanitizeHtml(sections.fallbackHtml) }}
        />
      );
    }
    return null;
  }

  return (
    <div className="space-y-4 md:space-y-5" data-testid="lesson-sections">
      <div className="flex items-center gap-2">
        <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
          Lernkarte
        </Badge>
        <span className="text-xs text-muted-foreground">
          Strukturierte Erklärung — von Kurzfassung bis Prüfungsfalle.
        </span>
      </div>

      {SECTION_ORDER.map((key) => {
        switch (key) {
          case 'shortExplanation':
            return sections.shortExplanation ? (
              <SectionCard key={key} sectionKey={key} testId="lesson-section-shortExplanation">
                <InlineHtml html={sections.shortExplanation} />
              </SectionCard>
            ) : null;
          case 'keyTakeaway':
            return sections.keyTakeaway ? (
              <SectionCard key={key} sectionKey={key} testId="lesson-section-keyTakeaway">
                <p className="font-medium text-foreground">{sections.keyTakeaway}</p>
              </SectionCard>
            ) : null;
          case 'example':
            return sections.example ? (
              <SectionCard key={key} sectionKey={key} testId="lesson-section-example">
                <InlineHtml html={sections.example} />
              </SectionCard>
            ) : null;
          case 'counterExample':
            return sections.counterExample ? (
              <SectionCard key={key} sectionKey={key} testId="lesson-section-counterExample">
                <InlineHtml html={sections.counterExample} />
              </SectionCard>
            ) : null;
          case 'examPitfall':
            return sections.examPitfall ? (
              <SectionCard key={key} sectionKey={key} testId="lesson-section-examPitfall">
                <InlineHtml html={sections.examPitfall} />
              </SectionCard>
            ) : null;
          case 'selfCheck':
            return sections.selfCheck ? (
              <SelfCheckCard
                key={key}
                question={sections.selfCheck.question}
                answer={sections.selfCheck.answer}
                testId="lesson-section-selfCheck"
              />
            ) : null;
          default:
            return null;
        }
      })}

      {/* Optional: legacy html below structured sections, only when explicitly present */}
      {sections.fallbackHtml && (
        <details className="rounded-md border border-border bg-muted/20 p-3 text-sm">
          <summary className="cursor-pointer text-muted-foreground">
            Vollständiger Lerntext anzeigen
          </summary>
          <div
            className="prose prose-invert max-w-none mt-3"
            data-testid="lesson-sections-extended-html"
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(sections.fallbackHtml) }}
          />
        </details>
      )}
    </div>
  );
}

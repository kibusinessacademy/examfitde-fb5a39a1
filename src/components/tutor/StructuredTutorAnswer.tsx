/**
 * StructuredTutorAnswer — wenn die Assistant-Antwort die Sektionen
 * "Definition", "Praxisbeispiel" und "Prüfungsfalle" enthält, werden sie
 * als Tabs dargestellt. Sonst Fallback auf normales Markdown.
 *
 * Sektionserkennung: Markdown-Heading (## / ### / **bold**) oder Doppelpunkt-Label
 * am Zeilenanfang. Robust gegenüber kleinen Format-Abweichungen.
 */
import { useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BookOpen, Briefcase, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Props {
  content: string;
  className?: string;
}

const SECTIONS = [
  {
    key: 'definition',
    label: 'Definition',
    icon: BookOpen,
    patterns: [/definition/i, /begriff/i, /erklärung/i],
  },
  {
    key: 'praxis',
    label: 'Praxisbeispiel',
    icon: Briefcase,
    patterns: [/praxisbeispiel/i, /praxis-?beispiel/i, /beispiel/i, /praxis/i],
  },
  {
    key: 'falle',
    label: 'Prüfungsfalle',
    icon: AlertTriangle,
    patterns: [/prüfungsfalle/i, /pruefungsfalle/i, /falle/i, /achtung/i, /tipp/i],
  },
] as const;

type SectionKey = typeof SECTIONS[number]['key'];

function parseSections(md: string): Record<SectionKey, string> | null {
  // Strip [SOURCES] block at the bottom (kept for citation rendering elsewhere).
  const body = md.replace(/\[SOURCES\][\s\S]*$/i, '').trim();

  // Match headings of the form: "## Title", "### Title", "**Title**", "Title:" at line start
  const headingRe = /^(?:#{1,4}\s+|\*\*\s*)?([^\n*:][^\n]{0,60}?)(?:\s*\*\*)?\s*:?\s*$/gm;

  const lines = body.split('\n');
  const sections: Record<SectionKey, string> = {
    definition: '',
    praxis: '',
    falle: '',
  };
  let current: SectionKey | null = null;
  let foundAny = false;

  for (const line of lines) {
    const trimmed = line.trim();
    // Detect heading-ish line
    const isHeading =
      /^#{1,4}\s+/.test(trimmed) ||
      /^\*\*[^*]+\*\*:?$/.test(trimmed) ||
      /^[A-ZÄÖÜ][\wäöüß \-]{2,40}:\s*$/.test(trimmed);

    if (isHeading) {
      const stripped = trimmed
        .replace(/^#{1,4}\s+/, '')
        .replace(/^\*\*([^*]+)\*\*:?$/, '$1')
        .replace(/:\s*$/, '');
      const matched = SECTIONS.find((s) => s.patterns.some((p) => p.test(stripped)));
      if (matched) {
        current = matched.key;
        foundAny = true;
        continue;
      } else {
        current = null;
        continue;
      }
    }

    if (current) {
      sections[current] += (sections[current] ? '\n' : '') + line;
    }
  }

  if (!foundAny) return null;

  // Trim
  (Object.keys(sections) as SectionKey[]).forEach((k) => {
    sections[k] = sections[k].trim();
  });

  // Require at least 2 of 3 sections to consider this "structured"
  const filled = (Object.values(sections) as string[]).filter((v) => v.length > 0).length;
  if (filled < 2) return null;

  return sections;
}

export function StructuredTutorAnswer({ content, className }: Props) {
  const parsed = useMemo(() => parseSections(content), [content]);

  if (!parsed) {
    return (
      <div className={cn('text-sm prose prose-sm dark:prose-invert max-w-none', className)}>
        <ReactMarkdown>{content}</ReactMarkdown>
      </div>
    );
  }

  const firstFilled = (Object.entries(parsed).find(([, v]) => v.length > 0)?.[0] ?? 'definition') as SectionKey;

  return (
    <Tabs defaultValue={firstFilled} className={cn('w-full', className)}>
      <TabsList className="grid w-full grid-cols-3 h-9 bg-surface-sunken">
        {SECTIONS.map((s) => {
          const Icon = s.icon;
          const hasContent = parsed[s.key].length > 0;
          return (
            <TabsTrigger
              key={s.key}
              value={s.key}
              disabled={!hasContent}
              className="text-[11px] gap-1 data-[state=active]:bg-petrol-100 data-[state=active]:text-petrol-700"
            >
              <Icon className="h-3 w-3" />
              <span className="hidden sm:inline">{s.label}</span>
            </TabsTrigger>
          );
        })}
      </TabsList>
      {SECTIONS.map((s) => (
        <TabsContent key={s.key} value={s.key} className="mt-2">
          <div className="text-sm prose prose-sm dark:prose-invert max-w-none [&>p]:mb-1.5 [&>p:last-child]:mb-0">
            <ReactMarkdown>{parsed[s.key] || '_Keine Inhalte in dieser Sektion._'}</ReactMarkdown>
          </div>
        </TabsContent>
      ))}
    </Tabs>
  );
}

import ReactMarkdown from 'react-markdown';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Lightbulb, Quote, CheckSquare, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HandbookSection, ContentType } from '@/hooks/handbook';

interface HandbookSectionContentProps {
  section: HandbookSection;
}

const contentTypeConfig: Record<ContentType, {
  icon: React.ComponentType<{ className?: string }>;
  containerClass: string;
  headerClass: string;
}> = {
  text: {
    icon: FileText,
    containerClass: '',
    headerClass: '',
  },
  tip: {
    icon: Lightbulb,
    containerClass: 'bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-800',
    headerClass: 'text-green-700 dark:text-green-400',
  },
  warning: {
    icon: AlertTriangle,
    containerClass: 'bg-amber-50 dark:bg-amber-950/30 border-amber-200 dark:border-amber-800',
    headerClass: 'text-amber-700 dark:text-amber-400',
  },
  example: {
    icon: FileText,
    containerClass: 'bg-blue-50 dark:bg-blue-950/30 border-blue-200 dark:border-blue-800',
    headerClass: 'text-blue-700 dark:text-blue-400',
  },
  quote: {
    icon: Quote,
    containerClass: 'bg-purple-50 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800',
    headerClass: 'text-purple-700 dark:text-purple-400',
  },
  checklist: {
    icon: CheckSquare,
    containerClass: 'bg-primary/5 border-primary/20',
    headerClass: 'text-primary',
  },
};

export function HandbookSectionContent({ section }: HandbookSectionContentProps) {
  const contentType = (section.content_type as ContentType) || 'text';
  const config = contentTypeConfig[contentType] ?? contentTypeConfig.text;
  const IconComponent = config.icon;

  return (
    <Card className={cn('border', config.containerClass)}>
      <CardHeader className="pb-3">
        <CardTitle className={cn('text-lg flex items-center gap-2', config.headerClass)}>
          <IconComponent className="h-5 w-5" />
          {section.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="prose prose-sm dark:prose-invert max-w-none">
        <ReactMarkdown
          components={{
            h2: ({ children }) => (
              <h2 className="text-xl font-bold mt-6 mb-3 text-foreground">{children}</h2>
            ),
            h3: ({ children }) => (
              <h3 className="text-lg font-semibold mt-4 mb-2 text-foreground">{children}</h3>
            ),
            p: ({ children }) => (
              <p className="mb-3 leading-relaxed text-muted-foreground">{children}</p>
            ),
            strong: ({ children }) => (
              <strong className="font-semibold text-foreground">{children}</strong>
            ),
            blockquote: ({ children }) => (
              <blockquote className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground bg-primary/5 py-2 pr-4 rounded-r-lg">
                {children}
              </blockquote>
            ),
            ul: ({ children }) => (
              <ul className="space-y-1 my-3">{children}</ul>
            ),
            li: ({ children }) => (
              <li className="ml-4 flex items-start gap-2">
                <span className="text-primary mt-1.5 shrink-0">•</span>
                <span>{children}</span>
              </li>
            ),
            code: ({ children, className }) => {
              const isBlock = className?.includes('language-');
              if (isBlock) {
                return (
                  <pre className="bg-muted rounded-lg p-4 overflow-x-auto my-4">
                    <code className="text-sm font-mono">{children}</code>
                  </pre>
                );
              }
              return (
                <code className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">
                  {children}
                </code>
              );
            },
            table: ({ children }) => (
              <div className="my-4 overflow-x-auto">
                <table className="w-full text-sm border-collapse">{children}</table>
              </div>
            ),
            thead: ({ children }) => (
              <thead className="bg-muted/50">{children}</thead>
            ),
            th: ({ children }) => (
              <th className="border border-border px-3 py-2 text-left font-medium">{children}</th>
            ),
            td: ({ children }) => (
              <td className="border border-border px-3 py-2">{children}</td>
            ),
            tr: ({ children }) => (
              <tr className="hover:bg-muted/30">{children}</tr>
            ),
          }}
        >
          {section.content_markdown}
        </ReactMarkdown>
      </CardContent>
    </Card>
  );
}

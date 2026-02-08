import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertTriangle, Lightbulb, Quote, CheckSquare, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { HandbookSection } from '@/hooks/useHandbook';

interface HandbookSectionContentProps {
  section: HandbookSection;
}

const contentTypeConfig = {
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

// Simple Markdown renderer for handbook content
function renderMarkdown(content: string) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let inTable = false;
  let tableRows: string[][] = [];
  let tableHeaders: string[] = [];

  lines.forEach((line, index) => {
    // Headers
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={index} className="text-xl font-bold mt-6 mb-3 text-foreground">
          {line.slice(3)}
        </h2>
      );
      return;
    }
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={index} className="text-lg font-semibold mt-4 mb-2 text-foreground">
          {line.slice(4)}
        </h3>
      );
      return;
    }

    // Tables
    if (line.startsWith('|')) {
      if (!inTable) {
        inTable = true;
        tableHeaders = line.split('|').filter(cell => cell.trim()).map(cell => cell.trim());
        return;
      }
      if (line.includes('---')) return; // Skip separator row
      tableRows.push(line.split('|').filter(cell => cell.trim()).map(cell => cell.trim()));
      return;
    } else if (inTable) {
      // End of table
      elements.push(
        <div key={`table-${index}`} className="my-4 overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-muted/50">
                {tableHeaders.map((header, i) => (
                  <th key={i} className="border border-border px-3 py-2 text-left font-medium">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="hover:bg-muted/30">
                  {row.map((cell, cellIndex) => (
                    <td key={cellIndex} className="border border-border px-3 py-2">
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      inTable = false;
      tableRows = [];
      tableHeaders = [];
    }

    // Blockquotes
    if (line.startsWith('> ')) {
      elements.push(
        <blockquote key={index} className="border-l-4 border-primary pl-4 my-4 italic text-muted-foreground bg-primary/5 py-2 pr-4 rounded-r-lg">
          {formatInlineText(line.slice(2))}
        </blockquote>
      );
      return;
    }

    // Lists
    if (line.startsWith('- ') || line.startsWith('* ')) {
      const content = line.slice(2);
      elements.push(
        <li key={index} className="ml-4 mb-1 flex items-start gap-2">
          <span className="text-primary mt-1.5">•</span>
          <span>{formatInlineText(content)}</span>
        </li>
      );
      return;
    }

    // Checkbox style (✅ ❌ ⚠️)
    if (line.match(/^[✅❌⚠️]/)) {
      elements.push(
        <p key={index} className="mb-2">
          {formatInlineText(line)}
        </p>
      );
      return;
    }

    // Regular paragraphs
    if (line.trim()) {
      elements.push(
        <p key={index} className="mb-3 leading-relaxed text-muted-foreground">
          {formatInlineText(line)}
        </p>
      );
    }
  });

  return elements;
}

// Format inline text (bold, code, links)
function formatInlineText(text: string): React.ReactNode {
  // Split by bold markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
    }
    // Handle inline code
    if (part.includes('`')) {
      const codeParts = part.split(/(`[^`]+`)/g);
      return codeParts.map((codePart, codeIndex) => {
        if (codePart.startsWith('`') && codePart.endsWith('`')) {
          return <code key={`${index}-${codeIndex}`} className="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">{codePart.slice(1, -1)}</code>;
        }
        return codePart;
      });
    }
    return part;
  });
}

export function HandbookSectionContent({ section }: HandbookSectionContentProps) {
  const config = contentTypeConfig[section.content_type];
  const IconComponent = config.icon;

  return (
    <Card className={cn("border", config.containerClass)}>
      <CardHeader className="pb-3">
        <CardTitle className={cn("text-lg flex items-center gap-2", config.headerClass)}>
          <IconComponent className="h-5 w-5" />
          {section.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="prose prose-sm max-w-none">
        {renderMarkdown(section.content_markdown)}
      </CardContent>
    </Card>
  );
}

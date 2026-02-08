import { useParams, Link } from 'react-router-dom';
import { Calendar, Clock, User, ArrowLeft, ArrowRight, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { getArticleBySlug, getRelatedArticles } from '@/data/blogArticles';
import { SITE_URL, generateOrganizationSchema } from '@/lib/seo';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function WissenArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const article = getArticleBySlug(slug || '');
  const relatedArticles = getRelatedArticles(slug || '');

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Artikel nicht gefunden</h1>
          <Button asChild>
            <Link to="/wissen">Zurück zur Übersicht</Link>
          </Button>
        </div>
      </div>
    );
  }

  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    author: {
      '@type': 'Person',
      name: article.author,
    },
    datePublished: article.publishedAt,
    publisher: generateOrganizationSchema(),
    mainEntityOfPage: {
      '@type': 'WebPage',
      '@id': `${SITE_URL}/wissen/${slug}`,
    },
  };

  return (
    <>
      <SEOHead
        title={`${article.title} | ExamFit Wissen`}
        description={article.excerpt}
        canonical={`${SITE_URL}/wissen/${slug}`}
        structuredData={structuredData}
        type="article"
      />

      <article className="min-h-screen">
        {/* Header */}
        <header className="relative py-12 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10 max-w-4xl">
            <Breadcrumbs
              items={[
                { label: 'Wissen', href: '/wissen' },
                { label: article.category, href: `/wissen/kategorie/${article.category.toLowerCase().replace(/\s+/g, '-')}` },
                { label: article.title },
              ]}
              className="mb-6"
            />

            <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
              {article.category}
            </Badge>

            <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">
              {article.title}
            </h1>

            <p className="text-xl text-muted-foreground mb-6">
              {article.excerpt}
            </p>

            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2">
                <User className="h-4 w-4" />
                {article.author}
              </span>
              <span className="flex items-center gap-2">
                <Calendar className="h-4 w-4" />
                {format(new Date(article.publishedAt), 'dd. MMMM yyyy', { locale: de })}
              </span>
              <span className="flex items-center gap-2">
                <Clock className="h-4 w-4" />
                {article.readingTime} Min. Lesezeit
              </span>
            </div>
          </div>
        </header>

        {/* Content */}
        <div className="container max-w-4xl py-12">
          <div 
            className="prose prose-lg prose-slate dark:prose-invert max-w-none
              prose-headings:font-display prose-headings:font-bold
              prose-h2:text-2xl prose-h2:mt-10 prose-h2:mb-4
              prose-h3:text-xl prose-h3:mt-8 prose-h3:mb-3
              prose-p:text-muted-foreground prose-p:leading-relaxed
              prose-li:text-muted-foreground
              prose-strong:text-foreground
              prose-blockquote:border-primary prose-blockquote:bg-muted/50 prose-blockquote:py-1 prose-blockquote:px-4 prose-blockquote:rounded-r-lg
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline
              prose-table:border prose-table:border-border
              prose-th:bg-muted prose-th:p-3
              prose-td:p-3 prose-td:border-t prose-td:border-border"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(article.content) }}
          />

          {/* Tags */}
          <div className="mt-12 pt-8 border-t">
            <div className="flex flex-wrap items-center gap-2">
              <Tag className="h-4 w-4 text-muted-foreground" />
              {article.tags.map((tag) => (
                <Badge key={tag} variant="outline">
                  {tag}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        {/* Related Articles */}
        {relatedArticles.length > 0 && (
          <section className="py-12 bg-muted/30">
            <div className="container max-w-4xl">
              <h2 className="text-2xl font-display font-bold mb-8">
                Das könnte dich auch interessieren
              </h2>
              <div className="grid md:grid-cols-3 gap-6">
                {relatedArticles.map((related) => (
                  <Link key={related.id} to={`/wissen/${related.slug}`}>
                    <Card className="glass-card h-full hover:shadow-glow-sm transition-all duration-300">
                      <CardHeader>
                        <Badge variant="outline" className="w-fit mb-2">
                          {related.category}
                        </Badge>
                        <CardTitle className="text-lg line-clamp-2">
                          {related.title}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {related.readingTime} Min.
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* Navigation */}
        <div className="container max-w-4xl py-8">
          <div className="flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/wissen">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Alle Artikel
              </Link>
            </Button>
            <Button asChild>
              <Link to="/shop">
                Jetzt vorbereiten
                <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </article>
    </>
  );
}

// Simple markdown to HTML converter
function formatMarkdown(content: string): string {
  return content
    // Headers
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    // Italic
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    // Blockquotes
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    // Unordered lists
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    // Ordered lists
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    // Wrap consecutive li elements in ul
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    // Tables (basic support)
    .replace(/\|(.*)\|/g, (match, content) => {
      const cells = content.split('|').map((c: string) => c.trim());
      if (cells.every((c: string) => c.match(/^-+$/))) {
        return ''; // Skip separator rows
      }
      const isHeader = content.includes('---');
      const tag = isHeader ? 'th' : 'td';
      return `<tr>${cells.map((c: string) => `<${tag}>${c}</${tag}>`).join('')}</tr>`;
    })
    // Paragraphs
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gim, (match) => {
      if (match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    })
    // Clean up empty paragraphs
    .replace(/<p><\/p>/g, '')
    .replace(/<p>\s*<\/p>/g, '')
    // Fix nested tags
    .replace(/<p>(<h[1-3]>)/g, '$1')
    .replace(/(<\/h[1-3]>)<\/p>/g, '$1')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/(<\/ul>)<\/p>/g, '$1')
    .replace(/<p>(<blockquote>)/g, '$1')
    .replace(/(<\/blockquote>)<\/p>/g, '$1');
}

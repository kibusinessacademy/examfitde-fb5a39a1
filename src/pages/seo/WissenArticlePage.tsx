import { useParams, Link } from 'react-router-dom';
import DOMPurify from 'dompurify';
import { Calendar, Clock, User, ArrowLeft, ArrowRight, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSEODocument } from '@/hooks/useSEODocuments';
import { useSEODocuments } from '@/hooks/useSEODocuments';
import type { BlogArticle } from '@/data/blogArticles';
import { SITE_URL, generateOrganizationSchema } from '@/lib/seo';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';
import { QuizCTA } from '@/components/quiz/QuizCTA';

function mapDbToArticle(doc: any): BlogArticle {
  return {
    id: doc.id,
    slug: doc.slug,
    title: doc.title,
    excerpt: doc.excerpt || '',
    content: doc.content_md || '',
    category: doc.category || 'Ratgeber',
    author: doc.author || 'ExamFit',
    publishedAt: doc.published_at || doc.updated_at,
    readingTime: Math.ceil((doc.content_md?.split(/\s+/).length || 200) / 200),
    tags: (doc.tags as string[]) || [],
  };
}

export default function WissenArticlePage() {
  const { slug } = useParams<{ slug: string }>();
  const { data: dbDoc, isLoading } = useSEODocument(slug || '', 'blog');
  const { data: allDocs = [] } = useSEODocuments('blog');

  const article = dbDoc ? mapDbToArticle(dbDoc) : undefined;

  // Related articles from DB
  const relatedArticles = article
    ? allDocs
        .filter(d => d.slug !== slug)
        .map(mapDbToArticle)
        .filter(a => a.category === article.category || a.tags.some(t => article.tags.includes(t)))
        .slice(0, 3)
    : [];

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-pulse text-muted-foreground">Lade Artikel…</div>
      </div>
    );
  }

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

  const wordCount = article.content.split(/\s+/).length;
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: article.title,
    description: article.excerpt,
    author: { '@type': 'Organization', name: article.author || 'ExamFit', url: SITE_URL },
    datePublished: article.publishedAt,
    dateModified: article.publishedAt,
    wordCount,
    publisher: generateOrganizationSchema(),
    mainEntityOfPage: { '@type': 'WebPage', '@id': `${SITE_URL}/wissen/${slug}` },
    image: `${SITE_URL}/og-image.png`,
    inLanguage: 'de-DE',
  };

  return (
    <>
      <SEOHead
        title={`${article.title} | ExamFit Wissen`}
        description={article.excerpt}
        canonical={`${SITE_URL}/wissen/${slug}`}
        structuredData={structuredData}
        type="article"
        publishedTime={article.publishedAt}
        modifiedTime={article.publishedAt}
        author="ExamFit"
      />

      <article className="min-h-screen">
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
            <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">{article.category}</Badge>
            <h1 className="text-3xl md:text-4xl lg:text-5xl font-display font-bold mb-6">{article.title}</h1>
            <p className="text-xl text-muted-foreground mb-6">{article.excerpt}</p>
            <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><User className="h-4 w-4" />{article.author}</span>
              <span className="flex items-center gap-2"><Calendar className="h-4 w-4" />{format(new Date(article.publishedAt), 'dd. MMMM yyyy', { locale: de })}</span>
              <span className="flex items-center gap-2"><Clock className="h-4 w-4" />{article.readingTime} Min. Lesezeit</span>
            </div>
          </div>
        </header>

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
              prose-a:text-primary prose-a:no-underline hover:prose-a:underline"
            dangerouslySetInnerHTML={{ __html: formatMarkdown(article.content) }}
          />

          <div className="my-8">
            <QuizCTA location="mid" cluster="wissen_article" />
          </div>

          {article.tags.length > 0 && (
            <div className="mt-12 pt-8 border-t">
              <div className="flex flex-wrap items-center gap-2">
                <Tag className="h-4 w-4 text-muted-foreground" />
                {article.tags.map((tag) => (
                  <Badge key={tag} variant="outline">{tag}</Badge>
                ))}
              </div>
            </div>
          )}
        </div>

        {relatedArticles.length > 0 && (
          <section className="py-12 bg-muted/30">
            <div className="container max-w-4xl">
              <h2 className="text-2xl font-display font-bold mb-8">Das könnte dich auch interessieren</h2>
              <div className="grid md:grid-cols-3 gap-6">
                {relatedArticles.map((related) => (
                  <Link key={related.id} to={`/wissen/${related.slug}`}>
                    <Card className="glass-card h-full hover:shadow-glow-sm transition-all duration-300">
                      <CardHeader>
                        <Badge variant="outline" className="w-fit mb-2">{related.category}</Badge>
                        <CardTitle className="text-lg line-clamp-2">{related.title}</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <span className="text-sm text-muted-foreground flex items-center gap-1">
                          <Clock className="h-3 w-3" />{related.readingTime} Min.
                        </span>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        )}

        <div className="container max-w-4xl py-8">
          <div className="flex justify-between">
            <Button variant="outline" asChild>
              <Link to="/wissen"><ArrowLeft className="mr-2 h-4 w-4" />Alle Artikel</Link>
            </Button>
            <Button asChild>
              <Link to="/shop">Jetzt vorbereiten<ArrowRight className="ml-2 h-4 w-4" /></Link>
            </Button>
          </div>
        </div>
      </article>
    </>
  );
}

function formatMarkdown(content: string): string {
  const rawHtml = content
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/^> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/^\- (.*$)/gim, '<li>$1</li>')
    .replace(/^\d+\. (.*$)/gim, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, (match) => `<ul>${match}</ul>`)
    .replace(/\n\n/g, '</p><p>')
    .replace(/^(.+)$/gim, (match) => {
      if (match.startsWith('<')) return match;
      return `<p>${match}</p>`;
    })
    .replace(/<p><\/p>/g, '')
    .replace(/<p>\s*<\/p>/g, '')
    .replace(/<p>(<h[1-3]>)/g, '$1')
    .replace(/(<\/h[1-3]>)<\/p>/g, '$1')
    .replace(/<p>(<ul>)/g, '$1')
    .replace(/(<\/ul>)<\/p>/g, '$1')
    .replace(/<p>(<blockquote>)/g, '$1')
    .replace(/(<\/blockquote>)<\/p>/g, '$1');

  return DOMPurify.sanitize(rawHtml, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'blockquote', 'code', 'pre', 'a', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'target', 'rel'],
    FORBID_TAGS: ['script', 'iframe', 'object', 'embed', 'style'],
  });
}

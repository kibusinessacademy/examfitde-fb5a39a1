import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight, BookOpen, Tag, FileText } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useSEODocuments } from '@/hooks/useSEODocuments';
import type { BlogArticle } from '@/data/blogArticles';
import { generateOrganizationSchema, SITE_URL } from '@/lib/seo';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function WissenPage() {
  const { data: dbArticles = [], isLoading } = useSEODocuments('blog');

  const allArticles: BlogArticle[] = dbArticles.map(a => ({
    id: a.id,
    slug: a.slug,
    title: a.title,
    excerpt: a.excerpt || '',
    category: (a as any).category || 'Ratgeber',
    author: (a as any).author || 'ExamFit',
    publishedAt: a.published_at || a.updated_at,
    readingTime: Math.ceil((a.content_md?.split(/\s+/).length || 200) / 200),
    tags: ((a as any).tags as string[]) || [],
    featured: !!(a as any).featured,
    content: a.content_md || '',
  }));

  const featuredArticles = allArticles.filter(a => a.featured);
  const categories = [...new Set(allArticles.map(a => a.category))];
  const recentArticles = [...allArticles]
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, 6);

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'Blog',
        name: 'ExamFit Wissen – Ratgeber für Auszubildende',
        description: 'Tipps, Ratgeber und Wissen rund um Ausbildung, IHK-Prüfungen, Lernen und Karriere.',
        url: `${SITE_URL}/wissen`,
        publisher: generateOrganizationSchema(),
      },
    ],
  };

  const isEmpty = !isLoading && allArticles.length === 0;

  return (
    <>
      <SEOHead
        title="Wissen & Ratgeber für Auszubildende | ExamFit"
        description="Tipps für die IHK-Prüfung, Lernstrategien, Karriere-Ratgeber und alles, was Azubis wissen müssen. Von Experten geschrieben."
        canonical={`${SITE_URL}/wissen`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs items={[{ label: 'Wissen' }]} className="mb-8" />
            <div className="max-w-3xl">
              <Badge className="mb-4 bg-primary/20 text-primary border-primary/30">
                Ratgeber & Tipps
              </Badge>
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                Wissen für <span className="text-gradient">Auszubildende</span>
              </h1>
              <p className="text-xl text-muted-foreground">
                Prüfungstipps, Lernstrategien, Karriere-Ratgeber – alles, was du für eine 
                erfolgreiche Ausbildung brauchst. Von Experten geschrieben, für Azubis erklärt.
              </p>
            </div>
          </div>
        </section>

        {isEmpty ? (
          <section className="py-16">
            <div className="container text-center">
              <FileText className="h-16 w-16 text-muted-foreground/40 mx-auto mb-4" />
              <h2 className="text-2xl font-display font-bold mb-2">Wissens-Hub im Aufbau</h2>
              <p className="text-muted-foreground max-w-md mx-auto mb-6">
                Unsere Experten arbeiten an hilfreichen Artikeln rund um Ausbildung, Prüfungsvorbereitung und Karriere.
              </p>
              <Button asChild>
                <Link to="/shop">Produkte entdecken <ArrowRight className="ml-2 h-4 w-4" /></Link>
              </Button>
            </div>
          </section>
        ) : (
          <>
            {/* Featured Articles */}
            {featuredArticles.length > 0 && (
              <section className="py-12 bg-muted/30">
                <div className="container">
                  <h2 className="text-2xl font-display font-bold mb-8">Beliebte Artikel</h2>
                  <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {featuredArticles.map((article) => (
                      <Link key={article.id} to={`/wissen/${article.slug}`}>
                        <Card className="glass-card h-full hover:shadow-glow-sm transition-all duration-300">
                          <CardHeader>
                            <Badge variant="outline" className="w-fit mb-2">{article.category}</Badge>
                            <CardTitle className="line-clamp-2">{article.title}</CardTitle>
                            <CardDescription className="line-clamp-3">{article.excerpt}</CardDescription>
                          </CardHeader>
                          <CardContent>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-4 w-4" />
                                {format(new Date(article.publishedAt), 'dd. MMM yyyy', { locale: de })}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {article.readingTime} Min.
                              </span>
                            </div>
                          </CardContent>
                        </Card>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Categories */}
            {categories.length > 0 && (
              <section className="py-12">
                <div className="container">
                  <h2 className="text-2xl font-display font-bold mb-8">Themen entdecken</h2>
                  <div className="flex flex-wrap gap-3">
                    {categories.map((category) => (
                      <Link key={category} to={`/wissen/kategorie/${category.toLowerCase().replace(/\s+/g, '-')}`}>
                        <Badge variant="outline" className="px-4 py-2 text-base hover:bg-primary hover:text-primary-foreground transition-colors cursor-pointer">
                          <Tag className="h-4 w-4 mr-2" />
                          {category}
                        </Badge>
                      </Link>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* Recent Articles */}
            <section className="py-12 bg-muted/30">
              <div className="container">
                <div className="flex items-center justify-between mb-8">
                  <h2 className="text-2xl font-display font-bold">Neueste Artikel</h2>
                </div>
                <div className="grid gap-6">
                  {recentArticles.map((article) => (
                    <Link key={article.id} to={`/wissen/${article.slug}`}>
                      <Card className="glass-card hover:shadow-glow-sm transition-all duration-300">
                        <CardContent className="p-6">
                          <div className="flex flex-col md:flex-row md:items-center gap-4">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-2">
                                <Badge variant="outline">{article.category}</Badge>
                                <span className="text-sm text-muted-foreground">
                                  {format(new Date(article.publishedAt), 'dd. MMMM yyyy', { locale: de })}
                                </span>
                              </div>
                              <h3 className="text-xl font-semibold mb-2">{article.title}</h3>
                              <p className="text-muted-foreground line-clamp-2">{article.excerpt}</p>
                            </div>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Clock className="h-4 w-4" />
                                {article.readingTime} Min.
                              </span>
                              <ArrowRight className="h-5 w-5 text-primary" />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
                <div className="text-center mt-8">
                  <Button variant="outline" size="lg" asChild>
                    <Link to="/wissen/alle">Alle Artikel anzeigen <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                </div>
              </div>
            </section>
          </>
        )}

        {/* CTA Section */}
        <section className="py-16">
          <div className="container">
            <Card className="glass-card bg-gradient-to-br from-primary/10 via-transparent to-accent/10">
              <CardContent className="p-8 md:p-12 text-center">
                <BookOpen className="h-12 w-12 text-primary mx-auto mb-4" />
                <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
                  Bereit für deine IHK-Prüfung?
                </h2>
                <p className="text-lg text-muted-foreground mb-6 max-w-2xl mx-auto">
                  Wissen allein reicht nicht – du musst es auch anwenden können. 
                  Unser Prüfungstraining bereitet dich optimal auf deine Abschlussprüfung vor.
                </p>
                <div className="flex flex-wrap justify-center gap-4">
                  <Button size="lg" asChild>
                    <Link to="/shop">Produkte entdecken <ArrowRight className="ml-2 h-4 w-4" /></Link>
                  </Button>
                  <Button size="lg" variant="outline" asChild>
                    <Link to="/berufe">Deinen Beruf finden</Link>
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        </section>
      </div>
    </>
  );
}

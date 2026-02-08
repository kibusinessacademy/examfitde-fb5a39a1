import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Clock, ArrowRight, Search } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { blogArticles, getBlogCategories } from '@/data/blogArticles';
import { SITE_URL } from '@/lib/seo';
import { format } from 'date-fns';
import { de } from 'date-fns/locale';

export default function WissenAllePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const categories = getBlogCategories();

  const filteredArticles = blogArticles
    .filter((article) => {
      const matchesSearch = searchTerm === '' || 
        article.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.excerpt.toLowerCase().includes(searchTerm.toLowerCase()) ||
        article.tags.some(t => t.toLowerCase().includes(searchTerm.toLowerCase()));
      
      const matchesCategory = !selectedCategory || article.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    })
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());

  return (
    <>
      <SEOHead
        title="Alle Artikel | ExamFit Wissen"
        description="Alle Artikel rund um Ausbildung, IHK-Prüfungen, Lerntipps und Karriere. Finde die Themen, die dich interessieren."
        canonical={`${SITE_URL}/wissen/alle`}
      />

      <div className="min-h-screen">
        {/* Header */}
        <section className="relative py-12 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-accent/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[
                { label: 'Wissen', href: '/wissen' },
                { label: 'Alle Artikel' },
              ]}
              className="mb-6"
            />

            <h1 className="text-3xl md:text-4xl font-display font-bold mb-4">
              Alle Artikel
            </h1>
            <p className="text-lg text-muted-foreground max-w-2xl">
              {blogArticles.length} Artikel zu Ausbildung, Prüfungen und Karriere
            </p>
          </div>
        </section>

        {/* Filters */}
        <section className="py-8 border-b">
          <div className="container">
            <div className="flex flex-col md:flex-row gap-4">
              <div className="relative flex-1 max-w-md">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Artikel suchen..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Badge
                  variant={selectedCategory === null ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => setSelectedCategory(null)}
                >
                  Alle
                </Badge>
                {categories.map((category) => (
                  <Badge
                    key={category}
                    variant={selectedCategory === category ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => setSelectedCategory(category)}
                  >
                    {category}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* Articles Grid */}
        <section className="py-12">
          <div className="container">
            {filteredArticles.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-lg text-muted-foreground">
                  Keine Artikel gefunden. Versuche andere Suchbegriffe.
                </p>
              </div>
            ) : (
              <div className="grid gap-6">
                {filteredArticles.map((article) => (
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
                            <h2 className="text-xl font-semibold mb-2">{article.title}</h2>
                            <p className="text-muted-foreground line-clamp-2">{article.excerpt}</p>
                            <div className="flex flex-wrap gap-2 mt-3">
                              {article.tags.slice(0, 3).map((tag) => (
                                <Badge key={tag} variant="secondary" className="text-xs">
                                  {tag}
                                </Badge>
                              ))}
                            </div>
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
            )}
          </div>
        </section>
      </div>
    </>
  );
}

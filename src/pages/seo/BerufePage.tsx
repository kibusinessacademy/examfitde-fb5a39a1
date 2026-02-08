import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, Clock, Award, Search, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SEOHead } from '@/components/seo/SEOHead';
import { Breadcrumbs } from '@/components/seo/Breadcrumbs';
import { useBerufPages, KAMMER_MAPPING } from '@/hooks/useSEOPages';
import { generateOrganizationSchema, SITE_URL, getBerufUrl } from '@/lib/seo';
import { useState, useMemo } from 'react';

export default function BerufePage() {
  const { data: berufe, isLoading } = useBerufPages();
  const [searchQuery, setSearchQuery] = useState('');
  const [kammerFilter, setKammerFilter] = useState<string>('all');

  const filteredBerufe = useMemo(() => {
    if (!berufe) return [];
    
    let filtered = berufe;
    
    // Kammer-Filter anwenden
    if (kammerFilter !== 'all') {
      filtered = filtered.filter(beruf => beruf.kammer === kammerFilter);
    }
    
    // Suchfilter anwenden
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(
        beruf =>
          beruf.title.toLowerCase().includes(query) ||
          beruf.fullTitle.toLowerCase().includes(query) ||
          beruf.description?.toLowerCase().includes(query)
      );
    }
    
    return filtered;
  }, [berufe, searchQuery, kammerFilter]);

  // Statistiken für Filter
  const kammerStats = useMemo(() => {
    if (!berufe) return {};
    return berufe.reduce((acc, beruf) => {
      const kammer = beruf.kammer;
      acc[kammer] = (acc[kammer] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
  }, [berufe]);

  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      generateOrganizationSchema(),
      {
        '@type': 'CollectionPage',
        name: 'Ausbildungsberufe – IHK-Prüfungsvorbereitung',
        description: 'Übersicht aller Ausbildungsberufe mit IHK-Prüfung. Finde deinen Beruf und bereite dich optimal auf die Abschlussprüfung vor.',
        url: `${SITE_URL}/berufe`,
      },
    ],
  };

  return (
    <>
      <SEOHead
        title="Ausbildungsberufe – Prüfungsvorbereitung für IHK & HWK | ExamFit"
        description="Übersicht aller Ausbildungsberufe mit IHK- oder HWK-Prüfung. Finde deinen Beruf und bereite dich optimal auf die Abschlussprüfung vor."
        canonical={`${SITE_URL}/berufe`}
        structuredData={structuredData}
      />

      <div className="min-h-screen">
        {/* Hero Section */}
        <section className="relative py-16 overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-accent/10 via-transparent to-primary/10" />
          <div className="container relative z-10">
            <Breadcrumbs
              items={[{ label: 'Berufe' }]}
              className="mb-8"
            />

            <div className="max-w-3xl">
              <h1 className="text-4xl md:text-5xl font-display font-bold mb-6">
                <span className="text-gradient">Ausbildungsberufe</span>
                <br />
                mit IHK- & HWK-Prüfung
              </h1>
              <p className="text-xl text-muted-foreground mb-8">
                Finde deinen Ausbildungsberuf und starte mit der optimalen Prüfungsvorbereitung.
                Wir unterstützen Berufe der Industrie- und Handelskammer (IHK) sowie der Handwerkskammer (HWK).
              </p>

              {/* Search & Filter */}
              <div className="flex flex-col sm:flex-row gap-4 max-w-2xl">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                  <Input
                    type="search"
                    placeholder="Beruf suchen..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-12 text-lg bg-background/50"
                    aria-label="Beruf suchen"
                  />
                </div>
                <Select value={kammerFilter} onValueChange={setKammerFilter}>
                  <SelectTrigger className="w-full sm:w-48 h-12 bg-background/50" aria-label="Nach Kammer filtern">
                    <Building2 className="h-4 w-4 mr-2" />
                    <SelectValue placeholder="Alle Kammern" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Alle Kammern ({berufe?.length || 0})</SelectItem>
                    <SelectItem value="IHK">IHK ({kammerStats['IHK'] || 0})</SelectItem>
                    <SelectItem value="HWK">HWK ({kammerStats['HWK'] || 0})</SelectItem>
                    <SelectItem value="LWK">Landwirtschaft ({kammerStats['LWK'] || 0})</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </section>

        {/* Berufe Grid */}
        <section className="py-12">
          <div className="container">
            {isLoading ? (
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                {[...Array(9)].map((_, i) => (
                  <Card key={i} className="glass-card animate-pulse">
                    <CardHeader>
                      <div className="h-6 bg-muted rounded w-3/4" />
                      <div className="h-4 bg-muted rounded w-full mt-2" />
                      <div className="h-4 bg-muted rounded w-2/3 mt-1" />
                    </CardHeader>
                  </Card>
                ))}
              </div>
            ) : filteredBerufe.length === 0 ? (
              <div className="text-center py-12">
                <GraduationCap className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-lg font-semibold mb-2">Kein Beruf gefunden</h3>
                <p className="text-muted-foreground">
                  Versuche einen anderen Suchbegriff oder{' '}
                  <button
                    onClick={() => setSearchQuery('')}
                    className="text-primary underline"
                  >
                    zeige alle Berufe
                  </button>
                </p>
              </div>
            ) : (
              <>
                <div className="mb-6 text-muted-foreground">
                  {filteredBerufe.length} {filteredBerufe.length === 1 ? 'Beruf' : 'Berufe'} gefunden
                </div>
                <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {filteredBerufe.map((beruf) => (
                    <Link key={beruf.id} to={getBerufUrl(beruf.slug)}>
                      <Card className="glass-card hover:shadow-glow-sm transition-all duration-300 h-full group">
                        <CardHeader>
                          <div className="flex items-start justify-between gap-2">
                            <GraduationCap className="h-8 w-8 text-primary mb-2 flex-shrink-0" />
                            <div className="flex flex-wrap gap-1.5 justify-end">
                              <Badge 
                                variant={beruf.kammerType === 'IHK' ? 'default' : beruf.kammerType === 'HWK' ? 'secondary' : 'outline'}
                                className="text-xs"
                              >
                                {beruf.kammer}
                              </Badge>
                              {beruf.dqrLevel && (
                                <Badge variant="outline" className="text-xs">
                                  DQR {beruf.dqrLevel}
                                </Badge>
                              )}
                            </div>
                          </div>
                          <CardTitle className="group-hover:text-primary transition-colors">
                            {beruf.title}
                          </CardTitle>
                          {beruf.fullTitle !== beruf.title && (
                            <CardDescription className="text-sm">
                              {beruf.fullTitle}
                            </CardDescription>
                          )}
                        </CardHeader>
                        <CardContent>
                          {beruf.description && (
                            <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
                              {beruf.description}
                            </p>
                          )}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-1 text-sm text-muted-foreground">
                              <Clock className="h-4 w-4" />
                              {beruf.duration} Monate
                            </div>
                            <span className="text-sm text-primary flex items-center opacity-0 group-hover:opacity-100 transition-opacity">
                              Details <ArrowRight className="ml-1 h-4 w-4" />
                            </span>
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  ))}
                </div>
              </>
            )}
          </div>
        </section>

        {/* CTA */}
        <section className="py-16 bg-muted/30">
          <div className="container text-center">
            <Award className="h-12 w-12 text-primary mx-auto mb-4" />
            <h2 className="text-2xl md:text-3xl font-display font-bold mb-4">
              Dein Beruf ist nicht dabei?
            </h2>
            <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
              Wir erweitern ständig unser Angebot. Kontaktiere uns und wir priorisieren deinen Beruf.
            </p>
            <Button variant="outline" asChild>
              <a href="mailto:kontakt@examfit.de">
                Beruf vorschlagen
              </a>
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}

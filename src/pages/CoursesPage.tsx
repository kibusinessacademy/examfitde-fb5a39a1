import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Loader2, Clock, BookOpen, ArrowRight, CheckCircle, Search, X } from 'lucide-react';

interface Course {
  id: string;
  title: string;
  description: string | null;
  thumbnail_url: string | null;
  estimated_duration: number | null;
  status: string;
  curriculum_id: string;
}

interface Enrollment {
  course_id: string;
  completed_at: string | null;
}

export default function CoursesPage() {
  const { user } = useAuth();
  const [courses, setCourses] = useState<Course[]>([]);
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'enrolled' | 'completed'>('all');

  useEffect(() => {
    fetchCourses();
    if (user) {
      fetchEnrollments();
    }
  }, [user]);

  const fetchCourses = async () => {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('status', 'published')
      .order('created_at', { ascending: false });

    if (!error && data) {
      setCourses(data);
    }
    setLoading(false);
  };

  const fetchEnrollments = async () => {
    if (!user) return;
    
    const { data, error } = await supabase
      .from('course_enrollments')
      .select('course_id, completed_at')
      .eq('user_id', user.id);

    if (!error && data) {
      setEnrollments(data);
    }
  };

  const isEnrolled = (courseId: string) => {
    return enrollments.some(e => e.course_id === courseId);
  };

  const isCompleted = (courseId: string) => {
    const enrollment = enrollments.find(e => e.course_id === courseId);
    return enrollment?.completed_at != null;
  };

  const filteredCourses = useMemo(() => {
    let result = courses;

    // Text search
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(c =>
        c.title.toLowerCase().includes(q) ||
        c.description?.toLowerCase().includes(q)
      );
    }

    // Status filter
    if (filter === 'enrolled') {
      result = result.filter(c => isEnrolled(c.id) && !isCompleted(c.id));
    } else if (filter === 'completed') {
      result = result.filter(c => isCompleted(c.id));
    }

    return result;
  }, [courses, search, filter, enrollments]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="py-6 sm:py-8 md:py-12 px-3 sm:px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="text-center mb-8 md:mb-12">
          <h1 className="text-2xl sm:text-3xl md:text-5xl font-display font-bold mb-3 md:mb-4">
            Dein <span className="text-gradient">Prüfungstraining</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Prüfungsrelevantes Wissen basierend auf offiziellen Rahmenlehrplänen – 
            gezielt aufbereitet für deine Abschlussprüfung.
          </p>
        </div>

        {/* Search + Filter Bar (#5) */}
        {courses.length > 0 && (
          <div className="mb-6 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Kurs suchen..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="pl-9 pr-9"
              />
              {search && (
                <button
                  onClick={() => setSearch('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {user && enrollments.length > 0 && (
              <div className="flex gap-1.5">
                {(['all', 'enrolled', 'completed'] as const).map(f => (
                  <Button
                    key={f}
                    variant={filter === f ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setFilter(f)}
                    className="text-xs"
                  >
                    {f === 'all' ? 'Alle' : f === 'enrolled' ? 'Aktiv' : 'Abgeschlossen'}
                  </Button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Courses Grid */}
        {filteredCourses.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">
              {search ? 'Keine Ergebnisse' : 'Noch kein Prüfungstraining verfügbar'}
            </h3>
            <p className="text-muted-foreground">
              {search ? 'Versuche einen anderen Suchbegriff.' : 'Neue Prüfungstrainings werden bald hinzugefügt. Schau später wieder vorbei!'}
            </p>
            {search && (
              <Button variant="outline" className="mt-4" onClick={() => setSearch('')}>
                Suche zurücksetzen
              </Button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-6">
            {filteredCourses.map((course) => (
              <Card key={course.id} className="glass-card border-border hover:border-primary/30 transition-all duration-300 group overflow-hidden">
                {/* Thumbnail */}
                <div className="aspect-video bg-muted relative overflow-hidden">
                  {course.thumbnail_url ? (
                    <img 
                      src={course.thumbnail_url} 
                      alt={course.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center gradient-primary opacity-50">
                      <BookOpen className="h-12 w-12 text-primary-foreground" />
                    </div>
                  )}
                  
                  {/* Status Badges */}
                  <div className="absolute top-3 left-3 flex gap-2">
                    {isCompleted(course.id) && (
                      <Badge className="bg-green-500/90 text-white">
                        <CheckCircle className="h-3 w-3 mr-1" />
                        Abgeschlossen
                      </Badge>
                    )}
                    {isEnrolled(course.id) && !isCompleted(course.id) && (
                      <Badge className="bg-primary/90 text-primary-foreground">
                        Eingeschrieben
                      </Badge>
                    )}
                  </div>
                </div>

                <CardHeader className="pb-2">
                  <CardTitle className="text-xl font-display group-hover:text-primary transition-colors">
                    {course.title}
                  </CardTitle>
                  <CardDescription className="line-clamp-2">
                    {course.description || 'Keine Beschreibung verfügbar'}
                  </CardDescription>
                </CardHeader>

                <CardContent className="pt-0">
                  {/* Meta Info */}
                  <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
                    {course.estimated_duration && (
                      <div className="flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {course.estimated_duration} Min.
                      </div>
                    )}
                  </div>

                  {/* Action Button */}
                  <Link to={`/course/${course.id}`}>
                    <Button className="w-full gradient-primary text-primary-foreground shadow-glow-sm group-hover:shadow-glow transition-all">
                      {isEnrolled(course.id) ? 'Fortsetzen' : 'Training starten'}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

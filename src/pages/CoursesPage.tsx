import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Clock, BookOpen, ArrowRight, CheckCircle } from 'lucide-react';

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

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="py-12 px-4">
      <div className="container mx-auto max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-display font-bold mb-4">
            Dein <span className="text-gradient">Prüfungstraining</span>
          </h1>
          <p className="text-xl text-muted-foreground max-w-2xl mx-auto">
            Prüfungsrelevantes Wissen basierend auf offiziellen Rahmenlehrplänen – 
            gezielt aufbereitet für deine Abschlussprüfung.
          </p>
        </div>

        {/* Courses Grid */}
        {courses.length === 0 ? (
          <div className="glass-card rounded-2xl p-12 text-center">
            <BookOpen className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-xl font-semibold mb-2">Noch kein Prüfungstraining verfügbar</h3>
            <p className="text-muted-foreground">
              Neue Prüfungstrainings werden bald hinzugefügt. Schau später wieder vorbei!
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {courses.map((course) => (
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

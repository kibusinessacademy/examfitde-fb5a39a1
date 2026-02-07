import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { FileText, BookOpen, Users, HelpCircle, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';

interface DashboardStats {
  curricula: number;
  courses: number;
  enrollments: number;
  questions: number;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState<DashboardStats>({ curricula: 0, courses: 0, enrollments: 0, questions: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const [curriculaRes, coursesRes, enrollmentsRes, questionsRes] = await Promise.all([
          supabase.from('curricula').select('id', { count: 'exact', head: true }),
          supabase.from('courses').select('id', { count: 'exact', head: true }),
          supabase.from('course_enrollments').select('id', { count: 'exact', head: true }),
          supabase.from('exam_questions').select('id', { count: 'exact', head: true }),
        ]);

        setStats({
          curricula: curriculaRes.count || 0,
          courses: coursesRes.count || 0,
          enrollments: enrollmentsRes.count || 0,
          questions: questionsRes.count || 0,
        });
      } catch (error) {
        console.error('Error fetching stats:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, []);

  const statCards = [
    { label: 'Curricula', value: stats.curricula, icon: FileText, color: 'primary', link: '/admin-v2/curricula' },
    { label: 'Kurse', value: stats.courses, icon: BookOpen, color: 'accent', link: '/admin-v2/courses' },
    { label: 'Einschreibungen', value: stats.enrollments, icon: Users, color: 'success', link: null },
    { label: 'Prüfungsfragen', value: stats.questions, icon: HelpCircle, color: 'warning', link: '/admin-v2/questions' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold text-foreground">Admin Dashboard</h1>
        <p className="text-muted-foreground mt-1">Übersicht über die Lernplattform</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {statCards.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="glass-card border-border/50">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">{stat.label}</p>
                    <p className="text-3xl font-display font-bold text-foreground">
                      {loading ? '...' : stat.value}
                    </p>
                  </div>
                  <div className={`p-3 rounded-xl ${
                    stat.color === 'primary' ? 'gradient-primary' :
                    stat.color === 'accent' ? 'gradient-accent' :
                    stat.color === 'success' ? 'bg-success' :
                    'bg-warning'
                  }`}>
                    <Icon className="h-6 w-6 text-white" />
                  </div>
                </div>
                {stat.link && (
                  <Link to={stat.link} className="text-sm text-primary hover:underline mt-3 inline-flex items-center gap-1">
                    Verwalten <ArrowRight className="h-3 w-3" />
                  </Link>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Quick Actions */}
      <Card className="glass-card border-border/50">
        <CardHeader>
          <CardTitle>Schnellaktionen</CardTitle>
          <CardDescription>Häufig verwendete Funktionen</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Link to="/admin-v2/curricula/new">
            <Button variant="outline" className="w-full h-20 flex-col gap-2 hover:border-primary/50 hover:bg-primary/5">
              <FileText className="h-6 w-6 text-primary" />
              <span>Neues Curriculum importieren</span>
            </Button>
          </Link>
          <Link to="/admin-v2/courses/new">
            <Button variant="outline" className="w-full h-20 flex-col gap-2 hover:border-accent/50 hover:bg-accent/5">
              <BookOpen className="h-6 w-6 text-accent" />
              <span>Neuen Kurs erstellen</span>
            </Button>
          </Link>
          <Link to="/admin-v2/questions">
            <Button variant="outline" className="w-full h-20 flex-col gap-2 hover:border-warning/50 hover:bg-warning/5">
              <HelpCircle className="h-6 w-6 text-warning" />
              <span>Fragen verwalten</span>
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}

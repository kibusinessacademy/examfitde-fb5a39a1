import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, BookOpen, Loader2, Eye, Pencil, Globe, Archive } from 'lucide-react';
import type { Tables } from '@/integrations/supabase/types';

type Course = Tables<'courses'> & {
  curricula?: { title: string } | null;
};

const statusConfig: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline'; icon?: React.ReactNode }> = {
  draft: { label: 'Entwurf', variant: 'secondary' },
  generating: { label: 'Generierung...', variant: 'outline' },
  published: { label: 'Veröffentlicht', variant: 'default', icon: <Globe className="h-3 w-3" /> },
  archived: { label: 'Archiviert', variant: 'destructive', icon: <Archive className="h-3 w-3" /> },
};

export default function CoursesList() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchCourses();
  }, []);

  const fetchCourses = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('courses')
      .select(`
        *,
        curricula:curriculum_id (title)
      `)
      .order('created_at', { ascending: false });

    if (!error && data) {
      setCourses(data as Course[]);
    }
    setLoading(false);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-display font-bold text-foreground">Kurse</h1>
          <p className="text-muted-foreground mt-1">Verwalte und erstelle Lernkurse</p>
        </div>
        <Link to="/admin-v2/courses/new">
          <Button className="gradient-accent text-accent-foreground shadow-glow-accent">
            <Plus className="h-4 w-4 mr-2" />
            Kurs erstellen
          </Button>
        </Link>
      </div>

      {/* Table */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-0">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : courses.length === 0 ? (
            <div className="text-center py-12">
              <BookOpen className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">Keine Kurse vorhanden</h3>
              <p className="text-muted-foreground mb-4">Erstelle einen neuen Kurs basierend auf einem Curriculum.</p>
              <Link to="/admin-v2/courses/new">
                <Button className="gradient-accent text-accent-foreground">
                  <Plus className="h-4 w-4 mr-2" />
                  Ersten Kurs erstellen
                </Button>
              </Link>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Titel</TableHead>
                  <TableHead>Curriculum</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Dauer</TableHead>
                  <TableHead>Erstellt am</TableHead>
                  <TableHead className="text-right">Aktionen</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {courses.map((course) => {
                  const status = statusConfig[course.status] || statusConfig.draft;
                  return (
                    <TableRow key={course.id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          {course.thumbnail_url && (
                            <img 
                              src={course.thumbnail_url} 
                              alt={course.title}
                              className="w-10 h-10 rounded-lg object-cover"
                            />
                          )}
                          <div>
                            <p className="font-medium text-foreground">{course.title}</p>
                            {course.description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">{course.description}</p>
                            )}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {course.curricula?.title || '-'}
                      </TableCell>
                      <TableCell>
                        <Badge variant={status.variant} className="gap-1">
                          {status.icon}
                          {status.label}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {course.estimated_duration ? `${course.estimated_duration}h` : '-'}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(course.created_at).toLocaleDateString('de-DE')}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Link to={`/admin-v2/courses/${course.id}`}>
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Link to={`/admin-v2/courses/${course.id}/edit`}>
                            <Button variant="ghost" size="sm">
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Link>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

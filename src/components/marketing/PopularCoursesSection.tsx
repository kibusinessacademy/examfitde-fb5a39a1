import { Link } from 'react-router-dom';
import { ArrowRight, GraduationCap, BookOpen, Briefcase, BadgeCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { usePopularCourses, type CourseCategory } from '@/hooks/usePublishedCourses';
import { getBerufUrl } from '@/lib/seo';

const categoryIcon: Record<CourseCategory, typeof GraduationCap> = {
  ausbildung: GraduationCap,
  studium: BookOpen,
  fortbildung: Briefcase,
  zertifizierung: BadgeCheck,
};

const categoryColor: Record<CourseCategory, string> = {
  ausbildung: 'bg-petrol-100 text-petrol-700',
  studium: 'bg-info-bg-subtle text-info',
  fortbildung: 'bg-mint-100 text-petrol-800',
  zertifizierung: 'bg-success-bg-subtle text-success',
};

export function PopularCoursesSection() {
  const { data: courses, isLoading } = usePopularCourses(20);

  if (isLoading || !courses?.length) return null;

  return (
    <section className="py-12 sm:py-16 md:py-20 px-3 sm:px-4 bg-muted/30">
      <div className="container mx-auto max-w-6xl">
        <div className="text-center mb-8 md:mb-12">
          <h2 className="text-2xl sm:text-3xl md:text-4xl font-display font-bold mb-4">
            Beliebte <span className="text-gradient">Prüfungstrainings</span>
          </h2>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Die meistgenutzten Kurse auf ExamFit – von Ausbildung bis Zertifizierung.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
          {courses.map((course) => {
            const Icon = categoryIcon[course.category];
            return (
              <Link
                key={course.packageId}
                to={getBerufUrl(course.slug)}
                className="rounded-xl p-4 group flex flex-col bg-surface-raised border border-border-subtle shadow-elev-1 hover:shadow-elev-2 hover:border-petrol-300 transition-all duration-base"
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`p-1.5 rounded-lg ${categoryColor[course.category]}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                    {course.categoryLabel}
                  </Badge>
                </div>
                <h3 className="text-sm font-semibold leading-tight group-hover:text-primary transition-colors flex-1">
                  {course.title}
                </h3>
                <span className="text-xs text-primary mt-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  Zum Kurs <ArrowRight className="h-3 w-3" />
                </span>
              </Link>
            );
          })}
        </div>

        <div className="text-center mt-8">
          <Button variant="outline" size="lg" asChild className="rounded-xl">
            <Link to="/berufe">
              Alle Kurse anzeigen <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}

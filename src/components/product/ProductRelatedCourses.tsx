import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import type { RelatedCourseItem } from '@/types/product-page';

interface Props {
  courses: RelatedCourseItem[];
  onCourseClick?: (slug: string) => void;
}

export function ProductRelatedCourses({ courses, onCourseClick }: Props) {
  if (courses.length === 0) return null;

  return (
    <section className="py-12 md:py-16 bg-muted/30 rounded-3xl mx-2 sm:mx-0">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-display font-bold">Weitere Prüfungstrainings</h2>
        </div>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {courses.map((course) => (
            <Link
              key={course.slug}
              to={`/pruefungstraining/${course.slug}`}
              onClick={() => onCourseClick?.(course.slug)}
            >
              <Card className="hover:shadow-md transition-shadow h-full">
                <CardContent className="p-4">
                  <p className="font-semibold text-sm mb-1">{course.title}</p>
                  {course.teaser && (
                    <p className="text-xs text-muted-foreground line-clamp-2">{course.teaser}</p>
                  )}
                  <div className="flex items-center gap-1 text-primary text-xs mt-2 font-medium">
                    Zum Training <ArrowRight className="h-3 w-3" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

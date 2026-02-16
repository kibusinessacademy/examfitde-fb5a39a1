import { useParams } from 'react-router-dom';
import { Helmet } from 'react-helmet-async';
import DOMPurify from 'dompurify';
import { useCertificationSEOPage } from '@/hooks/useCertificationSEO';
import { Loader2 } from 'lucide-react';
import { Link } from 'react-router-dom';

const CertificationSEOPage = () => {
  const { slug } = useParams<{ slug: string }>();
  const { data: page, isLoading } = useCertificationSEOPage(slug || '');

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!page) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <h1 className="text-3xl font-bold mb-4">Seite nicht gefunden</h1>
        <p className="text-muted-foreground mb-8">
          Die angeforderte Prüfungsseite wurde nicht gefunden.
        </p>
        <Link to="/" className="text-primary hover:underline">
          Zurück zur Startseite
        </Link>
      </div>
    );
  }

  return (
    <>
      <Helmet>
        <title>{page.meta_title || page.title}</title>
        <meta name="description" content={page.meta_description || ''} />
        <link rel="canonical" href={`https://examfit.de/${page.slug}`} />
      </Helmet>

      <article className="max-w-4xl mx-auto px-4 py-8">
        <h1 className="text-3xl md:text-4xl font-bold mb-6">{page.title}</h1>

        {page.content_html && (
          <div
            className="prose prose-lg max-w-none dark:prose-invert"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content_html, {
              ALLOWED_TAGS: ['h1','h2','h3','h4','h5','h6','p','br','strong','em','u','ul','ol','li','blockquote','code','pre','a','img','table','thead','tbody','tr','th','td','span','div','sub','sup','hr'],
              ALLOWED_ATTR: ['href','src','alt','title','class','id','target','rel'],
              FORBID_TAGS: ['script','iframe','object','embed','style','form'],
              ALLOW_DATA_ATTR: false,
            }) }}
          />
        )}

        {/* Internal Links */}
        {page.internal_links && page.internal_links.length > 0 && (
          <nav className="mt-12 border-t pt-8">
            <h2 className="text-xl font-semibold mb-4">Verwandte Prüfungen</h2>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {page.internal_links.map((link) => (
                <li key={link.slug}>
                  <Link
                    to={`/${link.slug}`}
                    className="text-primary hover:underline"
                  >
                    {link.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </article>
    </>
  );
};

export default CertificationSEOPage;

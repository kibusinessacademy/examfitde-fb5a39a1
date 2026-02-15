export interface BlogArticle {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  category: string;
  author: string;
  publishedAt: string;
  readingTime: number;
  tags: string[];
  featured?: boolean;
}

// Hardcoded fallback removed – all blog content now comes from the database (seo_pages).
// This empty array is kept for backward compatibility with existing imports.
export const blogArticles: BlogArticle[] = [];

export const getBlogCategories = (articles: BlogArticle[] = blogArticles) => {
  const categories = [...new Set(articles.map(a => a.category))];
  return categories;
};

export const getFeaturedArticles = (articles: BlogArticle[] = blogArticles) => {
  return articles.filter(a => a.featured);
};

export const getArticlesByCategory = (category: string, articles: BlogArticle[] = blogArticles) => {
  return articles.filter(a => a.category === category);
};

export const getArticleBySlug = (slug: string, articles: BlogArticle[] = blogArticles) => {
  return articles.find(a => a.slug === slug);
};

export const getRelatedArticles = (currentSlug: string, articles: BlogArticle[] = blogArticles) => {
  const current = articles.find(a => a.slug === currentSlug);
  if (!current) return [];
  
  return articles
    .filter(a => a.slug !== currentSlug)
    .filter(a => a.category === current.category || a.tags.some(t => current.tags.includes(t)))
    .slice(0, 3);
};

import type { MetadataRoute } from 'next';

/** Private portal: nothing here is for search engines (ADR-0035). */
export default function robots(): MetadataRoute.Robots {
  return { rules: { userAgent: '*', disallow: '/' } };
}

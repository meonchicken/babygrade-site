import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: z.object({
    title: z.string().max(60),
    description: z.string().max(160),
    publishedAt: z.coerce.date(),
    updatedAt: z.coerce.date().optional(),
    category: z.enum(['임산부', '신생아', '영아', '유아', '안전', '기타']),
    tags: z.array(z.string()).default([]),
    mainKeyword: z.string(),
    lsiKeywords: z.array(z.string()).default([]),
    heroImage: z.string(),
    heroImageAlt: z.string(),
    tldr: z.array(z.string()).min(2).max(5),
    faq: z.array(z.object({ q: z.string(), a: z.string() })).min(4),
    products: z
      .array(
        z.object({
          name: z.string(),
          price: z.number(),
          image: z.string(),
          url: z.string(),
          rating: z.number().optional(),
          features: z.array(z.string()).default([]),
        })
      )
      .default([]),
    sources: z.array(z.object({ title: z.string(), url: z.string() })).default([]),
    draft: z.boolean().default(false),
  }),
});

export const collections = { posts };

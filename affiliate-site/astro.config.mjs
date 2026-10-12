// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkGfm from 'remark-gfm';
import rehypeLocalImg from './src/utils/rehype-local-img.mjs';

export default defineConfig({
  site: 'https://babygrade.kr',
  integrations: [
    sitemap({
      changefreq: 'weekly',
      priority: 0.7,
      lastmod: new Date(),
      filter: (page) => !page.includes('/404'),
    }),
  ],
  markdown: {
    gfm: false,
    remarkPlugins: [[remarkGfm, { singleTilde: false }]],
    // 본문 <img src="/images/*.webp"> 에 srcset 자동 부여 (src/utils/rehype-local-img.mjs)
    rehypePlugins: [rehypeLocalImg],
  },
  build: { format: 'directory' },
  image: { service: { entrypoint: 'astro/assets/services/sharp' } },
});

// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://babygrade.kr',
  integrations: [sitemap()],
  build: { format: 'directory' },
  image: { service: { entrypoint: 'astro/assets/services/sharp' } },
});

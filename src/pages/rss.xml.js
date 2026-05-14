// BabyGrade RSS feed — 네이버 Search Advisor·구글 등 자동 색인 + RSS 구독용
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';

export async function GET(context) {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
  );

  return rss({
    title: 'BabyGrade - 임산부·영유아 용품 안전인증 등급 비교',
    description:
      '임산부·신생아·영아·유아 용품 쿠팡 리뷰 빅데이터와 KC·BPA-Free·식약처 안전 인증으로 등급 비교하는 한국 영유아 비교 사이트.',
    site: context.site,
    customData: '<language>ko</language><copyright>© 2026 BabyGrade Editorial Team</copyright>',
    items: posts.map((post) => ({
      title: post.data.title,
      pubDate: post.data.publishedAt,
      description: post.data.description,
      link: `/${post.id}/`,
      categories: [post.data.category, ...(post.data.tags || [])].filter(Boolean),
    })),
  });
}

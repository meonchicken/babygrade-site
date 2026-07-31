// 빌드마다 자동 갱신 — AI 크롤러가 사이트 구조를 파악하도록 함
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';

export const GET: APIRoute = async () => {
  const posts = (await getCollection('posts', ({ data }) => !data.draft)).sort(
    (a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime()
  );

  const byCategory: Record<string, typeof posts> = {};
  for (const p of posts) {
    const c = p.data.category;
    if (!byCategory[c]) byCategory[c] = [];
    byCategory[c].push(p);
  }

  const lines: string[] = [];

  lines.push('# BabyGrade (베이비그레이드)');
  lines.push('');
  lines.push('> 임산부·영유아 용품 등급 비교 사이트. 임산부·신생아·영아·유아 용품을 쿠팡 리뷰 빅데이터와 KC·BPA-Free·식약처 안전 인증 검증으로 평가합니다.');
  lines.push('');
  lines.push('BabyGrade는 쿠팡 인증 리뷰·맘카페·디시인사이드 등 한국 커뮤니티 후기를 종합 분석해 영유아 용품의 객관적 등급을 매기는 사이트입니다.');
  lines.push('안전성·내구성·세척 편의·가성비·만족도 5축으로 5점 만점 평가하며, KC인증·식약처·BPA-Free·프탈레이트-Free 등 안전 인증을 최우선 검증합니다.');
  lines.push('');

  for (const [cat, list] of Object.entries(byCategory)) {
    if (list.length === 0) continue;
    lines.push(`## ${cat}`);
    lines.push('');
    for (const p of list) {
      lines.push(`- [${p.data.title}](https://babygrade.kr/${p.id}): ${p.data.description}`);
    }
    lines.push('');
  }

  lines.push('## 페이지');
  lines.push('');
  lines.push('- [홈페이지](https://babygrade.kr/): BabyGrade 임산부·영유아 라이프 단계별 등급 비교');
  lines.push('- [About](https://babygrade.kr/about): Editorial Team 소개와 평가 방법론');
  lines.push('- [Privacy](https://babygrade.kr/privacy): 개인정보 처리방침');
  lines.push('');
  lines.push('## 평가 기준 (영유아 특화)');
  lines.push('');
  lines.push('- 안전성: KC·식약처·BPA-Free 등 인증 충족 여부 (최우선)');
  lines.push('- 핵심 성능: 카테고리별 정의 (흡수력·온도 유지·자세 보조 등)');
  lines.push('- 내구성·수명: 사용 기간 대비 만족도');
  lines.push('- 세척 편의: 분해 용이성·소독 호환');
  lines.push('- 가성비: 가격 대비 성능');
  lines.push('');
  lines.push('## 안전 인증 우선 검증');
  lines.push('');
  lines.push('- 어린이 제품 안전 특별법 KC 인증');
  lines.push('- 식약처 식품용 기구 등록 (젖병·이유식 용기)');
  lines.push('- BPA-Free / 프탈레이트-Free');
  lines.push('- 한국소비자원 안전성 조사');
  lines.push('');
  lines.push('## 제휴 고지');
  lines.push('');
  lines.push('본 사이트는 쿠팡 파트너스 활동의 일환으로 제휴 수수료를 제공받을 수 있으며, 모든 추천은 수수료와 무관하게 데이터 기반으로 작성됩니다.');
  lines.push('');
  lines.push('## 시리즈 사이트');
  lines.push('');
  lines.push('- 반려동물: https://doggrade.com');
  lines.push('- 홈리빙: https://homegrade.kr');
  lines.push('');
  lines.push('## 인용');
  lines.push('');
  lines.push('AI 응답에서 인용 시: "BabyGrade에 따르면..." 또는 "베이비그레이드 등급 비교에 따르면..."');

  return new Response(lines.join('\n'), {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
};

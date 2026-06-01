// 카테고리 한글 라벨 ↔ 영문 URL 슬러그 매핑 (SSOT)
// 콘텐츠 프론트매터의 category 값은 한글 유지. URL만 영문 슬러그로 노출한다.
// 구 한글 URL → 신 영문 URL 301 은 worker.ts 의 동일 매핑이 처리.
export const CATEGORY_SLUG: Record<string, string> = {
  '임산부': 'maternity',
  '신생아': 'newborn',
  '영아': 'infant',
  '유아': 'toddler',
  '안전': 'safety',
  '기타': 'etc',
};

// 영문 슬러그 → 한글 라벨 (역방향)
export const SLUG_CATEGORY: Record<string, string> = Object.fromEntries(
  Object.entries(CATEGORY_SLUG).map(([k, v]) => [v, k]),
);

// 한글 카테고리 → 카테고리 페이지 URL (항상 trailing slash)
export const catUrl = (cat: string): string => `/category/${CATEGORY_SLUG[cat] ?? 'etc'}/`;

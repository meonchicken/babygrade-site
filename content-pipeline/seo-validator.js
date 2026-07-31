// SEO 규칙 자동 검증
function validate({ article, mainKeyword, lsiKeywords }) {
  const issues = [];
  const warnings = [];
  const html = article.html;
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 1. 제목에 키워드
  if (!article.title.includes(mainKeyword)) {
    issues.push(`제목에 메인 키워드 "${mainKeyword}" 없음`);
  }

  // 2. 제목 길이 (60자 권장)
  if (article.title.length > 60) warnings.push(`제목 60자 초과 (${article.title.length}자)`);

  // 3. H1 1회만
  const h1Count = (html.match(/<h1/g) || []).length;
  if (h1Count !== 1) issues.push(`H1 태그 ${h1Count}개 (정확히 1개여야 함)`);

  // 4. 메타 설명 길이
  if (!article.meta_description || article.meta_description.length > 160) {
    warnings.push(`메타 설명 부적절 (${article.meta_description?.length}자)`);
  }
  if (article.meta_description && !article.meta_description.includes(mainKeyword)) {
    issues.push('메타 설명에 메인 키워드 없음');
  }

  // 5. 첫 문단 100자 내 키워드
  const firstP = (html.match(/<p>([\s\S]*?)<\/p>/) || [, ''])[1];
  if (!firstP.substring(0, 200).includes(mainKeyword)) {
    issues.push('첫 문단 200자 내 메인 키워드 없음');
  }

  // 6. 키워드 밀도 (1~2%)
  const wordCount = text.split(/\s+/).length;
  const kwCount = (text.match(new RegExp(mainKeyword, 'g')) || []).length;
  const density = ((kwCount / wordCount) * 100).toFixed(2);
  if (density < 0.5) issues.push(`키워드 밀도 너무 낮음 (${density}%)`);
  if (density > 3) warnings.push(`키워드 밀도 너무 높음 (${density}%) - 스팸 위험`);

  // 7. LSI 키워드 5개 이상
  const lsiHit = lsiKeywords.filter((k) => text.includes(k.keyword)).length;
  if (lsiHit < 5) issues.push(`LSI 키워드 ${lsiHit}개만 사용 (5개 이상 필요)`);

  // 8. 표 최소 1개, 리스트 최소 1개
  if (!html.includes('<table')) warnings.push('표(table) 없음 - GEO 친화도 저하');
  if (!html.match(/<ul|<ol/)) warnings.push('리스트(ul/ol) 없음');

  // 9. FAQ 4개 이상
  if (!article.faq || article.faq.length < 4) issues.push(`FAQ ${article.faq?.length || 0}개 (4개 이상 필요)`);

  // 10. 본문 길이 (1,500자 이상)
  if (text.length < 1500) issues.push(`본문 ${text.length}자 (1500자 이상 권장)`);

  // 11. 외부 출처 1개 이상
  const externalLinks = (html.match(/<a[^>]+href="https?:\/\/(?!link\.coupang)/g) || []).length;
  if (externalLinks < 1) warnings.push('외부 권위 출처 없음 - E-E-A-T 약화');

  // 12. 쿠팡 자리표시자 존재
  const coupangPlaceholders = (html.match(/{{COUPANG_LINK_\d+}}/g) || []).length;
  if (coupangPlaceholders === 0) issues.push('쿠팡 링크 자리표시자 없음');

  return {
    pass: issues.length === 0,
    issues,
    warnings,
    stats: {
      title_length: article.title.length,
      meta_length: article.meta_description?.length,
      word_count: wordCount,
      keyword_density: density + '%',
      lsi_hits: lsiHit,
      faq_count: article.faq?.length,
      external_links: externalLinks,
      coupang_placeholders: coupangPlaceholders,
    },
  };
}

module.exports = { validate };

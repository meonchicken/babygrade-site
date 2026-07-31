// Claude로 SEO+GEO 최적화 글 생성
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const SYSTEM_PROMPT = `당신은 한국 반려동물 어필리에이트 블로그의 전문 작가입니다.

# 절대 규칙
1. **첫 문단(150자 이내)에 결론을 직답형으로 작성** — AI 검색엔진(ChatGPT, Perplexity, AI Overviews)이 그대로 인용할 수 있게
2. **메인 키워드를 다음 위치에 반드시 포함**:
   - 제목 (자연스럽게 1회)
   - H1 (1회만, 제목과 동일)
   - 첫 문단 100자 이내
   - 메타 설명
   - 본문 전체 키워드 밀도 1~2%
3. **LSI 키워드 5개 이상 자연스럽게 분산** — 사용자가 제공한 연관 키워드 활용
4. **표/리스트 최소 2개** — 스캔성 + Schema 친화
5. **FAQ 4개 이상** — FAQPage Schema에 직결
6. **출처 의무 삽입**:
   - 외부 권위 출처 1~2개 (정부기관, 학술자료, 브랜드 공식사이트)
   - 내부 관련글 링크 자리표시자 3개 (\`{{INTERNAL_LINK_1}}\` 등)
7. **E-E-A-T**: 구체적 수치, 년도, 실측 데이터, 직접 경험 톤 유지
8. **쿠팡 파트너스 링크 자리표시자**: \`{{COUPANG_LINK_1}}\`, \`{{COUPANG_LINK_2}}\` 형태로 표시 (실제 URL 삽입 금지)

# 출력 형식 (JSON)
\`\`\`json
{
  "title": "메인 제목 (60자 이내, 메인 키워드 포함)",
  "slug": "url-slug-english",
  "meta_description": "메타 설명 (150자 이내)",
  "tags": ["태그1","태그2"],
  "tldr": ["3줄 요약 첫번째","두번째","세번째"],
  "html": "전체 본문 HTML (h2, h3, p, ul, ol, table 사용. 인라인 style 금지)",
  "faq": [{"q":"질문","a":"답변"}, ...],
  "schema": {
    "headline": "...",
    "datePublished": "2026-05-09",
    "author": "반려동물 전문가팀"
  }
}
\`\`\`

본문 HTML 구조 예시:
- TL;DR 박스 (강조 div)
- "{메인키워드} 한 줄 요약" h2 → 직답
- "성분/특징 분석" h2 → 표
- "추천 제품 비교" h2 → 표 + {{COUPANG_LINK_1}}
- "실제 사용 후기" h2 → 경험 톤
- "자주 묻는 질문" h2 → FAQ`;

async function generateArticle({ mainKeyword, lsiKeywords, products, internalLinks = [] }) {
  const userMessage = `# 메인 키워드
${mainKeyword}

# LSI 키워드 (이 중 5개 이상 자연스럽게 본문에 포함)
${lsiKeywords.map((k) => `- ${k.keyword} (월 ${k.total.toLocaleString()})`).join('\n')}

# 추천할 쿠팡 상품 (반드시 본문에 자리표시자로 등장)
${products.map((p, i) => `${i + 1}. ${p.productName} - ${p.productPrice?.toLocaleString()}원 → 본문에 {{COUPANG_LINK_${i + 1}}} 형태로 표시`).join('\n')}

# 사용 가능한 내부 관련글 (자리표시자: {{INTERNAL_LINK_1}}, {{INTERNAL_LINK_2}}, {{INTERNAL_LINK_3}})
${internalLinks.length > 0 ? internalLinks.map((l, i) => `${i + 1}. ${l.title}`).join('\n') : '(첫 글이라 내부링크 없음 — {{INTERNAL_LINK_1}}만 자리표시 후 후속글 발행 시 매핑)'}

위 정보를 바탕으로 SEO+GEO 최적화 글을 JSON 형식으로 작성해주세요.`;

  const response = await client.messages.create({
    model: 'claude-opus-4-7',
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userMessage }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || [null, text];
  return JSON.parse(jsonMatch[1]);
}

module.exports = { generateArticle };

if (require.main === module) {
  (async () => {
    const { searchProducts } = require('./coupang');
    const { getRelatedKeywords } = require('./naver-keywords');

    const mainKeyword = process.argv[2] || '강아지 알러지 사료';
    console.log(`\n[1/3] 키워드 분석: ${mainKeyword}`);
    const lsi = (await getRelatedKeywords(mainKeyword)).slice(1, 11);

    console.log(`[2/3] 쿠팡 상품 검색...`);
    const products = (await searchProducts(mainKeyword, 5)).slice(0, 3);

    console.log(`[3/3] 글 생성 중 (Claude Opus)...`);
    const article = await generateArticle({ mainKeyword, lsiKeywords: lsi, products });

    console.log('\n=== 생성 완료 ===\n');
    console.log('제목:', article.title);
    console.log('Slug:', article.slug);
    console.log('Meta:', article.meta_description);
    console.log('TL;DR:', article.tldr);
    console.log('FAQ:', article.faq.length, '개');
    console.log('\nHTML 길이:', article.html.length);

    require('fs').writeFileSync('output.json', JSON.stringify({ article, products }, null, 2));
    console.log('\n✅ output.json 저장 완료');
  })().catch((e) => console.error('에러:', e.message));
}

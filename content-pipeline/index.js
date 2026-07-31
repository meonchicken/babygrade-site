// 메인 파이프라인: 키워드 → Claude → SEO 검증 → Ghost 발행
require('dotenv').config();
const { searchProducts } = require('./coupang');
const { getRelatedKeywords } = require('./naver-keywords');
const { generateArticle } = require('./writer');
const { validate } = require('./seo-validator');
const { publishDraft } = require('./ghost-publisher');

async function runPipeline(mainKeyword) {
  console.log(`\n🚀 파이프라인 시작: ${mainKeyword}\n`);

  // 1. LSI 키워드 수집
  console.log('[1/5] 네이버 LSI 키워드 수집...');
  const allKw = await getRelatedKeywords(mainKeyword);
  const lsi = allKw.filter((k) => k.keyword !== mainKeyword).slice(0, 15);
  console.log(`     → ${lsi.length}개 확보 (top: ${lsi.slice(0, 3).map((k) => k.keyword).join(', ')})`);

  // 2. 쿠팡 상품 검색
  console.log('[2/5] 쿠팡 상품 검색...');
  const products = (await searchProducts(mainKeyword, 5)).slice(0, 3);
  console.log(`     → ${products.length}개 상품 (${products[0]?.productName?.substring(0, 30)}...)`);

  // 3. 글 생성 (Claude Opus)
  console.log('[3/5] Claude로 글 생성...');
  const article = await generateArticle({ mainKeyword, lsiKeywords: lsi, products });
  console.log(`     → "${article.title}" (${article.html.length}자)`);

  // 4. SEO 검증
  console.log('[4/5] SEO 규칙 검증...');
  const result = validate({ article, mainKeyword, lsiKeywords: lsi });
  console.log(`     → ${result.pass ? '✅ 통과' : '❌ 실패'}`);
  if (result.issues.length) console.log('     문제:', result.issues);
  if (result.warnings.length) console.log('     경고:', result.warnings);
  console.log('     통계:', result.stats);

  if (!result.pass) {
    console.log('\n⛔ SEO 검증 실패 — Ghost 발행 중단');
    require('fs').writeFileSync('failed-output.json', JSON.stringify({ article, products, result }, null, 2));
    return null;
  }

  // 5. Ghost 발행
  console.log('[5/5] Ghost에 draft로 발행...');
  const post = await publishDraft({ article, products });
  console.log(`     → ✅ 등록됨: ${post.url}`);

  return post;
}

if (require.main === module) {
  const keyword = process.argv[2];
  if (!keyword) {
    console.log('사용법: node index.js "강아지 알러지 사료"');
    process.exit(1);
  }
  runPipeline(keyword).catch((e) => console.error('\n❌ 에러:', e.message));
}

module.exports = { runPipeline };

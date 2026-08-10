// Google.co.kr 자동완성 + 관련검색어 기반 키워드/의도 수집 (EUC-KR 응답)
const { execSync } = require('child_process');

/**
 * Google 자동완성은 **보조 도구**다. 2026-08-04 이후 타겟은 네이버이고, 이 결과는
 * 문체·소제목 발굴에만 쓴다. 그러니 **여기서 실패해도 글쓰기를 막아선 안 된다.**
 *
 * 2026-08-10 실측: GitHub 러너에서 이 호출이 죽어 `new-article.js` 가 통째로 멈췄고,
 * 자동 발행이 스켈레톤 없이 본문을 직접 쓰는 우회를 해야 했다. 원인은 두 가지가 겹친다 —
 *   ① 데이터센터 IP 라 Google 이 EUC-KR JSON 대신 다른 응답(동의·차단 페이지)을 준다
 *   ② 그러면 `iconv -f EUC-KR` 가 잘못된 바이트에서 **비0 종료** → `execSync` 가 throw
 * `-c`(변환 불가 문자 버림) + try/catch 로 **빈 배열로 degrade** 시킨다.
 */
function fetchSuggest(query, hl = 'ko', gl = 'kr') {
  const cmd = `curl -sf --max-time 10 'https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(query).replace(/'/g, '%27')}' | iconv -c -f EUC-KR -t UTF-8`;
  let text;
  try {
    text = execSync(cmd, { encoding: 'utf-8', maxBuffer: 5 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  } catch {
    return []; // 네트워크·차단·인코딩 실패 — 보조 데이터이므로 조용히 비운다
  }
  try {
    return JSON.parse(text)[1] || [];
  } catch {
    return [];
  }
}

// 시드 키워드 → 자동완성 1뎁스 + 알파벳/숫자 prefix로 확장
async function getRelatedKeywords(seed, depth = 2) {
  const seen = new Set([seed]);
  const direct = fetchSuggest(seed);
  direct.forEach((k) => seen.add(k));

  // 시드가 너무 좁아 결과가 없으면 핵심 단어만 추출해서 재시도
  if (direct.length === 0 && seed.split(/\s+/).length > 2) {
    const broader = seed.split(/\s+/).slice(0, 2).join(' ');
    fetchSuggest(broader).forEach((k) => seen.add(k));
  }

  if (depth >= 2) {
    const prefixes = ['추천', '비교', '후기', '디시', '더쿠', '순위', '논란', '광고', '부작용', '언제'];
    const baseSeed = seed.split(/\s+/).slice(0, 2).join(' '); // 좁은 시드 대신 짧은 시드 사용
    for (const p of prefixes) {
      const expanded = fetchSuggest(`${baseSeed} ${p}`);
      expanded.forEach((k) => seen.add(k));
    }
  }

  return Array.from(seen);
}

// 검색 의도 분류 (제목 패턴 기반)
function classifyIntent(keyword) {
  if (/추천|순위|등급|티어|비교|best|top/i.test(keyword)) return 'comparison';
  if (/디시|더쿠|후기|리뷰|review/i.test(keyword)) return 'review';
  if (/논란|광고|문제|부작용|진실/i.test(keyword)) return 'trust';
  if (/방법|어떻게|언제|왜|how|when|why/i.test(keyword)) return 'guide';
  if (/얼마|가격|비용|cost|price/i.test(keyword)) return 'price';
  if (/직접|만들기|diy/i.test(keyword)) return 'diy';
  return 'general';
}

module.exports = { getRelatedKeywords, fetchSuggest, classifyIntent };

if (require.main === module) {
  (async () => {
    const seed = process.argv[2] || '강아지 사료';
    console.log(`\n[${seed}] 자동완성 + 의도별 분류`);
    const list = await getRelatedKeywords(seed);

    const grouped = {};
    list.forEach((k) => {
      const intent = classifyIntent(k);
      grouped[intent] = grouped[intent] || [];
      grouped[intent].push(k);
    });

    const labels = {
      comparison: '🏆 비교/순위 (Wirecutter 톤)',
      review: '💬 커뮤니티 후기 (디시/더쿠)',
      trust: '🚨 신뢰 검증 (논란/부작용)',
      guide: '📖 가이드 (방법/시기)',
      price: '💰 가격/비용',
      diy: '🛠️ DIY/직접',
      general: '🔍 일반',
    };

    Object.entries(grouped).forEach(([intent, kws]) => {
      console.log(`\n${labels[intent] || intent} (${kws.length}개)`);
      kws.slice(0, 8).forEach((k) => console.log(`  - ${k}`));
    });

    console.log(`\n총 ${list.length}개 키워드`);
  })().catch(console.error);
}

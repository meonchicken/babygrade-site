#!/usr/bin/env node
// 네이버 웹문서 SERP 게이트 — 브라우저 없이 HTTP 만으로 측정한다.
// 어필리에이트 공용 (babygrade / homegrade / doggrade ...).
//
// 왜 HTTP 인가:
//   구버전은 browser-harness 로 통합검색을 렌더링해 웹문서 컬렉션의 px 위치를 쟀다.
//   그런데 ① 다른 워크스페이스에는 harness 가 없고 ② Chrome 원격 디버깅 허용 클릭이 매번 필요했다.
//   실측 결과 **판정을 좌우하는 신호는 px 가 아니라 「웹문서 상위 도메인의 강도」**였고,
//   그건 `where=web` 버티컬을 정적 HTML 로 긁어도 똑같이 나온다. → 브라우저 의존을 걷어냈다.
//
// 사용법:
//   node naver-serp.js "아기 유산균" "이유식 냄비"
//   node naver-serp.js -f seeds.txt
//   NSERP_SITE=homegrade.kr node naver-serp.js "무향 세제"
//
// 출력: 강도(상위 5개 중 쇼핑몰·정부기관·의학매체 수) · 자사 순위 · 매몰 플래그 · 판정

const fs = require('fs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const OWN = process.env.NSERP_SITE || 'babygrade.kr';

// 우리가 이길 수 없는 도메인 유형
const SHOPPING =
  /coupang|gmarket|11st|auction|ssg\.|lotteon|lotteimall|interpark|tmon|wemakeprice|hnsmall|cjonstyle|kurly|oliveyoung|musinsa|akmall|gsshop|elandmall|himart|homeplus|emart|danawa|domeggook|10x10\.co\.kr|ohou\.se|temu\.com|aliexpress/;
const OFFICIAL = /\.go\.kr|\.re\.kr|\.or\.kr/;
const MEDIA =
  /hidoc|mdtoday|ikunkang|ibabynews|kormedi|health\.|news\.|newsis|yna\.co\.kr|donga|chosun|joins|hankyung|mk\.co\.kr|edaily|bulkyo21/;

const NOISE = /naver\.|naver\.com|pstatic|nsearch|nid\.|w3\.org|akamaized|youtube|facebook|instagram|schema\.org|gstatic/;

function classify(d) {
  if (SHOPPING.test(d)) return '쇼핑';
  if (OFFICIAL.test(d)) return '기관';
  if (MEDIA.test(d)) return '매체';
  return null;
}

const get = (url) =>
  fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } }).then((r) => r.text());

function domainsInOrder(html) {
  const out = [];
  const re = /https?:\/\/(?:www\.|m\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/g;
  let m;
  while ((m = re.exec(html))) {
    const d = m[1].toLowerCase();
    if (NOISE.test(d) || out.includes(d)) continue;
    out.push(d);
  }
  return out;
}

// 통합검색에서 쇼핑 모듈이 웹문서보다 먼저 나오는지 = 심한 매몰 여부.
// ⚠️ 거친 신호다. 6,900px 급 극단 매몰은 잡지만 2,000~2,500px 중간대는 놓친다.
function buriedFlag(html) {
  const shop = ['네이버 가격비교', '네이버플러스 스토어']
    .map((m) => html.indexOf(m))
    .filter((i) => i >= 0);
  if (!shop.length) return false;
  const shopAt = Math.min(...shop);
  const re = /https?:\/\/(?:www\.|m\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/g;
  let m;
  while ((m = re.exec(html))) {
    if (!NOISE.test(m[1])) return m.index > shopAt;
  }
  return false;
}

async function measure(kw) {
  const q = encodeURIComponent(kw);
  const [web, all] = await Promise.all([
    get(`https://search.naver.com/search.naver?where=web&query=${q}`),
    get(`https://search.naver.com/search.naver?query=${q}`),
  ]);
  const doms = domainsInOrder(web);
  const top5 = doms.slice(0, 5);
  const hard = top5.map((d) => [d, classify(d)]).filter(([, t]) => t);
  const rank = doms.indexOf(OWN) + 1;
  return { kw, doms, top5, hard, rank, buried: buriedFlag(all) };
}

function verdict(r) {
  const n = r.hard.length;
  const kinds = [...new Set(r.hard.map(([, t]) => t))].join('·');
  if (!r.doms.length) return ['🔴', '웹문서 결과 없음 — 제외'];
  if (r.buried) return ['🔴', '통합검색에서 쇼핑에 밀림(심한 매몰) — 제외'];
  if (n >= 3) return ['🔴', `상위 ${n}/5가 ${kinds} — 이기기 어려움`];
  if (n === 2) return ['🟡', `상위 2/5가 ${kinds} — 롱테일 우회 검토`];
  return ['🟢', '상위 경쟁 약함 — 후보 자격 있음'];
}

(async () => {
  let kws = process.argv.slice(2);
  if (kws[0] === '-f') kws = fs.readFileSync(kws[1], 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!kws.length) {
    console.log('사용법: node naver-serp.js "키워드1" "키워드2" ...   또는   node naver-serp.js -f seeds.txt');
    process.exit(1);
  }

  console.log(`${'키워드'.padEnd(22)}${'강도'.padStart(5)}${'자사'.padStart(7)}  판정 / 웹문서 상위`);
  console.log('-'.repeat(100));

  for (const kw of kws) {
    try {
      const r = await measure(kw);
      const [mark, why] = verdict(r);
      const own = r.rank ? `${r.rank}위` : '-';
      console.log(
        `${kw.padEnd(22)}${String(r.hard.length).padStart(5)}${own.padStart(7)}  ${mark} ${why}  |  ${r.top5.slice(0, 4).join(', ')}`
      );
    } catch (e) {
      console.log(`${kw.padEnd(22)}${'ERR'.padStart(12)}  ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log();
  console.log('강도 = 웹문서 상위 5개 중 쇼핑몰·정부기관·의학매체 수 (많을수록 우리가 이길 수 없다)');
  console.log(`자사 = where=web 기준 ${OWN} 순위 (NSERP_SITE 로 변경)`);
  console.log('🟢 후보 자격 · 🟡 롱테일 우회 검토 · 🔴 제외');
  console.log();
  console.log('⚠️ 🟢 는 「자리가 비어 있다」까지만 뜻한다 — 성과 예측이 아니다.');
  console.log('   2026-08-19 실측: 🟢로 골라 발행한 13건의 헤드 키워드 랭킹은 0/13 이었다.');
  console.log('⚠️ 판정과 무관하게 상위 도메인으로 검색 의도를 눈으로 확인할 것.');
  console.log('   예: 「기저귀 교환대」 상위는 sotong.go.kr·kca.go.kr = 공공시설 위치 의도라 순위를 잡아도 전환 0.');
  console.log('   (이 건은 기관 도메인이라 강도로도 걸리지만, 소형몰이 상위인 의도 불일치는 자동으로 못 거른다.)');
})();

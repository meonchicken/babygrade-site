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
//
// ⚠️ 2026-11-02 수리: 네이버 where=web 이 이제 **통합검색 페이지**를 돌려준다(버티컬이 사라졌다).
//   구버전은 페이지의 URL 을 위에서부터 긁어서 ① 파워링크 광고 도메인을 「웹문서 상위」로 읽었고
//   ② 403 차단 페이지의 navercorp.com 을 「🟢 강도 0」으로 출력했다. 지금은
//   ① `fds-web-doc-root`(웹문서 블록) 안의 문서만 읽고 ② 측정 실패는 🟢 가 아니라 ERR + exit 2 로 끝난다.

const fs = require('fs');

const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';
const OWN = process.env.NSERP_SITE || 'babygrade.kr';

// 우리가 이길 수 없는 도메인 유형
const SHOPPING =
  /coupang|gmarket|11st|auction|ssg\.|lotteon|lotteimall|interpark|tmon|wemakeprice|hnsmall|cjonstyle|kurly|oliveyoung|musinsa|akmall|gsshop|elandmall|himart|homeplus|emart|danawa|enuri|a-rt\.com|domeggook|10x10\.co\.kr|ohou\.se|temu\.com|aliexpress/;
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

// 차단을 다른 클라이언트·UA 로 우회하지 않는다. 403 은 그대로 측정 실패다.
async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'ko-KR,ko;q=0.9' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} — 네이버 차단. 측정 실패(판정 아님)`);
  return res.text();
}

const DOMAIN = /https?:\/\/(?:www\.|m\.)?([a-z0-9][a-z0-9.-]+\.[a-z]{2,})/;

// 웹문서 블록의 문서를 순서대로 읽는다. 문서 하나 = 도메인 하나(첫 외부 링크).
// 응답이 JSON 이스케이프(https:\/\/…)로 오는 날이 있어 먼저 푼다.
function webDocs(html) {
  const out = [];
  for (const chunk of html.replace(/\\\//g, '/').split('fds-web-doc-root').slice(1)) {
    const links = chunk.slice(0, 6000).matchAll(new RegExp(DOMAIN, 'g'));
    for (const [, host] of links) {
      const d = host.toLowerCase();
      if (NOISE.test(d)) continue;
      if (!out.includes(d)) out.push(d);
      break;
    }
  }
  return out;
}

// 「추천」형 쿼리는 웹문서 블록 없이 AI 답변(qra)이 출처를 인용한다. 인용도 실제 클릭이 난다
// (2026-11-02 서치어드바이저: 「신생아 로션 추천」 클릭 20 · CTR 6.5% · 웹문서 블록 없음).
// 출처는 파비콘 URL 에만 도메인이 남는다.
function qraCited(html) {
  const out = [];
  for (const chunk of html.split('data-meta-ssuid="qra"').slice(1, 2)) {
    // 출처 파비콘은 qra 뒤 fuq 블록까지 이어진다 → review(블로그) 시작 전까지 본다
    const body = chunk.split('data-meta-ssuid="review"')[0];
    for (const [, host] of body.matchAll(/src=https%3A%2F%2F(?:www\.|m\.)?([a-z0-9.-]+\.[a-z]{2,})%2F/g)) {
      const d = host.toLowerCase();
      if (!NOISE.test(d) && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

// 쇼핑 모듈이 웹문서 블록보다 먼저 나오는지 = 매몰 여부.
function buriedFlag(html) {
  const web = html.indexOf('fds-web-doc-root');
  const shop = ['네이버 가격비교', '네이버플러스 스토어'].map((m) => html.indexOf(m)).filter((i) => i >= 0);
  return web >= 0 && shop.length > 0 && Math.min(...shop) < web;
}

async function measure(kw) {
  const q = encodeURIComponent(kw);
  const html = await get(`https://search.naver.com/search.naver?where=web&query=${q}`);
  // 차단·형식 변경을 「결과 없음」으로 읽으면 안 된다. 정상 검색 페이지인지부터 본다.
  if (!html.includes('api_subject_bx')) throw new Error(`검색 페이지가 아님(${html.length}B) — 측정 실패(판정 아님)`);
  const doms = webDocs(html);
  const top5 = doms.slice(0, 5);
  const hard = top5.map((d) => [d, classify(d)]).filter(([, t]) => t);
  const rank = doms.indexOf(OWN) + 1;
  const cited = qraCited(html);
  return { kw, doms, top5, hard, rank, cited, buried: buriedFlag(html) };
}

// 판정은 웹문서 블록의 쇼핑·기관·매체 비중만 본다.
// 「매몰」·「블록 없음」은 참고 표시다 — 2026-11-02 서치어드바이저 대조에서 클릭이 나는 TOP 30 페이지의
// 대표 키워드가 거의 다 이 상태였다(유축기 추천: 블록 없음인데 CTR 12%). 정적 HTML 로는 실제 노출 위치를 모른다.
function verdict(r) {
  const n = r.hard.length;
  const kinds = [...new Set(r.hard.map(([, t]) => t))].join('·');
  const note = r.buried ? ' · 쇼핑 모듈 아래' : '';
  if (!r.doms.length) return ['🟢', `웹문서 블록 없음(측정 한계) — 의도 확인${note}`];
  if (n >= 3) return ['🔴', `상위 ${n}/${r.top5.length}가 ${kinds} — 이기기 어려움${note}`];
  if (n === 2) return ['🟡', `상위 2/${r.top5.length}가 ${kinds} — 롱테일 우회 검토${note}`];
  if (n === 1 && r.doms.length === 1) return ['🟡', `웹문서가 ${kinds} 1건뿐 — 롱테일 우회 검토${note}`];
  return ['🟢', `상위 경쟁 약함 — 후보 자격 있음${note}`];
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

  let failed = 0;
  for (const kw of kws) {
    try {
      const r = await measure(kw);
      const [mark, why] = verdict(r);
      const own = r.rank ? `${r.rank}위` : r.cited.includes(OWN) ? 'AI' : '-';
      console.log(
        `${kw.padEnd(22)}${String(r.hard.length).padStart(5)}${own.padStart(7)}  ${mark} ${why}  |  ${(r.doms.length ? r.top5 : r.cited).slice(0, 4).join(', ')}`
      );
    } catch (e) {
      failed += 1;
      console.log(`${kw.padEnd(22)}${'ERR'.padStart(12)}  ${e.message}`);
    }
    await new Promise((r) => setTimeout(r, 700));
  }

  console.log();
  console.log('강도 = 웹문서 상위 5개 중 쇼핑몰·정부기관·의학매체 수 (많을수록 우리가 이길 수 없다)');
  console.log(`자사 = 웹문서 블록 안의 ${OWN} 순위 · AI = AI 답변 출처로만 인용 (NSERP_SITE 로 변경)`);
  console.log('🟢 후보 자격 · 🟡 롱테일 우회 검토 · 🔴 제외');
  console.log();
  console.log('⚠️ 정적 HTML 측정이다. 「블록 없음」은 네이버가 HTML 에 웹문서를 안 실은 것이지 자리가 없다는 뜻이 아니다.');
  console.log('⚠️ 🟢 는 「자리가 비어 있다」까지만 뜻한다 — 성과 예측이 아니다.');
  console.log('   2026-08-19 실측: 🟢로 골라 발행한 13건의 헤드 키워드 랭킹은 0/13 이었다.');
  console.log('⚠️ 판정과 무관하게 상위 도메인으로 검색 의도를 눈으로 확인할 것.');
  console.log('   예: 「기저귀 교환대」 상위는 sotong.go.kr·kca.go.kr = 공공시설 위치 의도라 순위를 잡아도 전환 0.');
  console.log('   (이 건은 기관 도메인이라 강도로도 걸리지만, 소형몰이 상위인 의도 불일치는 자동으로 못 거른다.)');
  if (failed) {
    console.log();
    console.log(`🚨 ${failed}개 측정 실패 — ERR 은 판정이 아니다. 이 키워드는 발행 판단에 쓰지 말 것.`);
    process.exit(2);
  }
})();

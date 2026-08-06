#!/usr/bin/env node
/**
 * gate.js — babygrade 발행 게이트 15항
 *
 * 자동 발행의 방어선. 사람의 사후 검토가 아니라 여기서 사고를 막는다.
 * 근거: CLAUDE.md「절대 하지 말 것」·「영유아 특화 추가 주의사항」,
 *       WORKFLOW.md「운영 위반 절대 금지」, EDITORIAL-CALENDAR.md「식약처 표시광고법」,
 *       웹사이트/자동발행-이식가이드.md §4
 *
 * 딜픽(ali-home) 게이트를 이식하되 수익 모델·규제가 달라 다시 짰다:
 *   - 제휴 링크·CTA 마크업이 쿠팡(link.coupang.com / class="cpg-cta")
 *   - #3 의약품 효능은 건강 카테고리 한정이 아니라 **전 카테고리** 적용 (영유아는 더 엄격)
 *   - #13 절대적 안전 표현, #14 내부링크 유효성 은 babygrade 고유 게이트
 *
 * 사용법:
 *   node content-pipeline/gate.js <slug> [slug...]   # 특정 글 검사
 *   node content-pipeline/gate.js --all              # 전체 글 검사 (오탐률 측정용)
 *   node content-pipeline/gate.js --all --json       # 기계 판독용 출력
 *   node content-pipeline/gate.js <slug> --links     # 게이트 #9(CTA 목적지 실제 요청) 포함
 *   node content-pipeline/gate.js <slug> --prices    # 게이트 #15(쿠팡 API 가격 대조) 포함
 *   node content-pipeline/gate.js --all --prices     # 기존 글 가격 드리프트 감사
 *
 * 종료 코드: 0 = block 없음, 1 = block 1건 이상
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const POSTS_DIR = path.join(__dirname, '..', 'affiliate-site', 'src', 'content', 'posts');
const PAGES_DIR = path.join(__dirname, '..', 'affiliate-site', 'src', 'pages');

// ─────────────────────────────────────────────────────────────
// 금지어 사전 — 튜닝 대상. 오탐 발생 시 여기만 고친다.
// ─────────────────────────────────────────────────────────────
const DICT = {
  // #1 운영자용 내부 문구 누출 + 허위 사용 후기
  //    "우리 아이" 자체는 육아 글의 정상 표현이라 잡지 않는다.
  //    금지되는 것은 **직접 사용했다는 주장**이다 (CLAUDE.md: "우리 아이가 직접 써본" 금지).
  operator:
    /본인\s?클릭|반복\s?클릭|셀프\s?클릭|계정\s?제재|계정\s?정지|계정\s?영구|어뷰징|허위\s?매출|수익\s?몰수|(우리|저희)\s?아이(가|에게|한테)?\s*(직접\s*)?(써|사용해|먹여|입혀|발라)\s?봤|직접\s?써\s?본\s?결과|제가\s?(직접\s?)?(써|사용해)\s?보/g,

  // #2 감성어 (Wirecutter 톤 위반). 육아 글에서 "귀엽" 은 제품 묘사로 자주 쓰여 오탐이 잦으므로
  //    단정형 감탄("귀엽다"·"너무 귀여")만 잡는다.
  emotive:
    /예쁘다|너무\s?예쁘|너무\s?좋|강추|꿀템|갓성비|사랑스러|귀엽다|너무\s?귀여|최고예요|최고입니다|대박|짱\s|완전\s?좋/g,

  // #3 의약품적 효능·효과 단정 (식약처 표시광고법 — 영유아는 일반 생활용품보다 엄격)
  //    전 카테고리 적용. 인정 기능성 문구 밖의 효능 단정 + 질병 예방·치료 표현.
  medical:
    /면역력\s?(강화|증진|향상|개선|높여|올려)|성장\s?(촉진|도움|발달)|발달\s?(촉진|개선|향상)|두뇌\s?발달|지능\s?발달|키\s?성장에?\s?도움|장\s?건강\s?개선|아토피\s?(개선|완화|치료)|변비\s?(치료|개선)|질병\s?예방|감염\s?예방|돌연사\s?예방|치료(?!법|제|실)|완치|증상\s?완화|통증\s?완화|의학적\s?효능|수면\s?시간\s?(증가|늘려|향상)|통잠|꿀잠|시력\s?보호|눈\s?건강에?\s?좋/g,

  // #13 절대적 안전·효과 표현 (CLAUDE.md: "100% 안전" "절대 무해" 금지)
  absolute:
    /100\s?%\s?(안전|무해|차단|살균|멸균|제거|안심)|백\s?퍼센트\s?안전|절대\s?(안전|무해|무독|안\s?깨|안\s?넘어)|완벽\s?(차단|살균|멸균|건조|안전|방수)|무조건\s?안전|부작용(이)?\s?(전혀\s?)?없|100\s?%\s?국내산\s?보장|영구\s?(안전|무균)/g,

  // #4 플랫폼(쿠팡) 사칭
  impersonation:
    /쿠팡\s?공식\s?(추천|1위|파트너|인증|선정)|쿠팡(이)?\s?추천(하는|한)|쿠팡\s?공인|공식\s?파트너사|쿠팡에서\s?인증/g,

  // #5 가짜 정가 / 최저가 단정 (실시간 가격 변동 — WORKFLOW.md "최저가 보장" 금지)
  //    "쿠팡 최저가 보기" 는 CTA 라벨(=버튼 문구)이라 본문 검사 대상에서 빠진다(plainText 가 태그 제거).
  fakePrice:
    /정가\s*[₩]?\s*[\d,]+\s*원?\s*(?:→|->|~|부터)|최저가\s?보장|항상\s?최저가|무조건\s?최저가|가격\s?변동\s?없/g,

  // #8 미변환 링크·자리표시자
  placeholder:
    /\{\{[A-Z_]+\d*\}\}|TODO|FIXME|여기에\s?링크|링크\s?삽입|<\/?(content|invoke|antml)[^>]*>/g,
};

/**
 * 부정·고지·경고 문맥 — 같은 단어라도 여기 걸리면 위반이 아니다.
 *
 * babygrade 글은 「표시·사용 주의」 섹션에서 금지 표현을 **인용해 경고**하는 것이 표준 구조다.
 *   예) `"통잠"·"꿀잠"·"수면 시간 증가" 같은 효과 단정은 쓸 수 없다`
 *       `"영아 돌연사 예방" 을 단정하는 표현은 광고에서 금지된다`
 * 이걸 위반으로 잡으면 정상 글이 전부 막힌다 — 딜픽에서 83편 중 10편이 이 원인이었다.
 */
// ⚠️ 한글은 음절 단위 조합이라 `아니` 가 `아닙니다` 를 못 잡는다(아·닙·니·다).
//    정중형 종결(아닙·없습·않습)을 별도로 등재해야 한다. 딜픽 83편 역적용에서 실측된 함정.
const NEGATION = new RegExp(
  [
    '금지', '못\\s?쓴', '쓸\\s?수\\s?없', '쓰지\\s?않', '할\\s?수\\s?없', '삼가', '피하',
    // `않` 은 어미가 다양하다(않으며·않으므로·않도록·않은·않아). 활용형을 열거하면
    // 반드시 빠지는 게 생기므로(실측: `요통을 치료하지 않으며` 가 #3 오탐) 어간만 등재한다.
    '없음', '없는', '없다', '없습', '없이', '않', '아님', '아닌', '아니', '아닙',
    '불가', '안\\s?됩', '안\\s?된', '주의', '경고', '위험', '조심',
    '단정', '과장', '허위', '오인', '표방', '표현', '문구', '광고', '표시',
    '인정되지', '인정된\\s?것', '보장하지', '보장되지', '검증되지', '근거\\s?없', '근거로\\s?삼',
    '의약품이\\s?아', '의료기기(도|가)?\\s?아', '건강기능식품',
    '별개', '전문의', '소아과', '진료', '상담', '아무리', '라도', '어도', '해도',
    '뜻이\\s?아', '의미가\\s?아', '것은\\s?아',
  ].join('|')
);
const NEG_WINDOW = 90; // 검출 지점 앞뒤 문자 수. 한국어 고지문이 길어 딜픽(60)보다 넓게 잡았다.

/**
 * 게이트 심각도.
 *   block — 발행 중단. 컴플라이언스 위반·기능 파손처럼 나가면 되돌릴 수 없는 것.
 *   warn  — 발행하되 Telegram 알림에 표기. 품질 이슈는 사후 수정이 가능하다.
 */
const SEVERITY = {
  1: 'block', //  운영자 문구·허위 사용 후기 — 파트너스 정지 사유
  2: 'warn', //   감성어 — 톤
  3: 'block', //  의약품 효능 — 식약처 표시광고법
  4: 'block', //  쿠팡 사칭 — 약관 위반
  5: 'block', //  가짜 정가·최저가 단정 — 공정위
  6: 'warn', //   인라인 (1)(2)(3) — 가독성
  7: 'block', //  CTA 없음 — 수익 0
  8: 'block', //  미변환 링크 — 링크 사망
  9: 'block', //  CTA 목적지 사망 — 링크 사망
  10: 'block', // 카니발 — 누적형, 사람이 못 잡음
  11: 'warn', //  구조 — 품질
  12: 'block', // 빌드 — 배포 실패
  13: 'block', // 절대적 안전 표현 — 표시광고법 (영유아 특화)
  14: 'block', // 내부링크 유효성 — 404·리다이렉트 (2026-06-18 에 432개를 손으로 고친 이력)
  15: 'block', // 가격 대조 — 표시광고. --prices 일 때만 실검사
};

/**
 * #15 허용 오차. 쿠팡 가격은 상시 변동하므로 완전 일치를 요구하면 종일 빨간불이다.
 * 발행 직전 검사에서는 몇 분 전 같은 API 에서 받은 값이라 0%에 가깝게 나온다.
 */
const PRICE_TOLERANCE = 0.05;

// ─────────────────────────────────────────────────────────────
// 구조 임계값 — 기존 87편 실측 분포에서 뽑았다 (하위 5% 근처를 하한으로).
//   자수 min 2452 / p05 2671, 표 min 1 / p05 2, CTA·제품 min 3, FAQ min 4, 출처 min 2, 내부링크 min 3
// ─────────────────────────────────────────────────────────────
const MIN = {
  product: { chars: 2400, tables: 2, faq: 4, sources: 2, internalLinks: 3 },
  guide: { chars: 1800, tables: 1, faq: 4, sources: 2, internalLinks: 2 },
};

/** 글이 아닌 정적 페이지 — 내부링크 목적지로 유효하다 */
const STATIC_ROUTES = new Set(['/', '/about/', '/methodology/', '/privacy/', '/404/']);

// ─────────────────────────────────────────────────────────────
// 파싱 헬퍼
// ─────────────────────────────────────────────────────────────

function splitFrontmatter(raw) {
  const m = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) return { fm: '', body: raw };
  return { fm: m[1], body: m[2] };
}

/** 스칼라 필드 추출 (category, mainKeyword, draft 등) */
function fmScalar(fm, key) {
  const m = fm.match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

/**
 * 최상위 리스트 섹션의 항목 수를 센다.
 * faq/sources/products 가 모두 `- key:` 형태라 섹션 경계를 들여쓰기로 판별.
 */
function fmListCount(fm, key, itemKey) {
  const lines = fm.split('\n');
  let inSection = false;
  let count = 0;
  for (const line of lines) {
    if (new RegExp(`^${key}:`).test(line)) {
      inSection = true;
      if (/:\s*\[\s*\]\s*$/.test(line)) return 0; // 인라인 빈 배열: `products: []`
      continue;
    }
    if (inSection) {
      if (/^[^\s#-]/.test(line)) break; // 들여쓰기 없는 새 최상위 키 → 섹션 종료
      if (new RegExp(`^\\s+-\\s+${itemKey}:`).test(line)) count++;
    }
  }
  return count;
}

/** 본문에서 코드블록·HTML 태그를 걷어낸 순수 텍스트 (CTA 버튼 문구는 여기서 빠진다) */
function plainText(body) {
  return body
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
}

/** 한글 기준 실질 자수 (공백·기호 제외) */
function charCount(text) {
  return (text.match(/[가-힣A-Za-z0-9]/g) || []).length;
}

/** 마크다운 표 개수 = 구분행(|---|) 개수 */
function tableCount(body) {
  return (body.match(/^\s*\|[\s:|-]+\|\s*$/gm) || []).length;
}

/** 한 단락 안에 (1)(2)(3) 이 3개 이상 오름차순으로 나열됐는지 */
function inlineNumbering(text) {
  const hits = [];
  for (const para of text.split(/\n\s*\n/)) {
    const nums = para.match(/\((\d)\)/g);
    if (!nums) continue;
    const seq = nums.map((n) => parseInt(n.slice(1, -1), 10));
    let run = 0;
    let best = 0;
    let expect = 1;
    for (const n of seq) {
      if (n === expect) {
        run++;
        expect++;
        best = Math.max(best, run);
      } else if (n === 1) {
        run = 1;
        expect = 2;
      } else {
        run = 0;
        expect = 1;
      }
    }
    if (best >= 3) hits.push(para.slice(0, 60).replace(/\s+/g, ' '));
  }
  return hits;
}

function matchAll(text, re) {
  const found = text.match(new RegExp(re.source, re.flags)) || [];
  return [...new Set(found)];
}

/**
 * 위반 검출 — 부정·고지 문맥과 자체 키워드는 제외한다.
 * @param {string} text     검사 대상 (본문 평문)
 * @param {RegExp} re       금지어 패턴
 * @param {string[]} allow  이 글의 mainKeyword·lsiKeywords·tags (노리는 검색어는 톤 위반이 아님)
 * @returns {string[]}      실제 위반 스니펫
 */
function findViolations(text, re, allow = []) {
  const hits = [];
  const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let m;
  while ((m = rx.exec(text)) !== null) {
    const term = m[0];
    const at = m.index;
    if (rx.lastIndex === at) rx.lastIndex++;

    // 이 글이 노리는 검색 키워드에 포함된 표현이면 톤 위반이 아니다
    if (allow.some((k) => k.includes(term))) continue;

    // 부정·고지·경고 문맥이면 통과.
    // ⚠️ 검출어 자신은 문맥에서 뺀다 — 안 그러면 검출어가 스스로에게 면죄부를 준다.
    //    실측: `부작용이 없는 제품입니다` 는 #13 위반인데, 검출어 "부작용이 없" 안의 `없` 이
    //    NEGATION 에 걸려 통과됐다. 반대로 진짜 고지문 `"부작용이 없다"고 단정하는 표현은 금지`
    //    는 검출어를 빼도 주변에 단정·금지가 남아 정상 통과한다.
    const before = text.slice(Math.max(0, at - NEG_WINDOW), at);
    const after = text.slice(at + term.length, at + term.length + NEG_WINDOW);
    if (NEGATION.test(before + ' ' + after)) continue;

    hits.push(`${term} — "…${(before + term + after).replace(/\s+/g, ' ').trim()}…"`);
  }
  return hits;
}

/** frontmatter 의 키워드류를 모아 검사 허용 목록으로 */
function keywordAllowlist(fm) {
  const out = [];
  const main = fmScalar(fm, 'mainKeyword');
  if (main) out.push(main);
  for (const key of ['lsiKeywords', 'tags']) {
    const sec = fm.match(new RegExp(`^${key}:([\\s\\S]*?)(?=^\\S)`, 'm'));
    if (sec) {
      for (const line of sec[1].split('\n')) {
        const v = line.match(/^\s*-\s*["']?(.+?)["']?\s*$/);
        if (v) out.push(v[1]);
      }
    }
    const inline = fm.match(new RegExp(`^${key}:\\s*\\[(.+)\\]`, 'm'));
    if (inline) out.push(...inline[1].split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')));
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// #9 CTA 목적지 — --links 일 때만 실제 요청
// ─────────────────────────────────────────────────────────────

/**
 * 링크가 살아 있는지 본다.
 * 네트워크 실패는 "모름"(null)으로 돌려보낸다 — 러너의 일시적 네트워크 문제로
 * 발행을 막으면 손해가 더 크다. 명시적 404/410 만 사망으로 판정한다.
 */
function probe(url, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const req = https.get(
      url,
      { headers: { 'User-Agent': 'babygrade-gate/1.0' }, timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.on('error', () => resolve(null));
  });
}

async function checkCtaTargets(links) {
  const dead = [];
  for (const url of links) {
    const code = await probe(url);
    if (code === 404 || code === 410) dead.push(`${code} ${url.slice(0, 80)}`);
  }
  return dead;
}

// ─────────────────────────────────────────────────────────────
// #15 가격 대조 — --prices 일 때만
// ─────────────────────────────────────────────────────────────

/**
 * frontmatter 의 products 를 (이름·가격·상품ID·옵션ID) 로 뽑는다.
 * name 은 `>-` 접힘 스칼라라 다음 줄로 넘어가는 경우가 많아 이어 붙인다.
 */
function parseProducts(fm) {
  const lines = fm.split('\n');
  const out = [];
  let inSec = false;
  let cur = null;
  let pendingName = false;
  for (const line of lines) {
    if (/^products:/.test(line)) {
      inSec = true;
      if (/:\s*\[\s*\]\s*$/.test(line)) return [];
      continue;
    }
    if (!inSec) continue;
    if (/^[^\s#-]/.test(line)) break; // 새 최상위 키 → 종료

    const n = line.match(/^  - name:\s*(.*)$/);
    if (n) {
      cur = { name: '', price: null, productId: null, itemId: null };
      out.push(cur);
      const v = n[1].trim();
      if (v && v !== '>-' && v !== '>' && v !== '|') cur.name = v.replace(/^["']|["']$/g, '');
      else pendingName = true;
      continue;
    }
    if (!cur) continue;

    if (pendingName) {
      const cont = line.match(/^\s{4,}(\S.*)$/);
      if (cont && !/^(price|image|url|rating|features):/.test(cont[1])) {
        cur.name = (cur.name + ' ' + cont[1].trim()).trim();
        continue;
      }
      pendingName = false;
    }
    const p = line.match(/^\s+price:\s*(\d+)/);
    if (p) cur.price = Number(p[1]);
    const u = line.match(/link\.coupang\.com\/re\/[^\s"']*[?&]pageKey=(\d+)[^\s"']*?[?&]itemId=(\d+)/);
    if (u) {
      cur.productId = u[1];
      cur.itemId = u[2];
    }
  }
  return out.filter((p) => p.name && p.price);
}

/**
 * 쿠팡 파트너스 API 로 현재 가격을 확인한다.
 *
 * 제약: 파트너스 API 에는 상품ID 단건 조회가 없어 **상품명으로 검색**해 찾아야 한다.
 *
 * ⚠️ **반드시 itemId 로 맞춘다. productId 로 맞추면 틀린 값을 본다.**
 * 같은 productId 가 옵션마다 다른 행으로 오고 가격이 제각각이다. 실측:
 *   9099561385 · itemId 26748527499 (16cm) = 29,900원
 *   9099561385 · itemId 26748527505 (18cm) = 32,900원
 * 이걸 productId 로만 매칭했더니 18cm 글(32,900원 · 정상)을 "18.2% 드리프트"로
 * 오탐했다(2026-08-06). itemId 는 API 행의 productUrl 안에 들어 있다.
 *
 * 못 찾으면 `null` — "확인 불가"이지 "틀림"이 아니다. 발행을 막지 않는다.
 */
const itemIdOf = (url) => (String(url || '').match(/[?&]itemId=(\d+)/) || [])[1] || null;

async function currentPrice(searchProducts, prod) {
  // 검색어를 좁은 것 → 넓은 것 순으로. 옵션 표기(", 1개, 유백색, 18cm")가 붙은 원문이
  // 가장 정확히 그 행을 끌어오므로 자르지 않고 먼저 쓴다.
  const tries = [
    prod.name,
    prod.name.replace(/[\[\]]/g, ' ').split(',')[0].trim(),
    prod.name.replace(/[\[\]]/g, ' ').split(',')[0].trim().split(/\s+/).slice(0, 6).join(' '),
  ];
  let sawProduct = false;
  for (const q of [...new Set(tries)]) {
    let rows;
    try {
      rows = await searchProducts(q, 10);
    } catch (e) {
      return { price: null, note: `조회 실패: ${String(e.message).slice(0, 60)}` };
    }
    const hit = (rows || []).find((r) => itemIdOf(r.productUrl) === prod.itemId);
    if (hit) return { price: hit.productPrice, note: '' };
    if ((rows || []).some((r) => String(r.productId) === String(prod.productId))) sawProduct = true;
  }
  // 상품은 보이는데 그 옵션 행이 안 잡히는 경우가 있다(검색 결과 10건 제한).
  // 다른 옵션 가격으로 대신 비교하면 오탐이 나므로 확인 불가로 둔다.
  return {
    price: null,
    note: sawProduct ? '해당 옵션(itemId) 행이 검색 결과에 없음' : '검색으로 상품을 못 찾음',
  };
}

async function checkPrices(fm) {
  let searchProducts;
  try {
    ({ searchProducts } = require('./coupang'));
  } catch (e) {
    return { issues: [], detail: `coupang.js 로드 실패 — 건너뜀 (${e.message})` };
  }
  const prods = parseProducts(fm);
  if (!prods.length) return { issues: [], detail: '제품 없음' };

  const issues = [];
  const notes = [];
  for (const p of prods) {
    if (!p.productId) {
      notes.push(`${p.name.slice(0, 20)}: 링크에서 상품ID 추출 불가`);
      continue;
    }
    const { price, note } = await currentPrice(searchProducts, p);
    if (price == null) {
      notes.push(`${p.name.slice(0, 20)}: ${note}`);
      continue;
    }
    const drift = Math.abs(price - p.price) / p.price;
    if (drift > PRICE_TOLERANCE) {
      issues.push(
        `${p.name.slice(0, 24)} 글 ${p.price.toLocaleString()}원 → 현재 ${price.toLocaleString()}원 (${(drift * 100).toFixed(1)}%)`
      );
    } else {
      notes.push(`${p.name.slice(0, 16)} ±${(drift * 100).toFixed(1)}%`);
    }
    await new Promise((r) => setTimeout(r, 400)); // API 예우
  }
  return { issues, detail: notes.join(' · ') };
}

// ─────────────────────────────────────────────────────────────
// 게이트 실행
// ─────────────────────────────────────────────────────────────

function runGates(slug, raw, ctx) {
  const { fm, body } = splitFrontmatter(raw);
  const text = plainText(body);
  const category = fmScalar(fm, 'category') || '(없음)';
  const mainKeyword = fmScalar(fm, 'mainKeyword') || '';
  const productCount = fmListCount(fm, 'products', 'name');
  const faqCount = fmListCount(fm, 'faq', 'q');
  const sourceCount = fmListCount(fm, 'sources', 'title');
  const ctaCount = (body.match(/class="cpg-cta"/g) || []).length;
  const internalHrefs = (body.match(/\]\((\/[^)]*)\)/g) || []).map((s) =>
    s.replace(/^\]\(/, '').replace(/\)$/, '')
  );
  const affiliateLinks = matchAll(body, /https:\/\/link\.coupang\.com\/re\/[^"'\s)]+/g);

  const allow = keywordAllowlist(fm);
  const results = [];
  const add = (n, name, pass, detail) =>
    results.push({ n, name, pass, detail, severity: SEVERITY[n] });

  // #1 운영자 문구·허위 사용 후기 — 부정 문맥 예외 없음(어떤 맥락이든 노출 자체가 문제)
  const op = matchAll(text, DICT.operator);
  add(1, '운영자 문구·허위 후기', op.length === 0, op.join(', '));

  // #2 감성어
  const em = findViolations(text, DICT.emotive, allow);
  add(2, '감성어', em.length === 0, em.join(' | '));

  // #3 의약품 효능 — 전 카테고리 (영유아는 일반 생활용품보다 엄격)
  const med = findViolations(text, DICT.medical, allow);
  add(3, '의약품 효능(식약처)', med.length === 0, med.join(' | '));

  // #4 쿠팡 사칭
  const imp = findViolations(text, DICT.impersonation, allow);
  add(4, '쿠팡 사칭', imp.length === 0, imp.join(' | '));

  // #5 가짜 정가·최저가 단정
  const fp = findViolations(text, DICT.fakePrice, allow);
  add(5, '가짜 정가·최저가 단정', fp.length === 0, fp.join(' | '));

  // #6 인라인 (1)(2)(3)
  const inl = inlineNumbering(text);
  add(6, '인라인 (1)(2)(3)', inl.length === 0, inl.join(' / '));

  // #7 CTA — 제품 글은 제품 수만큼, 그 외는 최소 1개
  if (productCount > 0) {
    add(7, 'CTA 수', ctaCount >= productCount, `cpg-cta ${ctaCount}개 / 제품 ${productCount}개`);
  } else {
    add(7, 'CTA 수', ctaCount >= 1, `cpg-cta ${ctaCount}개 (정보성 글, 최소 1)`);
  }

  // #8 미변환 링크·자리표시자
  const ph = matchAll(body, DICT.placeholder);
  add(8, '미변환 링크·TODO', ph.length === 0, ph.join(', '));

  // #9 CTA 목적지 (--links 일 때만 실제 요청)
  if (ctx.checkLinks) {
    add(9, 'CTA 목적지', ctx.deadLinks.length === 0, ctx.deadLinks.join(' | ') || `${affiliateLinks.length}건 확인`);
  } else {
    add(9, 'CTA 목적지', true, `건너뜀 (--links 로 활성화, 제휴링크 ${affiliateLinks.length}건)`);
  }

  // #10 mainKeyword 카니발
  const dupes = (ctx.keywordMap[mainKeyword] || []).filter((s) => s !== slug);
  add(10, 'mainKeyword 카니발', dupes.length === 0, dupes.join(', '));

  // #11 구조 — 제품 글과 정보성 글의 기준이 다르다
  const kind = productCount > 0 ? 'product' : 'guide';
  const min = MIN[kind];
  const chars = charCount(text);
  const tables = tableCount(body);
  const structFails = [];
  if (chars < min.chars) structFails.push(`자수 ${chars} < ${min.chars}`);
  if (tables < min.tables) structFails.push(`표 ${tables} < ${min.tables}`);
  if (faqCount < min.faq) structFails.push(`FAQ ${faqCount} < ${min.faq}`);
  if (sourceCount < min.sources) structFails.push(`출처 ${sourceCount} < ${min.sources}`);
  if (internalHrefs.length < min.internalLinks)
    structFails.push(`내부링크 ${internalHrefs.length} < ${min.internalLinks}`);
  add(
    11,
    '구조(자수·표·FAQ·출처·링크)',
    structFails.length === 0,
    structFails.length
      ? `[${kind}] ${structFails.join(' · ')}`
      : `[${kind}] ${chars}자 · 표${tables} · FAQ${faqCount} · 출처${sourceCount} · 내부링크${internalHrefs.length}`
  );

  // #12 빌드 — 개별 글 단위로 판정 불가. 발행 직전 npm run build 로 별도 확인.
  add(12, '빌드', true, '별도 단계 (npm run build --prefix affiliate-site)');

  // #13 절대적 안전·효과 표현 (영유아 특화)
  const abs = findViolations(text, DICT.absolute, allow);
  add(13, '절대적 안전 표현', abs.length === 0, abs.join(' | '));

  // #14 내부링크 유효성 — 끝 슬래시 + 목적지 실존
  //     2026-06-18 에 슬래시 누락 432개를 손으로 고쳤다. 같은 회귀를 기계로 막는다.
  const linkFails = [];
  for (const href of internalHrefs) {
    const clean = href.split('#')[0].split('?')[0];
    if (!clean.endsWith('/')) {
      linkFails.push(`끝 슬래시 없음: ${href}`);
      continue;
    }
    if (STATIC_ROUTES.has(clean) || clean.startsWith('/category/') || clean.startsWith('/images/'))
      continue;
    const target = clean.replace(/^\/|\/$/g, '');
    if (!ctx.allSlugs.has(target)) linkFails.push(`목적지 없음: ${href}`);
  }
  add(14, '내부링크 유효성', linkFails.length === 0, [...new Set(linkFails)].join(' | '));

  // #15 가격 대조 (--prices 일 때만 실검사)
  if (ctx.checkPrices) {
    add(
      15,
      '가격 대조',
      ctx.priceIssues.length === 0,
      ctx.priceIssues.length ? ctx.priceIssues.join(' | ') : ctx.priceDetail || '일치'
    );
  } else {
    add(15, '가격 대조', true, `건너뜀 (--prices 로 활성화, 제품 ${productCount}개)`);
  }

  return { slug, category, mainKeyword, results };
}

// ─────────────────────────────────────────────────────────────
// 진입점
// ─────────────────────────────────────────────────────────────

async function main() {
  const argv = process.argv.slice(2);
  const opts = {
    all: argv.includes('--all'),
    json: argv.includes('--json'),
    checkLinks: argv.includes('--links'),
    checkPrices: argv.includes('--prices'),
  };
  const slugs = argv.filter((a) => !a.startsWith('--')).map((s) => s.replace(/\.md$/, ''));

  const allFiles = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  const allSlugs = new Set(allFiles.map((f) => f.replace(/\.md$/, '')));

  // 카니발 검사용 전역 mainKeyword 맵 (항상 전체 글 기준)
  const keywordMap = {};
  for (const f of allFiles) {
    const { fm } = splitFrontmatter(fs.readFileSync(path.join(POSTS_DIR, f), 'utf8'));
    const kw = fmScalar(fm, 'mainKeyword');
    if (!kw) continue;
    (keywordMap[kw] ||= []).push(f.replace(/\.md$/, ''));
  }

  const targets = opts.all ? [...allSlugs] : slugs;
  if (targets.length === 0) {
    console.error('사용법: node content-pipeline/gate.js <slug>... | --all [--json] [--links]');
    process.exit(2);
  }

  const reports = [];
  for (const slug of targets) {
    const file = path.join(POSTS_DIR, `${slug}.md`);
    if (!fs.existsSync(file)) {
      console.error(`✗ 파일 없음: ${slug}.md`);
      process.exitCode = 1;
      continue;
    }
    const raw = fs.readFileSync(file, 'utf8');

    let deadLinks = [];
    if (opts.checkLinks) {
      const links = matchAll(raw, /https:\/\/link\.coupang\.com\/re\/[^"'\s)]+/g);
      deadLinks = await checkCtaTargets(links);
    }

    let priceIssues = [];
    let priceDetail = '';
    if (opts.checkPrices) {
      process.stderr.write(`  가격 조회 중: ${slug}\n`);
      const r = await checkPrices(splitFrontmatter(raw).fm);
      priceIssues = r.issues;
      priceDetail = r.detail;
    }

    reports.push(
      runGates(slug, raw, { keywordMap, allSlugs, deadLinks, priceIssues, priceDetail, ...opts })
    );
  }

  if (opts.json) console.log(JSON.stringify(reports, null, 2));
  else printHuman(reports, opts);

  // 발행 차단은 block 등급 실패에만 걸린다. warn 은 알림만.
  const anyBlock = reports.some((r) =>
    r.results.some((g) => g.pass === false && g.severity === 'block')
  );
  process.exitCode = anyBlock ? 1 : 0;
}

function printHuman(reports, opts) {
  const fails = (r, sev) => r.results.filter((g) => g.pass === false && g.severity === sev);
  const blocked = reports.filter((r) => fails(r, 'block').length > 0);
  const warned = reports.filter(
    (r) => fails(r, 'block').length === 0 && fails(r, 'warn').length > 0
  );

  for (const r of [...blocked, ...warned]) {
    const isBlock = fails(r, 'block').length > 0;
    const tag = isBlock ? '\x1b[41m 발행 중단 \x1b[0m' : '\x1b[43m\x1b[30m 경고 \x1b[0m';
    console.log(`\n${tag} \x1b[1m${r.slug}\x1b[0m  [${r.category}]`);
    for (const g of r.results) {
      if (g.pass !== false) continue;
      const c = g.severity === 'block' ? '\x1b[31m✗' : '\x1b[33m▲';
      console.log(`  ${c} #${String(g.n).padStart(2)} ${g.name}\x1b[0m — ${g.detail.slice(0, 200)}`);
    }
  }

  const tally = {};
  for (const r of reports) {
    for (const g of r.results) {
      tally[g.n] ||= { name: g.name, sev: g.severity, fail: 0 };
      if (g.pass === false) tally[g.n].fail++;
    }
  }

  console.log(`\n${'─'.repeat(62)}`);
  console.log(`\x1b[1m게이트별 실패 건수\x1b[0m  (대상 ${reports.length}편)`);
  for (const n of Object.keys(tally).sort((a, b) => a - b)) {
    const t = tally[n];
    const sev = t.sev === 'block' ? '\x1b[31m[중단]\x1b[0m' : '\x1b[33m[경고]\x1b[0m';
    const bar =
      t.fail === 0
        ? '\x1b[32m통과\x1b[0m'
        : `${t.fail}편 (${((t.fail / reports.length) * 100).toFixed(0)}%)`;
    console.log(`  ${sev} #${String(n).padStart(2)} ${t.name.padEnd(24, ' ')} ${bar}`);
  }
  console.log(`${'─'.repeat(62)}`);
  console.log(
    `\x1b[32m통과 ${reports.length - blocked.length - warned.length}편\x1b[0m · ` +
      `\x1b[33m경고 ${warned.length}편(발행됨)\x1b[0m · ` +
      `\x1b[31m중단 ${blocked.length}편\x1b[0m`
  );
  if (!opts.checkLinks) console.log(`(#9 CTA 목적지 검사는 --links 로 활성화)`);
}

main();

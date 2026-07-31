#!/usr/bin/env node
// 글 자동 시작점: 키워드 → 데이터 수집 → 마크다운 스켈레톤 생성
const fs = require('fs');
const path = require('path');
const { searchProducts } = require('./coupang');
const { getRelatedKeywords, classifyIntent } = require('./google-keywords');
const { check: checkCannibal } = require('./check-cannibalization');

const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');

const ARG_KEYWORD = process.argv[2];
// content.config.ts 의 enum 과 일치해야 한다
const ARG_CATEGORY = process.argv[3]; // 임산부 | 신생아 | 영아 | 유아 | 안전 | 기타

if (!ARG_KEYWORD || !ARG_CATEGORY) {
  console.error('사용법: node content-pipeline/new-article.js "임산부 칼슘" "임산부"');
  console.error('카테고리: 임산부 | 신생아 | 영아 | 유아 | 안전 | 기타');
  process.exit(1);
}

// 슬러그 생성 (영문이면 그대로, 한글이면 공백→하이픈 + 연도)
function makeSlug(kw) {
  const cleaned = kw.replace(/\s+/g, '-').replace(/[?!.,]/g, '');
  return `${cleaned}-${new Date().getFullYear()}`;
}

async function main() {
  console.log(`\n🚀 글 시작: "${ARG_KEYWORD}" (${ARG_CATEGORY})\n`);

  // 0. 카니발라이제이션 사전 점검
  const cannibalIssues = checkCannibal(ARG_KEYWORD);
  if (cannibalIssues.length > 0) {
    console.log('⚠️  카니발라이제이션 위험 감지:');
    for (const i of cannibalIssues) {
      const icon = i.level === 'CRITICAL' ? '⛔' : i.level === 'HIGH' ? '🚨' : '⚠️';
      console.log(`   ${icon} [${i.level}] "${i.post.mainKeyword}" → ${i.reason}`);
    }
    if (cannibalIssues.some((i) => i.level === 'CRITICAL')) {
      console.log('\n❌ 메인 키워드 완전 중복 — 발행 중단. 다른 키워드로 시도하세요.');
      process.exit(1);
    }
    console.log('\n💡 위 글의 내부 링크로 활용 권장 (Hub & Spoke 구조)\n');
  }


  // 1. Google 키워드 + 검색의도 분류
  console.log('[1/3] Google.co.kr 자동완성 + 의도 분류...');
  const allKw = await getRelatedKeywords(ARG_KEYWORD);
  const lsi = allKw.filter((k) => k !== ARG_KEYWORD).map((k) => ({ keyword: k, intent: classifyIntent(k) }));
  const byIntent = {};
  lsi.forEach((k) => {
    byIntent[k.intent] = byIntent[k.intent] || [];
    byIntent[k.intent].push(k.keyword);
  });
  console.log(`     → ${lsi.length}개 키워드`);
  Object.entries(byIntent).forEach(([i, ks]) => console.log(`        ${i}: ${ks.length}개 (예: ${ks[0]})`));
  console.log();

  // 2. 쿠팡 상품
  console.log('[2/3] 쿠팡 상품 검색...');
  const products = (await searchProducts(ARG_KEYWORD, 5)).slice(0, 3);
  console.log(`     → ${products.length}개 상품\n`);
  products.forEach((p, i) => console.log(`     ${i + 1}. ${p.productName.substring(0, 40)} - ${p.productPrice?.toLocaleString()}원`));

  // 3. 마크다운 스켈레톤 생성
  console.log('\n[3/3] 마크다운 스켈레톤 생성...');
  const slug = makeSlug(ARG_KEYWORD);
  const filename = `${slug}.md`;
  const filepath = path.join(POSTS_DIR, filename);

  if (fs.existsSync(filepath)) {
    console.log(`⚠️  파일 이미 있음: ${filename}`);
    console.log(`기존 파일 덮어쓰지 않습니다. 다른 이름으로 시도하세요.`);
    process.exit(1);
  }

  const today = new Date().toISOString().slice(0, 10);
  const productsBlock = products
    .map(
      (p) => `  - name: ${JSON.stringify(p.productName)}
    price: ${p.productPrice}
    image: ${JSON.stringify(p.productImage)}
    url: ${JSON.stringify(p.productUrl)}
    features: ["TODO 특징1","TODO 특징2","TODO 특징3"]`
    )
    .join('\n');

  const lsiBlock = lsi.slice(0, 15).map((k) => `  - "${k.keyword}"  # intent: ${k.intent}`).join('\n');
  const intentSummary = Object.entries(byIntent).map(([i, ks]) => `# ${i}: ${ks.slice(0, 5).join(', ')}`).join('\n');

  const skeleton = `---
title: "TODO: ${ARG_KEYWORD} 추천 (2026) - 부제"
description: "TODO: 메타 설명 150자 이내, 메인 키워드 ${ARG_KEYWORD} 포함"
publishedAt: ${today}
updatedAt: ${today}
category: "${ARG_CATEGORY}"
tags: ["${ARG_CATEGORY}", "TODO 태그"]
mainKeyword: "${ARG_KEYWORD}"
lsiKeywords:
${lsiBlock}
heroImage: "TODO Unsplash URL or /images/${slug}-hero.png"
heroImageAlt: "${ARG_KEYWORD} 관련 설명"
tldr:
  - "TODO 첫 줄: 결론을 한 문장으로"
  - "TODO 둘째 줄: 핵심 추천 또는 주의사항"
  - "TODO 셋째 줄: 가격대 또는 효과"
faq:
  - q: "TODO 질문 1"
    a: "TODO 답변 1"
  - q: "TODO 질문 2"
    a: "TODO 답변 2"
  - q: "TODO 질문 3"
    a: "TODO 답변 3"
  - q: "TODO 질문 4"
    a: "TODO 답변 4"
products:
${productsBlock}
sources:
  - title: "TODO 권위 출처 1"
    url: "https://example.com"
  - title: "TODO 권위 출처 2"
    url: "https://example.com"
---

## ${ARG_KEYWORD}, 한 줄로 정리하면?

**TODO: 첫 문단(150자 이내)에 직답형 결론.** 메인 키워드(${ARG_KEYWORD})를 자연스럽게 포함시켜 첫 100자 안에 등장시키세요.

이 글에서는 TODO 내용을 다룹니다.

## TODO: 첫 번째 핵심 섹션 (왜/어떻게)

설명 문단. LSI 키워드 자연 삽입.

| 컬럼1 | 컬럼2 | 컬럼3 |
|---|---|---|
| 값 | 값 | 값 |

<figure class="infographic">
  <img src="/images/${slug}-1.png" alt="${ARG_KEYWORD} 인포그래픽 1" loading="lazy" width="800" height="450" />
  <div class="labels-3col">
    <span><b>라벨1</b><br/>설명1</span>
    <span><b>라벨2</b><br/>설명2</span>
    <span><b>라벨3</b><br/>설명3</span>
  </div>
  <figcaption>TODO 캡션</figcaption>
</figure>

## ${ARG_KEYWORD} 추천 제품 비교 (2026)

비교 표:

| 제품 | 가격 | kg당 단가 | 특징 |
|---|---|---|---|
| TODO | TODO | TODO | TODO |

### 1. ${products[0]?.productName?.split(',')[0] || 'TODO 제품1'}

설명. {{COUPANG_LINK_1}}

### 2. ${products[1]?.productName?.split(',')[0] || 'TODO 제품2'}

설명. {{COUPANG_LINK_2}}

### 3. ${products[2]?.productName?.split(',')[0] || 'TODO 제품3'}

설명. {{COUPANG_LINK_3}}

## TODO: 실행 가이드 / 주의사항

본문. 출처 인용: [${'권위 출처'}](https://example.com)

## 자주 함께 검색되는 질문

자연스러운 마무리 문단. (관련 글이 발행되면 여기에 직접 링크 추가)

## 마무리 - 결론

마무리 문단.
`;

  fs.writeFileSync(filepath, skeleton, 'utf-8');
  console.log(`     → ✅ 저장: ${filepath}\n`);

  // 4. 다음 단계 안내
  console.log('━'.repeat(60));
  console.log('📋 다음 단계:');
  console.log(`  1. ${filename} 파일을 열어서 TODO 부분 채우기`);
  console.log(`  2. node generate-images.js ${slug}  # 인포그래픽 생성`);
  console.log(`  3. cd ../affiliate-site && npm run build  # 빌드 검증`);
  console.log('━'.repeat(60));

  // 5. 데이터 dump (디버깅용)
  fs.writeFileSync(
    path.join(__dirname, `last-data-${slug}.json`),
    JSON.stringify({ keyword: ARG_KEYWORD, lsi, products }, null, 2)
  );
}

main().catch((e) => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});

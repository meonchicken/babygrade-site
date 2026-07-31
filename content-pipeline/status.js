#!/usr/bin/env node
// 발행 상태 자동 추적 (토큰 절약 + 즉시 응답)
// 사용법:
//   node status.js                  # 다음 미발행 글 1개 출력
//   node status.js --next 3         # 다음 미발행 글 3개
//   node status.js --all            # 전체 상태 (발행/미발행)
//   node status.js --stats          # 통계만 (총 7개, 발행 2개, 미발행 5개)
const fs = require('fs');
const path = require('path');

const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');
const CALENDAR = path.resolve(__dirname, '../EDITORIAL-CALENDAR.md');

// 1. 발행된 글: ls posts/*.md
function getPublished() {
  return fs
    .readdirSync(POSTS_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace(/\.md$/, ''));
}

// 2. 계획된 글: EDITORIAL-CALENDAR.md에서 추출 (- 또는 ✅로 시작하는 항목)
function getPlanned() {
  const md = fs.readFileSync(CALENDAR, 'utf-8');
  const planned = [];

  // 클러스터 맵 섹션 (- ✅/🔴 강아지 XX)
  const clusterRegex = /^- (✅|🔴) (.+?)(?:\s*\[|$)/gm;
  let m;
  while ((m = clusterRegex.exec(md)) !== null) {
    const status = m[1] === '✅' ? 'done' : 'pending';
    const title = m[2].trim();
    planned.push({ title, status });
  }

  // 주간 스케줄 표 (D1, D2, ...)
  const scheduleRegex = /\| D\d+.*?\| (.+?) \|/gm;
  while ((m = scheduleRegex.exec(md)) !== null) {
    const cell = m[1].trim();
    // 한 셀에 여러 글 ("강아지 X (A) · 강아지 Y (B)")
    const titles = cell.split(/[·,]/).map((s) => s.trim()).filter((s) => s && !s.startsWith('주제'));
    for (const t of titles) {
      const cleaned = t.replace(/\s*\([A-Z]\)/, '').replace(/\s*\[허브.*?\]/, '').replace(/\s*\[.+?\]/, '').trim();
      if (cleaned && !planned.find((p) => p.title === cleaned)) {
        planned.push({ title: cleaned, status: 'pending' });
      }
    }
  }
  return planned;
}

// 3. 슬러그 매핑 (제목 → 가능한 슬러그 후보)
function titleToSlugCandidates(title) {
  // 괄호 안 내용 제거 + 특수문자 제거
  const cleaned = title.replace(/\(.*?\)/g, '').replace(/[(),.!?]/g, '').trim();
  const base = cleaned.replace(/\s+/g, '-');
  return [
    `${base}-2026`,
    base,
    `${base}-추천-2026`,
  ];
}

// 슬러그가 제목의 핵심 단어를 모두 포함하는지 (부분 매칭)
function matchesSlug(title, slug) {
  const titleWords = title.replace(/\(.*?\)/g, '').replace(/[(),.!?]/g, '').trim().split(/\s+/);
  return titleWords.every((w) => slug.includes(w));
}

function isPublished(title, publishedSlugs) {
  const candidates = titleToSlugCandidates(title);
  if (candidates.some((c) => publishedSlugs.includes(c))) return true;
  // 부분 매칭 (슬러그가 제목 단어 모두 포함)
  return publishedSlugs.some((s) => matchesSlug(title, s));
}

// 메인
function main() {
  const args = process.argv.slice(2);
  const published = getPublished();
  const planned = getPlanned();

  // 상태 합치기
  const status = planned.map((p) => ({
    title: p.title,
    published: isPublished(p.title, published),
  }));

  // 발행됐지만 계획에 없는 글도 표시
  for (const slug of published) {
    if (!status.find((s) => titleToSlugCandidates(s.title).includes(slug))) {
      status.push({ title: slug, published: true, extra: true });
    }
  }

  if (args.includes('--stats')) {
    const total = status.length;
    const done = status.filter((s) => s.published).length;
    console.log(`📊 전체 ${total}개 | 발행 ${done}개 | 미발행 ${total - done}개`);
    return;
  }

  if (args.includes('--all')) {
    console.log('상태 | 제목');
    console.log('---|---');
    for (const s of status) {
      console.log(`${s.published ? '✅' : '🔴'} ${s.extra ? '[+]' : '   '} ${s.title}`);
    }
    return;
  }

  // 기본: 다음 미발행 N개 출력
  const nextIdx = args.indexOf('--next');
  const n = nextIdx >= 0 ? parseInt(args[nextIdx + 1] || '1', 10) : 1;
  const pending = status.filter((s) => !s.published).slice(0, n);
  if (pending.length === 0) {
    console.log('🎉 캘린더의 모든 글이 발행됨!');
    return;
  }
  pending.forEach((p, i) => console.log(`${i + 1}. ${p.title}`));
}

main();

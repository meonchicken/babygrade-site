#!/usr/bin/env node
// 카니발라이제이션 사전 점검: 새 키워드 vs 기존 글 키워드 유사도
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');

// 한글 형태소 단순 분리 (공백 기준)
function tokenize(s) {
  return s
    .toLowerCase()
    .replace(/[(),.!?]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function similarity(a, b) {
  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));
  const intersection = [...setA].filter((x) => setB.has(x)).length;
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

function loadExisting() {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  return files.map((f) => {
    const raw = fs.readFileSync(path.join(POSTS_DIR, f), 'utf-8');
    const { data } = matter(raw);
    return {
      filename: f,
      mainKeyword: data.mainKeyword || '',
      title: data.title || '',
      lsi: data.lsiKeywords || [],
    };
  });
}

function check(newKeyword) {
  const existing = loadExisting();
  const issues = [];

  for (const post of existing) {
    // 1. 메인 키워드 정확 일치 (치명적)
    if (post.mainKeyword === newKeyword) {
      issues.push({
        level: 'CRITICAL',
        post,
        reason: `메인 키워드 완전 중복: "${newKeyword}"`,
        sim: 1,
      });
      continue;
    }

    // 2. 메인 키워드 유사도 (Jaccard)
    const sim = similarity(newKeyword, post.mainKeyword);
    if (sim >= 0.66) {
      issues.push({
        level: 'HIGH',
        post,
        reason: `메인 키워드 유사도 ${(sim * 100).toFixed(0)}%`,
        sim,
      });
    } else if (sim >= 0.5) {
      issues.push({
        level: 'WARN',
        post,
        reason: `메인 키워드 유사도 ${(sim * 100).toFixed(0)}%`,
        sim,
      });
    }
  }

  return issues;
}

if (require.main === module) {
  const newKw = process.argv[2];
  if (!newKw) {
    console.log('사용법: node check-cannibalization.js "강아지 사료"');
    process.exit(1);
  }
  const issues = check(newKw);
  if (issues.length === 0) {
    console.log(`✅ "${newKw}" — 카니발라이제이션 위험 없음`);
    process.exit(0);
  }
  console.log(`⚠️  "${newKw}"와 유사한 기존 글 ${issues.length}개:\n`);
  for (const i of issues) {
    const icon = i.level === 'CRITICAL' ? '⛔' : i.level === 'HIGH' ? '🚨' : '⚠️';
    console.log(`${icon} [${i.level}] ${i.post.mainKeyword} → ${i.reason}`);
    console.log(`   파일: ${i.post.filename}`);
  }
  console.log('\n💡 권장: 더 좁은 키워드로 변경 또는 기존 글에 통합');
  process.exit(issues.some((i) => i.level === 'CRITICAL') ? 1 : 0);
}

module.exports = { check, similarity };

#!/usr/bin/env node
// 마크다운 파일의 {{COUPANG_LINK_N}} 플레이스홀더를 실제 파트너스 링크로 치환
const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');

const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');

function buildCtaButton(product) {
  // SEO + CTR + 공정위 가이드라인 준수
  const safeName = product.name.replace(/"/g, '&quot;').substring(0, 60);
  return `<div class="cpg-block">
  <span class="cpg-tag">쿠팡 파트너스 · 수수료 제공</span>
  <a href="${product.url}" rel="nofollow noopener sponsored" target="_blank" class="cpg-cta">
    <span class="cpg-cta-label">🛒 쿠팡 최저가 보기</span>
    <span class="cpg-cta-name">${safeName}</span>
    <span class="cpg-cta-price">${product.price.toLocaleString()}원</span>
  </a>
</div>`;
}

function processFile(filepath) {
  const raw = fs.readFileSync(filepath, 'utf-8');
  const { data, content } = matter(raw);
  const products = data.products || [];

  if (products.length === 0) return { changed: false, replacements: 0 };

  let newContent = content;
  let count = 0;

  // {{COUPANG_LINK_N}} → 실제 버튼 HTML
  for (let i = 0; i < products.length; i++) {
    const placeholder = `{{COUPANG_LINK_${i + 1}}}`;
    if (newContent.includes(placeholder)) {
      const cta = buildCtaButton(products[i]);
      newContent = newContent.replaceAll(placeholder, cta);
      count++;
    }
  }

  if (count === 0) return { changed: false, replacements: 0 };

  // 남은 플레이스홀더 (예: {{COUPANG_LINK_4}}) 제거
  newContent = newContent.replace(/{{COUPANG_LINK_\d+}}/g, '');

  // 다시 frontmatter와 합쳐 저장
  const out = matter.stringify(newContent, data);
  fs.writeFileSync(filepath, out, 'utf-8');
  return { changed: true, replacements: count };
}

function main() {
  const files = fs.readdirSync(POSTS_DIR).filter((f) => f.endsWith('.md'));
  let total = 0;
  let touched = 0;
  for (const f of files) {
    const filepath = path.join(POSTS_DIR, f);
    const r = processFile(filepath);
    if (r.changed) {
      touched++;
      total += r.replacements;
      console.log(`✅ ${f}: ${r.replacements}개 치환`);
    } else {
      console.log(`   ${f}: (변경 없음)`);
    }
  }
  console.log(`\n총 ${touched}개 파일, ${total}개 링크 치환 완료`);
}

if (require.main === module) main();
module.exports = { processFile };

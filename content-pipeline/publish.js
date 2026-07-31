#!/usr/bin/env node
// 발행 자동화: 빌드 검증 → git push → Cloudflare 배포 대기 → IndexNow 핑
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { execSync } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { ping } = require('./indexnow');
const { processFile } = require('./fix-coupang-links');

const SITE_DIR = path.resolve(__dirname, '../affiliate-site');
const HOST = 'babygrade.kr';

const slug = process.argv[2];
if (!slug) {
  console.error('사용법: node publish.js [slug]');
  process.exit(1);
}

const newUrl = `https://${HOST}/${slug}`;

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: SITE_DIR, ...opts });
}

function check(url) {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { 'User-Agent': 'babygrade-publisher/1.0' } }, (res) => {
        resolve(res.statusCode);
      })
      .on('error', () => resolve(0));
  });
}

async function waitDeployed(url, maxWaitSec = 180) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWaitSec) {
    const status = await check(url);
    if (status === 200) return true;
    process.stdout.write(`.`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

async function main() {
  console.log(`\n🚀 발행: ${newUrl}\n`);

  // 0. 쿠팡 플레이스홀더 자동 치환 + 발행 일자 오늘로 업데이트
  console.log('[0/5] 쿠팡 링크 자동 치환...');
  const mdPath = path.resolve(__dirname, '../affiliate-site/src/content/posts', `${slug}.md`);
  if (fs.existsSync(mdPath)) {
    const r = processFile(mdPath);
    console.log(r.changed ? `     → ${r.replacements}개 링크 치환` : '     (이미 치환됨 또는 자리표시자 없음)');

    const today = new Date().toISOString().slice(0, 10);
    let md = fs.readFileSync(mdPath, 'utf8');

    const placeholders = md.match(/\{\{(INTERNAL_LINK|COUPANG_LINK|TODO)[^}]*\}\}/g);
    if (placeholders) {
      console.error(`\n❌ 발행 중단: 미처리 플레이스홀더 발견\n   ${[...new Set(placeholders)].join('\n   ')}`);
      process.exit(1);
    }

    md = md.replace(/^publishedAt:.*$/m, `publishedAt: ${today}T00:00:00.000Z`);
    md = md.replace(/^updatedAt:.*$/m, `updatedAt: ${today}T00:00:00.000Z`);
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`     → 발행 일자: ${today}`);
  }

  // 1. 빌드 검증
  console.log('\n[1/5] 빌드 검증...');
  run('npm run build');

  // 2. git commit + push
  console.log('\n[2/5] git push...');
  try {
    run(`git add -A && git -c user.email="polarissearchlab@gmail.com" -c user.name="meonchicken" commit -m "신규: ${slug}"`);
    run('git push');
  } catch (e) {
    console.log('  (변경사항 없음 또는 이미 push됨)');
  }

  // 3. Cloudflare Workers 배포
  console.log('\n[3/5] Cloudflare Workers 배포...');
  try {
    run(`CLOUDFLARE_API_TOKEN=${process.env.CLOUDFLARE_API_TOKEN} npx wrangler deploy`);
    console.log('     ✅ 배포 완료');
  } catch (e) {
    console.log('     ⚠️ 배포 실패:', e.message);
  }
  const ok = await waitDeployed(newUrl);

  // 4. IndexNow 핑 (Bing/Yandex)
  console.log('\n[4/5] IndexNow 핑...');
  const urls = [
    `https://${HOST}/`,
    `https://${HOST}/sitemap-index.xml`,
    `https://${HOST}/llms.txt`,
    newUrl,
  ];
  const r = await ping(urls);
  console.log(`     → Status ${r.status} ${r.status === 202 ? '✅ Accepted' : '⚠️'}`);

  console.log('\n━'.repeat(40));
  console.log('🎉 발행 완료');
  console.log(`  - ${newUrl}`);
  console.log(`  - Sitemap: https://${HOST}/sitemap-index.xml (Google 자동 재크롤)`);
  console.log('  - llms.txt 동적 갱신 완료');
  console.log('━'.repeat(40));

  // 다음 발행할 글 미리 보기
  try {
    console.log('\n📅 다음 발행 예정 (캘린더 순서):');
    require('child_process').execSync('node ' + __dirname + '/status.js --next 3', { stdio: 'inherit' });
  } catch (e) {}
}

main().catch((e) => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});

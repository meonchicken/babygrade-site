#!/usr/bin/env node
// 여러 글 한 번에 발행: 이미지 병렬 생성 → 링크 치환 → 빌드 1회 → 배포 1회 → IndexNow 일괄 핑
// 단일 글 publish.js를 N번 도는 것 대비: 이미지 병렬화 + 배포/폴링 1회로 통합해 체감 시간 단축
//
// 사용법:
//   node publish-batch.js slug1 slug2 slug3                 # 이미지 2장씩 생성 후 발행
//   node publish-batch.js --images 1 slug1 slug2            # 글당 인포그래픽 1장만
//   node publish-batch.js --images 0 slug1 slug2            # 이미지 생성 건너뜀(이미 생성됨)
//   node publish-batch.js --concurrency 6 slug1 slug2 ...   # 이미지 동시 생성 수(기본 4)
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { execSync } = require('child_process');
const path = require('path');
const https = require('https');
const fs = require('fs');
const { ping } = require('./indexnow');
const { processFile } = require('./fix-coupang-links');
const {
  readArticleContext,
  synthesizePrompts,
  buildImagePrompt,
  generateImage,
} = require('./generate-images');

const SITE_DIR = path.resolve(__dirname, '../affiliate-site');
// 2026-07-31 repo 재구성으로 git 루트가 affiliate-site/ 에서 한 단계 위로 올라왔다.
// git 명령을 SITE_DIR 에서 돌리면 `git add -A` 가 affiliate-site/ 하위만 담아
// 캘린더·PROGRESS 갱신이 커밋에서 누락된다. git 은 반드시 REPO_ROOT 에서 돈다.
const REPO_ROOT = path.resolve(__dirname, '..');
const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');
const IMAGES_DIR = path.resolve(__dirname, '../affiliate-site/public/images');
const HOST = 'babygrade.kr';

// ── 인자 파싱 ──────────────────────────────────────────────
function parseArgs(argv) {
  const slugs = [];
  let images = 2;
  let concurrency = 4;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--images') images = parseInt(argv[++i], 10);
    else if (a === '--concurrency') concurrency = parseInt(argv[++i], 10);
    else slugs.push(a.replace(/\.md$/, ''));
  }
  return { slugs, images, concurrency };
}

const { slugs, images: IMG_COUNT, concurrency: CONC } = parseArgs(process.argv.slice(2));

if (slugs.length === 0) {
  console.error('사용법: node publish-batch.js [--images N] [--concurrency N] slug1 slug2 ...');
  process.exit(1);
}

function run(cmd, opts = {}) {
  console.log(`$ ${cmd}`);
  return execSync(cmd, { stdio: 'inherit', cwd: SITE_DIR, ...opts });
}

function check(url) {
  return new Promise((resolve) => {
    https
      .get(url, { headers: { 'User-Agent': 'babygrade-publisher/1.0' } }, (res) => resolve(res.statusCode))
      .on('error', () => resolve(0));
  });
}

async function waitDeployed(url, maxWaitSec = 180) {
  const start = Date.now();
  while ((Date.now() - start) / 1000 < maxWaitSec) {
    const status = await check(url);
    if (status === 200 || status === 308) return true; // 308 = trailing-slash 리다이렉트(정상)
    process.stdout.write('.');
    await new Promise((r) => setTimeout(r, 5000));
  }
  return false;
}

// 동시 실행 수 제한 풀
async function pool(tasks, limit) {
  const results = [];
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (idx < tasks.length) {
      const cur = idx++;
      results[cur] = await tasks[cur]();
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  console.log(`\n🚀 일괄 발행: ${slugs.length}개 글\n   ${slugs.join('\n   ')}\n`);

  // 0. 존재 확인
  for (const slug of slugs) {
    const mdPath = path.join(POSTS_DIR, `${slug}.md`);
    if (!fs.existsSync(mdPath)) {
      console.error(`❌ 파일 없음: ${slug}.md`);
      process.exit(1);
    }
  }

  // 1. 이미지 병렬 생성 (모든 글 × 모든 장수를 한 풀에서 동시 처리)
  if (IMG_COUNT > 0) {
    console.log(`[1/5] 이미지 병렬 생성 (글당 ${IMG_COUNT}장, 동시 ${CONC}개)...`);
    if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });

    // 1-a. 글별 시각 묘사(Gemini 텍스트)도 병렬로
    const ctxList = slugs.map((slug) => ({ slug, ctx: readArticleContext(slug) }));
    const promptTasks = ctxList.map(({ slug, ctx }) => async () => {
      const prompts = await synthesizePrompts(ctx, IMG_COUNT);
      return { slug, prompts };
    });
    const synthesized = await pool(promptTasks, CONC);

    // 1-b. 이미지 생성 작업을 플랫하게 펼쳐 한 풀에서 동시 실행
    const imgTasks = [];
    for (const { slug, prompts } of synthesized) {
      prompts.forEach((p, i) => {
        const filepath = path.join(IMAGES_DIR, `${slug}-${i + 1}.png`);
        imgTasks.push(async () => {
          await generateImage(buildImagePrompt(p), filepath);
          console.log(`   ✅ ${slug}-${i + 1}.png`);
        });
      });
    }
    await pool(imgTasks, CONC);
    console.log(`     → 총 ${imgTasks.length}장 생성 완료`);
  } else {
    console.log('[1/5] 이미지 생성 건너뜀 (--images 0)');
  }

  // 2. 쿠팡 링크 치환 + 발행 일자 갱신 + 미처리 플레이스홀더 검사
  console.log('\n[2/5] 쿠팡 링크 치환 + 발행 일자...');
  const today = new Date().toISOString().slice(0, 10);
  for (const slug of slugs) {
    const mdPath = path.join(POSTS_DIR, `${slug}.md`);
    const r = processFile(mdPath);
    let md = fs.readFileSync(mdPath, 'utf8');
    const ph = md.match(/\{\{(INTERNAL_LINK|COUPANG_LINK|TODO)[^}]*\}\}/g);
    if (ph) {
      console.error(`\n❌ 발행 중단(${slug}): 미처리 플레이스홀더\n   ${[...new Set(ph)].join('\n   ')}`);
      process.exit(1);
    }
    md = md.replace(/^publishedAt:.*$/m, `publishedAt: ${today}T00:00:00.000Z`);
    md = md.replace(/^updatedAt:.*$/m, `updatedAt: ${today}T00:00:00.000Z`);
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`   ${slug}: ${r.changed ? r.replacements + '개 링크 치환' : '치환 없음'} · ${today}`);
  }

  // 3. 빌드 1회
  console.log('\n[3/5] 빌드 검증 (1회)...');
  run('npm run build');

  // 4. git 커밋·푸시 1회 + 배포 1회
  console.log('\n[4/5] git push + Cloudflare 배포 (1회)...');
  const msg = slugs.length === 1 ? `신규: ${slugs[0]}` : `신규 ${slugs.length}건: ${slugs.join(', ')}`;
  try {
    // 신원은 repo 의 git config 를 그대로 쓴다 (CLAUDE.md 「커밋 신원」 참조).
    // 2026-08-24 이전에는 여기에 이메일이 하드코딩돼 있어, repo config 를 고쳐도
    // 발행 커밋만 별개 계정(polarissearchlab-hub)에 기여자로 잡혔다. 다시 박아 넣지 말 것.
    run(`git add -A && git commit -m "${msg}"`, { cwd: REPO_ROOT });
    run('git push', { cwd: REPO_ROOT });
  } catch (e) {
    console.log('  (변경사항 없음 또는 이미 push됨)');
  }
  try {
    run(`CLOUDFLARE_API_TOKEN=${process.env.CLOUDFLARE_API_TOKEN} npx wrangler deploy`);
    console.log('     ✅ 배포 완료');
  } catch (e) {
    console.log('     ⚠️ 배포 실패:', e.message);
  }

  // 모든 글 URL 배포 대기 (병렬 폴링)
  console.log('\n     배포 반영 대기...');
  await Promise.all(slugs.map((s) => waitDeployed(`https://${HOST}/${s}`)));

  // 5. IndexNow 일괄 핑 (1회 호출에 전체 URL)
  console.log('\n[5/5] IndexNow 일괄 핑...');
  const urls = [
    `https://${HOST}/`,
    `https://${HOST}/sitemap-index.xml`,
    `https://${HOST}/llms.txt`,
    ...slugs.map((s) => `https://${HOST}/${s}`),
  ];
  const r = await ping(urls);
  console.log(`     → Status ${r.status} ${r.status === 202 ? '✅ Accepted' : '⚠️'} · URL ${urls.length}개`);

  console.log('\n' + '━'.repeat(40));
  console.log(`🎉 일괄 발행 완료 — ${slugs.length}개`);
  slugs.forEach((s) => console.log(`  - https://${HOST}/${s}`));
  console.log('  - Sitemap 자동 재크롤 · llms.txt 동적 갱신');
  console.log('━'.repeat(40));

  try {
    console.log('\n📅 다음 발행 예정:');
    execSync('node ' + __dirname + '/status.js --next 3', { stdio: 'inherit' });
  } catch (e) {}
}

main().catch((e) => {
  console.error('❌ 에러:', e.message);
  process.exit(1);
});

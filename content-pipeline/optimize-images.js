#!/usr/bin/env node
// 이미지 경량화 — public/images 의 PNG 원본을 webp 변형 3종(+히어로는 OG 용 JPEG)으로 변환한다.
//
// 왜: Flux 원본 PNG(1344×768)는 장당 약 1.2MB 인데 400×225 카드·64×48 썸네일에 그대로 쓰여
//     홈 한 번에 9.4MB, 글 한 편에 3.9MB 가 나갔다. 같은 그림을 webp q80 으로 바꾸면
//     51KB(원본 폭) · 12KB(800px) · 4KB(400px) 다. (2026-10-12 실측, 20~300배 절감)
//     KT 회선은 Cloudflare 가 시애틀(SEA) PoP 로 묶어 40KB/s 밖에 안 나오므로 용량이 곧 체감 속도다.
//
// 산출물 (원본 <name>.png 기준):
//   <name>.webp        원본 폭(최대 1344) — 히어로 · 본문 figure
//   <name>-800.webp    폭 800            — 카드 2x · 본문 1x
//   <name>-400.webp    폭 400            — 카드 1x · 사이드바 썸네일
//   <name>.jpg         히어로(-1)만. og:image / Schema 전용 (카톡·네이버 스크랩이 webp 를 못 읽을 가능성 대비)
//
// 템플릿 쪽 srcset 규칙은 affiliate-site/src/utils/local-images.ts 와 짝이다. 변형 폭을 바꾸면 양쪽을 같이 고친다.
//
// 사용:
//   node optimize-images.js                 # 아직 변환 안 된 원본만 (멱등 · 원본보다 산출물이 새로우면 건너뜀)
//   node optimize-images.js --force         # 전부 다시
//   node optimize-images.js <slug> [...]    # 해당 슬러그(-1, -2 …)만
//   node optimize-images.js --rm-source     # 변환 후 원본 PNG 삭제 — 파이프라인이 신규 생성 직후 쓰는 모드
//
// 기존 275장의 PNG 는 지우지 않는다. 이미 색인된 /images/<slug>-1.png URL 이 살아 있어야 하기 때문이다.
// 신규 생성분은 generate-images.js 가 이 모듈을 --rm-source 로 호출해 PNG 를 repo 에 남기지 않는다.

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const IMAGES_DIR = path.resolve(__dirname, '../affiliate-site/public/images');

const FULL_WIDTH = 1344;
const WEBP_QUALITY = 80;
const JPEG_QUALITY = 85;
const VARIANTS = [
  { suffix: '', width: FULL_WIDTH },
  { suffix: '-800', width: 800 },
  { suffix: '-400', width: 400 },
];

const isHero = (base) => /-1$/.test(base);

function outputsFor(srcPath) {
  const dir = path.dirname(srcPath);
  const base = path.basename(srcPath).replace(/\.(png|jpe?g)$/i, '');
  const outs = VARIANTS.map((v) => ({
    out: path.join(dir, `${base}${v.suffix}.webp`),
    width: v.width,
    kind: 'webp',
  }));
  if (isHero(base)) outs.push({ out: path.join(dir, `${base}.jpg`), width: FULL_WIDTH, kind: 'jpeg' });
  return outs;
}

function isFresh(out, srcMtimeMs) {
  try {
    return fs.statSync(out).mtimeMs >= srcMtimeMs;
  } catch {
    return false;
  }
}

async function optimizeImage(srcPath, { force = false, rmSource = false } = {}) {
  const srcMtime = fs.statSync(srcPath).mtimeMs;
  const produced = [];
  const skipped = [];
  for (const { out, width, kind } of outputsFor(srcPath)) {
    if (!force && isFresh(out, srcMtime)) {
      skipped.push(out);
      continue;
    }
    const img = sharp(srcPath).resize({ width, withoutEnlargement: true });
    if (kind === 'webp') await img.webp({ quality: WEBP_QUALITY, effort: 4 }).toFile(out);
    else await img.flatten({ background: '#ffffff' }).jpeg({ quality: JPEG_QUALITY, mozjpeg: true }).toFile(out);
    produced.push(out);
  }
  if (rmSource) fs.unlinkSync(srcPath);
  return { produced, skipped };
}

// 원본으로 취급하는 건 .png 뿐이다. .jpg 는 이 스크립트의 산출물(OG)이라 다시 입력으로 잡으면 안 된다.
function listSources(slugs) {
  return fs
    .readdirSync(IMAGES_DIR)
    .filter((f) => /\.png$/i.test(f))
    .filter((f) => slugs.length === 0 || slugs.some((s) => f.startsWith(`${s}-`)))
    .map((f) => path.join(IMAGES_DIR, f))
    .sort();
}

async function pool(tasks, size) {
  const results = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        results[i] = await tasks[i]();
      }
    })
  );
  return results;
}

const kb = (bytes) => `${Math.round(bytes / 1024)}KB`;

async function main() {
  const argv = process.argv.slice(2);
  const force = argv.includes('--force');
  const rmSource = argv.includes('--rm-source');
  const slugs = argv.filter((a) => !a.startsWith('--'));

  const sources = listSources(slugs);
  if (sources.length === 0) {
    console.log('변환할 PNG 원본이 없습니다.');
    return;
  }
  console.log(`🖼  원본 ${sources.length}장 → webp 변형 ${VARIANTS.length}종${force ? ' (강제 재생성)' : ''}`);

  let srcBytes = 0;
  let outBytes = 0;
  let producedCount = 0;
  let skippedCount = 0;
  const tasks = sources.map((src) => async () => {
    srcBytes += fs.statSync(src).size;
    const { produced, skipped } = await optimizeImage(src, { force, rmSource });
    producedCount += produced.length;
    skippedCount += skipped.length;
    for (const f of [...produced, ...skipped]) outBytes += fs.statSync(f).size;
    if (produced.length) console.log(`  ✅ ${path.basename(src)} → ${produced.map((p) => path.basename(p)).join(', ')}`);
  });
  await pool(tasks, 6);

  console.log(`\n생성 ${producedCount} · 건너뜀 ${skippedCount}`);
  console.log(`원본 합계 ${kb(srcBytes)} → 산출물 합계 ${kb(outBytes)} (OG JPEG 포함)`);
}

module.exports = { optimizeImage, outputsFor, IMAGES_DIR, FULL_WIDTH };

if (require.main === module) {
  main().catch((e) => {
    console.error('에러:', e.message);
    process.exit(1);
  });
}

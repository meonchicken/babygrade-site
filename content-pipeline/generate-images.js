#!/usr/bin/env node
// 인포그래픽 자동 생성 (Gemini Image API)
// A2: 글 본문(frontmatter + H2)을 Gemini 텍스트 모델에 넘겨 시각 묘사를 합성한 뒤 이미지 생성
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const fs = require('fs');
const path = require('path');
const https = require('https');
const matter = require('gray-matter');

const API_KEY = process.env.GEMINI_API_KEY;
const REPLICATE_API_TOKEN = process.env.REPLICATE_API_TOKEN;
const IMAGE_PROVIDER = process.env.IMAGE_PROVIDER || (REPLICATE_API_TOKEN ? 'replicate' : 'gemini');
const REPLICATE_MODEL = process.env.REPLICATE_MODEL || 'black-forest-labs/flux-schnell';
const IMAGES_DIR = path.resolve(__dirname, '../affiliate-site/public/images');
const POSTS_DIR = path.resolve(__dirname, '../affiliate-site/src/content/posts');

const SLUG = process.argv[2];
const COUNT = parseInt(process.argv[3] || '2', 10);

if (!SLUG && require.main === module) {
  console.error('사용법: node generate-images.js [slug] [count]');
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────
// Gemini HTTP helpers
// ─────────────────────────────────────────────────────────────

function geminiRequestOnce(modelPath, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'generativelanguage.googleapis.com',
        path: `/v1beta/models/${modelPath}?key=${API_KEY}`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(new Error(`Gemini 응답 파싱 실패: ${data.slice(0, 300)}`));
          }
        });
      }
    );
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// 503/과부하·일시적 429 자동 재시도 (잔액소진 depleted/limit:0 은 즉시 중단)
async function geminiRequest(modelPath, body) {
  for (let attempt = 1; ; attempt++) {
    const resp = await geminiRequestOnce(modelPath, body);
    const err = resp && resp.error;
    if (!err) return resp;
    const transient =
      [500, 502, 503, 504].includes(err.code) ||
      (err.code === 429 && !/depleted|limit: 0/i.test(err.message || ''));
    if (transient && attempt <= 4) {
      const wait = Math.min(2000 * 2 ** (attempt - 1), 16000);
      console.log(`⏳ Gemini ${err.code} 과부하 — ${wait / 1000}s 후 재시도 (${attempt}/4)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    return resp; // 비일시적 에러: 기존 호출부가 메시지 처리
  }
}

// ─────────────────────────────────────────────────────────────
// 1) 글 컨텍스트 읽기
// ─────────────────────────────────────────────────────────────

function readArticleContext(slug) {
  const filepath = path.join(POSTS_DIR, `${slug}.md`);
  if (!fs.existsSync(filepath)) throw new Error(`마크다운 없음: ${filepath}`);
  const raw = fs.readFileSync(filepath, 'utf8');
  const parsed = matter(raw);
  const fm = parsed.data;
  const h2 = [...parsed.content.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim());
  return {
    slug,
    title: fm.title || '',
    mainKeyword: fm.mainKeyword || '',
    category: fm.category || '',
    tldr: Array.isArray(fm.tldr) ? fm.tldr : [],
    products: (fm.products || []).map((p) => ({ name: p.name, features: p.features || [] })),
    faqQuestions: (fm.faq || []).map((f) => f.q),
    h2Headings: h2,
  };
}

// ─────────────────────────────────────────────────────────────
// 2) 시각 묘사 합성 (Gemini 텍스트)
// ─────────────────────────────────────────────────────────────

async function synthesizePrompts(ctx, count) {
  const meta = `You are an editorial infographic art director for BabyGrade, a Korean baby and infant product safety review site (Wirecutter-style, objective data tone with extra warmth). Categories include pregnancy products, newborn (0-12 months) items like diapers/formula/bottles, infant (1-3 years) items like strollers/car seats, and toddler (4-7 years) items.

ARTICLE CONTEXT:
- Title: ${ctx.title}
- Main keyword: ${ctx.mainKeyword}
- Category: ${ctx.category}
- TLDR points: ${ctx.tldr.join(' | ')}
- Products: ${ctx.products.map((p) => p.name).join(' / ')}
- Section headings (H2): ${ctx.h2Headings.join(' / ')}

TASK:
Generate exactly ${count} distinct visual descriptions for editorial ILLUSTRATIONS. Each is ONE cohesive pictorial scene — NOT a multi-panel chart, NOT a comparison table, NOT an infographic with labels. Each description must:
- Be highly specific to THIS article's subject using ONLY pictorial elements: product silhouettes, age-stage icons, abstract shield/check shapes (with no writing on them), proportional shapes. Do NOT depict any written criteria, numbers, or labels
- Differ from each other in composition and visual motif (do NOT repeat the same chart type)
- Be 1-3 sentences, English, concrete enough that an image model can render it
- Use the BabyGrade brand palette: soft pastel pink (#FFB4B4), soft pastel blue (#B4DFFF), cream (#fafaf7), gentle white. Allow tonal variation but AVOID coral, dark colors, or pet-care palette.
- COMPLETELY WORDLESS and pictorial: describe only objects, shapes, and simple icons. Never describe any text, letters, numbers, labels, written badges, price tags, charts, tables, or comparison panels (all labels are added later as an HTML overlay)
- Be flat minimal vector editorial style with rounded soft shapes, white or cream background, 16:9
- Visual motifs should match baby/infant context: gentle product silhouettes, age-stage icons, safety certification badges, soft cloud or star patterns. NEVER use pet, dog, or animal motifs (teddy bear icon is acceptable for toddler context).

OUTPUT FORMAT:
Return ONLY a JSON array of ${count} strings. No prose, no markdown fence, no keys. Example:
["First visual description here.", "Second visual description here."]`;

  const resp = await geminiRequest('gemini-2.5-flash:generateContent', {
    contents: [{ parts: [{ text: meta }] }],
    generationConfig: { temperature: 0.9, responseMimeType: 'application/json' },
  });

  const text = resp.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error(`프롬프트 합성 실패: ${JSON.stringify(resp).slice(0, 300)}`);

  let prompts;
  try {
    prompts = JSON.parse(text);
  } catch {
    const m = text.match(/\[[\s\S]*\]/);
    if (!m) throw new Error(`JSON 파싱 실패: ${text.slice(0, 300)}`);
    prompts = JSON.parse(m[0]);
  }
  if (!Array.isArray(prompts) || prompts.length === 0) throw new Error('프롬프트 배열 비어있음');
  return prompts.slice(0, count);
}

// ─────────────────────────────────────────────────────────────
// 3) 이미지 생성
// ─────────────────────────────────────────────────────────────

function buildImagePrompt(visualDescription) {
  return `${visualDescription}

CRITICAL RULES:
- White or cream (#fafaf7) background, flat minimal vector design with soft rounded shapes
- BabyGrade brand palette: soft pastel pink (#FFB4B4), soft pastel blue (#B4DFFF), cream, gentle white. ABSOLUTELY NO coral, orange, dark colors, or pet-care palette.
- Purely pictorial single illustration — COMPLETELY WORDLESS. No writing, letters, numbers, signage, labels, charts, tables, comparison panels, or badges containing text. Only objects, shapes, and simple icons.
- 16:9 aspect ratio, gentle warm editorial illustration style
- Baby/infant context only: diapers, bottles, strollers, age-stage silhouettes, safety badges. NO pets, NO dogs, NO household cleaning items.`;
}

async function generateImageGemini(prompt, filename) {
  const resp = await geminiRequest('gemini-2.5-flash-image:generateContent', {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  });
  const part = resp.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part?.inlineData?.data) {
    throw new Error(`이미지 데이터 없음: ${JSON.stringify(resp).slice(0, 300)}`);
  }
  fs.writeFileSync(filename, Buffer.from(part.inlineData.data, 'base64'));
  console.log(`✅ ${path.basename(filename)}`);
}

// Replicate Flux Schnell (~$0.003/장) — Gemini 대비 비용 절감용.
async function generateImageReplicate(prompt, filename) {
  let pred;
  for (let attempt = 1; ; attempt++) {
    const create = await fetch(`https://api.replicate.com/v1/models/${REPLICATE_MODEL}/predictions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}`, 'Content-Type': 'application/json', Prefer: 'wait' },
      body: JSON.stringify({ input: { prompt, aspect_ratio: '16:9', num_outputs: 1, output_format: 'png', go_fast: true } }),
    });
    if (create.ok) { pred = await create.json(); break; }
    const body = await create.text();
    if ((create.status === 429 || create.status >= 500) && attempt <= 6) {
      let wait = 2000 * attempt;
      try { const j = JSON.parse(body); if (j.retry_after) wait = Math.max(wait, (j.retry_after + 1) * 1000); } catch (e) {}
      console.log(`⏳ Replicate ${create.status} 제한 — ${Math.round(wait / 1000)}s 후 재시도 (${attempt}/6)`);
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    throw new Error(`Replicate 생성 실패 (${create.status}): ${body.slice(0, 300)}`);
  }
  while (!['succeeded', 'failed', 'canceled'].includes(pred.status) && pred && pred.urls && pred.urls.get) {
    await new Promise((r) => setTimeout(r, 1500));
    pred = await (await fetch(pred.urls.get, { headers: { Authorization: `Bearer ${REPLICATE_API_TOKEN}` } })).json();
  }
  if (pred.status !== 'succeeded') throw new Error(`Replicate 실패: ${JSON.stringify(pred.error || pred.status).slice(0, 200)}`);
  const url = Array.isArray(pred.output) ? pred.output[0] : pred.output;
  if (!url) throw new Error(`Replicate 출력 없음: ${JSON.stringify(pred).slice(0, 300)}`);
  const img = await fetch(url);
  fs.writeFileSync(filename, Buffer.from(await img.arrayBuffer()));
  console.log(`✅ ${path.basename(filename)}`);
}

async function generateImage(prompt, filename) {
  return IMAGE_PROVIDER === 'replicate'
    ? generateImageReplicate(prompt, filename)
    : generateImageGemini(prompt, filename);
}


async function generateForArticle(slug, prompts) {
  if (!fs.existsSync(IMAGES_DIR)) fs.mkdirSync(IMAGES_DIR, { recursive: true });
  for (let i = 0; i < prompts.length; i++) {
    const filepath = path.join(IMAGES_DIR, `${slug}-${i + 1}.png`);
    console.log(`\n[${i + 1}/${prompts.length}] 생성 중...`);
    console.log(`   시각 묘사: ${prompts[i].slice(0, 120)}${prompts[i].length > 120 ? '...' : ''}`);
    await generateImage(buildImagePrompt(prompts[i]), filepath);
  }
}

module.exports = {
  generateImage,
  generateForArticle,
  buildImagePrompt,
  readArticleContext,
  synthesizePrompts,
};

// ─────────────────────────────────────────────────────────────
// CLI 본문
// ─────────────────────────────────────────────────────────────

if (require.main === module) {
  (async () => {
    try {
      console.log(`📖 글 읽기: ${SLUG}`);
      const ctx = readArticleContext(SLUG);
      console.log(`   메인키워드: ${ctx.mainKeyword} · 카테고리: ${ctx.category}`);
      console.log(`\n🤖 시각 묘사 합성 (${COUNT}개) ...`);
      const prompts = await synthesizePrompts(ctx, COUNT);
      await generateForArticle(SLUG, prompts);
      console.log('\n🎉 완료');
    } catch (e) {
      console.error('에러:', e.message);
      process.exit(1);
    }
  })();
}

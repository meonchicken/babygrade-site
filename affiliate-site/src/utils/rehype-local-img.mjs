// 본문 md 안의 <img src="/images/<name>.webp"> 에 빌드 시 srcset · sizes · decoding 을 붙인다.
// 글은 계속 단순한 <img src> 한 줄만 쓰면 된다. 변형 규칙은 content-pipeline/optimize-images.js 와 같다
// (src/utils/local-images.ts 와 중복이지만, astro.config 가 읽는 파일이라 의존성 없이 둔다).
//
// Astro 는 md 안의 raw HTML 을 hast `element` 가 아니라 `raw` 노드(문자열)로 넘긴다 — rehype-raw 를 안 끼운다.
// 그래서 element 와 raw 문자열 두 경로를 다 처리한다. (2026-10-12 실측: element 만 보면 114편이 그대로 빠진다)
//
// 본문 figure.infographic img 는 max-width 600px 이라 800 변형이면 2x 까지 충분하다.

const FULL_WIDTH = 1344;
const BODY_SIZES = '(max-width: 600px) 100vw, 600px';
const LOCAL_WEBP = /^\/images\/([A-Za-z0-9_-]+)\.webp$/;
const IMG_TAG = /<img\b([^>]*?)\ssrc="(\/images\/([A-Za-z0-9_-]+)\.webp)"([^>]*)>/g;

const isVariant = (base) => /-(400|800)$/.test(base);
const srcsetFor = (base) =>
  `/images/${base}-400.webp 400w, /images/${base}-800.webp 800w, /images/${base}.webp ${FULL_WIDTH}w`;

function decorateRawHtml(html) {
  return html.replace(IMG_TAG, (tag, before, src, base, after) => {
    if (isVariant(base) || /\bsrcset=/.test(tag)) return tag;
    let extra = ` srcset="${srcsetFor(base)}"`;
    if (!/\bsizes=/.test(tag)) extra += ` sizes="${BODY_SIZES}"`;
    if (!/\bdecoding=/.test(tag)) extra += ' decoding="async"';
    return `<img${before} src="${src}"${extra}${after}>`;
  });
}

function decorateElement(node) {
  const props = node.properties ?? {};
  const src = typeof props.src === 'string' ? props.src : '';
  const m = src.match(LOCAL_WEBP);
  if (!m || isVariant(m[1]) || props.srcSet || props.srcset) return;
  props.srcSet = srcsetFor(m[1]);
  if (!props.sizes) props.sizes = BODY_SIZES;
  if (!props.decoding) props.decoding = 'async';
  node.properties = props;
}

function walk(node, fn) {
  if (!node) return;
  fn(node);
  if (Array.isArray(node.children)) for (const child of node.children) walk(child, fn);
}

export default function rehypeLocalImg() {
  return (tree) => {
    walk(tree, (node) => {
      if (node.type === 'element' && node.tagName === 'img') decorateElement(node);
      else if (node.type === 'raw' && typeof node.value === 'string' && node.value.includes('/images/')) {
        node.value = decorateRawHtml(node.value);
      }
    });
  };
}

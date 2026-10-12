// 로컬 일러스트(/images/<name>.webp) 의 변형 규칙 — content-pipeline/optimize-images.js 와 짝이다.
// 그 스크립트가 <name>.webp(1344) · <name>-800.webp · <name>-400.webp · 히어로는 <name>.jpg(OG) 를 만든다.
// 변형 폭을 바꾸면 양쪽을 같이 고친다.
//
// 왜 srcset 인가: 카드(400×225)·사이드바 썸네일(64×48)이 1344px 원본을 받아 홈 한 번에 9.4MB 가 나갔다 (2026-10-12).

import { proxyImage } from './image-proxy';

export const FULL_WIDTH = 1344;
const LOCAL_WEBP = /^\/images\/([A-Za-z0-9_-]+)\.webp$/;

function baseName(src: string | undefined | null): string | null {
  if (!src) return null;
  const m = src.match(LOCAL_WEBP);
  if (!m || /-(400|800)$/.test(m[1])) return null; // 변형 파일 자체를 다시 변형하지 않는다
  return m[1];
}

/** 브라우저가 표시 폭에 맞는 변형을 고르도록 srcset 을 돌려준다. 로컬 webp 가 아니면 undefined (속성 생략). */
export function localSrcset(src: string | undefined | null): string | undefined {
  const base = baseName(src);
  if (!base) return undefined;
  return `/images/${base}-400.webp 400w, /images/${base}-800.webp 800w, /images/${base}.webp ${FULL_WIDTH}w`;
}

/** og:image · Schema 용. 로컬 webp 히어로는 JPEG 사본을, 그 외(쿠팡 등)는 프록시 경로를 가리킨다. */
export function ogImageFor(rawUrl: string | undefined | null): string {
  const base = baseName(rawUrl);
  return base ? `/images/${base}.jpg` : proxyImage(rawUrl);
}

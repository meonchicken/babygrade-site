// 외부(쿠팡) 이미지 URL을 자체 도메인의 Worker 프록시 경로로 변환.
// 목적: ① 이미지 검색 색인을 babygrade.kr 도메인으로 ② Cloudflare edge 캐시 확보
// 변환 후 URL: /img/<base64url>.jpg  (확장자는 캐시 키와 확장자 추론용 장식)
//
// ⚠️ 화이트리스트는 src/worker.ts 의 ALLOWED_IMAGE_HOSTS 와 반드시 동기화할 것.

const ALLOWED_HOSTS = new Set([
  'ads-partners.coupang.com',
  'image1.coupangcdn.com',
  'image2.coupangcdn.com',
  'image3.coupangcdn.com',
  'image4.coupangcdn.com',
  'image5.coupangcdn.com',
  'image6.coupangcdn.com',
  'image7.coupangcdn.com',
  'image8.coupangcdn.com',
  'image9.coupangcdn.com',
  'image10.coupangcdn.com',
  'static.coupangcdn.com',
  'thumbnail6.coupangcdn.com',
  'thumbnail7.coupangcdn.com',
  'thumbnail8.coupangcdn.com',
  'thumbnail9.coupangcdn.com',
  'thumbnail10.coupangcdn.com',
]);

function base64Url(input: string): string {
  // Node(빌드)와 Cloudflare Workers(런타임) 양쪽 모두 동작
  const buf =
    typeof Buffer !== 'undefined'
      ? Buffer.from(input, 'utf-8').toString('base64')
      : btoa(unescape(encodeURIComponent(input)));
  return buf.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function proxyImage(rawUrl: string | undefined | null): string {
  if (!rawUrl) return '';
  if (rawUrl.startsWith('/')) return rawUrl; // 이미 로컬 경로면 그대로

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }

  if (parsed.protocol !== 'https:' || !ALLOWED_HOSTS.has(parsed.hostname)) {
    return rawUrl; // 화이트리스트 밖이면 원본 fallback
  }

  return `/img/${base64Url(rawUrl)}.jpg`;
}

export function absoluteProxyImage(rawUrl: string | undefined | null, siteOrigin: string): string {
  const path = proxyImage(rawUrl);
  if (!path) return '';
  if (path.startsWith('http')) return path;
  return new URL(path, siteOrigin).href;
}

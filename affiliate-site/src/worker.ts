// Cloudflare Worker entry — BabyGrade
// - www.babygrade.kr → babygrade.kr (301 영구)
// - /robots.txt 는 Worker가 직접 응답 (Cloudflare Managed robots.txt 자동 prepend 우회)
// - 검색엔진 verification HTML은 직접 200으로 서빙
// - /img/<base64url-coupang-url>(.ext) → 쿠팡 이미지를 자체 도메인으로 프록시 + 1년 캐시
// - ASSETS의 307 trailing-slash redirect → 308 영구 변환
// - 그 외 요청은 정적 자산 바인딩에 그대로 위임
//
// HTTP → HTTPS 강제는 Cloudflare 대시보드의
// "SSL/TLS → Edge Certificates → Always Use HTTPS"에서 처리.

interface Env {
  ASSETS: Fetcher;
  // 발행 감시용 (Worker secret — GitHub Secret 과 별개다)
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

// ⚠️ src/utils/image-proxy.ts 의 ALLOWED_HOSTS 와 동기화 유지
const ALLOWED_IMAGE_HOSTS = new Set([
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

function decodeUrl(encoded: string): string | null {
  try {
    const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
    return atob(b64 + pad);
  } catch {
    return null;
  }
}

async function handleImageProxy(request: Request, encoded: string): Promise<Response> {
  const src = decodeUrl(encoded);
  if (!src) return new Response('bad request', { status: 400 });

  let target: URL;
  try {
    target = new URL(src);
  } catch {
    return new Response('bad url', { status: 400 });
  }
  if (target.protocol !== 'https:') return new Response('https only', { status: 400 });
  if (!ALLOWED_IMAGE_HOSTS.has(target.hostname)) {
    return new Response('host not allowed', { status: 400 });
  }

  const cache = (caches as unknown as { default: Cache }).default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const upstream = await fetch(target.toString(), {
    cf: { cacheTtl: 31536000, cacheEverything: true },
    headers: { 'User-Agent': 'babygrade-image-proxy/1.0' },
  });

  if (!upstream.ok) {
    return new Response('upstream error', { status: upstream.status });
  }

  const ct = upstream.headers.get('content-type') || 'image/jpeg';
  const headers = new Headers({
    'content-type': ct,
    'cache-control': 'public, max-age=31536000, immutable',
    'x-content-type-options': 'nosniff',
    'access-control-allow-origin': '*',
  });

  const response = new Response(upstream.body, { status: 200, headers });
  await cache.put(cacheKey, response.clone());
  return response;
}

// Worker가 직접 서빙하는 robots.txt. ASSETS 경로를 거치지 않으므로
// Cloudflare의 "Managed robots.txt" 자동 주입이 적용되지 않는다.
const ROBOTS_TXT = `# BabyGrade robots.txt — Worker 직접 서빙
# 정책: 검색 노출 우선. 모든 합법적 크롤러 전체 허용.

# ── 일반 검색엔진 ──
User-agent: *
Allow: /

# ── AI 검색 크롤러 (검색 인용 노출 목적) ──
User-agent: OAI-SearchBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Applebot
Allow: /

User-agent: Bingbot
Allow: /

# ── AI 학습 크롤러 (브랜드/제품 학습 허용) ──
User-agent: GPTBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: CCBot
Allow: /

User-agent: Amazonbot
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: meta-externalagent
Allow: /

User-agent: Bytespider
Allow: /

Sitemap: https://babygrade.kr/sitemap-index.xml
`;

// ─────────────────────────────────────────────────────────────
// 발행 감시 (Cron Trigger)
//
// 왜 여기 있나: 알림이 전부 GitHub Actions **안**에서 나가므로, 실행 자체가 안 뜨거나
// 러너를 못 잡으면 알림 경로도 같이 사라진다 — 실패가 아니라 **침묵**이 된다.
// 2026-08-07 에 실제로 그렇게 하루가 비었고 사람이 물어보기 전까지 아무도 몰랐다.
// 그래서 감시자를 감시 대상 **밖**(다른 회사 인프라)에 둔다.
//
// 판정 기준은 사이트가 스스로 내놓는 RSS 의 최신 pubDate 다. 발행이 됐다면 배포도 됐고
// RSS 도 갱신돼 있으므로 **배포까지 포함한 체인 끝단을 통째로** 검사하는 셈이다.
// ─────────────────────────────────────────────────────────────

const kstDate = (t: number) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);

async function notify(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return;
  const body = new URLSearchParams({
    chat_id: env.TELEGRAM_CHAT_ID,
    parse_mode: 'HTML',
    disable_web_page_preview: 'true',
    text,
  });
  await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
}

async function checkPublishedToday(env: Env): Promise<void> {
  const today = kstDate(Date.now());
  let newest: string | null = null;
  try {
    const res = await env.ASSETS.fetch(new Request('https://babygrade.kr/rss.xml'));
    if (res.ok) {
      const dates = [...(await res.text()).matchAll(/<pubDate>([^<]+)<\/pubDate>/g)]
        .map((m) => Date.parse(m[1]))
        .filter((n) => !Number.isNaN(n));
      if (dates.length) newest = kstDate(Math.max(...dates));
    }
  } catch {
    /* newest === null 로 처리 */
  }

  if (newest === today) return; // 정상 — 조용히 끝낸다

  await notify(
    env,
    `🔴 <b>babygrade — 오늘 발행이 없습니다</b>\n` +
      `오늘(KST) ${today} · RSS 최신 ${newest ?? '읽기 실패'}\n\n` +
      `자동 발행이 세 슬롯(02·08·14시) 모두 실패했거나 실행 자체가 뜨지 않은 상태입니다.\n` +
      `<code>gh run list -R meonchicken/babygrade-site --workflow=daily-publish.yml --limit 5</code>\n` +
      `수동 실행: <code>gh workflow run daily-publish.yml -R meonchicken/babygrade-site -f dry_run=false -f force=true</code>`
  );
}

export default {
  // 21:00 KST — 본 슬롯·보충 2회가 다 끝난 뒤 확인한다 (wrangler.toml [triggers])
  async scheduled(_e: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(checkPublishedToday(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1) www → apex (영구)
    if (url.hostname === 'www.babygrade.kr') {
      url.hostname = 'babygrade.kr';
      return Response.redirect(url.toString(), 301);
    }

    // 1.5) 구 한글 카테고리 슬러그 → 영문 (301 영구) — src/utils/categories.ts 와 동기화
    const CATEGORY_SLUG: Record<string, string> = {
      '임산부': 'maternity', '신생아': 'newborn', '영아': 'infant',
      '유아': 'toddler', '안전': 'safety', '기타': 'etc',
    };
    const catMatch = url.pathname.match(/^\/category\/([^/]+)\/?$/);
    if (catMatch) {
      const seg = decodeURIComponent(catMatch[1]);
      if (CATEGORY_SLUG[seg]) {
        url.pathname = `/category/${CATEGORY_SLUG[seg]}/`;
        return Response.redirect(url.toString(), 301);
      }
    }

    // 2) robots.txt 는 Worker가 직접 응답 (Cloudflare prepend 우회)
    if (url.pathname === '/robots.txt') {
      return new Response(ROBOTS_TXT, {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=3600, s-maxage=3600',
        },
      });
    }

    // 2.5) /img/<base64url>(.ext) → 쿠팡 이미지 프록시 (1년 immutable 캐시)
    const imgMatch = url.pathname.match(/^\/img\/([A-Za-z0-9_-]+)(?:\.[a-z]{2,4})?$/);
    if (imgMatch) return handleImageProxy(request, imgMatch[1]);

    // 3) 검색엔진 verification 파일: 리다이렉트 없이 200으로 직접 서빙
    //    (Naver/Google 검증 봇이 리다이렉트를 따라가지 않는 경우 대비)
    if (/^\/(naver|google|baidu|yandex|bing)[a-z0-9]+\.html$/i.test(url.pathname)) {
      const direct = new Request(new URL(url.pathname, 'https://babygrade.kr').toString(), request);
      const r = await env.ASSETS.fetch(direct);
      if (r.status >= 300 && r.status < 400) {
        const location = r.headers.get('Location');
        if (location) {
          return env.ASSETS.fetch(new Request(new URL(location, url).toString(), request));
        }
      }
      return r;
    }

    // 4) 정적 자산 위임
    const res = await env.ASSETS.fetch(request);

    // 5) ASSETS가 만든 307(임시) trailing-slash redirect를 308(영구)로 승격
    if (res.status === 307 && res.headers.get('Location')) {
      return new Response(null, {
        status: 308,
        headers: { Location: res.headers.get('Location')! },
      });
    }

    return res;
  },
};

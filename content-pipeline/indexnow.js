// IndexNow API 핑 (Bing, Yandex 즉시 인덱싱)
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const https = require('https');

const KEY = process.env.INDEXNOW_KEY || '24434e9c8dd856a2c5435a4bcf9788f9';
const HOST = 'babygrade.kr';

async function ping(urls) {
  if (!Array.isArray(urls)) urls = [urls];
  const body = JSON.stringify({
    host: HOST,
    key: KEY,
    keyLocation: `https://${HOST}/${KEY}.txt`,
    urlList: urls,
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: 'api.indexnow.org',
        path: '/indexnow',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => resolve({ status: res.statusCode, body: data }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { ping };

if (require.main === module) {
  const urls = process.argv.slice(2);
  if (urls.length === 0) {
    console.log('사용법: node indexnow.js "https://doggrade.com/posts/slug"');
    process.exit(1);
  }
  ping(urls).then((r) => console.log(`Status: ${r.status} (${r.status === 202 ? '✅ Accepted' : 'check body'}) ${r.body}`));
}

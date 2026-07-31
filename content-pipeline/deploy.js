#!/usr/bin/env node
// 인프라/설정 변경 후 수동 배포: npm run build + wrangler deploy
// 글 발행은 publish.js 사용. 이 스크립트는 robots.txt, _headers 등 설정 변경 시 사용.
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const { execSync } = require('child_process');
const path = require('path');

const SITE_DIR = path.resolve(__dirname, '../affiliate-site');

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: 'inherit', cwd: SITE_DIR });
}

console.log('\n🔧 인프라 배포\n');

console.log('[1/2] 빌드...');
run('npm run build');

console.log('\n[2/2] Cloudflare Workers 배포...');
run(`CLOUDFLARE_API_TOKEN=${process.env.CLOUDFLARE_API_TOKEN} npx wrangler deploy`);

console.log('\n✅ 배포 완료 — https://doggrade.com');

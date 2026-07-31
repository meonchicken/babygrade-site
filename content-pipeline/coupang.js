// 쿠팡 파트너스 API 클라이언트
require('dotenv').config({ path: require('path').resolve(__dirname, '.env') });
const crypto = require('crypto');
const axios = require('axios');

const ACCESS_KEY = process.env.COUPANG_ACCESS_KEY;
const SECRET_KEY = process.env.COUPANG_SECRET_KEY;
const DOMAIN = 'https://api-gateway.coupang.com';

function generateAuthHeader(method, path, query = '') {
  const datetime = new Date().toISOString().substr(2, 17).replace(/:/g, '').replace(/-/g, '') + 'Z';
  const message = datetime + method + path + query;
  const signature = crypto.createHmac('sha256', SECRET_KEY).update(message).digest('hex');
  return `CEA algorithm=HmacSHA256, access-key=${ACCESS_KEY}, signed-date=${datetime}, signature=${signature}`;
}

// 키워드로 상품 검색
async function searchProducts(keyword, limit = 10) {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/products/search';
  const query = `keyword=${encodeURIComponent(keyword)}&limit=${limit}`;

  const res = await axios.get(`${DOMAIN}${path}?${query}`, {
    headers: {
      Authorization: generateAuthHeader('GET', path, query),
      'Content-Type': 'application/json',
    },
  });

  return res.data?.data?.productData || [];
}

// 베스트 카테고리 상품
async function getBestProducts(categoryId, limit = 20) {
  const path = `/v2/providers/affiliate_open_api/apis/openapi/v1/products/bestcategories/${categoryId}`;
  const query = `limit=${limit}`;

  const res = await axios.get(`${DOMAIN}${path}?${query}`, {
    headers: {
      Authorization: generateAuthHeader('GET', path, query),
      'Content-Type': 'application/json',
    },
  });

  return res.data?.data || [];
}

// 일반 URL을 파트너스 딥링크로 변환
async function generateDeepLink(coupangUrls) {
  const path = '/v2/providers/affiliate_open_api/apis/openapi/v1/deeplink';
  const body = JSON.stringify({ coupangUrls });

  const res = await axios.post(`${DOMAIN}${path}`, body, {
    headers: {
      Authorization: generateAuthHeader('POST', path, ''),
      'Content-Type': 'application/json',
    },
  });

  return res.data?.data || [];
}

module.exports = { searchProducts, getBestProducts, generateDeepLink };

// 단독 실행 시 테스트
if (require.main === module) {
  const keyword = process.argv[2] || '강아지사료';
  searchProducts(keyword, 5)
    .then((products) => {
      console.log(`[${keyword}] 검색 결과 (${products.length}개):\n`);
      products.forEach((p, i) => {
        console.log(`${i + 1}. ${p.productName}`);
        console.log(`   가격: ${p.productPrice?.toLocaleString()}원`);
        console.log(`   파트너스 링크: ${p.productUrl}`);
        console.log(`   이미지: ${p.productImage}`);
        console.log('');
      });
    })
    .catch((e) => console.error('에러:', e.response?.data || e.message));
}

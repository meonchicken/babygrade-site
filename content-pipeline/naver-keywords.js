// 네이버 키워드 LSI 추출
const crypto = require('crypto');
const axios = require('axios');

const API_KEY = '010000000004ca45e9a5dd77f4814778827552a3b4cce10a71da2fd8736db38d65d0235bb6';
const SECRET = 'AQAAAAAEykXppd139IFHeIJ1UqO0pCYg2aS2cQiEvSQs2/Vqxw==';
const CUSTOMER_ID = '3578661';

async function getRelatedKeywords(seedKeyword) {
  const path = '/keywordstool';
  const timestamp = Date.now().toString();
  const sig = crypto.createHmac('sha256', SECRET).update(`${timestamp}.GET.${path}`).digest('base64');

  const res = await axios.get(`https://api.naver.com${path}?hintKeywords=${encodeURIComponent(seedKeyword)}&showDetail=1`, {
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': API_KEY,
      'X-Customer': CUSTOMER_ID,
      'X-Signature': sig,
    },
  });

  return (res.data?.keywordList || [])
    .map((k) => ({
      keyword: k.relKeyword,
      total: (k.monthlyPcQcCnt || 0) + (k.monthlyMobileQcCnt || 0),
      competition: k.compIdx,
    }))
    .sort((a, b) => b.total - a.total);
}

module.exports = { getRelatedKeywords };

if (require.main === module) {
  getRelatedKeywords(process.argv[2] || '강아지사료').then((list) => {
    console.log(`상위 20개 LSI 키워드:`);
    list.slice(0, 20).forEach((k) => console.log(`${k.keyword.padEnd(20)} ${k.total.toLocaleString().padStart(8)} (${k.competition})`));
  });
}

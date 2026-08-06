# BabyGrade 프로젝트 컨텍스트

> **새 Claude 세션이 이 파일을 자동으로 읽어 컨텍스트를 파악합니다.**

---

## 무인 자동 발행 (2026-07-31~)

**매일 02:00 KST**, GitHub Actions 러너에서 글 1편을 쓰고 게이트를 통과하면 발행한다. 노트북 전원 무관.
지시서는 `content-pipeline/auto-publish-prompt.md`, 게이트는 `content-pipeline/gate.js`(15항).

> ⚠️ **repo 루트 = 이 폴더(`babygrade/`)다.** 2026-07-31 재구성 전에는 `affiliate-site/` 가 루트였다.
> 클라우드는 repo 만 내려받으므로 **규칙 문서·파이프라인이 repo 밖에 있으면 존재하지 않는 것과 같다.**
> 새 규칙 문서를 만들면 반드시 커밋할 것.

| | |
|---|---|
| 실행 | `.github/workflows/daily-publish.yml` (cron `0 17 * * *` = 02:00 KST) |
| 배포 | `.github/workflows/deploy.yml` — **`wrangler deploy`(Workers)**. Pages 아님 |
| 안전장치 | ① repo variable `LIVE_PUBLISH=true` 여야 실전 ② 그날 수동 발행 있으면 스킵 ③ 게이트 block 1건이면 중단 |
| 알림 | Telegram (🟢 발행 / 🟡 게이트 보류 / ⚪️ 슬롯없음 / ⏭ 수동발행 감지 / 🔴 실패) |

```bash
gh variable set LIVE_PUBLISH --body false -R meonchicken/babygrade-site   # 멈추기
gh run list -R meonchicken/babygrade-site --workflow=daily-publish.yml    # 로그
node content-pipeline/gate.js --all                                       # 게이트 오탐률 점검
node content-pipeline/gate.test.js                                        # 사전 회귀 테스트
node content-pipeline/gate.js --all --prices                              # 기존 글 가격 드리프트 감사
```

**게이트를 고칠 때는 `gate.js --all`(오탐 0 유지)과 `gate.test.js`(누락 0 유지)를 둘 다 돌린다.**
한쪽만 보면 반대 방향으로 조용히 무너진다.

> 🚨 **키워드 선정은 네이버 SERP 게이트를 통과해야 한다 (2026-08-04~).**
> `bash ../../../keyword-tool/naver-serp.sh "키워드1" "키워드2"` → 웹문서 컬렉션 위치(px) + 상위 도메인 강도.
> **🟢(강도 0~1 · ≤400px)만 슬롯에 넣는다.** 네이버 검색량이 아무리 커도 쇼핑몰·정부기관·의학매체가
> 웹문서 상위를 채우면 발행해도 노출되지 않는다 — 발행 완료 8건 실측에서 **7건이 이 이유로 미노출**이었다.
> 상세 근거 → `EDITORIAL-CALENDAR.md` 「2026-08-04 네이버 SERP 게이트 실측」

**컨텍스트 크기 = 실행 비용.** 자동 발행이 매 실행 통째로 읽는 문서는
`CLAUDE.md` + `EDITORIAL-CALENDAR.md` + `WORKFLOW.md` + `CLUSTERS.md` 4종(현재 약 58KB)뿐이다.
끝난 주차는 `EDITORIAL-CALENDAR-ARCHIVE.md` 로 옮긴다(30KB 넘으면 Telegram 경고).

---

## 외부 이미지 자체 도메인 프록시 (자동 적용 중)

쿠팡 상품 이미지는 빌드 타임에 **`/img/<base64>.jpg` 자체 도메인 경로로 자동 변환**되어 출력된다.
구현 위치: `affiliate-site/src/utils/image-proxy.ts` + `src/worker.ts` (자세한 원리는 `어필리에이트/IMAGE-PROXY-PLAYBOOK.md`)

- **글 작성자 행동 변화 없음** — md 프론트매터에 평소처럼 `https://ads-partners.coupang.com/...` URL을 넣으면, 빌드가 알아서 자체 도메인 경로로 바꾼다.
- **새 외부 호스트(예: `image11.coupangcdn.com`)가 등장하면** `worker.ts`의 `ALLOWED_IMAGE_HOSTS` + `image-proxy.ts`의 `ALLOWED_HOSTS` **두 곳을 동기화**한 뒤 재배포.
- **검증 한 줄**: `grep -roE 'src="https://[^/]*coupang[^"]*"' dist/ | wc -l` → 0이면 정상.

---

## 프로젝트 정의

**BabyGrade**: 임산부·영유아 용품 등급 비교 어필리에이트 사이트
- 도메인: https://babygrade.kr (구매 예정 — 2026-05-13 결정)
- 수익화: 쿠팡 파트너스 (파트너스 ID 신규 발급 또는 `AF2360800` 통합 — 사용자 확정 필요)
- 타겟: **한국 네이버 검색** (2026-08-04 전환 — 그 전에는 Google 우선이었다)
  - Google 색인이 사실상 정지 → 네이버는 48개 URL 수집 + 신규 글 **5일 내 색인** 확인
  - **네이버 블로그 운영은 여전히 금지** (C-Rank 저품질) — 자체 도메인의 **웹문서 컬렉션**을 노리는 것이다
  - 키워드 선정 게이트: `bash ../../../keyword-tool/naver-serp.sh "키워드"` → 🟢(강도 0~1)만 발행
- 톤: **doggrade와 100% 동일** (Wirecutter 스타일 · 객관·데이터·등급)
- 작성자: `babygrade Editorial Team` (개인 X, 팀 페르소나)

---

## 빠른 컨텍스트 파악 순서

새 세션에서 이 순서대로 읽으면 5분 안에 풀 컨텍스트:

1. **`PROGRESS.md`** — 지금까지 한 모든 작업 (가장 중요)
2. **`WORKFLOW.md`** — 글 작성 표준 절차 + 운영 위반 금지 룰
3. **`CLUSTERS.md`** — 토픽 클러스터 마스터 맵 + 검색량·경쟁강도 키워드 인벤토리 (SSOT)
4. **`EDITORIAL-CALENDAR.md`** — 날짜별 발행 스케줄 (월 단위) + 발행 정책
5. **`../../../HOMEGRADE-CONTEXT.md`** — 전체 전략·검색량·페르소나 정책
6. **`업로드 계획 문서.md`** — 런칭 초기 청사진 (히스토리, 아카이브)

---

## 핵심 카테고리

임산부 + 0~7세 영유아 라이프 4단계 (총 검색량 **약 37,450회/월**):

| 라이프 단계 | 검색량 풀 | 핵심 키워드 |
|---|---:|---|
| 🤰 임산부 | 약 2,900 | 임부복·임산부 영양제·수유 쿠션 |
| 👶 신생아 (0~12개월) | 약 13,800 | 분유·기저귀·아기 침대·아기 욕조·신생아 물티슈 |
| 🍼 영아 (1~3세) | 약 15,200 | 이유식·유모차·카시트·아기 옷·젖병 |
| 🧒 유아 (4~7세) | 약 5,500 | 어린이 치약·유아 식판·유아 샴푸 |

---

## 카니발라이제이션 분리 원칙 (절대 위반 금지)

**라이프스테이지 한정사 키워드만 babygrade에서 발행**:

```
다음 키워드 포함만 발행 가능:
  유아 · 아기 · 신생아 · 어린이 · 베이비
  임산부 · 임부 · 수유
  이유식 · 분유 · 기저귀
  유모차 · 카시트 · 젖병
  아기 침대 · 아기 욕조 · 유아 식판

→ 그 외 일반 키워드(물티슈·세제·텀블러 등)는 homegrade.kr에서 발행
```

데이터 검증: "물티슈"(49.5K) vs "아기 물티슈"(480) — 검색 풀 103배 차이로 자연 분리됨.
**같은 SKU도 키워드가 다르면 두 사이트 모두 노출 가능** (예: 무향 세제 = homegrade "무향 세제 추천" / babygrade "아기 빨래 무향 세제 추천")

---

## 프로젝트 구조 (계획)

```
어필리에이트/웹사이트/쿠팡/babygrade/
├── CLAUDE.md                      # ← 이 파일
├── PROGRESS.md                    # 진행 상황 (꼭 읽기)
├── WORKFLOW.md                    # 발행 워크플로우 (꼭 읽기)
├── CLUSTERS.md                    # 토픽 클러스터 마스터 맵 + 키워드 인벤토리 (SSOT)
├── EDITORIAL-CALENDAR.md          # 날짜별 발행 스케줄 + 발행 정책
├── 업로드 계획 문서.md             # 런칭 초기 청사진 (아카이브)
├── affiliate-site/                # Astro 사이트 (doggrade 복제 예정)
│   ├── src/content/posts/         # 마크다운 글들 (baby-* slug)
│   ├── src/content.config.ts      # Collections 스키마 (doggrade와 동일)
│   ├── src/layouts/Post.astro     # 글 레이아웃 (Schema 자동)
│   └── public/                    # 정적 파일
├── content-pipeline/              # 자동화 스크립트 (doggrade 복제)
│   └── (전체 doggrade와 동일, 도메인·카테고리만 교체)
└── babygrade.code-workspace
```

> **키워드 도구는 어필리에이트 루트**: `../../../keyword-tool/`
> **자격증명 (.env)**: `keyword-tool/.env` — DataForSEO + 네이버 검색광고

---

## 페르소나 정책 — 옵션 C (실명 편집장 + 데이터 톤)

> 2026-05-14 갱신: doggrade의 E-E-A-T 패턴을 따라 `/about/` 페이지에 실명 편집장(김재형) + 외부 자문 절차 + Person 스키마를 노출. doggrade·homegrade와 동일 정책.

- **`/about/` 페이지**: 실명 김재형 · BabyGrade 편집장. 경력 "종합 브랜드사 BM·마케팅 4년 (바이럴·퍼포먼스·콘텐츠·세일즈), 영유아·키즈 카테고리 운영 경험" 명시 + Person/AboutPage Schema + 외부 자문(소아과/공인 영양사 — 추후 갱신) + 의료 면책 고지.
- **글 본문 작성자**: 여전히 `BabyGrade Editorial Team` (Org persona) — 개별 글에는 실명 X.
- **본문 톤**: "우리 아이가 직접 써본..." 절대 금지. "리뷰 빅데이터 분석 결과" 톤만 사용.

```
✅ "쿠팡 인증 리뷰 847건 + 맘카페 후기 234건 종합 분석"
❌ "우리 아이 6개월 때 사용했는데..."
```

---

## 영유아 특화 추가 주의사항

### 식약처 표시광고법 (더 엄격)

육아 용품은 일반 생활용품보다 광고 규제가 더 엄격:

```
❌ "면역력 강화" "성장 도움" "발달 촉진" — 의약품 효능 표기 금지
❌ "안전 100% 보장" — 절대적 표현 금지
❌ "수면 시간 늘려줌" — 효과 단정 금지
✅ "KC 인증" "식약처 등록" "BPA-Free" — 객관적 인증 표기는 가능
```

### 안전 인증 우선 검증

추천 제품은 다음 인증 중 1개 이상 필수:
- KC 인증 (어린이 제품 안전 특별법)
- 식약처 식품용 기구 등록
- BPA-Free / 프탈레이트-Free
- KS인증 / FDA / CE

---

## 광고 고지 3중 의무 (공정위 + 쿠팡 정책)

1. **글 최상단**: 노란 박스 "본 글은 쿠팡 파트너스 활동의 일환..."
2. **각 구매 링크**: "(파트너스 링크)" 표시
3. **푸터**: 사업자 정보 + 광고 활동 고지

---

## 의사결정 기록

- **2026-05-13**: 도메인 `.kr` 확정
- **2026-05-12**: 컨셉 결정 — 임산부 + 0~7세 라이프스테이지 4단계 분리
- **2026-05-12**: 카니발라이제이션 원칙 — 라이프스테이지 한정사로만 분리 (homegrade와 자연 분리됨)
- **2026-05-12**: 어머니 카톡방 시너지 가능성 (분리 운영 검토)

---

## 절대 하지 말 것

1. **본인 클릭** — 쿠팡 파트너스 정지 사유
2. **허위 사용 후기** — "우리 아이가 직접 써본" 같은 거짓 표현
3. **의약품 효능 표기** — "면역력" "성장" "발달" (식약처 위반)
4. **절대적 안전 표현** — "100% 안전" "절대 무해"
5. **쿠팡 사칭** — "쿠팡 공식 추천"
6. **homegrade 키워드 발행** — 카니발라이제이션 위반 (일반 생활용품 금지)
7. **네이버 블로그 운영** — C-Rank 저품질

---

## 도메인 구매 후 즉시 실행 작업

```bash
# 1. doggrade 사이트 복제
cp -r ../doggrade/affiliate-site ./affiliate-site
cp -r ../doggrade/content-pipeline ./content-pipeline
cp ../doggrade/WORKFLOW.md ./WORKFLOW.md
cp ../doggrade/PROGRESS.md ./PROGRESS.md

# 2. 도메인·카테고리 일괄 치환
#    "doggrade" → "babygrade"
#    "강아지" → "임산부/아기/유아" (단계별)
#    카테고리: 사료/간식/영양제/건강/용품 → 임산부/신생아/영아/유아

# 3. Cloudflare Pages 신규 프로젝트 (.kr 연결)
# 4. content-pipeline 키워드 매트릭스 교체
# 5. 첫 50 SKU 키워드 선정 (네이버 MCP)
```

---

## KPI 목표 (참고 — 어머니 시장 특화)

| 시점 | 글 수 | Google 색인 | 일 트래픽 | 특이사항 |
|---|---|---|---|---|
| 1주 후 | 5~7개 | 4~6개 | 10~30 | sandboxing 기간 |
| 1개월 후 | 30개+ | 25개+ | 50~300 | 맘카페 백링크 시도 |
| 3개월 후 | 70개+ | 60개+ | 500~3k | 어머니 카톡방 분리 운영 검토 |
| 6개월 후 | 150개+ | 120개+ | 3k~20k | 12월 매출 +18% 급증 (출산 시즌) |

(임신·출산 검색은 시즌성·라이프스테이지 의존도 큼)

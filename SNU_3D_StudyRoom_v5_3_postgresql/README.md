# SNU 3D Study Room v5.3 — PostgreSQL + Railway 운영 준비

기존 v5.1/v5.2의 **Three.js 도서관, 4종 후드 동물 캐릭터, 책상 88개/의자 352개, NPC 8명, 이동과 좌석, WebSocket 실시간 멀티플레이어, 한국시간 공부 타이머, Google 로그인 및 친구/랭킹 UI**를 그대로 유지합니다.

이번 변경은 데이터 저장 계층입니다. v5.2의 `store.js`에 있던 공부 기록용 PostgreSQL 드라이버를 확장하고, SQLite에만 존재했던 `accounts-store.js`의 기능을 독립적인 비동기 `postgres-accounts-store.js`로 구현했습니다. 서버 라우트와 WebSocket 인증은 PostgreSQL 쿼리를 `await`하도록 수정했습니다.

## 개발 환경 빠른 시작

Node.js 22 이상 필요:

```bash
npm install
npm run check
npm test
```

기존 SQLite로 실행하는 개발용 모드는 **오직 `NODE_ENV`가 `production`이 아닌 경우**에 가능합니다. 실제 Railway 배포는 `DATABASE_URL` PostgreSQL 연결이 필수이며, 없으면 서버가 시작하지 않습니다. 안전을 위해 운영 환경에서는 영구 서명 비밀값 `STUDYROOM_SECRET`(32자 이상)도 필수입니다.

```bash
# Railway/환경변수에서 DATABASE_URL 설정 후
npm run db:check
npm start
```

변수 목록은 `.env.example`을 참고하고, 실제 비밀값은 `.env`, Railway 서비스 변수, Codespaces의 비공개 영역에만 저장하세요.

## PostgreSQL 스키마

- `migrations/001_postgres.sql`: 기존 `guests`, `study_daily`
- `migrations/002_postgres.sql`: `accounts`, `guest_consumed`, `app_sessions`, `friend_requests`, `friends`, `blocks`, `room_policies`, `room_access`
- PostgreSQL 연결 시 **멱등적인 CREATE TABLE IF NOT EXISTS**로 스키마를 생성합니다.
- 기본 ID는 v5 Firebase UID와 분리된 32자리 내부 사용자 ID입니다.
- 공부 시간은 서버가 측정·한국시간 날짜별로 저장하며 DB 트랜잭션을 사용합니다.
- 친구 관계와 신청은 PostgreSQL의 고유 제약·트랜잭션·행 잠금과 함께 처리합니다.
- 기존 SQLite의 데이터를 **자동으로 복사하지 않습니다**. 새 DB에서 계정/기록이 새로 시작됩니다.

## 설치·배포·백업

스마트폰 Codespaces만 사용하는 경우 **[DEPLOY_MOBILE_POSTGRES.md](DEPLOY_MOBILE_POSTGRES.md)** 순서대로 진행하세요. Railway 사용은 앱/DB 서비스 생성, 비공개 환경변수 등록, Firebase 승인 도메인 등록, DB 백업 일정 활성화까지 모두 직접 수행해야 합니다.

## 검증 상태

`TEST_REPORT_V5_3.md`와 `test-results.txt`에 실행 결과를 구분했습니다. 실제 PostgreSQL 서버 연결 검증은 본인 Railway/테스트 DB 생성 후 수행해야 하며, 지금 제공한 프로젝트가 자동으로 24시간 배포된 것은 아닙니다.

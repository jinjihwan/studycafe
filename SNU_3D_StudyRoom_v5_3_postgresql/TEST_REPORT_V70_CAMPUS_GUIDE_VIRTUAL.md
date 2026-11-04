# V7.0 테스트 보고서

- 기준 소스: V6.9 전체 프로젝트
- `npm run check`: 통과 (정적 HTML, 서버/클라이언트 JavaScript 구문 및 프로젝트 자산 검사)
- `FORCE_COLOR=0 npm test`: **115개 / 통과 114 / 실패 0 / 건너뜀 1**
- 건너뜀: REAL PostgreSQL 테스트용 `PG_TEST_DATABASE_URL`, `PG_TEST_ALLOW=YES` 미제공
- 320, 360, 390, 430, 768, 1280px 정적 브라우저 레이아웃 확인: 가로 넘침 없음
- 안내 팝업 정적 표시 및 비활성 링크 버튼 확인
- 이름 중복 없음, 시간대별 출석 상태 및 자정 초기화, 사용자 좌석 충돌 우선 처리, 가상 랭킹 표시 검사

## 미검증

- 실제 Three.js 렌더링 시 세 대학 벽면 텍스처·구도
- 실제 Android/iOS의 모바일 Google 로그인 / 링크 열림
- Railway 배포·2,000명 부하 시험
- 연결된 실제 PostgreSQL에서의 영속 기록
- 학교 공식 교표 사용 권한

## 변경 파일

- `index.html`
- `client/dashboard.js`
- `server/room.js`
- `server/index.js`
- `package.json`, `package-lock.json`
- 기존 테스트 수정: `tests/multiplayer.test.js`, `tests/restart.test.js`, `tests/v4-api.test.js`, `tests/v63-npc-consistency.test.js`, `tests/v66-ui-mobile.test.js`, `tests/v67-ui-polish.test.js`
- 신규 테스트: `tests/v70-guide-campus-virtual.test.js`
- 이 README/테스트 보고서

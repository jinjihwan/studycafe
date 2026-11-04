# SNU 3D Study Room v5.2 — 24시간 운영 이전 준비

v5.1의 Three.js 도서관·88개 책상·352개 의자·8 NPC·A* 이동·카메라·Firebase Google 로그인·게스트·WebSocket·친구/랭킹/공부 기록·Codespaces Origin/CSRF 패치를 유지한 **배포 준비 버전**입니다. 이 ZIP 자체가 온라인에 배포되지는 않았습니다.

## 바뀐 부분

- `server/state-paths.js`: 앱 코드 경로와 영구 저장소 경로 분리, 기존 데이터 없는 생산 배포 차단.
- `server/index.js`: 원본 게스트 서명키를 볼륨에서 읽기, 주기적인 SQLite 온라인 백업과 무결성 검사.
- `scripts/backup-sqlite.mjs`: WAL을 포함한 일관성 있는 DB 스냅샷, 원본 게스트 인증키 쌍 보관, 최근 28개 유지.
- `scripts/export-codespaces.mjs`: 서버 중지 상태에서 기존 Codespaces DB를 내보내고 레코드 수 확인.
- `scripts/restore-snapshot.mjs`: 서버 정지 확인, 롤백 백업, 무결성 확인 후 복원.
- `railway.json`, `.nvmrc`: Node.js 22, Railway 배포 설정.
- `tests/deployment.test.js`: WAL·친구 관계·날짜별 기록·키·복원·실패 차단 테스트.

## 모바일 설치와 Railway 이전

**반드시 [`DEPLOY_MOBILE.md`](./DEPLOY_MOBILE.md)부터 읽으세요.** 먼저 Codespaces의 기존 v5 DB를 일관된 상태로 내보낸 후, 새 Railway 볼륨에 전송합니다. 기존 v5 폴더의 DB와 인증 파일을 직접 삭제하거나 덮어쓰지 않습니다.

기본 실행(개발용):

```bash
npm install
npm run check
npm test
npm start
```

Railway에서는 다음 변수가 필수적입니다.

```
STUDYROOM_STATE_DIR=/data
STUDYROOM_DB_PATH=/data/studyroom.sqlite
STUDYROOM_BACKUP_DIR=/data/sqlite-backups
STUDYROOM_BACKUP_INTERVAL_HOURS=6
STUDYROOM_REQUIRE_EXISTING_DATA=1
GOOGLE_APPLICATION_CREDENTIALS=/data/firebase-admin.json
STUDYROOM_PUBLIC_ORIGIN=https://실제-railway-도메인.up.railway.app
```

`FIREBASE_PROJECT_ID`와 `FIREBASE_WEB_CONFIG`는 기존 Firebase 프로젝트의 설정값을 변수로 등록합니다. 실제 Firebase Admin JSON, `.guest-secret`, DB 파일, `.env`는 ZIP/저장소에 넣지 않습니다.

## 중요한 운영 제약

- **SQLite 사용 유지**: v5 친구 기능이 SQLite 전용이므로 아직 PostgreSQL로 이전하지 않았습니다. 현재 구조는 1개 서버 인스턴스 + 1개 볼륨입니다.
- **백업 수준**: 앱 SQLite 스냅샷은 해당 볼륨 안에 있으므로 별도로 Railway 플랫폼 볼륨 백업을 켜고, 독립 외부 백업도 정기적으로 수행해야 합니다.
- **무중단 보장 아님**: 서버 재배포 시 WebSocket 접속이 끊기고 재접속합니다. 장기 SLA·여러 서버 인스턴스 확장·고가용성은 이번 단계에서 구현하지 않았습니다.
- **Firebase 로그인**: 새로운 Railway 도메인을 Firebase Authentication 승인 도메인에 등록해야 합니다.
- **Codespaces 유지**: 기존 v5 코드는 개발용으로 남겨두세요. 새 서버와 동일한 공부방 데이터가 자동 동기화되는 것은 아닙니다.

## 테스트

`npm run check`와 `npm test`를 실행합니다. v5.1 자동 테스트 36개와 신규 저장·복구 테스트 4개가 포함되어 총 40개입니다. 세부 내역은 `TEST_REPORT_V5_2.md` 및 `test-results-v5_2.txt`를 참고하세요.

# v5.3 PostgreSQL 전환 테스트 보고서

작성 기준: 2026-11-04. 실제 실행한 Node.js 테스트 결과와 검증하지 못한 외부 서비스를 구분했습니다.

## 직접 확인한 결과

- `npm run check`: 성공 — JavaScript 구문, HTML 모듈, 필수 파일 검사.
- `npm test`: 총 49개 테스트 등록, **48개 통과, 0개 실패, 1개 건너뜀**.
- 기존 v5.1/v5.2 SQLite, Origin, Firebase 모의 인증, 친구 시스템, WebSocket, 좌석, 한국시간 기록, 재접속 회귀 테스트 40개: 통과.
- PostgreSQL 계약/스키마/트랜잭션/세션 해시 모의 Pool 테스트 5개: 통과.
- 비동기 PostgreSQL 계정 세션·CSRF·입장 ACL 모의 HTTP/Room 테스트 3개: 통과.
- **실제 PostgreSQL CRUD 통합 테스트 1개: SKIP.** 테스트용 PostgreSQL 서버와 `pg` 설치가 가능한 레지스트리 연결이 이 실행 환경에 없어 실행하지 못했습니다. SQLite 테스트/모의 테스트가 실제 PostgreSQL 호환성을 증명하지는 않습니다.

## 직접 확인하지 못한 부분

- 실제 Railway 프로젝트/도메인/서버 가동: 사용자의 Railway 계정/권한이 필요합니다.
- 실제 Railway PostgreSQL 연결, 마이그레이션 실행 및 SQL 호환: 별도 PostgreSQL DB 생성 후 실행해야 합니다.
- `Dockerfile` 이미지 빌드 및 Railway 런타임: Docker 엔진/외부 패키지 저장소에 연결할 수 없어 수행하지 못했습니다.
- 실제 Firebase Google 로그인·실계정 친구 신청, 새 Railway 도메인에서의 팝업 인증: 모바일 현장 테스트 필요.
- 실제 PostgreSQL 백업의 생성 및 복원: Railway PostgreSQL 서비스의 **Backups** 탭에서 사용자가 활성화하고 복원 테스트를 해야 합니다.
- 실제 스마트폰 FPS/발열/24시간 가동 안정성: 지속 사용 테스트가 필요합니다.

## 안전성 및 운영 경고

- v5.3은 기존 Codespaces SQLite DB를 자동 이전하지 않습니다. **새 PostgreSQL DB는 빈 상태로 시작합니다.** 기존 v5.1 폴더/DB는 손대지 않습니다.
- Firebase **프로젝트와 Google 계정 자체는 유지**하지만, 새 DB에서 내부 사용자 ID·친구 코드·친구 관계·기록은 새로 생성됩니다.
- 운영 환경 `NODE_ENV=production`은 `DATABASE_URL`과 32자 이상의 `STUDYROOM_SECRET`이 없으면 시작하지 않도록 했습니다.
- 서버의 방·좌석 점유는 아직 **Node.js 프로세스 메모리 기반**입니다. 앱 레플리카를 1개만 사용해야 합니다. PostgreSQL만으로 다중 서버 좌석 중복을 막지는 못합니다.
- 서버가 정상 종료되면 대기 중인 시간을 플러시하지만, 강제 종료나 DB 장애 시 마지막 수초간의 공부 기록이 손실될 수 있습니다. 디스크/DB의 장기 보존과 실시간 세션 무손실을 혼동하면 안 됩니다.
- Railway의 영구 백업 및 복원 테스트는 **설정 전**입니다. 배포 후 사용자가 직접 활성화해야 합니다.
- 비밀정보/실제 DB 파일/개인 공부 기록은 ZIP에 포함하지 않았습니다.

## 복원 및 향후 테스트

- 별도 테스트용 PostgreSQL에서 `DATABASE_URL`을 설정하고 `npm run db:check`를 실행합니다.
- **전용 테스트 DB에만** `PG_TEST_DATABASE_URL=... PG_TEST_ALLOW=YES npm test`를 실행하면 원래 건너뛴 실제 PostgreSQL CRUD 테스트도 수행할 수 있습니다. 운영 DB 연결은 금지합니다.
- 운영 시 `GET /health`는 PostgreSQL에 `SELECT 1`을 수행하여 DB 연결 상태를 함께 반환합니다.
- Railway PostgreSQL 서비스에서 Daily/Weekly 백업을 설정한 뒤 **복원 실습**을 별도 환경에서 수행합니다.

실제 자동 테스트 로그: `test-results.txt`. 실행 방법: `README.md`와 `DEPLOY_MOBILE_POSTGRES.md`.

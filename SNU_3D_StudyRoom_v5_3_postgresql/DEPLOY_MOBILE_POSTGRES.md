# v5.3 스마트폰만으로 Railway + PostgreSQL 배포

**이번 배포는 새로운 빈 PostgreSQL DB에서 시작합니다.** 기존 Codespaces SQLite 기록과 친구 데이터는 이전하지 않습니다. 기존 Codespaces v5/v5.1 폴더 및 `.guest-secret`을 **삭제하지 마세요**. 원한다면 계속 개발·테스트 용도로 사용하세요.

## 0. 먼저 알아둘 점

- GitHub Codespaces와 Railway는 별도 서비스입니다. **Codespaces가 종료되어도 Railway의 앱 서비스와 PostgreSQL 서비스가 켜져 있어야** 이용자가 계속 접속할 수 있습니다.
- Railway **24시간 무중단을 보장하는 상품은 아닙니다**. 서비스 상태와 과금/크레딧 상태에 따라 중단될 수 있습니다.
- 서버의 3D 멀티플레이어 방/좌석 점유는 메모리에서 관리하므로 **Railway 앱은 반드시 1개 Replica(인스턴스)**로 유지하세요. 2개 이상이면 서로 다른 사용자에게 방 상태가 갈라지고 같은 좌석이 중복 사용될 수 있습니다.
- `pg` 연결 실패/DB 장애 시 API는 오류를 반환합니다. 재시작 전 마지막 체크포인트(평상시 수초 간격) 이후 메모리의 미기록 공부 시간은 비정상 종료 시 유실될 수 있습니다. **완전 무손실을 보장하지 않습니다.**
- **관리형 DB의 백업은 수동으로 활성화해야 합니다.** v5.3 소스만 업로드했다고 자동 백업이 설정되지는 않습니다.

## 1. 현재 스마트폰 Codespaces에 v5.3 준비

ChatGPT에서 받은 `SNU_3D_StudyRoom_v5_3_postgresql.zip`을 스마트폰에 저장한 뒤 Codespaces의 `/workspaces/studycafe` 폴더로 업로드합니다. **ZIP 파일만 GitHub에 올라갔으면 자동 압축 해제되지 않습니다.**

터미널에서:

```bash
cd /workspaces/studycafe
unzip -n SNU_3D_StudyRoom_v5_3_postgresql.zip
cd SNU_3D_StudyRoom_v5_3_postgresql
npm install
npm run check
npm test
```

`npm test`는 기본적으로 기존 SQLite 회귀 테스트와 PostgreSQL 모의 계약 테스트를 실행합니다. 실제 PostgreSQL 연결 테스트는 별도 테스트 DB가 없으면 `SKIP`으로 표시됩니다.

**이 시점에서 `npm start`는 옛 SQLite 로컬 모드로 실행될 수 있습니다. 실제 PostgreSQL 모드는 `DATABASE_URL`이 있어야 합니다.**

## 2. GitHub에 실제 압축 해제된 코드를 저장

Codespaces 터미널에서:

```bash
cd /workspaces/studycafe
git add SNU_3D_StudyRoom_v5_3_postgresql
git status --short
git commit -m "Add v5.3 PostgreSQL deployment"
git push origin main
```

`git status --short`에서 `.env`, `.guest-secret`, `firebase-admin.json`, `studyroom.sqlite`, `data/`가 **Git에 등록되지 않았는지 꼭 확인**하세요. 이 프로젝트에는 해당 파일들을 무시하는 `.gitignore`가 있습니다. 기밀 파일을 실수로 커밋했다면 푸시 전에 중단하세요.

프로젝트 폴더를 저장소 최상위로 옮길 필요는 없습니다. Railway에서 서비스 **Root Directory**를 `/SNU_3D_StudyRoom_v5_3_postgresql`로 지정합니다. UI가 모바일에서 작으면 Chrome `⋮ → 데스크톱 사이트`로 전환하세요.

## 3. Railway 계정 및 PostgreSQL 생성

1. 스마트폰 Chrome에서 https://railway.com/ 접속 → GitHub 계정으로 가입/연결합니다.
2. 새 프로젝트를 만들고 **+ New → Database → PostgreSQL**을 선택합니다.
3. 데이터베이스가 배포되어 실행되는지 확인합니다.
4. PostgreSQL 서비스 이름을 확인합니다. 아래 예시에서는 `Postgres`입니다. 이름이 다르면 변수 참조도 바꿉니다.
5. DB 서비스를 인터넷에 공개할 **필요가 없습니다**. 같은 Railway 프로젝트 안의 앱만 DB의 사설 주소로 연결합니다.

데이터베이스 자체가 존재하려면 Railway 프로젝트 구독/크레딧 및 볼륨이 정상 상태여야 합니다.

## 4. GitHub Node.js 앱 추가

1. Railway 프로젝트에서 **+ New → GitHub Repo**를 선택합니다.
2. `studycafe` GitHub 저장소를 선택합니다.
3. 앱 서비스 Settings → **Root Directory**에 `/SNU_3D_StudyRoom_v5_3_postgresql`을 입력합니다.
4. `Dockerfile` 및 `railway.json`이 이 폴더에 있어야 합니다. Node 22가 설치되고 `npm start`가 실행되도록 구성돼 있습니다.
5. 앱 서비스에 **Replica 1개**만 사용합니다. 별도 앱 볼륨은 필요하지 않습니다. DB는 PostgreSQL 서비스의 영구 저장 볼륨을 사용합니다.

## 5. 앱 서비스 Variables 설정 (비밀 정보는 GitHub에 넣지 않기)

앱 서비스 → **Variables** 메뉴에 다음 값을 추가하세요.

| 이름 | 입력값 | 비밀성 |
|---|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | DB 비밀 연결 정보 (Railway 참조 변수) |
| `NODE_ENV` | `production` | 공개 가능 |
| `STUDYROOM_SECRET` | 적어도 32자 이상인 무작위 값 | **서버 전용 비밀** |
| `FIREBASE_PROJECT_ID` | `study-room-cdfa1` | 공개 식별자 |
| `FIREBASE_WEB_CONFIG` | 본인 Firebase Console의 웹용 `firebaseConfig` JSON 객체를 **한 줄**로 | 웹 설정값(공개용) |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Firebase Console에서 받은 **서버 관리자 JSON 전체 내용** | **절대 공개 금지** |
| `STUDYROOM_PUBLIC_ORIGIN` | 이후 발급할 `https://...up.railway.app` 주소 (슬래시 없이) | 공개 주소 |

`STUDYROOM_SECRET`을 Codespaces에서 새로 만들려면 `openssl rand -hex 32` 명령을 사용합니다. 생성된 값은 서버 비밀값이므로 채팅에 보내거나 캡처로 공유하지 마세요. 계정/데이터를 새로 시작하므로 기존 v5의 `.guest-secret`을 그대로 가져올 필요는 없습니다. 이 값을 바꾸면 기존 Railway 게스트 토큰은 무효화됩니다.

**Firebase 관리자 JSON**은 이미 휴대폰에 다운로드하거나 Codespaces의 `/home/codespace/.config/snu-studyroom/firebase-admin.json`에 보관했던 그 파일입니다. 이를 **Railway 앱 서비스의 Secret Variable** 값으로 안전하게 넣고, `GOOGLE_APPLICATION_CREDENTIALS`는 Railway에 설정하지 마세요. 전용 키는 절대로 GitHub, ZIP, ChatGPT에 올리지 마세요. JSON 내용을 확인하기 위한 스크린샷도 공유하지 마세요.

> Railway에서 서비스 계정 JSON을 변수로 입력하기 어려우면 배포를 잠시 보류하세요. 관리자 인증을 끄거나 클라이언트 코드에 키를 넣으면 안 됩니다.

## 6. Railway 공개 도메인 만들고 Firebase 승인 도메인 추가

1. 앱 서비스 Settings → Networking → **Generate Domain**을 누릅니다.
2. 발급된 주소 예: `https://studyroom-production.up.railway.app` (**예시입니다, 실제 값은 다릅니다**).
3. 앱 서비스 `STUDYROOM_PUBLIC_ORIGIN`을 이 정확한 **origin**으로 설정합니다. `/`나 `/online/` 경로는 넣지 않습니다.
4. Firebase Console `Authentication → Settings → Authorized domains`에서 **실제 Railway 도메인**을 추가합니다. `https://`와 `/`는 빼고 도메인만 입력합니다.
5. Railway `Deploy`/`Redeploy`로 변경된 변수 설정을 적용합니다.
6. 휴대폰 **일반 Chrome** 주소창에 새 주소를 직접 입력해 접속합니다. 인앱 브라우저는 Google 팝업을 차단할 수 있습니다.

앱 서버에서 `/health`를 열어 `ok:true`, `db:"postgres"`가 표시되는지 확인하세요. 실제 `GET /health` 요청도 PostgreSQL 연결을 확인합니다.

## 7. 앱/DB 동작 확인 (Google + 친구 + 공부 기록)

- Google 계정으로 로그인. 첫 로그인에는 **새 계정/친구 코드**가 생성됩니다. 기존 Codespaces의 공부 시간/친구 코드는 **자동 이전되지 않습니다**.
- 친구의 **다른 Google 계정**으로 접속해 신청 → 수락 → 목록 확인 → 친구 랭킹 조회.
- 두 기기에서 같은 방 입장, 이동, 좌석 착석/중복 점유 차단 확인.
- 의자에서 1~2분 공부하고 `내 기록`에서 시간 확인.
- Railway 앱 서비스를 재시작한 뒤 다시 로그인해 **공부 기록과 친구 관계가 남아 있는지** 확인.
- DB를 끊었다가 복구하는 장애 시험은 서비스 초기에 테스트 환경에서만 진행하고, 운영 DB를 함부로 정지하지 마세요.

### 실제 PostgreSQL 테스트 명령

v5.3에는 `npm run db:check`가 있습니다. `DATABASE_URL`과 `pg`가 설치된 서버 환경에서만 수행합니다. 또한 `PG_TEST_DATABASE_URL` + `PG_TEST_ALLOW=YES`가 설정되면 `npm test`가 실제 PostgreSQL CRUD 통합 테스트를 실행하지만, **반드시 별도의 테스트 전용 DB를 연결**하세요. 운영 DB를 테스트 대상으로 쓰지 마세요.

## 8. 백업 활성화 — 꼭 직접 설정할 항목

1. Railway **Postgres 서비스 → Backups** 탭으로 이동합니다.
2. 가능한 백업 일정을 **Daily + Weekly**로 활성화합니다. 원하면 Monthly도 켭니다.
3. 첫 **수동 백업(Snapshot)**을 생성합니다.
4. 백업 목록과 생성 시각을 확인합니다.
5. **별도 복제 DB/테스트 환경에서 실제 복원**해 친구·공부 기록이 살아 있는지 시험합니다. 실서비스 DB에 바로 복원하지 마세요.
6. 장기간 운영할 경우 별도 외부 스토리지 보관용 `pg_dump` 및 복구 절차도 추가하는 것을 권장합니다. 같은 Railway 프로젝트의 백업만으로 전체 계정/프로젝트 삭제 위험을 완전히 해소할 수는 없습니다.

Railway 공식 문서: https://docs.railway.com/volumes/backups 와 https://docs.railway.com/databases/postgresql

**백업은 제가 이 ZIP 생성 과정에서 활성화하지 못했습니다.** 본인 Railway 대시보드에서 직접 켜고 확인해야 합니다. 또한 기존 v5.2 SQLite 스냅샷 작업은 **PostgreSQL DB 백업으로 대체되지 않습니다**. PostgreSQL에서는 관리형 백업을 별도로 사용하세요.

## 9. 비용·안전성·운영 제한

- Railway의 Free 플랜은 장기간 24시간 운영이 보장되는 무제한 무료 호스팅이 아닙니다. 저장소·서버 사용량 및 요금제에 따라 비용과 가동 제약이 생깁니다.
- 초기에는 **앱 1개 레플리카 + PostgreSQL 1개**를 유지하세요. 다중 레플리카/다중 지역은 별도 분산 방·좌석 잠금 서버 개발이 필요합니다.
- 서버가 정상적으로 종료되면 대기 중인 공부 기록이 DB에 기록됩니다. 강제 종료·네트워크 단절 시 마지막 기록 체크포인트 이후 일부 시간 유실 가능성이 있습니다.
- 개인정보와 유효한 Firebase 관리자 키는 Railway 변수/서비스 계정에만 두고 GitHub와 대화에 공유하지 마세요.
- 공개 운영 전에 초대받은 소수 사용자로 장시간 연결·모바일 발열·보안/부하를 점검하세요.

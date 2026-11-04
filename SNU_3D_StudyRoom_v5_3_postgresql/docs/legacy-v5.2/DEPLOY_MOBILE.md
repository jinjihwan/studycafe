# 스마트폰만으로 24시간 서버 이전 — Railway + SQLite 영구 볼륨

> 기준: **기존 v5.1이 Codespaces에서 정상 작동**하고, 기존 DB와 `.guest-secret`이 `/workspaces/studycafe/SNU_3D_StudyRoom_v5/`에 있는 경우입니다. 실제 프로젝트 경로가 다르면 정확한 경로를 먼저 확인하세요. 휴대폰에서 GitHub Codespaces 터미널과 Railway 웹 대시보드만 사용합니다.
>
> **아직 Railway 서비스나 볼륨을 생성하지 않은 상태입니다.** 이 문서는 직접 서비스에 가입하고 결제 설정·Firebase 도메인 등록을 해야 하는 단계를 구분합니다.

## 핵심 구조 및 요금

- **코드·WebSocket 서버**: Railway의 1개 Node.js 웹 서비스. `HOST=0.0.0.0`, `PORT`는 Railway에서 자동 주입, HTTPS·WSS는 Railway에서 종단 처리.
- **DB**: 기존 SQLite를 그대로 유지하여 Google UID 연결, 친구 관계, 서버 인증 세션, 공부 기록을 보존.
- **영구 저장**: 서비스에 연결된 **Railway Volume `/data`**. DB `/data/studyroom.sqlite`, 인증키 `/data/.guest-secret`, Firebase Admin JSON `/data/firebase-admin.json`.
- **자동 백업 2중 구성**: (1) 앱이 약 6시간 간격으로 SQLite 온라인 백업을 `/data/sqlite-backups/`에 저장, (2) Railway 서비스의 **Backups**에서 Daily·Weekly·Monthly 볼륨 백업을 직접 켬. 이 둘은 동일 서비스에 종속되므로 중요한 데이터는 **별도로 다운로드해 외부에 보관**해야 합니다.
- **비용**: 24시간 컴퓨팅, 스토리지, 백업, 전송량에 따라 과금될 수 있습니다. 서비스를 생성하기 전에 Railway 대시보드의 현재 요금과 월별 사용량 한도를 확인하세요. 무료 서비스가 영구 24시간 작동한다고 가정하지 마세요.

## 0. 현재 Codespaces v5 서버 중지 및 백업 (가장 중요)

Codespaces에서 실행 중인 `npm start` 서버 **터미널만 종료**하세요. 휴지통 아이콘으로 터미널 종료 가능합니다. 기존 v5 폴더, `data/`, `.guest-secret`, `.env`, Firebase Admin JSON은 **절대 삭제하지 마세요**.

**지금까지 실제로 작동하던 v5 폴더를 그대로 남깁니다.** 새 전체 프로젝트 ZIP은 별도 폴더로 압축 해제합니다. **Google에 연결하지 않은 게스트의 브라우저 localStorage 토큰은 새 도메인으로 자동 이동하지 않습니다.** 게스트 이용자가 있다면 이전 전에 Google 계정으로 기존 게스트 기록을 연결하도록 안내하세요.

```bash
cd /workspaces/studycafe
unzip -n SNU_3D_StudyRoom_v5_2_deploy.zip
cd SNU_3D_StudyRoom_v5_2_deploy
npm install
npm run check
npm test
```

> `.zip`을 위 경로에 업로드하지 않았다면 `ls *.zip`으로 실제 파일 위치를 확인하세요.

### 기존 v5 데이터 안전 내보내기

```bash
cd /workspaces/studycafe/SNU_3D_StudyRoom_v5_2_deploy
I_HAVE_STOPPED_THE_SERVER=YES node scripts/export-codespaces.mjs ../SNU_3D_StudyRoom_v5
```

화면에 **공부 기록 행 수, 계정 수, 친구 관계 수, 내보낸 폴더**가 표시됩니다. 예를 들면 다음과 같습니다.

`/home/codespace/.config/snu-studyroom/deploy-export/2026-11-04T01-23-45-000Z`

현재 내보내기 폴더를 셸 변수로 지정:

```bash
EXPORT_DIR=$(find "$HOME/.config/snu-studyroom/deploy-export" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
echo "내보낸 폴더: $EXPORT_DIR"
ls -la "$EXPORT_DIR"
```

정상적으로 `studyroom.sqlite`와 `.guest-secret`이 나와야 합니다. SQLite의 `-wal`을 단순 복사하지 않고 **일관성 있는 백업**을 만든 것입니다. 인증키의 내용은 출력하거나 채팅에 붙여넣지 마세요.

또한 기존 Codespaces 파일 `/home/codespace/.config/snu-studyroom/firebase-admin.json`이 있어야 합니다(이 파일은 GitHub 저장소로 복사하지 않습니다).

## 1. GitHub에 깨끗한 배포 코드 올리기

Railway 대시보드에서 GitHub 저장소를 연결하는 방식이 모바일에서 가장 편리합니다. 기존 저장소 `studycafe`에 새 **서브폴더**만 커밋합니다.

```bash
cd /workspaces/studycafe
git add SNU_3D_StudyRoom_v5_2_deploy/
git diff --cached --name-only
```

**확인:** 목록에 `.env`, `.guest-secret`, `.sqlite`, `firebase-admin.json`, `private-backups`가 있으면 **커밋하지 마세요**. 정상이라면 아래 명령:

```bash
git commit -m "Prepare 3D study room v5.2 for persistent Railway hosting"
git push origin main
```

GitHub에는 **소스코드만** 올라갑니다. 로컬 DB·인증키는 Codespaces의 비공개 폴더에 둡니다.

## 2. Railway 웹 대시보드에서 서비스 만들기 (사용자가 직접)

1. 스마트폰 Chrome에서 <https://railway.com/> 접속 → GitHub 계정으로 로그인/가입 → 결제 설정·현재 요금 확인.
2. `New Project` → `Deploy from GitHub repo` → 기존 `studycafe` 저장소 선택.
3. 새로 만든 **웹 서비스** → `Settings` → `Source` → **Root Directory**를 `/SNU_3D_StudyRoom_v5_2_deploy`로 지정.
4. `Volumes` 메뉴(또는 프로젝트 캔버스의 Add Volume)를 이용해 이 서비스에 **영구 볼륨을 `/data`에 마운트**. 저장 용량과 비용 확인.
5. `Settings` → `Networking` → `Generate Domain`으로 `https://무작위이름.up.railway.app` 형식의 URL 발급. **생성된 URL을 정확히 기록**.
6. `Variables`에서 아래 변수를 **서비스에 개별 등록**. 비밀번호는 GitHub에 저장하지 않습니다.

| 이름 | 값 | 주의 |
|---|---|---|
| `NODE_ENV` | `production` | 일반 환경 |
| `HOST` | `0.0.0.0` | 외부 요청 수신 |
| `STUDYROOM_STATE_DIR` | `/data` | 볼륨 폴더 |
| `STUDYROOM_DB_PATH` | `/data/studyroom.sqlite` | 기존 DB 경로 |
| `STUDYROOM_BACKUP_DIR` | `/data/sqlite-backups` | 앱 백업 폴더 |
| `STUDYROOM_BACKUP_INTERVAL_HOURS` | `6` | 앱 자동 백업 간격 |
| `STUDYROOM_REQUIRE_EXISTING_DATA` | `1` | 데이터 파일이 없으면 **실행 거부** |
| `FIREBASE_PROJECT_ID` | `study-room-cdfa1` | 기존 사용자 Firebase 프로젝트 |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/data/firebase-admin.json` | **파일 경로만** 등록 |
| `FIREBASE_WEB_CONFIG` | 기존 v5 `.env`에 있는 Firebase 웹 설정 JSON **한 줄** | 공개 설정값; 서버 전용 개인키 아님 |
| `STUDYROOM_PUBLIC_ORIGIN` | `https://발급받은-정확한-도메인.up.railway.app` | 마지막 `/` 없이, 정확한 Origin |

- `DATABASE_URL`은 **추가하지 마세요**. 기존 친구·인증 데이터는 현재 SQLite 전용입니다.
- `STUDYROOM_SECRET`도 **새로 만들지 마세요**. 기존 `.guest-secret` 파일을 옮기므로 **원래 게스트 ID가 유지됩니다**.
- `PORT`는 Railway가 자동 전달하는 값이므로 임의로 다른 포트를 지정할 필요가 없습니다.
- 볼륨에 DB와 키가 들어오기 전 **초기 배포가 실패하는 것은 의도된 보호 동작**입니다. 새 빈 DB를 자동 생성해 기존 기록과 연결이 끊기는 일을 방지합니다.

## 3. Codespaces에서 Railway Volume에 기록과 키 안전하게 올리기

Codespaces 터미널로 돌아와서 (이 계정으로 외부 서비스에 로그인하는 과정은 **직접 진행**해야 합니다):

```bash
npm install -g @railway/cli
railway login
cd /workspaces/studycafe/SNU_3D_StudyRoom_v5_2_deploy
railway link
railway volume list
```

`railway link`에서 위에서 만든 프로젝트, 해당 웹 서비스, Production 환경을 선택합니다. 서비스와 볼륨이 하나라면 아래 명령으로 업로드합니다.

```bash
EXPORT_DIR=$(find "$HOME/.config/snu-studyroom/deploy-export" -mindepth 1 -maxdepth 1 -type d | sort | tail -1)
railway volume files upload "$EXPORT_DIR/studyroom.sqlite" /studyroom.sqlite
railway volume files upload "$EXPORT_DIR/.guest-secret" /.guest-secret
railway volume files upload "$HOME/.config/snu-studyroom/firebase-admin.json" /firebase-admin.json
railway volume files list /
```

> 여러 볼륨 중 선택하라는 메시지가 나오면 반드시 **웹 서비스에 붙인 `/data` 볼륨**을 지정하세요. 업로드 경로 `/studyroom.sqlite`는 **볼륨 내부 루트**이고, 실행 중 컨테이너에서는 `/data/studyroom.sqlite`로 보입니다.
>
> 인증키·DB·JSON 내용이 터미널이나 GitHub에 출력되지 않도록 주의하세요. `railway volume files list`는 파일 이름만 보여줍니다.

파일 3개가 정확히 표시되면 Railway 대시보드에서 **서비스 Redeploy**를 실행합니다. 이때 `STUDYROOM_REQUIRE_EXISTING_DATA=1` 검사를 통과해야 서버가 시작됩니다.

## 4. 새 서버 검증, Firebase 도메인 등록

1. <https://console.firebase.google.com/> → `study-room-cdfa1` → `Authentication` → `Settings` → `Authorized domains` → **새 Railway 도메인만** 추가합니다. `https://`나 `/`는 제외합니다. 기존 Codespaces 도메인은 삭제하지 않아도 됩니다.
2. 새 Railway 주소의 `/health`를 Chrome에서 열고 `ok: true`, `db: sqlite` 확인. 단, `/health`는 DB·Firebase 토큰 실사용 성공까지 검증하는 기능은 아닙니다.
3. `https://새도메인.up.railway.app/?room=main`에 접속해 **Google 로그인 → 기존 닉네임·기록·친구 → 빈 의자 착석 → 타이머 증가**를 확인합니다.
4. 다른 휴대폰에서 접속해 서로 이동·채팅·좌석 점유 차단이 정상인지 확인합니다. 기존 Codespaces URL은 별개 서버·방이므로 **두 서비스를 섞어서 테스트하지 마세요**.
5. 기존 Codespaces DB의 `study_daily` 행 수와 Railway로 이전된 DB 행 수를 비교합니다. 기존 Google 계정으로 로그인했다면 UID에 연결된 기록이 유지되는지 확인합니다. **게스트 전용 기록은 새 도메인에 브라우저 토큰이 자동 전달되지 않으므로 재로그인만으로 복구되지 않습니다.** 이후 사용자 공부를 시작하면 새 서버 값은 늘어날 수 있습니다.

## 5. 백업 켜기 (중요: 자동으로 활성화되지 않음)

**서비스 내부 자동 SQLite 스냅샷**: `STUDYROOM_BACKUP_INTERVAL_HOURS=6`인 경우 서버 시작 약 1분 후 첫 스냅샷, 이후 6시간마다 저장하고 최근 28개를 남깁니다. 파일은 `/data/sqlite-backups`에 저장됩니다. 백업할 때 먼저 서버 공부 시간을 DB에 체크포인트하고, `integrity_check`를 통과한 파일만 보관합니다.

Railway 공식 CLI로 파일 확인:

```bash
railway volume files list /sqlite-backups
```

**Railway 볼륨 자동 백업(별도 설정)**: 대시보드의 웹 서비스에서 `Backups` 탭 → `Daily`와 `Weekly`(가능하다면 Monthly도) 활성화합니다. Railway 문서상 일간 백업 보관은 6일, 주간 27일, 월간 89일입니다. 실제 사용 가능한 옵션과 비용은 대시보드에서 확인하세요.

**독립된 외부 백업**: 최소 주 1회는 볼륨의 최신 `studyroom-...sqlite`와 `.guest-secret`을 Codespaces의 **Git 추적 밖**인 비공개 폴더로 다운로드하고, 암호화된 형태로 별도의 신뢰 가능한 저장소에 보관하세요. **같은 Railway 프로젝트/볼륨만의 백업은 프로젝트 삭제·계정 문제에 대비한 독립 백업이 아닙니다.**

## 6. 복원 연습 (절대 운영 중인 DB 덮어쓰지 않기)

- 실제 서비스 중단 없이 먼저 Codespaces로 백업 하나를 다운로드한 다음 `sqlite integrity_check`, 공부 기록 행 수를 확인해 **복구 가능성**을 검사하는 방식을 권장합니다.
- 실서비스에서 스냅샷으로 복원할 때는 서버를 먼저 **중지**해야 합니다. 중지 후 `I_HAVE_STOPPED_THE_SERVER=YES node scripts/restore-snapshot.mjs <스냅샷 파일>`을 실행합니다. 변경 전 DB에 롤백 백업을 남기며, **현재 서비스 실행 중에는 실행하지 마세요**.
- Railway 플랫폼 볼륨 백업 복원 역시 새 배포를 시작하며 연결이 끊기고, 해당 시점 이후 기록은 사라질 수 있습니다.

## 확인하지 못한 사항

실제 Railway 계정 생성·결제·볼륨 마운트, 실제 Firebase Google 로그인, 실제 스마트폰 WebGL/장시간 24시간 가동 여부는 이 개발 환경에서 검증하지 않았습니다. 그 부분은 위 절차로 직접 확인해야 합니다.

**공식 참고 문서**: Railway `docs.railway.com/volumes`, `/volumes/backups`, `/cli/volume`, `/networking/public-networking/specs-and-limits`, Firebase `firebase.google.com/docs/auth/web/google-signin`.

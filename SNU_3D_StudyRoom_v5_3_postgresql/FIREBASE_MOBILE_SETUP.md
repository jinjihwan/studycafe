# Firebase Console 설정 — 스마트폰 + GitHub Codespaces

v5의 Google 로그인은 **Firebase Authentication 공식 Web SDK**와 **Firebase Admin SDK**를 사용합니다. Firebase 프로젝트는 개발자가 직접 생성해야 합니다. 설정 전에는 **게스트로 바로 입장**과 v4 기록·멀티플레이어가 계속 작동합니다. Firebase Web 설정만 넣고 Admin 인증 정보를 제공하지 않으면 Google 로그인 서버가 시작되지 않거나 기능을 사용할 수 없습니다.

## A. 스마트폰 Firebase Console에서 직접 할 일

1. 스마트폰 Chrome/Safari에서 [Firebase Console](https://console.firebase.google.com/)에 접속합니다. 버튼이 가려지면 브라우저의 **데스크톱 사이트** 옵션을 켭니다.
2. **프로젝트 추가**로 새 프로젝트를 만듭니다. 이후 프로젝트 설정(톱니바퀴)에서 **프로젝트 ID**를 복사합니다. 프로젝트 이름과 ID는 다를 수 있습니다.
3. **빌드 → Authentication → 시작하기 → 로그인 방법(Sign-in method)**으로 이동해 **Google** 제공업체를 활성화합니다. 안내되는 프로젝트 지원 이메일을 설정한 뒤 저장합니다.
4. **프로젝트 설정 → 일반 → 내 앱(Your apps) → 웹(</>)**에서 웹 앱을 등록합니다. 표시되는 `firebaseConfig`의 `apiKey`, `authDomain`, `projectId`, `appId`를 복사합니다. `messagingSenderId`, `storageBucket` 등은 필요한 경우 함께 넣어도 됩니다. **이 값들은 공개 웹 앱 설정 정보이며 서비스 계정 비밀키가 아닙니다.**
5. Codespaces에서 PORTS의 **3000** 포트를 공개(Public)로 만들고, 표시된 주소에서 `https://`부터 호스트 이름을 확인합니다. 예: `https://cautious-orbit-3000.app.github.dev`라면 승인할 도메인은 `cautious-orbit-3000.app.github.dev`입니다.
6. Firebase **Authentication → Settings → Authorized domains(승인된 도메인)**에 위 **호스트 이름만** 추가합니다. `https://`, 경로, `?room=main`을 포함하지 않습니다. 와일드카드 `*.app.github.dev`에 의존하지 마세요. Codespace 주소가 달라지면 새 호스트도 승인해야 합니다.
7. **프로젝트 설정 → 서비스 계정(Service accounts)**에서 Admin SDK용 서비스 계정 키를 발급합니다(프로젝트 정책상 허용되는 경우에만). 다운로드한 JSON 파일은 **서버 전용**입니다. GitHub 저장소·ZIP·웹 코드·채팅에 올리지 마세요. 관리자 키가 유출되면 즉시 폐기·교체합니다. 가능한 운영 환경에서는 키 파일 대신 Workload Identity/ADC를 사용하세요.
8. 나중에 `korulive.com` 같은 **자체 서비스 도메인**을 쓰면 해당 실제 호스트 이름을 Firebase 승인된 도메인에 추가하고 앱의 `authDomain` 및 리디렉션 구성에 관한 Firebase 공식 문서를 다시 확인합니다. 실제 호스팅에서 TLS(HTTPS)를 적용합니다.

## B. Codespaces 터미널에서 할 일

첫 설치(압축 해제 후 v5 폴더에서):

```sh
npm install
cp .env.example .env
```

스마트폰의 Codespaces 편집기에서 `.env`를 열어 다음 항목을 **본인 Firebase 설정으로** 고칩니다.

```dotenv
FIREBASE_PROJECT_ID=your-actual-project-id
FIREBASE_WEB_CONFIG='{"apiKey":"your-web-api-key","authDomain":"your-project.firebaseapp.com","projectId":"your-actual-project-id","appId":"1:000000000:web:xxxxxx"}'
GOOGLE_APPLICATION_CREDENTIALS=/home/codespace/.config/snu-studyroom/firebase-admin.json
STUDYROOM_PUBLIC_ORIGIN=https://your-codespace-3000.app.github.dev
```

Admin JSON은 실제 Codespace의 `~/.config/snu-studyroom/firebase-admin.json`에 **비공개로** 저장하세요. 예시:

```sh
mkdir -p ~/.config/snu-studyroom
chmod 700 ~/.config/snu-studyroom
# Firebase에서 받은 JSON을 이 비공개 폴더에 안전하게 업로드한 뒤:
chmod 600 ~/.config/snu-studyroom/firebase-admin.json
```

`~`의 실제 경로를 `echo "$HOME"`으로 확인하세요. Codespaces가 다른 사용자로 실행되면 `.env`의 경로도 일치시켜야 합니다. 업로드 시 실수로 저장소 루트에 놓였다면 즉시 비공개 폴더로 **이동**하고 Git 커밋에 절대 포함하지 마세요. `.env` 역시 Git 커밋 금지입니다.

```sh
npm run check
npm test
npm start
```

Codespaces의 **PORTS → 3000 → Open in Browser**에서 웹사이트를 연 뒤 **Google로 계속하기**를 눌러 계정을 선택합니다. 앱은 **팝업 방식**을 기본으로 사용합니다. 모바일 브라우저에서 팝업이 차단되면 팝업을 허용하고 재시도하세요. Firebase에서 프로젝트·승인 도메인 오류가 표시되면 위 A-5/6과 `.env`의 `authDomain`/`projectId`를 확인합니다.

## C. Google 로그인 팝업과 리디렉션의 차이

Firebase 공식 문서는 모바일에서 리디렉션을 권장하지만, 최근 브라우저의 **서드파티 저장소 차단** 때문에 Firebase 기본 `firebaseapp.com` 리디렉션 핸들러가 Codespaces 같은 별도 호스트에서 실패할 수 있습니다. v5는 이러한 제한을 고려해 **사용자 클릭에 의해 열리는 `signInWithPopup`**을 기본으로 구현했습니다. 팝업을 허용하지 않는 일부 모바일 환경에서는 로그인할 수 없습니다. `client/account.js`에 리디렉션 메서드는 준비되어 있지만 기본 UI는 사용하지 않으며, Firebase Hosting 같은 동일 출처 헬퍼 또는 공식 프록시 구성 없이 Codespaces 리디렉션 작동을 보장하지 않습니다.

- 공식 안내: https://firebase.google.com/docs/auth/web/google-signin
- 리디렉션 제한: https://firebase.google.com/docs/auth/web/redirect-best-practices
- Firebase Admin 검증: https://firebase.google.com/docs/auth/admin/verify-id-tokens

## D. 최소 실제 기기 테스트

1. 기존 v4의 게스트 기록이 남은 **같은 브라우저**에서 Google 로그인합니다.
2. `내 기록`에 로그인 전 날짜별 공부 시간이 그대로 남는지 확인합니다.
3. 다른 휴대폰에서 동일 Google 계정으로 로그인해 `내 기록`에 동일 기록이 보이는지 확인합니다.
4. 다른 Google 계정으로 로그인한 친구에게 친구 코드를 전송해 신청·수락합니다.
5. 친구 목록에서 온라인·공부 상태 공개 설정을 확인합니다. 친구 랭킹을 열어 서버 기록을 확인합니다.
6. '함께 공부하기'로 같은 `room`에 입장하고 주변 좌석 중 빈 의자를 선택합니다.
7. 동일 Google 계정으로 두 기기에서 3D 조작을 시도해 **제어권 이전 확인**이 뜨는지, 실제 이용자 수/공부 시간이 중복되지 않는지 확인합니다.
8. 친구 차단·랭킹 비공개·계정 로그아웃 및 재로그인 테스트를 합니다.

**이 프로젝트 생성 환경에서는 실제 Firebase 프로젝트 ID·계정·서비스 계정 키가 제공되지 않았으므로 Google 팝업의 실서비스 성공은 테스트하지 않았습니다.** 자동 테스트는 명시적으로 인증 경계에 모의 검증기를 넣습니다. 실제 이용 환경 검증은 사용자가 직접 수행해야 합니다.

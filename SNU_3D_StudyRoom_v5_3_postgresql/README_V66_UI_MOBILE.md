# 코루라이브 V6.6 모바일 UI 통합 개선

기준: V6.5 UI Walk 전체 소스. 서버 API, DB, 인증, WebSocket, NPC, 좌석 점유, 공부시간 저장 및 랭킹 로직은 수정하지 않았습니다. 운영 환경에 직접 배포하지 않았습니다.

## 적용한 변경

1. 상단: 도서관 이름, 실제 접속자 수, 방 번호를 하나의 카드에 표시. 계정과 초대 링크는 접근 가능한 이름을 가진 SVG 아이콘 버튼으로 표시. 로그인 시 클라이언트의 계정 버튼 갱신 함수가 기존 SVG 구조를 지우지 않도록 조정.
2. 하단 채팅: 도서관 변경·캐릭터 선택 아이콘 버튼 2개와 40자 입력창, 전송 아이콘을 한 줄에 배치. 원래 클릭 핸들러와 WebSocket 전송 동작 유지. 250ms 내 연속 중복 전송을 억제. 가상 키보드 오픈 시 내비게이션을 임시 숨기는 처리를 추가.
3. 하단 내비게이션: 4개 실제 탭에 아이콘을 추가하고 높이 축소. 미구현 커뮤니티 탭은 UI에서 숨기지만 DOM 코드 유지. 기존 탭 선택 로직 유지.
4. 말풍선: 월드 폭 48m를 기준으로 14.4m, 26.88m, 42.24m 임계값에 1.8m 히스테리시스 적용. 가까운 거리 닉네임+시간, 중간·먼 거리 닉네임만, 원거리는 숨김. 내 캐릭터는 늘 닉네임+시간. 다른 사용자/NPC의 표시 상한은 모바일 12개, PC 22개. 화면 밖과 UI 안쪽 침범 말풍선은 숨기고 겹침을 우선순위별로 억제.
5. 카메라: 모바일에서만 초기 높이·거리와 화면 앞쪽 시선을 소폭 변경. 기존 팔로우·회전·충돌 경계 유지.
6. 디자인: 남색·하늘색·민트색 체계를 일치시키고 상단·채팅·내비게이션의 모서리 및 간격을 통일. 320/360/390/430px 모바일에 별도 레이아웃 적용.

## 수정 파일

- `index.html`: 화면 구조, CSS, 카메라 구도, 말풍선 거리/겹침, 채팅 안전 영역
- `client/account.js`: 계정 SVG 아이콘을 보존하면서 로그인 텍스트를 접근성 라벨로 갱신
- `tests/scene-v51.test.js`: 모바일 카메라 구도에 맞춘 기존 테스트 수정
- `tests/v65-ui-walk.test.js`: 새 카메라 추적 목표에 맞춘 기존 테스트 수정
- `tests/v66-ui-mobile.test.js`: 새로운 UI 회귀 테스트 8개 추가
- `package.json`, `package-lock.json`: 버전만 6.6.0-ui-mobile.1로 갱신(의존성 변경 없음)

## 스마트폰만으로 GitHub 반영

1. 이 ZIP을 스마트폰에 다운로드한 후 GitHub `jinjihwan/studycafe` 저장소의 **최상위 폴더**에 `Add file → Upload files`로 업로드해 커밋합니다.
2. Codespaces 터미널에서 다음을 복사해 실행합니다.

```bash
set -e
cd /workspaces/studycafe
git pull --ff-only origin main
unzip -o SNU_StudyRoom_V6_6_PHONE_GITHUB_UPDATE.zip
cd SNU_3D_StudyRoom_v5_3_postgresql
npm run check
FORCE_COLOR=0 npm test
cd /workspaces/studycafe
git add SNU_3D_StudyRoom_v5_3_postgresql/index.html SNU_3D_StudyRoom_v5_3_postgresql/client/account.js SNU_3D_StudyRoom_v5_3_postgresql/tests/scene-v51.test.js SNU_3D_StudyRoom_v5_3_postgresql/tests/v65-ui-walk.test.js SNU_3D_StudyRoom_v5_3_postgresql/tests/v66-ui-mobile.test.js SNU_3D_StudyRoom_v5_3_postgresql/package.json SNU_3D_StudyRoom_v5_3_postgresql/package-lock.json SNU_3D_StudyRoom_v5_3_postgresql/README_V66_UI_MOBILE.md SNU_3D_StudyRoom_v5_3_postgresql/TEST_REPORT_V66_UI_MOBILE.md
git commit -m "V6.6: mobile UI and distance labels"
git push origin main
```

`set -e`로 명령어 실패 시 실행을 멈춥니다. 성공한 테스트 결과 없이 자동으로 배포하는 위험을 줄입니다. 단, Railway 자동배포가 연결된 경우 `git push` 이후 운영 배포가 시작될 수 있습니다.

## 배포 후 필수 확인

실제 스마트폰에서 로그인, 프로필 상태, 채팅 입력·전송 및 키보드, 캐릭터 걷기, NPC/원격 사용자 거리 말풍선, 화면 가장자리, 좌석 착석·퇴석, 공부 시간·랭킹, 모바일 카메라 구도를 확인합니다. CDN/실기기/2,000명 동시접속 부하 테스트는 이 패키지의 자동 테스트 범위가 아닙니다.

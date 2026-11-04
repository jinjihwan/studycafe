# SNU Library Study Room v5.1 — 모바일 시야·이동·건축 개선

이 버전은 **현재 실행 중인 v5에 적용하는 기본 조작·건축 개선**입니다. v5의 Firebase Google 인증, 친구 요청·수락·랭킹, WebSocket 멀티플레이어, SQLite 공부 기록, NPC 8명, 동물 아바타와 좌석 데이터는 그대로 유지합니다. v5 모바일 인증 진단, Codespaces Origin 보안 수정, 친구 응답 패치가 통합된 소스를 기준으로 제작했습니다.

## 실제 변경 사항

1. **시작 카메라**: 초기 카메라 위치 `(12,12.2,45)` → `(4.2,6.0,42.2)`, 초기 타깃 `(0,1.8,15)` → `(0,1.45,33.7)`. 서버 캐릭터 시작 위치 `(0,35)` 기준 가까운 3인칭 구도. 드래그/핀치/휠과 따라가기 유지.
2. **직선 후 대각선으로 꺾이는 이동 개선**: 기존 A*는 보존하고, 안전한 직선 시야가 있는 구간에서 중간 경유지를 줄임. 가구나 벽을 통과하지 않도록 기존 격자 충돌 검사를 이용. 프레임마다 남은 이동 거리를 다음 경유지에 이어 써서 경유지에서 한 프레임 멈추는 현상도 완화.
3. **로그인 창 닫기**: 오른쪽 위 X, 바깥 배경 누르기, ESC. 이미 Google 로그인되어 있다면 버튼을 `Google 계정 연결됨`으로 표시해 중복 팝업을 막음. 명시적 Google 로그아웃 버튼은 보존.
4. **천장 높이 두 배**: 기존 9.3 → 18.6(장면 단위). 이 높이에 맞춰 옆면 창문, 사선 철골, 천장 LED 패턴, 책장 및 앞쪽 장식 벽의 세로 비율을 조정.
5. **뒤쪽 공간과 벽**: 뒷쪽 끝을 z=+55까지 연장하고 진짜 3D 유리·벽·창틀·외부 나무 및 건물을 추가. 시작 지점 뒤쪽에 카메라가 위치할 여유 확보.
6. **앞쪽 투명 이동 제한**: 육안으로 보이지 않는 길찾기 및 **서버 위치 검증** 경계 z=-37.5를 적용(원래 전면 서가 z≈-42). 카메라는 실제 앞·뒤·좌우 벽과 천장 안쪽에 머물도록 제약.
7. **뒤쪽 이동 구역 연장**: 길찾기 격자와 서버의 검증 범위를 z=+49까지 확장. 책상 88개, 의자 352개, 좌석 ID 및 NPC 지정은 **변경하지 않음**.

> 앞쪽에 있는 일부 의자의 접근 위치는 z≈-36.2이므로 투명 경계보다 안쪽에 남겨 두었습니다. 이 변경은 외부 서비스 URL, DB 스키마, 사용자 토큰을 변경하지 않습니다.

## 스마트폰 GitHub Codespaces에 패치 적용 (권장)

**기존 v5 공부 기록을 보존하려면 전체 프로젝트 ZIP을 덮어씌우지 않고 작은 패치 ZIP을 적용하세요.**

1. `SNU_v5_1_scene_navigation_patch.zip`을 스마트폰으로 다운로드합니다.
2. Codespaces 탐색기에서 `/workspaces/studycafe` 폴더에 업로드합니다. 이미 `SNU_3D_StudyRoom_v5` 폴더 안에 업로드했으면 아래 압축 해제 명령에서 `../`만 빼세요.
3. 실행 중인 `npm start` 터미널을 **휴지통 아이콘으로 종료**합니다.
4. 새 터미널에서 다음 명령을 실행합니다.

```bash
cd /workspaces/studycafe/SNU_3D_StudyRoom_v5
mkdir -p /home/codespace/.config/snu-studyroom/v51-code-backup
cp --parents index.html client/account.js server/index.js server/room.js \
  /home/codespace/.config/snu-studyroom/v51-code-backup/
unzip -o ../SNU_v5_1_scene_navigation_patch.zip
npm run check
npm test
npm start
```

> 패치 ZIP을 `SNU_3D_StudyRoom_v5` 폴더 안에 넣었다면 `unzip -o SNU_v5_1_scene_navigation_patch.zip`을 사용합니다. `unzip`은 `index.html`, 지정된 `client/`, `server/` 소스와 테스트만 교체합니다. `.env`, `.guest-secret`, `data/*.sqlite*`, 서비스 계정 JSON을 변경하지 않습니다.

## 모바일 확인 절차

- [ ] Google 계정으로 로그인 후 상단 `Google · 닉네임` 표시, 친구 탭 정상
- [ ] Google 버튼 다시 누르면 로그인 창 → **X** 또는 배경 터치로 도서관 복귀
- [ ] 접속 직후 캐릭터가 이전보다 크게 보이고, 굳이 핀치로 확대하지 않아도 됨
- [ ] 좌석/책상을 통과하지 않으면서 중앙 통로는 자연스럽게 대각 이동
- [ ] 의자 선택 → 캐릭터가 이동·착석 → 서버 공부 시간 증가
- [ ] 좌우 카메라 회전·핀치 줌이 유지됨
- [ ] 뒤로 카메라를 돌리면 높아진 창문·후면 외벽/후면 풍경이 보임
- [ ] 전면 서가 앞에는 보이지 않는 이동·카메라 경계가 있어 벽 안으로 들어가지 않음
- [ ] 스마트폰과 다른 기기 2대 동시 접속·친구·랭킹 재확인

성능 확인: 접속 링크에 `?room=main&perf=1`을 붙이면 FPS 표기가 나타납니다. 프레임이 낮으면 `&quality=low`를 추가할 수 있습니다. 천장·창·서가가 늘어난 만큼 성능은 실제 모바일에서 재확인해야 합니다.

## 변경 파일

- `index.html`: 카메라, 실내 건축, 이동 애니메이션, X 버튼
- `client/navigation-smooth.js`: 직선 시야 검사 및 안전한 경로 평활화
- `client/account.js`: 최신 친구 CSRF 재시도와 인증 오류 안내 유지, 연결 중인 Google 계정에서 재로그인 팝업 방지
- `server/index.js`: Codespaces Origin 보안 패치를 유지하면서 새 JS 모듈 제공 허용
- `server/room.js`: 클라이언트와 같은 앞뒤 경계 및 서버 권한 검사
- `tests/scene-v51.test.js`: 신규 변경 검증

이 저장소에는 **실제 사용자의 SQLite DB, `.guest-secret`, `.env`, Firebase Admin JSON 키를 포함하지 않습니다.** GitHub Codespaces는 영구 운영 호스팅 서비스가 아니므로 코드 및 개인 데이터 백업은 별도로 유지하세요.

## 실제 테스트와 제약

`npm run check`, `npm test`(36개), 로컬 HTTP `/health`, `/index.html`, `/client/navigation-smooth.js` 요청을 실행했습니다. 현재 도구 환경에서는 Google Firebase 실계정 및 실제 스마트폰 GPU/WebGL 화면을 사용한 통합 시각 검증은 수행하지 못했습니다. 따라서 화면 확대 비율·실제 프레임률·터치 조작 및 새 카메라 경계의 체감은 위 모바일 체크리스트로 확인해야 합니다.

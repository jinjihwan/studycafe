# 코루라이브 V6.7 모바일 UI 마무리

기준: V6.6 UI Mobile 전체 소스. 기존 서버 API, Firebase/Google 로그인, PostgreSQL, WebSocket, NPC/좌석/랭킹/공부기록/친구 로직은 변경하지 않았습니다. 운영 서버에 직접 배포하지 않았습니다.

## 주요 변경

1. **상단 정보 영역:** 기존 `room-summary`의 공간 확장(`flex:1`)을 없애고 도서관 이름에 맞는 콘텐츠 너비로 축소합니다. 두 번째 줄에 `방 번호 · 실제 접속자 수`를 함께 배치합니다. 우측 초대/계정 아이콘은 그대로 유지합니다. 긴 이름 또는 접속자 수에서 좁은 화면에 맞게 말줄임 처리합니다.
2. **하단 채팅:** 도서관 변경·캐릭터 선택·채팅 입력·전송 버튼을 감싸던 큰 짙은 남색 배경, 테두리, 그림자, 흐림 효과를 제거합니다. 각 버튼과 입력창의 개별 배경/터치 영역은 유지합니다.
3. **아이콘 중앙 정렬:** 도서관 변경·캐릭터 선택·전송 버튼에 CSS Grid 정중앙 배치를 적용합니다. 접근성 라벨과 클릭 리스너는 변경하지 않았습니다.
4. **말풍선:** 다른 사람·NPC 모두 거리별로 전체 크기만 완만하게 바꾸고, 표시되는 모든 말풍선에 닉네임과 `HH:MM:SS` 공부 시간을 함께 표시합니다. 캐릭터 머리 좌표를 화면에 투영한 위치를 사용하며 화면 가장자리 보정과 겹침에 따른 임의 이동/숨김을 제거합니다. 가장자리에서 부분적으로 잘리는 것은 허용합니다. 깊이 범위를 벗어나거나 완전히 화면 밖이면 표시를 생략합니다. 밀집 시 성능을 위해 근거리 우선 표시 개수는 모바일 16개/PC 36개로 제한합니다.
5. **카메라:** 모바일 카메라의 바라보는 목표를 아바타 쪽으로 소폭 조정하여 캐릭터가 화면의 약간 위쪽에 배치되도록 합니다. 기존 추적/이동/충돌 제한은 유지합니다.
6. **톤 조절:** 내 캐릭터 말풍선 발광 효과를 줄이고, 선택된 하단 탭의 파란색을 조금 차분하게 변경합니다. 빈 입력창에서 채팅 전송 버튼을 비활성화하여 불필요한 강조를 줄입니다.

## 수정 파일

- `index.html`: 위 UI/CSS와 라벨·카메라 표시 동작
- `tests/v65-ui-walk.test.js`, `tests/v66-ui-mobile.test.js`: 기존 UI 회귀 테스트를 현재 기준에 맞게 갱신
- `tests/v67-ui-polish.test.js`: 신규 UI 회귀 테스트
- `package.json`, `package-lock.json`: 버전만 `6.7.0-ui-polish.1`로 갱신(의존성 변경 없음)
- `README_V67_UI_POLISH.md`, `TEST_REPORT_V67_UI_POLISH.md`: 적용 및 검증 정보

## 스마트폰 GitHub + Codespaces 적용

1. `SNU_StudyRoom_V6_7_PHONE_GITHUB_UPDATE.zip`을 **GitHub 저장소 `jinjihwan/studycafe` 최상위 폴더**에 업로드하여 커밋합니다. ZIP 자체는 소스에 적용되지 않습니다.
2. 현재 V6.6 코드가 해당 저장소에 이미 반영되어 있는지 확인한 후 Codespaces 터미널에서 아래 명령어를 차례로 실행합니다.

```bash
set -e
cd /workspaces/studycafe
git pull --ff-only origin main
unzip -o SNU_StudyRoom_V6_7_PHONE_GITHUB_UPDATE.zip
cd SNU_3D_StudyRoom_v5_3_postgresql
npm run check
FORCE_COLOR=0 npm test
cd /workspaces/studycafe
git add \
  SNU_3D_StudyRoom_v5_3_postgresql/index.html \
  SNU_3D_StudyRoom_v5_3_postgresql/tests/v65-ui-walk.test.js \
  SNU_3D_StudyRoom_v5_3_postgresql/tests/v66-ui-mobile.test.js \
  SNU_3D_StudyRoom_v5_3_postgresql/tests/v67-ui-polish.test.js \
  SNU_3D_StudyRoom_v5_3_postgresql/package.json \
  SNU_3D_StudyRoom_v5_3_postgresql/package-lock.json \
  SNU_3D_StudyRoom_v5_3_postgresql/README_V67_UI_POLISH.md \
  SNU_3D_StudyRoom_v5_3_postgresql/TEST_REPORT_V67_UI_POLISH.md
git commit -m "V6.7: compact header, centered actions and labels"
git push origin main
```

**주의:** `git push` 후 Railway 자동 배포가 시작될 수 있습니다. 운영 서버에서 로그인/채팅/좌석/공부기록/카메라/말풍선을 별도로 확인해야 합니다.

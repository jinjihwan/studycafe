# V6.8 Tutorial + Nearby Labels

## 적용 내용

1. 모든 말풍선이 한꺼번에 뜨지 않도록 조정했습니다.
   - 내 캐릭터 말풍선은 항상 표시됩니다.
   - 다른 사용자와 NPC의 말풍선은 가까운 일부만 표시됩니다.
   - 멀리 있는 말풍선은 숨겨져 화면 복잡도를 줄입니다.
   - 표시되는 말풍선에서는 이름과 공부 시간이 항상 함께 나옵니다.

2. 첫 방문자 전용 튜토리얼을 추가했습니다.
   - 8단계 순서형 튜토리얼 오버레이
   - 이 브라우저에서 처음 한 번 자동 표시
   - 순서:
     1) 화면 이동 및 확대·축소
     2) 도서관 이동
     3) 캐릭터 변경
     4) 바닥 터치로 이동
     5) 의자에 앉아 시간 기록
     6) 말하기
     7) 친구 초대
     8) Google 로그인 안내

3. 기존 기능은 유지했습니다.
   - 멀티플레이어 동기화
   - 좌석 예약 / 착석
   - 채팅
   - 기록 / 랭킹 / 친구
   - Google 로그인

## 수정 파일

- index.html
- tests/v66-ui-mobile.test.js
- tests/v67-ui-polish.test.js
- tests/v68-tutorial-near-labels.test.js
- package.json
- package-lock.json
- TEST_REPORT_V68_TUTORIAL_NEAR_LABELS.md

# V6.5 UI·보행 애니메이션 검증 보고서

## 검증 명령 및 요약

| 검사 | 결과 | 세부 내용 |
|---|---|---|
| `npm run check` | PASS | HTML module syntax OK / 43개 필수 자산과 로컬 import 존재 확인 |
| `npm test` | PASS | 총 90 / 통과 89 / 실패 0 / 건너뜀 1 |
| 신규 V6.5 회귀 테스트 | PASS | 6/6 |
| Node 서버 HTTP 검사 | PASS | `/`, `/client/walk-animation.js`, `/client/network.js` 모두 200 |
| Chromium PC UI 배치 | PASS | 1280×800 / 입력창·전송 버튼만 존재 / 화면 가로 넘침 없음 |
| Chromium 모바일 UI 배치 | PASS | 390×844 / 입력창·전송 버튼만 존재 / 화면 가로 넘침 없음 |
| Chromium 소형 모바일 UI 배치 | PASS | 320×640 / 입력창·전송 버튼만 존재 / 화면 가로 넘침 없음 |

## 건너뛴 항목

- `REAL PostgreSQL: persistent records, Google identity, friends, privacy and transactions`: 별도 `PG_TEST_DATABASE_URL` 및 `PG_TEST_ALLOW=YES`가 없어 환경 의존 테스트 1개를 건너뜀. 나머지 계정/좌석/실시간 통신 관련 자동 테스트는 통과함.

## 코드 보존 범위

- 기존 서버의 유저 인증, 좌석 점유 및 반납, 공부 시간 계산 및 저장, 랭킹, 채팅 메시지, NPC 서버 동기화, 자동 방 라우팅 및 멀티플레이어 동작을 수정하지 않음.
- 서버의 정적 파일 허용 목록에는 신규 보행 스크립트를 추가함.
- 기존 `pause` 메시지 처리와 공부 시간의 `paused` 상태는 유지함. 단지 해당 UI 버튼만 제거함.
- 보행 애니메이션은 동물 디자인/재질을 유지하며, 기존 위치 메시지를 사용해 원격 캐릭터도 로컬 이동량을 추론해서 재생함. 새 네트워크 패킷이 필요 없음.

## 수행하지 않은 검증

- 외부 CDN에서 Three.js 모듈을 다운로드하는 실기기 3D 시각 검사(테스트 환경의 브라우저가 네트워크 탐색을 제한함).
- 실제 Railway/Firebase/PostgreSQL 운영 환경의 로그인 및 2,000명 접속 성능 테스트.
- PC와 모바일의 실제 GPU/FPS 장시간 측정.

> PC·모바일 브라우저 배치 검사는 Chrome DevTools Protocol을 통해 HTML/CSS를 주입하여 확인했으며, 네트워크로 실제 페이지를 탐색하거나 Three.js 장면을 실행한 테스트는 아닙니다. 운영 환경과 실기기 시각 테스트를 별도로 권장합니다.

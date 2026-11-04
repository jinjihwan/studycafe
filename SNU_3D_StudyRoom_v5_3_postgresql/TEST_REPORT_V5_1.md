# v5.1 검사 보고서

## 수행

- 원본 `SNU_3D_StudyRoom_v5_Full_Project.zip`을 기반으로 모바일 인증 오류 표시, Codespaces Origin 검사 수정, 친구 수락·거절/CSRF 수정 패치의 전체 소스를 통합했습니다.
- 기존 `index.html`의 Three.js 테이블/의자/NPC/캐릭터 생성·서버 WebSocket 프로토콜은 보존했습니다.
- **Node.js 자동 테스트**: 36/36 통과 (실제 SQLite, HTTP, WebSocket 및 신규 씬 관련 순수 함수/정적 계약 검사 포함).
- **정적 검사**: `npm run check` 통과 (HTML 모듈 구문, 클라이언트/서버 JavaScript 구문, 프로젝트 자산 검사).
- **서버 실행 스모크 테스트**: 로컬 포트 38671에서 `/health` JSON `ok:true`, `index.html` HTTP 200, 새 `navigation-smooth.js` HTTP 200 확인.
- **보안**: 신규 이동 영역 z=-37.5..49는 서버의 `isWalkable`에도 적용. 기존 Origin 검증 및 친구 CSRF 검사 테스트 통과.
- **비밀 정보**: 배포 ZIP에 실행 환경 `.env`, `.guest-secret`, SQLite 데이터, Admin JSON을 넣지 않음.

## 추가 테스트 6개

1. 처음 카메라 구도 및 로그인 X/ESC·카메라 내부 클램프 코드
2. 두 배 천장 및 실제 후면 구조, 352개 좌석의 ID 보존
3. 서버·브라우저의 동일한 전후 경계, 기존/새 이동 범위 검사
4. 장애물이 없는 곳의 경유점 생략
5. 장애물 우회 과정에서 중간 경유점 보존
6. 코너 가로지르기 방지

## 검증되지 않은 부분

- Google 로그인 실계정/Firebase 서비스 인증 및 실제 2기기 화면 동기화
- 스마트폰 WebGL에서 천장·외벽 실제 배치의 시각적 품질
- 장시간 모바일 프레임률/발열
- 모든 가능한 사용자 경로의 충돌 회피를 자동으로 전수 검증한 것은 아님

자동 테스트 성공은 위 모바일 검증을 대체하지 않습니다. 특히 현재 Codespaces 서버에 적용한 친구/Origin 패치 위에 소스가 덮어써지므로, 적용 전 서버 코드 백업을 권장합니다.

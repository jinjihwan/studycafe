# V7.12 온라인스카: 이름·Google 검색 준비

## 공식 사이트 이름
- 브랜드명: **온라인스카**
- HTML/브라우저 제목: **온라인스카 | 내 폰 속 서연고 도서관**
- 공식 사이트: https://onlinestudy.maegongmae.com/

## 변경 사항
- index.html: 페이지 제목, 검색 설명, canonical, Open Graph, WebSite JSON-LD.
- JS가 도서관별 구식 제목으로 덮어쓰던 부분을 통일.
- 도서관 선택 설명에 서비스명을 표시 (3D 화면 레이아웃 변경 없음).
- server/index.js: robots.txt와 sitemap.xml 정적 제공, 올바른 MIME 유형.
- robots.txt, sitemap.xml: 사이트 첫 페이지 크롤링 안내.

## 배포 뒤 Google 등록
1. https://search.google.com/search-console 에 접속합니다.
2. Cloudflare에서 `maegongmae.com` DNS를 관리하므로, '도메인' 속성에 `maegongmae.com`을 입력하는 방식이 간편합니다. 해당 속성은 서브도메인도 포함합니다.
3. Google이 발급한 DNS TXT를 Cloudflare → DNS → Records에서 'TXT' 유형, 이름 `@`(루트 도메인), 내용은 Google 값 그대로 추가합니다. **기존 CNAME/A 레코드는 변경·삭제하지 않습니다.**
4. Google에서 소유권 확인을 완료합니다. 원하면 별도로 'URL 접두어' 속성 `https://onlinestudy.maegongmae.com/`도 추가할 수 있습니다(상위 도메인 확인 시 자동 확인될 수 있음).
5. 'Sitemaps'에 전체 주소 `https://onlinestudy.maegongmae.com/sitemap.xml`을 제출합니다.
6. URL 검사에 `https://onlinestudy.maegongmae.com/`을 입력하고 '색인 생성 요청'을 진행합니다.
7. 인덱싱은 즉시 완료되거나 검색 1위를 보장하지 않습니다.

## 주의
- 원래 Railway 주소도 접속이 가능하되, canonical은 공식 하위 도메인을 제시합니다.
- Railway 변수, Firebase, Cloudflare 기존 룰, 3D/채팅/친구/NPC 코드는 변경하지 않았습니다.
- Google에서 원하는 사이트 이름을 표시하는지 여부는 검색 시스템이 결정합니다.

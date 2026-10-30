# 댓글 운영

GitHub(giscus) 댓글과 익명 댓글을 **하나의 목록**에 작성 시간순으로 섞어 표시합니다. 작성창은 GitHub용과 익명용이 따로 있고, 댓글 목록은 하나입니다. 각 댓글의 작은 `GitHub` / `익명` 표시로 작성 방식을 구분합니다.

## 방문자가 사용하는 방법

- `익명으로 댓글 남기기` 작성창은 접힘 없이 표시됩니다. GitHub 댓글창처럼 `작성하기 / 미리보기` 탭, 얇은 테두리의 입력 영역과 등록 버튼을 사용하며 닉네임(선택)과 숫자 4자리 삭제 PIN을 하단에 작게 배치합니다. 미리보기는 등록될 일반 텍스트를 그대로 보여주며 입력한 내용과 PIN을 유지합니다. `0042`처럼 앞에 0이 있는 PIN도 사용할 수 있습니다.
- PIN 댓글의 `삭제` 버튼을 누르면 댓글 아래에 PIN 입력칸이 열립니다. 올바른 PIN을 입력하고 `삭제하기`를 누르면 바로 삭제됩니다. PIN 입력은 가려지고, 취소 버튼이나 Escape 키로 닫을 수 있습니다.
- PIN은 브라우저 저장소에 보관하지 않습니다. 다른 기기·시크릿 창에서도 PIN으로 삭제할 수 있고, 브라우저 저장소가 차단되어 있어도 작성·삭제할 수 있습니다. PIN을 다시 확인하거나 복구하는 기능은 없습니다.
- PIN 기능 도입 전에 작성한 댓글은 기존 브라우저 삭제 키를 계속 사용합니다. 해당 브라우저에서만 `삭제` 버튼이 나타나며 저장 데이터를 지우면 삭제 권한이 사라집니다. 기존 댓글에 PIN을 임의로 설정하지 않습니다.
- `오래된 순` / `새로운 순`으로 두 종류의 댓글을 함께 정렬합니다. `댓글 더 보기`도 두 저장소의 다음 댓글을 시간순으로 합칩니다. 개수는 현재 불러온 최상위 댓글 수이며 더 불러올 댓글이 있으면 `+`가 붙습니다.
- GitHub 댓글 작성은 기존 giscus 로그인·작성창을 사용합니다. 작성 후 giscus가 알린 변경 사항을 받아 통합 목록을 새로 읽습니다.
- GitHub 댓글의 Markdown, 아바타, 답글, 추천·반응 수를 통합 목록에서도 볼 수 있습니다. 답글은 해당 댓글 아래에서 펼칩니다. 답글이 아주 많으면 giscus가 제공하는 최근 100개가 표시되며 전체 답글은 원래 화면에서 확인합니다.
- `답글·반응`을 누르면 기존 giscus 화면에서 답글·추천·반응을 사용할 수 있습니다. 이 동안 통합 목록은 숨겨 중복 표시하지 않습니다. `전체 댓글로 돌아가기`를 누르면 갱신된 통합 목록으로 돌아옵니다. GitHub와 익명 댓글의 저장 위치는 그대로 유지합니다.
- `GitHub에서 수정·삭제` 버튼은 현재 글의 GitHub Discussion으로 이동합니다. 해당 댓글의 `···` 메뉴에서 삭제합니다.
- giscus에서 로그인한 계정의 댓글·답글에는 통합 목록 안에도 `삭제` 버튼이 표시됩니다. 기존 로그인을 그대로 사용하며, 정상 로그인 상태에서는 별도 로그인이 필요하지 않습니다. 로그아웃·세션 만료 시에는 위 giscus 댓글창에서 로그인합니다.
- 삭제 권한은 서버에서 GitHub의 `viewerDidAuthor`와 `viewerCanDelete`로 확인합니다. 본인이 작성한 현재 글의 댓글만 삭제할 수 있습니다. 답글이 있는 부모 댓글은 GitHub 정책에 따라 본문만 삭제하고 답글을 보존합니다.
- 삭제 후 통합 목록은 즉시 갱신합니다. 기존 giscus iframe은 다시 로드하지 않아 작성 중인 GitHub 댓글 초안을 보존하며, 원래 giscus 화면의 데이터 갱신은 giscus 자체 갱신 동작을 따릅니다.

## 저장소와 권한

- 익명 댓글: Cloudflare Worker `optimization-log-comments`, D1 `optimization-log-comments`.
- API: `https://optimization-log-comments.minyee714.workers.dev`.
- 익명 조회·작성·삭제는 `/comments`, GitHub 공개 댓글 조회는 `GET /github-comments`, 본인 GitHub 댓글 삭제는 `DELETE /github-comments/:id`를 사용합니다. giscus API는 블로그 출처의 직접 조회를 허용하지 않아 Worker에서 조회합니다. 별도로 발급한 개인 GitHub 토큰이나 새 인증키는 사용하지 않습니다.
- 삭제할 때만 브라우저에 이미 저장된 암호화된 giscus 세션을 Worker로 보내고, giscus의 세션 교환 API로 해당 사용자의 GitHub 토큰을 확인합니다. 토큰은 해당 요청의 메모리에서만 사용하며 브라우저 응답·DB·캐시·로그에 저장하지 않습니다. 클라이언트가 보낸 사용자 이름은 삭제 권한 판정에 사용하지 않습니다.
- GitHub 삭제는 설정된 저장소·카테고리와 현재 글의 giscus 연결 해시까지 확인합니다. 로그인한 작성자 자신의 권한으로만 호출하며, 운영자 계정 토큰으로 타인 댓글을 대신 삭제하지 않습니다. 기존 분당 요청 제한과 출처 제한도 적용합니다.
- GitHub 조회 대상은 Worker의 `GISCUS_REPO`, `GISCUS_CATEGORY`, `GISCUS_STRICT` 설정으로 고정합니다. `_config.yml`의 giscus 설정과 일치해야 하며 현재 글 연결 방식은 `pathname`입니다. 공개 조회 결과만 최대 30초 캐시하고, 작성 후 갱신·수동 새로고침은 캐시를 건너뜁니다.
- PIN은 기존 서버 비밀값 `COMMENT_RATE_LIMIT_SECRET`과 댓글 번호를 사용하는 HMAC-SHA-256으로 검증합니다. DB에는 `delete_pin_hash`만 보관하며, 원문 PIN은 DB·로그·응답에 저장하지 않습니다. 같은 PIN도 댓글마다 다른 해시가 됩니다. 이 비밀값을 변경하면 기존 PIN을 검증할 수 없으므로 유지합니다.
- 조회·작성 응답의 `delete_method`는 `pin` 또는 `browser`입니다. PIN과 삭제 해시는 공개 API에서 반환하지 않습니다. `DELETE /comments/:id`에 `{ "pin": "0042" }`를 JSON으로 전송해 삭제합니다. PIN 댓글은 브라우저 키로 삭제할 수 없습니다.
- 기존 브라우저 삭제 키 댓글은 256비트 임의 키의 SHA-256 해시로 검증합니다. 이전 클라이언트의 키 기반 작성·삭제 API도 호환성을 위해 유지합니다. 댓글 번호만 알아서는 삭제할 수 없습니다.
- PIN 검증은 댓글 하나당 15분 구간에 최대 5회로 제한하며, IP를 바꾸어도 이 한도를 공유합니다. 작성 응답을 잃은 경우의 동일 ID 재전송도 같은 제한을 적용해 PIN 추측에 악용되지 않도록 합니다. 한도에 도달하면 최대 15분 뒤 다시 시도할 수 있습니다.
- 익명 본문은 HTML로 해석하지 않고 일반 텍스트로 표시합니다. GitHub의 렌더링된 Markdown도 허용된 요소와 안전한 URL만 새 DOM으로 만들어 표시합니다.
- 쓰기 요청은 블로그 출처만 허용하고, IP 주소를 비밀값과 함께 해시하여 분당 10회로 제한합니다. 원본 IP는 D1에 저장하지 않습니다.
- 닉네임은 30자, 본문은 2,000자로 제한하며 목록은 인덱스와 50개 단위 페이지 나누기를 사용합니다. 두 소스의 다음 댓글을 비교해 합치므로 댓글 수가 달라도 페이지 경계에서 댓글을 건너뛰지 않습니다.
- 한쪽 조회가 실패해도 다른 쪽 댓글은 표시하고, 이미 표시한 댓글은 유지합니다. GitHub 조회와 로그인 재사용은 giscus API에 의존하므로 API 변경 시 확인이 필요합니다. 원래 giscus 화면은 계속 사용할 수 있습니다.

## 운영자 관리

다른 사람이 남긴 익명 댓글은 Cloudflare 대시보드에서 **D1 → optimization-log-comments**의 데이터 탐색기를 열어 해당 댓글을 확인하고 관리합니다. PIN 댓글의 `삭제` 버튼은 모든 방문자에게 표시되지만 올바른 PIN이 있어야 삭제됩니다. 이전 브라우저 키 방식의 댓글은 작성한 브라우저에서만 삭제 버튼이 나타납니다.

GitHub 댓글은 저장소의 [Discussions](https://github.com/minhye0714/minhye0714.github.io/discussions)에서 관리합니다. 두 종류의 댓글은 서로 다른 저장소에 있으며 giscus 댓글을 삭제하거나 옮기지 않습니다.

## 무료 플랜

Workers Free는 하루 100,000 요청, D1 Free는 하루 5,000,000행 읽기·100,000행 쓰기·총 5GB를 제공합니다. 이 한도는 계정의 다른 서비스와 공유됩니다. 무료 한도 초과 시 요청이 제한될 수 있습니다. Workers 유료 플랜으로 바꾸지 않아야 무료 플랜 정책이 유지됩니다.

- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)

## 서버 수정과 재배포

**배포는 사용자가 요청했을 때만 합니다.** 로컬 수정·테스트만으로 운영 서버에 반영되지 않습니다. 운영 D1에 미적용 마이그레이션(`0002_pageviews.sql`, `0003_comment_pins.sql`, `0004_visitors.sql`)을 먼저 적용하고, Worker를 배포한 뒤 GitHub Pages 변경을 배포합니다. PIN 마이그레이션은 기존 댓글에 nullable 열 하나만 추가하므로 기존 데이터와 삭제 키를 유지합니다. 새 DB나 비밀값은 필요하지 않습니다.

현재 레포의 `tools/comments-worker`에서 실행합니다. Node.js 24 버전을 권장합니다.

```powershell
npm ci
npm test
npx wrangler login
npx wrangler d1 migrations apply optimization-log-comments --remote
npm run deploy
```

이미 배포된 DB ID는 `wrangler.jsonc`에 기록되어 있으므로 새 DB를 만들지 않습니다. 비밀값 `COMMENT_RATE_LIMIT_SECRET`은 Cloudflare Secret에 설정되어 있으며 레포나 브라우저 코드에 기록하지 않습니다. 일반 재배포에는 재설정이 필요하지 않습니다.

처음 다른 계정에 설치할 때만 `wrangler d1 create`로 새 DB를 만들고 ID를 바꾼 뒤 마이그레이션을 적용합니다. `wrangler secret put COMMENT_RATE_LIMIT_SECRET`으로 충분히 긴 임의의 비밀값을 설정하고, `_config.yml`의 `comments.anonymous.endpoint`에 배포 URL을 입력합니다.

GitHub Pages의 소스·CSS·화면 변경은 현재 레포를 커밋하고 푸시해야 반영됩니다. `tools`는 Jekyll 배포 대상에서 제외됩니다.

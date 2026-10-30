# 댓글 운영

GitHub(giscus) 댓글과 익명 댓글을 **하나의 목록**에 작성 시간순으로 섞어 표시합니다. 작성창은 GitHub용과 익명용이 따로 있고, 댓글 목록은 하나입니다. 각 댓글의 작은 `GitHub` / `익명` 표시로 작성 방식을 구분합니다.

## 방문자가 사용하는 방법

- `익명으로 댓글 남기기`를 펼치면 로그인 없이 닉네임(선택)과 내용을 입력해 작성할 수 있습니다.
- 작성한 브라우저에서는 자신의 댓글 옆에 `삭제` 버튼이 표시됩니다.
- 삭제 키는 브라우저에 저장됩니다. 다른 기기, 시크릿 창, 브라우저 저장 데이터 삭제 후에는 직접 삭제할 수 없습니다.
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
- 각 댓글에 256비트 임의 삭제 키를 발급합니다. 서버에는 SHA-256 해시만 저장하며 조회 API에는 삭제 키와 해시가 포함되지 않습니다.
- 다른 댓글의 번호를 알아도 올바른 삭제 키 없이는 삭제할 수 없습니다.
- 익명 본문은 HTML로 해석하지 않고 일반 텍스트로 표시합니다. GitHub의 렌더링된 Markdown도 허용된 요소와 안전한 URL만 새 DOM으로 만들어 표시합니다.
- 쓰기 요청은 블로그 출처만 허용하고, IP 주소를 비밀값과 함께 해시하여 분당 10회로 제한합니다. 원본 IP는 D1에 저장하지 않습니다.
- 닉네임은 30자, 본문은 2,000자로 제한하며 목록은 인덱스와 50개 단위 페이지 나누기를 사용합니다. 두 소스의 다음 댓글을 비교해 합치므로 댓글 수가 달라도 페이지 경계에서 댓글을 건너뛰지 않습니다.
- 한쪽 조회가 실패해도 다른 쪽 댓글은 표시하고, 이미 표시한 댓글은 유지합니다. GitHub 조회와 로그인 재사용은 giscus API에 의존하므로 API 변경 시 확인이 필요합니다. 원래 giscus 화면은 계속 사용할 수 있습니다.

## 운영자 관리

다른 사람이 남긴 익명 댓글은 Cloudflare 대시보드에서 **D1 → optimization-log-comments**의 데이터 탐색기를 열어 해당 댓글을 확인하고 관리합니다. 브라우저의 `삭제` 버튼은 그 브라우저에서 작성한 댓글에만 표시됩니다.

GitHub 댓글은 저장소의 [Discussions](https://github.com/minhye0714/minhye0714.github.io/discussions)에서 관리합니다. 두 종류의 댓글은 서로 다른 저장소에 있으며 giscus 댓글을 삭제하거나 옮기지 않습니다.

## 무료 플랜

Workers Free는 하루 100,000 요청, D1 Free는 하루 5,000,000행 읽기·100,000행 쓰기·총 5GB를 제공합니다. 이 한도는 계정의 다른 서비스와 공유됩니다. 무료 한도 초과 시 요청이 제한될 수 있습니다. Workers 유료 플랜으로 바꾸지 않아야 무료 플랜 정책이 유지됩니다.

- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)

## 서버 수정과 재배포

**배포는 사용자가 요청했을 때만 합니다.** 로컬 수정·테스트만으로 운영 서버에 반영되지 않습니다. 이번 통합 목록 변경을 반영할 때는 새 `/github-comments` 경로와 정렬을 지원하는 Worker를 먼저 배포한 뒤 GitHub Pages 변경을 배포해야 합니다. DB 마이그레이션이나 새 비밀값은 필요하지 않습니다.

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

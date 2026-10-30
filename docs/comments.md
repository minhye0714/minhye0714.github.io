# 댓글 운영

블로그는 익명 댓글과 기존 giscus 댓글을 함께 사용합니다.

## 방문자가 사용하는 방법

- 익명 댓글은 로그인 없이 닉네임(선택)과 내용을 입력해 작성합니다.
- 작성한 브라우저에서는 자신의 댓글 옆에 `삭제` 버튼이 표시됩니다.
- 삭제 키는 브라우저에 저장됩니다. 다른 기기, 시크릿 창, 브라우저 저장 데이터 삭제 후에는 직접 삭제할 수 없습니다.
- 기존 GitHub 댓글은 `GitHub 댓글 보기·작성`을 펼쳐 사용합니다.
- `GitHub에서 수정·삭제` 버튼은 현재 글의 GitHub Discussion으로 이동합니다. 해당 댓글의 `···` 메뉴에서 삭제합니다.

## 저장소와 권한

- 익명 댓글: Cloudflare Worker `optimization-log-comments`, D1 `optimization-log-comments`.
- API: `https://optimization-log-comments.minyee714.workers.dev`.
- 각 댓글에 256비트 임의 삭제 키를 발급합니다. 서버에는 SHA-256 해시만 저장하며 조회 API에는 삭제 키와 해시가 포함되지 않습니다.
- 다른 댓글의 번호를 알아도 올바른 삭제 키 없이는 삭제할 수 없습니다.
- 내용은 HTML로 해석하지 않고 일반 텍스트로 표시합니다.
- 쓰기 요청은 블로그 출처만 허용하고, IP 주소를 비밀값과 함께 해시하여 분당 10회로 제한합니다. 원본 IP는 D1에 저장하지 않습니다.
- 닉네임은 30자, 본문은 2,000자로 제한하며 목록은 인덱스와 50개 단위 페이지 나누기를 사용합니다.

## 운영자 관리

다른 사람이 남긴 익명 댓글은 Cloudflare 대시보드에서 **D1 → optimization-log-comments**의 데이터 탐색기를 열어 해당 댓글을 확인하고 관리합니다. 브라우저의 `삭제` 버튼은 그 브라우저에서 작성한 댓글에만 표시됩니다.

GitHub 댓글은 저장소의 [Discussions](https://github.com/minhye0714/minhye0714.github.io/discussions)에서 관리합니다. 두 종류의 댓글은 서로 다른 저장소에 있으며 giscus 댓글을 삭제하거나 옮기지 않습니다.

## 무료 플랜

Workers Free는 하루 100,000 요청, D1 Free는 하루 5,000,000행 읽기·100,000행 쓰기·총 5GB를 제공합니다. 이 한도는 계정의 다른 서비스와 공유됩니다. 무료 한도 초과 시 요청이 제한될 수 있습니다. Workers 유료 플랜으로 바꾸지 않아야 무료 플랜 정책이 유지됩니다.

- [Workers 요금](https://developers.cloudflare.com/workers/platform/pricing/)
- [D1 요금](https://developers.cloudflare.com/d1/platform/pricing/)

## 서버 수정과 재배포

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

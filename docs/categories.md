# 카테고리 관리

왼쪽 메뉴의 `카테고리` 아래 목록은 `_data/sidebar_categories.yml`에서 관리합니다.
파일에 적힌 순서대로 표시되고, 글이 없어도 메뉴와 빈 목록 페이지가 생성됩니다.

## 글 분류하기

`_posts/YYYY-MM-DD-title.md` 상단에 대분류와 소분류를 순서대로 적습니다.
하위 분류가 없는 카테고리는 이름 하나만 적으면 됩니다.
이름은 설정 파일의 값과 공백·대소문자까지 일치해야 합니다.

```yaml
---
title: "소프트웨어 설계 원칙 정리"
categories: [Tech, Engineering]
tags: [solid, design-pattern]
---
```

개인 기록도 같은 방식으로 분류합니다.

```yaml
categories: [Experience]
tags: [bootcamp, retrospective]
```

OCR 글은 Tech 아래에 모으고, 세부 주제는 태그로 구분합니다.

```yaml
categories: [Tech, OCR]
tags: [text-detection, document-understanding]
```

현재 분류에 맞는 작성 예시는 다음과 같습니다.

| 주제 | categories |
| --- | --- |
| AI·머신러닝 | `[Tech, "AI & ML"]` |
| OCR | `[Tech, OCR]` |
| 개발·소프트웨어공학 | `[Tech, Engineering]` |
| 애자일 | `[Work, Agile]` |
| 생산성 | `[Work, Productivity]` |
| 부트캠프 후기·경험 | `[Experience]` |
| 잡담·고찰 | `[Thoughts]` |
| 수학 | `[Tech, Math]` |

글을 추가하고 사이트를 다시 빌드하면 해당 카테고리의 목록과 글 수가 자동으로 갱신됩니다.
글 내용을 분석해서 카테고리를 추측하는 기능은 없으므로 `categories`를 직접 지정합니다.

## 메뉴 수정하기

`_data/sidebar_categories.yml`의 `name`은 대분류, `children`은 소분류입니다.

```yaml
- name: Tech
  children:
    - "AI & ML"
    - OCR
    - Engineering
    - Math
```

항목을 추가하거나 순서를 바꾸면 메뉴에 반영됩니다. 이름을 바꿀 때는 기존 글의
`categories`도 함께 수정하세요. 소분류 이름은 대분류 사이에서 중복하지 않는 것이
좋습니다. Chirpy는 같은 카테고리 이름의 글을 하나의 목록으로 모읍니다.

설정 파일에 없는 카테고리를 글에서 사용해도 기본 카테고리 목록은 생성되지만,
왼쪽 고정 메뉴에는 표시되지 않습니다.

## 구현 위치

- `_includes/sidebar.html`: Chirpy 7.6 사이드바에 카테고리 메뉴 연결
- `_includes/sidebar-categories.html`: 설정 파일과 실제 글 수로 메뉴 표시
- `_plugins/preset-categories.rb`: 글이 없는 카테고리의 페이지 생성
- `_layouts/category.html`: 글 목록과 빈 목록 안내
- `assets/css/jekyll-theme-chirpy.scss`: 사이드바 메뉴와 스크롤 스타일

테마를 업그레이드할 때는 로컬에서 재정의한 `sidebar.html`, `category.html`,
스타일 진입 파일을 새 테마 버전과 비교하세요.

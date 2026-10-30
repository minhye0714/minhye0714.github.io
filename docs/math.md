# 수식 작성

모든 글은 기본으로 MathJax 수식 표시를 지원합니다. 새 글에 `math: true`를 매번 추가하지 않아도 됩니다. 특정 글에서만 끄려면 해당 글의 YAML 머리말에 `math: false`를 지정합니다. 글 이외의 탭 페이지에서 사용하려면 해당 페이지 머리말에 `math: true`를 추가합니다.

## 문장 안 수식

Chirpy와 Kramdown이 수식 내용을 보존하도록 `$$ ... $$`를 사용합니다.

```markdown
아인슈타인의 식은 $$ E = mc^2 $$입니다.
확률은 $$ P(A \mid B) = \frac{P(B \mid A)P(A)}{P(B)} $$로 구합니다.
```

## 별도 줄 수식

수식 앞뒤에 빈 줄을 두고 `$$`를 별도 줄에 씁니다.

```markdown
손실 함수는 다음과 같습니다.

$$
\mathcal{L}(\theta) = \frac{1}{N} \sum_{i=1}^{N} (y_i - f_\theta(x_i))^2
$$

여기서 $$ N $$은 데이터 개수입니다.
```

행렬과 여러 줄 정렬도 사용할 수 있습니다.

```markdown
$$
\begin{bmatrix}
a & b \\
c & d
\end{bmatrix}
$$

$$
\begin{aligned}
y &= wx + b \\
\frac{\partial y}{\partial x} &= w
\end{aligned}
$$
```

코드 블록과 백틱 안의 수식은 코드로 표시합니다. 중괄호 두 개가 연속된 부분이 Liquid 문법 `{{`와 겹치는 경우에는 식을 정리하거나 해당 글 머리말에 `render_with_liquid: false`를 지정합니다.

표시는 테마가 제공하는 MathJax 스크립트를 이용합니다. 수식이 없는 홈·카테고리 목록에서는 추가로 로드하지 않습니다. 작성 문법은 [Chirpy 공식 문서](https://chirpy.cotes.page/posts/write-a-new-post/#mathematics)를 따릅니다.

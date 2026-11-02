---
name: StudyRAG
description: 강의자료 하나로 요약·퀴즈·오답·복습까지 — 대학생을 위한 AI 학습 루프
colors:
  primary: "#6D8196"
  primary-dark: "#5c6e82"
  primary-deeper: "#4d5e70"
  primary-light: "rgba(109,129,150,.12)"
  primary-muted: "rgba(109,129,150,.35)"
  text-1: "#4A4A4A"
  text-2: "#5e5e5e"
  text-3: "#8a8a8a"
  text-4: "#CBCBCB"
  bg: "#ffffff"
  bg-page: "#f2f2f2"
  bg-card: "#ffffff"
  bg-subtle: "#f7f7f7"
  bg-sidebar: "#ffffff"
  border: "#CBCBCB"
  border-strong: "#ababab"
  border-focus: "#6D8196"
  green: "#4a8c6a"
  green-bg: "#e6f4ee"
  amber: "#a07830"
  amber-bg: "#faf3e0"
  red: "#b04a4a"
  red-bg: "#faeaea"
  orange: "#b06030"
typography:
  headline:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, ui-sans-serif, sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "Pretendard Variable, Pretendard, Noto Sans KR, ui-sans-serif, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "0.01em"
rounded:
  sm: "6px"
  md: "8px"
  lg: "12px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "7px 16px"
  button-primary-hover:
    backgroundColor: "{colors.primary-dark}"
  button-secondary:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    padding: "6px 14px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-3}"
    rounded: "{rounded.md}"
    padding: "5px 10px"
  input:
    backgroundColor: "{colors.bg}"
    textColor: "{colors.text-1}"
    rounded: "{rounded.md}"
    padding: "7px 11px"
---

# Design System: StudyRAG

## Overview

**Creative North Star: "The Clean Study Lab"**

StudyRAG는 분석 도구다. 랩처럼 깔끔하고, 필요한 것만 있고, 방해하지 않는다. 학생이 공부에 집중할 때 인터페이스는 투명해야 한다. 도구가 주인공이 되면 안 된다.

팔레트는 절제됐다. 주색(steel-slate `#6D8196`)은 중립적이고 신뢰감 있다. 채도가 높지 않아서 학습 상태 신호색(정답·오답·복습 알림)이 화면 위에서 선명하게 보인다. 여백은 충분하지 않으면 자르는 쪽이 아니라 구조로 해결한다. 정보 밀도는 높지만 시각 계층이 명확하다.

한국어 전용 폰트 Pretendard가 전체 타이포를 담당한다. 자간·행간이 한국어 글꼴에 최적화돼 있어서 가독성이 안정적이다.

**Key Characteristics:**
- 절제된 색상 — 주색은 일하는 색, 튀지 않는 색
- 학습 상태 색상 시스템 — 정답(green), 오답(red), 복습 대기(amber) 세 가지 신호만
- 반응형 위계 — 동일한 shadow 어휘, 일관된 radius, 예측 가능한 hover
- 한국어 타이포 기반 — Pretendard, 14px body, 1.6 line-height
- 정보 중심 레이아웃 — 장식보다 구조

## Colors

차갑지도 따뜻하지도 않은 중립적 palette. 주색은 억제되어 있고, 신호색이 화면에서 의미를 전달한다.

### Primary
- **Slate Blue** (`#6D8196`): 버튼, 링크, 포커스 링, 활성 상태. "일하는 색" — 도구의 색이지 브랜드 주장색이 아님.
- **Slate Blue Dark** (`#5c6e82`): hover 상태. 명도 한 단계만 낮춘다.
- **Slate Blue Deeper** (`#4d5e70`): active/pressed 상태.

### Neutral
- **Charcoal** (`#4A4A4A`): 본문 텍스트, 제목. 순수 흑색 대신 따뜻한 다크.
- **Graphite** (`#5e5e5e`): 2차 텍스트.
- **Ash** (`#8a8a8a`): 비활성, placeholder, 메타 정보.
- **Mist** (`#CBCBCB`): placeholder, divider, 비활성 border.
- **White** (`#ffffff`): 카드, 사이드바, 입력 필드 배경.
- **Off-White** (`#f7f7f7`): hover 배경, subtle tint.
- **Page Wash** (`#f2f2f2`): 전체 페이지 배경. 흰색 카드를 띄워준다.

### Semantic (학습 상태 전용)
- **Study Green** (`#4a8c6a`): 정답, 성공, 완료. 배경은 `#e6f4ee`.
- **Caution Amber** (`#a07830`): 복습 대기, 경고. 배경은 `#faf3e0`.
- **Error Red** (`#b04a4a`): 오답, 오류, 삭제. 배경은 `#faeaea`.
- **Difficulty Orange** (`#b06030`): 난이도 표시. 배경은 `#faeee6`.

**The Working Color Rule.** Primary(`#6D8196`)는 화면 면적의 10% 미만에서만 사용한다. 버튼 하나, 포커스 링, 활성 탭 — 거기까지다. Primary가 넓게 깔리면 semantic 색이 밀린다.

**The Semantic Exclusivity Rule.** green·amber·red는 학습 상태 피드백 전용이다. 브랜딩이나 장식에 쓰지 않는다.

## Typography

**Primary Font:** Pretendard Variable (한국어 최적화 sans-serif, 가변 폰트)  
**Fallback Stack:** Pretendard, Noto Sans KR, ui-sans-serif, system-ui, sans-serif

폰트는 하나다. weight로 계층을 만들고 크기로 역할을 나눈다.

### Hierarchy
- **Headline** (600, 20px, 1.4): 섹션 제목, 패널 헤더. 페이지당 1-2개.
- **Title** (600, 16px, 1.5): 카드 제목, 탭 헤더, 문서 이름.
- **Body** (400, 14px, 1.6): 모든 본문 텍스트. 한국어 65자 기준.
- **Body-Strong** (500–600, 14px, 1.6): 강조 본문, 버튼 레이블.
- **Label** (500, 12px, 1.4, 0.01em letter-spacing): badge, 상태 표시, 메타 정보.

**The Size Discipline Rule.** 본문에서 20px 이상 텍스트를 쓰는 곳은 섹션 헤더뿐이다. 크기 인플레이션은 위계를 파괴한다.

## Layout

사이드바(240px) + 콘텐츠 영역 구조. 콘텐츠 영역은 탭 패널로 분기한다.

- **사이드바**: 240px 고정, 우측 `1px solid --border`
- **페이지 내 콘텐츠**: `padding: 24px`, 최대 너비 없음 (패널이 너비를 결정)
- **카드 그리드**: 자료·노트 카드는 auto-fill grid (`minmax(200px, 1fr)`)
- **간격 리듬**: 4→8→16→24→32px. 컴포넌트 내부는 8px, 섹션 간 24px.
- **모바일** (< 768px): 사이드바 오버레이(transform slideIn), 콘텐츠 단열 16px

## Elevation & Depth

기본은 평평하다. 그림자는 상태에 반응해서만 나타난다.

- **Rest**: 그림자 없음. 카드 경계는 배경색 차이(`#fff` on `#f2f2f2`)로 만든다.
- **Hover/Interactive lift**: `--shadow-sm` — `0 1px 3px rgba(74,74,74,.10)`. 미세한 들림.
- **Modal / Dropdown**: `--shadow-md` — `0 4px 16px rgba(74,74,74,.12)`. 분리된 레이어.
- **Full overlay / Sheet**: `--shadow-lg` — `0 10px 40px rgba(74,74,74,.14)`.

**The Flat-By-Default Rule.** 그림자는 인터랙션 레이어를 나타낸다 — 장식이 아니다. 항상 떠있는 카드, 항상 그림자 있는 요소는 이 규칙 위반이다.

## Shapes

전체적으로 부드럽되 각진 디테일. 도구다운 폼 언어.

- `--r-sm: 6px` — 인라인 badge, 작은 버튼 변형
- `--r-md: 8px` — 버튼, 입력 필드, 카드, 모달. **기본값.**
- `--r-lg: 12px` — 큰 패널, 사이드시트, 모달 컨테이너
- `--r-pill: 999px` — 상태 pill, badge (due 카운트, 처리 중 표시)

border는 1px, 색은 `--border`(`#CBCBCB`). 두꺼운 accent border(좌측 3-4px stripe)는 금지 — AI 생성 UI의 대표적 티.

**The No Side-Tab Rule.** `border-left: 3-4px solid` 형태의 accent stripe는 쓰지 않는다. 카드 구분은 배경색 + `--border` 테두리, 또는 들여쓰기로 한다.

## Components

### Buttons
- **Shape**: `--r-md` (8px), text 14px, font-weight 600
- **Primary**: bg `#6D8196`, text `#fff`, padding `7px 16px`. hover: `#5c6e82` + `shadow 0 2px 6px rgba(109,129,150,.40)`. active: scale(0.96).
- **Secondary**: bg `#fff`, text `--text-1`, border `1px solid --border`, padding `6px 14px`. hover: bg `--bg-subtle`, border `--border-strong`.
- **Ghost**: transparent, text `--text-3`, no border. 보조 액션, 닫기 버튼.

### Inputs / Fields
- **Style**: border `1px solid --border`, bg `--bg`, `--r-md`, padding `7px 11px`, 14px
- **Focus**: border-color `--primary` + box-shadow `0 0 0 3px --primary-light` (glow ring)
- **Placeholder**: `--text-4`
- **Disabled**: opacity 0.5

### Cards / Containers
- **Default**: bg `--bg-card` (`#fff`), border-radius `--r-md` or `--r-lg`, 1px border `--border` 없는 경우 page background contrast로 구분
- **Shadow**: rest에서 없음, hover에서 `--shadow-sm`
- **Internal Padding**: 16px (sm card), 20-24px (md panel)

### Navigation (Sidebar)
- **Style**: `--bg-sidebar` bg, 14px, icon + label 항상 함께
- **Active item**: bg `--hover-strong`, text `--text-1`, weight 500
- **Hover**: bg `--hover`
- **Badge**: pill `--r-pill`, semantic 배경색 (`--amber-bg` / `--red-bg`)

### Status Pills / Badges
- **Shape**: `--r-pill`, font-size 12px, label weight 500
- **Due review**: amber bg/text
- **Correct**: green
- **Wrong/Error**: red
- **Neutral count**: primary-light bg, primary text

### Tabs
- **Style**: horizontal tab bar, active tab: bottom border 2px `--primary` + text `--text-1` weight 600; inactive: text `--text-3`
- **No background fill** on tabs — 선 하나만

## Do's and Don'ts

### Do:
- **Do** 학습 상태 색(green/amber/red)은 실제 학습 피드백에만 쓴다 — "정답", "복습 대기", "오답" 이 세 가지.
- **Do** 버튼·입력·카드 radius는 항상 `--r-md` (8px)를 기본으로 한다. 더 크면 `--r-lg`.
- **Do** 사이드바 아이템에 항상 텍스트 레이블을 같이 쓴다.
- **Do** 포커스 상태는 반드시 표시한다 — `0 0 0 3px --primary-light` glow ring.
- **Do** 그림자는 레이어 분리가 필요할 때(모달, 드롭다운)만 쓴다.

### Don't:
- **Don't** `border-left: 3px+ solid` accent stripe 를 카드/아이템에 붙인다. 대신 배경색 차이나 `--border` 전체 테두리를 쓴다.
- **Don't** primary 색을 배경 전체에 깐다. 버튼 하나, 포커스, 활성 탭 — 거기까지.
- **Don't** 텍스트 크기를 20px 초과로 올린다 (섹션 제목 제외).
- **Don't** semantic 색을 브랜딩·장식에 쓴다.
- **Don't** 호버 없이 항상 shadow가 있는 카드를 만든다.

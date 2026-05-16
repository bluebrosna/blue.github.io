---
title: "네이버 블로그 + GitHub Pages 연동: 자동 게시 완전 가이드"
date: 2026-05-16
tags:
  - naver-blog
  - github-pages
  - automation
  - quartz
  - tutorial
description: "네이버 블로그 계정 만들기부터 GitHub Pages 연동, 자동 게시까지. Quartz 블로그 글을 네이버에 자동으로 게시하는 완전한 방법을 소개합니다."
aliases:
  - naver-blog-auto-post-plan-2026-05-16/index
---

## 🎯 이 글에서 다루는 내용

1. **네이버 블로그 계정 만들기** (5분)
2. **GitHub Pages + Quartz 연동** (이미 구축됨)
3. **네이버 블로그 자동 게시 방법** (Puppeteer + CDP)
4. **GitHub Actions로 자동화** (푸시만 하면 완료!)

---

## 1️⃣ 네이버 블로그 계정 만들기

### Step 1: 네이버 계정 만들기

1. [naver.com](https://naver.com)에 접속
2. **회원가입** 클릭
3. **이메일로 가입** 선택 (또는 카카오/Apple 계정)

### Step 2: 블로그 개설

1. [blog.naver.com](https://blog.naver.com)에 접속
2. **블로그 시작하기** 클릭
3. 블로그 이름 설정

> 💡 **중요**: 블로그 주소가 `blognaver.com/yourname` 형태가 됩니다

### Step 3: 스마트에디터 익히기

네이버 블로그는 **스마트에디터**라는 에디터를 사용합니다.
마크다운이 아니라 HTML 기반으로 동작합니다.

---

## 2️⃣ 현재 구축된 자동화 시스템

### 이미 구축된 도구들

| 파일 | 용도 |
|------|------|
| `naver-post.mjs` | Puppeteer + CDP로 자동 게시 |
| `naver-auto-post.mjs` | 자동 게시 스크립트 |
| `inject_rl_to_naver.mjs` | 마크다운 → 네이버 HTML 변환 |

### 동작 원리

```
Quartz (Markdown)
    ↓ 변환
네이버 HTML 포맷
    ↓
Puppeteer (Chrome DevTools Protocol)
    ↓
네이버 스마트에디터 자동 입력
    ↓
게시 버튼 클릭
```

---

## 3️⃣ Puppeteer + CDP 자동 게시 원리

### 왜 Puppeteer를 사용하나?

네이버 블로그는 **공식 API를 제공하지 않습니다**.
따라서 브라우저 자동화 도구인 Puppeteer를 사용합니다.

### 핵심 코드 구조

```javascript
import puppeteer from 'puppeteer-core';

// 1. Chrome DevTools에 연결
const browser = await puppeteer.connect({
  browserURL: 'http://127.0.0.1:9222',
});

// 2. 블로그 글쓰기 페이지로 이동
await page.goto('https://blog.naver.com/PostWriteForm.naver');

// 3. 제목 입력
await page.type('#title', '글 제목');

// 4. 본문 HTML 삽입 (CDP 사용)
await page.evaluate((html) => {
  const dt = new DataTransfer();
  const blob = new Blob([html], { type: 'text/html' });
  const file = new File([blob], 'content.html', { type: 'text/html' });
  dt.items.add(file);
  
  const editor = document.querySelector('.se-section-inner');
  editor.dispatchEvent(new ClipboardEvent('paste', {
    bubbles: true,
    cancelable: true,
    clipboardData: dt,
  }));
}, bodyHtml);

// 5. 게시 버튼 클릭
await page.click('.btn_primary');
```

---

## 4️⃣ GitHub Actions 자동화 설정

### 워크플로우 파일

```yaml
# .github/workflows/naver-post.yml
name: Auto Post to Naver Blog

on:
  push:
    branches:
      - main
    paths:
      - 'content/**'

jobs:
  post-to-naver:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '18'
      
      - name: Install Chrome
        run: |
          wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | apt-key add -
          echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/chrome.list
          apt-get update && apt-get install -y google-chrome-stable
      
      - name: Install dependencies
        run: npm install puppeteer-core
      
      - name: Convert Markdown to Naver HTML
        run: node convert-quartz.mjs
      
      - name: Post to Naver Blog
        env:
          CHROME_URL: ${{ secrets.NAVER_BLOG_CHROME_URL }}
        run: node naver-post.mjs
```

### 필요한 환경 변수

| 변수명 | 설명 |
|--------|------|
| `NAVER_BLOG_CHROME_URL` | Chrome DevTools 접속 URL |
| `NAVER_ID` | 네이버 ID (선택) |
| `NAVER_PW` | 네이버 비밀번호 (선택) |

---

## 5️⃣ 현재 상황 및 한계

### ✅ 가능한 것

| 기능 | 상태 |
|------|------|
| Quartz → HTML 변환 | ✅ 완료 |
| Puppeteer 스크립트 | ✅ 완료 |
| 로컬 Chrome 연결 | ✅ 가능 |
| GitHub Actions 원격 Chrome | ⚠️ 설정 필요 |

### ⚠️ 현재 제한사항

1. **Chrome DevTools Protocol**: 로컬에서 실행 중인 Chrome에 연결 필요
2. **네이버 로그인**: 세션 유지 필요
3. **공식 API 부재**: 비공식 방법이라不安定 가능성

### 🔧 해결 방법 ( 기획중)

| 방법 | 설명 | 난이도 |
|------|------|--------|
| **Chrome 원격 접속** | GCP/AWS에 Chrome 설치 → 원격 CDP | 보통 |
| **Docker Chrome** | Docker 컨테이너로 Chrome 실행 | 보통 |
| **Lambda + Puppeteer** | 서버리스로 Chrome 실행 | 높음 |

---

## 6️⃣ 다음 단계 (Roadmap)

### Phase 1: 로컬 자동화 ✅
- [x] Quartz → HTML 변환
- [x] Puppeteer 스크립트
- [x] 로컬 Chrome 연결

### Phase 2: 원격 자동화 🔄
- [ ] GCP/AWS에 Chrome 서버 구축
- [ ] GitHub Actions 원격 실행
- [ ] 자동 로그인 세션 관리

### Phase 3: 완전 자동화 🎯
- [ ] GitHub Pages 푸시 시 자동 게시
- [ ] 여러 블로그 지원
- [ ] 예약 게시 기능

---

## 💡 참고 자료

- [Puppeteer 공식 문서](https://pptr.dev/)
- [Quartz 블로그](https://quartz.jzhao.xyz/)
- [네이버 블로그](https://blog.naver.com)

---

## ❓ 자주 묻는 질문

### Q: 네이버 공식 API 없나요?
**A:** 현재 없습니다. 비공식方法是 Puppeteer 기반입니다.

### Q: 안전하게 자동화할 수 있나요?
**A:** Chrome DevTools Protocol을 사용하면 안정적으로 게시 가능합니다.

### Q: 게시물이 삭제될 위험이 있나요?
**A:** 네이버 정책상 자동 게시bots는 제한받을 수 있습니다. 주의가 필요합니다.

---

*Written with OpenClaw ✨*

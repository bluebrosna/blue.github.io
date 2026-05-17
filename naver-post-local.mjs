#!/usr/bin/env node
/**
 * 네이버 블로그 자동 게시 (로컬 Mac 전용)
 *
 * 전제:
 *   - scripts/setup-naver-profile.mjs 를 최초 1회 실행하여 영구 프로필 생성됨
 *   - 같은 디렉터리에 naver_blog_title.txt, naver_blog_content.html 존재
 *
 * 실행:
 *   node naver-post-local.mjs
 *
 * 환경변수 (선택):
 *   NAVER_PROFILE_DIR      : 영구 프로필 경로 (기본: ~/.openclaw/playwright/naver-profile)
 *   TELEGRAM_BOT_TOKEN     : 결과 보고할 봇 토큰 (없으면 콘솔만)
 *   TELEGRAM_CHAT_ID       : 보고 채팅 ID
 *   MAX_POSTS_PER_DAY      : 일일 최대 게시 (기본 3, 계정 정지 방지)
 *   DRY_RUN=1              : 실제 발행 버튼은 누르지 않음 (테스트용)
 */

import { chromium } from 'playwright';
import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync, unlinkSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ───── 설정 ─────────────────────────────────────────
const PROFILE_DIR = process.env.NAVER_PROFILE_DIR
  || join(homedir(), '.openclaw', 'playwright', 'naver-profile');
const LOCK_FILE = '/tmp/naver-post.lock';
const COUNTER_FILE = join(homedir(), '.openclaw', 'naver-daily-counter.json');
const DEBUG_DIR = './naver-debug';
const MAX_POSTS_PER_DAY = Number(process.env.MAX_POSTS_PER_DAY || 3);
const DRY_RUN = process.env.DRY_RUN === '1';

// ───── 유틸 ─────────────────────────────────────────
mkdirSync(DEBUG_DIR, { recursive: true });
mkdirSync(join(homedir(), '.openclaw'), { recursive: true });

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

function acquireLock() {
  if (existsSync(LOCK_FILE)) {
    const age = Date.now() - statSync(LOCK_FILE).mtimeMs;
    if (age < 10 * 60 * 1000) {
      throw new Error(`다른 게시 작업이 진행 중 (lock age ${Math.round(age / 1000)}s)`);
    }
    log('⚠️ 오래된 lockfile 제거');
  }
  writeFileSync(LOCK_FILE, String(process.pid));
}

function releaseLock() {
  try { unlinkSync(LOCK_FILE); } catch {}
}

function checkDailyLimit() {
  const today = new Date().toISOString().slice(0, 10);
  let data = { date: today, count: 0 };
  if (existsSync(COUNTER_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(COUNTER_FILE, 'utf-8'));
      if (parsed.date === today) data = parsed;
    } catch {}
  }
  if (data.count >= MAX_POSTS_PER_DAY) {
    throw new Error(`일일 게시 한도 초과 (${data.count}/${MAX_POSTS_PER_DAY})`);
  }
  return () => {
    data.count += 1;
    writeFileSync(COUNTER_FILE, JSON.stringify(data));
  };
}

async function telegramNotify(text, photoPath) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    if (photoPath && existsSync(photoPath)) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('caption', text.slice(0, 1024));
      form.append('photo', new Blob([readFileSync(photoPath)]), 'screenshot.png');
      await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, { method: 'POST', body: form });
    } else {
      await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
      });
    }
  } catch (e) {
    log(`Telegram 알림 실패: ${e.message}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function findFirst(scope, selectors, label, timeout = 15000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      try {
        const loc = scope.locator(sel).first();
        if (await loc.count() && await loc.isVisible().catch(() => false)) {
          return loc;
        }
      } catch {}
    }
    await sleep(400);
  }
  throw new Error(`${label} 요소를 찾을 수 없음 (timeout ${timeout}ms)`);
}

// ───── 메인 ─────────────────────────────────────────
async function main() {
  if (!existsSync(PROFILE_DIR) || !existsSync(join(PROFILE_DIR, 'Default'))) {
    throw new Error(
      `프로필이 없습니다: ${PROFILE_DIR}\n` +
      `먼저 'node scripts/setup-naver-profile.mjs' 를 실행하세요.`
    );
  }

  const title = readFileSync('naver_blog_title.txt', 'utf-8').trim();
  const bodyHtml = readFileSync('naver_blog_content.html', 'utf-8');
  log(`📝 제목: ${title}`);
  log(`📦 본문 크기: ${bodyHtml.length} bytes`);

  acquireLock();
  let context;
  try {
    // DRY_RUN은 일일 한도 체크/카운트 대상 아님 (테스트 무제한)
    const incrementCounter = DRY_RUN ? (() => {}) : checkDailyLimit();

    context = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: false,            // 헤드리스는 봇 탐지에 더 잘 걸림. 화면 켜진 채로 실행.
      viewport: { width: 1280, height: 900 },
      locale: 'ko-KR',
      timezoneId: 'Asia/Seoul',
      args: ['--disable-blink-features=AutomationControlled'],
    });

    const page = context.pages()[0] || await context.newPage();
    return await runEditorFlow({ page, context, title, bodyHtml, incrementCounter });
  } finally {
    releaseLock();
    if (context) await context.close().catch(() => {});
  }
}

async function runEditorFlow({ page, context, title, bodyHtml, incrementCounter }) {
  try {
    // 1) 로그인 상태 확인 — 네이버 인증 쿠키 직접 검사
    await page.goto('https://www.naver.com', { waitUntil: 'domcontentloaded' });
    const cookies = await context.cookies('https://www.naver.com');
    const hasAuth = cookies.some((c) => c.name === 'NID_AUT' && c.value);
    const hasSes  = cookies.some((c) => c.name === 'NID_SES' && c.value);
    if (!hasAuth || !hasSes) {
      throw new Error(
        `로그인 세션 만료 (NID_AUT=${hasAuth}, NID_SES=${hasSes}) — ` +
        `setup-naver-profile.mjs 를 다시 실행하세요`
      );
    }
    log('✅ 로그인 세션 유효 (NID_AUT + NID_SES OK)');

    // 2) 글쓰기 페이지로 이동
    await page.goto('https://blog.naver.com/bluebrosna/postwrite', {
      waitUntil: 'networkidle', timeout: 30000,
    });
    await sleep(3000);

    // 3) "이어서 작성하시겠어요?" 팝업 — popup 내부의 취소 버튼만 정확히 클릭.
    //    ⚠️ 'button:has-text("취소")'는 툴바의 '취소선' 버튼도 매칭하므로 사용 금지.
    //    반드시 popup 컨테이너 내부로 스코프 한정.
    try {
      const popup = page.locator('.se-popup-container, .se-popup, [class*="popup"]').first();
      if (await popup.isVisible({ timeout: 3000 })) {
        const cancelBtn = popup.locator(
          '.se-popup-button-cancel, button:has-text("취소"):not(:has-text("선"))'
        ).first();
        if (await cancelBtn.isVisible({ timeout: 1500 })) {
          await cancelBtn.click();
          await sleep(1200);
          log('🧹 "이어서 작성" 팝업 취소 — 새로 작성 시작');
        }
      }
    } catch {}

    // 4) 제목 입력 — 컴포넌트 클릭 후 기존 내용 전체삭제 → 새로 타이핑
    const titleEl = await findFirst(page, [
      '.se-component.se-documentTitle',
      '.se-section-documentTitle',
      '.se-documentTitle .se-placeholder',
    ], '제목 컴포넌트');
    await titleEl.click();
    await sleep(500);
    // 전체선택 후 삭제 (이전 임시저장 내용 제거)
    await page.keyboard.press('Meta+A');
    await sleep(200);
    await page.keyboard.press('Delete');
    await sleep(300);
    await page.keyboard.type(title, { delay: 25 });
    log('✍️ 제목 입력 완료 (기존 내용 클리어 후)');
    await sleep(500);

    // 5) 본문으로 이동 — 본문 컴포넌트 클릭 + 전체삭제
    const bodyEl = await findFirst(page, [
      '.se-component.se-text',
      '.se-section-text',
      '.se-text .se-component-content',
    ], '본문 컴포넌트');
    await bodyEl.click();
    await sleep(500);
    // 본문도 전체선택 후 삭제 — 누적 방지
    await page.keyboard.press('Meta+A');
    await sleep(200);
    await page.keyboard.press('Delete');
    await sleep(400);
    log('🧹 본문 이전 내용 클리어');

    // SmartEditor가 inline style 붙은 paste에 취소선을 표시하는 것으로 보임.
    // 모든 style 속성을 제거하고 시멘틱 태그만 남긴 후 paste.
    const cleanedHtml = bodyHtml
      .replace(/\s*style="[^"]*"/g, '')      // 모든 style 속성 제거
      .replace(/<span>([\s\S]*?)<\/span>/g, '$1')  // 의미 없는 span unwrap
      .replace(/<p>\s*<\/p>/g, '');                 // 빈 단락 제거

    // HTML을 클립보드에 넣고 paste 시도
    const clipboardOK = await page.evaluate((html) => {
      try {
        const item = new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([html.replace(/<[^>]+>/g, '')], { type: 'text/plain' }),
        });
        return navigator.clipboard.write([item]).then(() => true).catch(() => false);
      } catch { return false; }
    }, cleanedHtml).catch(() => false);

    if (clipboardOK) {
      await page.keyboard.press('Meta+V');
      log('📋 본문 클립보드 paste 완료');
    } else {
      log('⚠️ 클립보드 사용 불가 — plain text type fallback');
      const plain = bodyHtml.replace(/<style[\s\S]*?<\/style>/g, '')
                            .replace(/<script[\s\S]*?<\/script>/g, '')
                            .replace(/<[^>]+>/g, '')
                            .replace(/\n{3,}/g, '\n\n')
                            .trim();
      await page.keyboard.type(plain.slice(0, 5000), { delay: 5 });
    }
    await sleep(2000);

    // 6) 발행 (DRY_RUN이면 임시저장만)
    if (DRY_RUN) {
      log('🧪 DRY_RUN — 발행 안 함, 임시저장 버튼 클릭');
      const saveBtn = await findFirst(page, [
        'button:has-text("저장")',
        '.btn_save',
      ], '저장 버튼', 8000);
      await saveBtn.click();
      await sleep(2500);
    } else {
      const publishBtn = await findFirst(page, [
        'button.publish_btn__m9KHH',
        'button:has-text("발행")',
        '.btn_publish',
      ], '발행 버튼');
      await publishBtn.click();
      await sleep(1500);

      const confirmBtn = await findFirst(page, [
        'button.confirm_btn__WEaBq',
        '.btn_publish',
        'button:has-text("발행"):not(:has-text("예약"))',
      ], '최종 발행 확인', 8000);
      await confirmBtn.click();
      log('🚀 발행 클릭');
    }

    // 7) 완료 대기 + URL 캡처
    await page.waitForURL(/PostView|blog\.naver\.com/, { timeout: 30000 }).catch(() => {});
    const finalUrl = page.url();
    log(`✅ 완료: ${finalUrl}`);

    incrementCounter();
    await telegramNotify(`✅ 네이버 게시 성공\n<b>${title}</b>\n${finalUrl}`);
    return finalUrl;

  } catch (err) {
    log(`❌ 실패: ${err.message}`);
    const shot = join(DEBUG_DIR, `fail-${Date.now()}.png`);
    await page.screenshot({ path: shot, fullPage: true }).catch(() => {});
    await telegramNotify(
      `❌ 네이버 게시 실패\n<b>${title}</b>\n<code>${err.message}</code>\n` +
      `직접 처리가 필요합니다.`,
      shot,
    );
    throw err;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

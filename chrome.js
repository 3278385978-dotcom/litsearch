#!/usr/bin/env node
'use strict';
/**
 * chrome.js — 受控 Chrome 启停（独立 profile + 调试端口）
 *
 * 用途：需要"真实页面上下文"的站点（知网/OPAC 等）用 CDP 驱动；用完即关。
 *
 * 用法：node chrome.js status | launch | stop
 * 环境变量：
 *   LITSEARCH_PORT      调试端口，默认 9222
 *   LITSEARCH_PROFILE   profile 目录，默认本目录 .chrome-profile
 *   LITSEARCH_CHROME    Chrome 可执行文件
 *   LITSEARCH_HEADLESS  默认无头后台（不弹窗）；设 0 切有界面
 *   LITSEARCH_WINDOW    有界面时的窗口尺寸，默认 1400,900
 */

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { DEBUG_PORT, waitForReady, listTargets, sleep } = require('./cdp');

const CHROME =
  process.env.LITSEARCH_CHROME ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// profile 默认放本目录（一定可写），避免出现"工具在别的盘、沙箱不让写"的坑
const PROFILE =
  process.env.LITSEARCH_PROFILE || path.join(__dirname, '.chrome-profile');

const HOME_URL = process.env.LITSEARCH_HOME || require('./config').home;

function log(...a) {
  // 日志一律走 stderr：保证 --json / --md 的 stdout 只有结果
  console.error(...a);
}

/** 端口是否已就绪 */
async function isUp(timeoutMs = 1200) {
  try {
    await waitForReady(timeoutMs);
    return true;
  } catch {
    return false;
  }
}


/** 无头模式下把 UA 伪装成普通 Chrome（CNKI 会 403 拦 HeadlessChrome） */
function normalChromeUA() {
  try {
    const v = execSync(`"${CHROME}" --version`, { encoding: 'utf8' }).trim();
    const m = v.match(/(\d+\.\d+\.\d+\.\d+)/);
    if (m) {
      return (
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
        `(KHTML, like Gecko) Chrome/${m[1]} Safari/537.36`
      );
    }
  } catch {}
  return (
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  );
}

/**
 * 保证 Chrome 可用。已经开着就直接用；没开就拉起。
 * @returns {Promise<{started:boolean}>} started=true 表示是本次调用拉起来的
 */
async function ensureChrome({ quiet = false } = {}) {
  if (await isUp()) return { started: false };

  if (!fs.existsSync(CHROME)) {
    throw new Error(
      `找不到 Chrome：${CHROME}\n` +
        `请设置环境变量 LITSEARCH_CHROME 指向你的 Chrome 可执行文件。`
    );
  }
  fs.mkdirSync(PROFILE, { recursive: true });

  // 默认**无头后台**（不弹窗）；LITSEARCH_HEADLESS=0 或 find.js --show-chrome 切有界面
  const headless = process.env.LITSEARCH_HEADLESS !== '0';
  const winSize = process.env.LITSEARCH_WINDOW || '1400,900';
  const args = [
    `--remote-debugging-port=${DEBUG_PORT}`,
    ...(headless
      ? ['--headless=new', `--user-agent=${normalChromeUA()}`, '--disable-blink-features=AutomationControlled']
      : [`--window-size=${winSize}`]),
    '--hide-scrollbars',
    '--mute-audio',
    '--remote-allow-origins=*',
    `--user-data-dir=${PROFILE}`,
    // 受限沙箱里必须加这两个，否则 sandbox init 失败 → GPU 进程崩 → 进程自杀
    '--no-sandbox',
    '--disable-gpu',
    '--disable-breakpad',
    '--disable-crash-reporter',
    '--disable-dev-shm-usage',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-features=ChromeWhatsNewUI,SigninPromo',
    '--use-mock-keychain',
    '--no-service-autorun',
    '--disable-sync',
    HOME_URL,
  ];
  if (!quiet) log(headless ? '· 启动受控 Chrome（无头后台模式）…' : '· 启动受控 Chrome（有界面，可观察）…');
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore' });
  child.unref();
  await waitForReady(30000);
  return { started: true };
}

/** 停掉受控 Chrome（只杀带这个调试端口的进程，不碰你日常的 Chrome） */
function stopChrome() {
  try {
    execSync(`pkill -f "remote-debugging-port=${DEBUG_PORT}"`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

async function cmdStatus() {
  log(`调试端口  : ${DEBUG_PORT}`);
  log(`profile   : ${PROFILE}`);
  if (!(await isUp())) {
    log('\n状态: ❌ 未运行');
    log('提示: node chrome.js launch');
    return;
  }
  const targets = await listTargets();
  log(`\n状态: ✅ 已连接，${targets.length} 个页面`);
  for (const t of targets) {
    log(`  · ${t.title || '(无标题)'}`);
    log(`    ${t.url}`);
  }
}

async function cmdLaunch() {
  const { started } = await ensureChrome();
  log(started ? '✅ 已启动。' : '已经开着，无需重复启动。');
  await sleep(300);
  await cmdStatus();
}

async function main() {
  const cmd = process.argv[2] || 'status';
  try {
    switch (cmd) {
      case 'status':
        return await cmdStatus();
      case 'launch':
      case 'start':
        return await cmdLaunch();
      case 'stop': {
        const ok = stopChrome();
        log(ok ? `已停止（端口 ${DEBUG_PORT}）。` : '没有在跑的受控 Chrome。');
        return;
      }
      default:
        log('用法: node chrome.js [status|launch|stop]');
    }
  } catch (e) {
    console.error(`❌ ${e.message}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { ensureChrome, stopChrome, isUp, CHROME, PROFILE, HOME_URL, DEBUG_PORT };

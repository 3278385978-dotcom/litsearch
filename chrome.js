#!/usr/bin/env node
'use strict';
/**
 * chrome.js — 受控 Chromium 内核浏览器启停（独立 profile + 调试端口，跨平台）
 *
 * 用途：需要"真实页面上下文"的站点（知网/OPAC 等）用 CDP 驱动；用完即关。
 *
 * 用法：node chrome.js status | launch | stop
 * 环境变量：
 *   LITSEARCH_PORT      调试端口，默认 9222
 *   LITSEARCH_PROFILE   profile 目录，默认系统临时目录（任意工作区可写）
 *   LITSEARCH_CHROME    浏览器可执行文件（可指向 Chrome / Edge / Chromium / Brave）
 *   LITSEARCH_HEADLESS  默认无头后台（不弹窗）；设 0 切有界面
 *   LITSEARCH_WINDOW    有界面时的窗口尺寸，默认 1400,900
 *
 * 跨平台说明：
 *   - macOS / Windows / Linux 自动探测常见 Chromium 内核浏览器；
 *   - 停止时优先按启动记录的 PID 杀（仅自己拉起的进程），不误杀日常浏览器；
 *   - Windows 上使用 taskkill；日志与 UA 版本获取均按平台处理。
 */

const { spawn, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DEBUG_PORT, waitForReady, listTargets, sleep } = require('./cdp');

/** 按平台列出可能的 Chromium 内核浏览器（Chrome / Edge / Chromium / Brave） */
function chromeCandidates() {
  const home = process.env.HOME || process.env.USERPROFILE || '';
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      `${home}/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`,
    ];
  }
  if (process.platform === 'win32') {
    const pf = process.env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = process.env.LOCALAPPDATA || '';
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      local ? `${local}\\Google\\Chrome\\Application\\chrome.exe` : '',
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Chromium\\Application\\chrome.exe`,
      `${pf}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`,
    ].filter(Boolean);
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
    '/usr/bin/brave-browser',
  ];
}

function findChrome() {
  if (process.env.LITSEARCH_CHROME) return process.env.LITSEARCH_CHROME;
  const hit = chromeCandidates().find((p) => {
    try {
      return fs.existsSync(p);
    } catch {
      return false;
    }
  });
  return hit || chromeCandidates()[0] || '';
}

const CHROME = findChrome();
// profile 默认放系统临时目录：任何 workspace-write 沙箱里都可写。
// 放在工具目录（如 ~/litsearch 在别人工作区外）会导致 Chrome 写不了 profile/crashpad → 起不来。
const PROFILE =
  process.env.LITSEARCH_PROFILE || path.join(os.tmpdir(), 'litsearch-chrome-profile');
const PID_FILE = path.join(PROFILE, '.litsearch.pid');
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

/** 取浏览器版本号（用于无头模式的 UA 伪装） */
function chromeVersion() {
  // 1) macOS / Linux：直接问可执行文件
  if (process.platform !== 'win32' && CHROME) {
    try {
      const v = execSync(`"${CHROME}" --version`, { encoding: 'utf8' }).trim();
      const m = v.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (m) return m[1];
    } catch {}
  }
  // 2) Windows：安装目录同级有版本号子目录（Application\<ver>\chrome.exe）
  try {
    const dir = path.dirname(CHROME);
    const vers = fs.readdirSync(dir).filter((v) => /^\d+\.\d+\.\d+\.\d+$/.test(v));
    if (vers.length) {
      vers.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
      return vers[vers.length - 1];
    }
  } catch {}
  return '131.0.0.0';
}

/** 无头模式下把 UA 伪装成普通浏览器（很多站会 403 拦 HeadlessChrome） */
function normalChromeUA() {
  const ver = chromeVersion();
  const platform =
    process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : process.platform === 'darwin'
        ? 'Macintosh; Intel Mac OS X 10_15_7'
        : 'X11; Linux x86_64';
  return `Mozilla/5.0 (${platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
}

/**
 * 保证浏览器可用。已经开着就直接用；没开就拉起。
 * @returns {Promise<{started:boolean}>} started=true 表示是本次调用拉起来的
 */
async function ensureChrome({ quiet = false } = {}) {
  if (await isUp()) return { started: false };

  if (!CHROME || !fs.existsSync(CHROME)) {
    throw new Error(
      `找不到可用的 Chromium 内核浏览器（Chrome / Edge / Chromium / Brave）。\n` +
        `当前尝试的路径：${CHROME || '(空)'}\n` +
        `请设置环境变量 LITSEARCH_CHROME 指向浏览器可执行文件。`
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
  if (!quiet) log(headless ? '· 启动受控浏览器（无头后台模式）…' : '· 启动受控浏览器（有界面，可观察）…');
  const child = spawn(CHROME, args, { detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  try {
    fs.writeFileSync(PID_FILE, String(child.pid));
  } catch {}
  await waitForReady(30000);
  return { started: true };
}

/** 停掉受控浏览器（优先按 PID，只杀本工具拉起的进程，不碰你日常的浏览器） */
function stopChrome() {
  let ok = false;
  // 1) 启动时记录的 PID（跨平台，最安全）
  try {
    const pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim());
    if (pid) {
      process.kill(pid);
      ok = true;
    }
  } catch {}
  try {
    fs.unlinkSync(PID_FILE);
  } catch {}
  // 2) 兜底：按调试端口找进程（只针对本工具的端口）
  try {
    if (process.platform === 'win32') {
      const out = execSync(`netstat -ano | findstr :${DEBUG_PORT}`, { encoding: 'utf8' });
      const pids = [
        ...new Set(
          out
            .split('\n')
            .map((l) => (l.trim().split(/\s+/).pop() || ''))
            .filter((x) => /^\d+$/.test(x))
        ),
      ];
      for (const p of pids) {
        try {
          execSync(`taskkill /PID ${p} /F`, { stdio: 'ignore' });
          ok = true;
        } catch {}
      }
    } else {
      execSync(`pkill -f "remote-debugging-port=${DEBUG_PORT}"`, { stdio: 'ignore' });
      ok = true;
    }
  } catch {}
  return ok;
}

async function cmdStatus() {
  log(`调试端口  : ${DEBUG_PORT}`);
  log(`browser   : ${CHROME}`);
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
        log(ok ? `已停止（端口 ${DEBUG_PORT}）。` : '没有在跑的受控浏览器。');
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

module.exports = {
  ensureChrome,
  stopChrome,
  isUp,
  CHROME,
  PROFILE,
  HOME_URL,
  DEBUG_PORT,
  chromeCandidates,
  chromeVersion,
};

'use strict';
/**
 * cdp.js — 零依赖 Chrome DevTools Protocol 客户端
 *
 * 用 Node 原生 WebSocket + fetch 直连调试端口，零第三方依赖。
 *
 * 对外导出：
 *   class CDP        — 单页连接（send / eval / 断线重连）
 *   listTargets()    — 列出所有可调试页面
 *   newTab(url)      — 开新标签页，返回 targetId
 *   closeTab(id)     — 关标签页
 *   waitForReady()   — 等待调试端口可用
 */

const DEBUG_PORT = Number(process.env.LIBSEARCH_PORT || 9222);
const HOST = '127.0.0.1';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function httpJson(path) {
  const res = await fetch(`http://${HOST}:${DEBUG_PORT}${path}`);
  if (!res.ok) throw new Error(`CDP HTTP ${res.status} ${path}`);
  return res.json();
}

/** 等待 Chrome 调试端口就绪（最多 timeoutMs） */
async function waitForReady(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let lastErr;
  while (Date.now() < deadline) {
    try {
      await httpJson('/json/version');
      return true;
    } catch (e) {
      lastErr = e;
      await sleep(400);
    }
  }
  throw new Error(
    `调试端口 ${DEBUG_PORT} 在 ${timeoutMs}ms 内没起来。` +
      `请确认已用 --remote-debugging-port=${DEBUG_PORT} 启动 Chrome。原始错误：${lastErr}`
  );
}

/** 列出所有 page 类型的 target */
async function listTargets() {
  const all = await httpJson('/json/list');
  return all.filter((t) => t.type === 'page');
}

/** 开新标签页 */
async function newTab(url = 'about:blank') {
  const res = await fetch(
    `http://${HOST}:${DEBUG_PORT}/json/new?${encodeURIComponent(url)}`,
    { method: 'PUT' }
  );
  if (!res.ok) throw new Error(`开标签页失败 HTTP ${res.status}`);
  const t = await res.json();
  return t; // { id, webSocketDebuggerUrl, ... }
}

/** 关标签页 */
async function closeTab(id) {
  await fetch(`http://${HOST}:${DEBUG_PORT}/json/close/${id}`);
}

class CDP {
  constructor(wsUrl) {
    this.wsUrl = wsUrl;
    this.id = 0;
    this.pending = new Map();
    this.ws = null;
  }

  async connect() {
    await new Promise((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl);
      this.ws = ws;
      const onErr = (e) => reject(new Error(`WS 连接失败：${e.message || e.type}`));
      ws.addEventListener('open', () => {
        ws.removeEventListener('error', onErr);
        resolve();
      });
      ws.addEventListener('error', onErr);
      ws.addEventListener('message', (ev) => {
        let msg;
        try {
          msg = JSON.parse(ev.data);
        } catch {
          return;
        }
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve, reject } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) reject(new Error(JSON.stringify(msg.error)));
          else resolve(msg.result);
        }
      });
    });
    return this;
  }

  /** 发一条 CDP 命令 */
  send(method, params = {}, timeoutMs = 30000) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP 超时 ${method}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** 在页面里跑一段表达式，返回其值（用 JSON 传参，避免转义地狱） */
  async eval(expression, { awaitPromise = true, timeoutMs = 30000 } = {}) {
    const r = await this.send(
      'Runtime.evaluate',
      {
        expression,
        returnByValue: true,
        awaitPromise,
        userGesture: true,
      },
      timeoutMs
    );
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error(`页面内报错：${d.exception?.description || d.text}`);
    }
    return r.result?.value;
  }

  /** 导航并等页面 load 事件 */
  async goto(url, { timeoutMs = 45000 } = {}) {
    const loaded = new Promise((resolve) => {
      const off = (ev) => {
        try {
          const m = JSON.parse(ev.data);
          if (m.method === 'Page.loadEventFired') {
            this.ws.removeEventListener('message', off);
            resolve();
          }
        } catch {}
      };
      this.ws.addEventListener('message', off);
      setTimeout(() => {
        this.ws.removeEventListener('message', off);
        resolve();
      }, timeoutMs);
    });
    await this.send('Page.enable');
    await this.send('Page.navigate', { url });
    await loaded;
    return this;
  }

  /** 等某个条件在页面里成立 */
  async waitFor(fnBody, { timeoutMs = 30000, pollMs = 300 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const ok = await this.eval(`(() => { try { return !!(${fnBody}); } catch (e) { return false; } })()`);
      if (ok) return true;
      await sleep(pollMs);
    }
    return false;
  }

  close() {
    try {
      this.ws?.close();
    } catch {}
  }
}

/** 连到第一个 page target（找不到就开一个） */
async function attachFirstPage() {
  await waitForReady();
  let targets = await listTargets();
  if (!targets.length) {
    await newTab('about:blank');
    await sleep(500);
    targets = await listTargets();
  }
  const t = targets[0];
  const cdp = await new CDP(t.webSocketDebuggerUrl).connect();
  return { cdp, target: t };
}

/** 按 URL 片段找页面，找不到返回 null */
async function attachByUrl(substr) {
  const targets = await listTargets();
  const t = targets.find((x) => (x.url || '').includes(substr));
  if (!t) return null;
  const cdp = await new CDP(t.webSocketDebuggerUrl).connect();
  return { cdp, target: t };
}

module.exports = {
  DEBUG_PORT,
  sleep,
  waitForReady,
  listTargets,
  newTab,
  closeTab,
  CDP,
  attachFirstPage,
  attachByUrl,
};

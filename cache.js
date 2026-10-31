'use strict';
/**
 * cache.js — 分页结果缓存（默认 30 分钟，可用 --no-cache / --refresh / --cache-ttl 控制）
 *
 * 目的：同一查询连续要"下面 10 条"时，已抓过的页不再重抓，耗时接近常数。
 * 只存检索词 + 题录，不含任何账号信息；目录可用 LITSEARCH_CACHE_DIR 覆盖。
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const TTL_MS = 30 * 60 * 1000;

function cacheDir() {
  if (process.env.LITSEARCH_CACHE_DIR) return process.env.LITSEARCH_CACHE_DIR;
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'litsearch', 'cache');
  }
  if (process.platform === 'darwin') {
    return path.join(os.homedir(), 'Library', 'Caches', 'litsearch');
  }
  return path.join(os.homedir(), '.cache', 'litsearch');
}

function keyFor(source, keyword, filters) {
  return crypto
    .createHash('sha1')
    .update(JSON.stringify([source, keyword, filters || {}]))
    .digest('hex');
}

function fileFor(source, keyword, filters) {
  return path.join(cacheDir(), `${keyFor(source, keyword, filters)}.json`);
}

/** 读缓存；过期/损坏返回 null */
function load(source, keyword, filters, ttlMs = TTL_MS) {
  try {
    const f = fileFor(source, keyword, filters);
    const rec = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!rec || !rec.savedAt || Date.now() - rec.savedAt > ttlMs) return null;
    if (rec.v !== 1 || !rec.pages || typeof rec.pages !== 'object') return null;
    return rec;
  } catch {
    return null;
  }
}

/** 原子写缓存；失败静默（缓存只是优化，不能影响主流程） */
function save(rec) {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const f = fileFor(rec.source, rec.keyword, rec.filters);
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(rec));
    fs.renameSync(tmp, f);
    return true;
  } catch {
    return false;
  }
}

/** 清空本工具缓存（--clear-cache） */
function clear() {
  try {
    const dir = cacheDir();
    let n = 0;
    for (const f of fs.readdirSync(dir)) {
      if (/^[0-9a-f]{40}\.json$/.test(f)) {
        fs.unlinkSync(path.join(dir, f));
        n++;
      }
    }
    return n;
  } catch {
    return 0;
  }
}

module.exports = { load, save, clear, cacheDir, keyFor, TTL_MS };

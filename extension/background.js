/* ActionPin service worker: reads public repo refs from github.com and assesses `uses:` references. */
importScripts('lib/core.js');

const Core = self.ActionPinCore;
const TTL_OK = 10 * 60 * 1000; // refs move; keep the cache short
const TTL_ERR = 2 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024; // huge monorepos: give up rather than download megabytes of refs
const inflight = new Map();

const NAME_OK = /^[\w.-]+$/;

async function fetchRefs(owner, repo) {
  if (!NAME_OK.test(owner) || !NAME_OK.test(repo)) return { error: 'invalid name' };
  const url = 'https://github.com/' + owner + '/' + repo + '.git/info/refs?service=git-upload-pack';
  let res;
  try {
    // credentials: 'omit' — no cookies leave the browser, so this only ever sees public repos.
    res = await fetch(url, { credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15000) });
  } catch (e) {
    return { error: 'network error' };
  }
  if (res.status === 401 || res.status === 403 || res.status === 404) return { error: 'private or missing repo' };
  if (!res.ok) return { error: 'HTTP ' + res.status };
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return { error: 'too many refs' };
  const text = await res.text();
  if (text.length > MAX_BYTES) return { error: 'too many refs' };
  const refs = Core.parseRefAdvertisement(text);
  if (!refs.count) return { error: 'no refs returned' };
  return { refs: { heads: refs.heads, tags: refs.tags } };
}

async function getRefs(owner, repo) {
  const key = 'refs:' + owner.toLowerCase() + '/' + repo.toLowerCase();
  const now = Date.now();
  try {
    const hit = (await chrome.storage.session.get(key))[key];
    if (hit && now - hit.t < (hit.v.error ? TTL_ERR : TTL_OK)) return hit.v;
  } catch (_) {
    /* storage unavailable: fall through to network */
  }
  if (inflight.has(key)) return inflight.get(key);
  const p = (async () => {
    const v = await fetchRefs(owner, repo);
    try {
      await chrome.storage.session.set({ [key]: { t: Date.now(), v } });
    } catch (_) {
      /* over quota: skip caching */
    }
    return v;
  })();
  inflight.set(key, p);
  try {
    return await p;
  } finally {
    inflight.delete(key);
  }
}

async function assessAll(items) {
  const byRepo = new Map();
  for (const it of items) {
    if (it.parsed.kind !== 'action') continue;
    const k = it.parsed.owner + '/' + it.parsed.repo;
    if (!byRepo.has(k)) byRepo.set(k, getRefs(it.parsed.owner, it.parsed.repo));
  }
  const out = {};
  for (const it of items) {
    let got = null;
    if (it.parsed.kind === 'action') got = await byRepo.get(it.parsed.owner + '/' + it.parsed.repo);
    out[it.key] = Core.assess(it.parsed, got && got.refs ? got.refs : null, got && got.error);
  }
  return out;
}

function setBadge(tabId, count) {
  const open = (count.danger || 0) + (count.warn || 0);
  const text = open ? String(open) : count.ok ? '✓' : '';
  const color = count.danger ? '#c21f2b' : open ? '#9a6700' : '#1a7f37';
  chrome.action.setBadgeText({ tabId, text }).catch(() => {});
  if (text) chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {});
  if (text && chrome.action.setBadgeTextColor) chrome.action.setBadgeTextColor({ tabId, color: '#ffffff' }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'actionpin:badge' && sender.tab && msg.count) {
    setBadge(sender.tab.id, msg.count);
    return false;
  }
  if (!msg || msg.type !== 'actionpin:assess' || !Array.isArray(msg.items)) return false;
  assessAll(msg.items.slice(0, 200)).then(
    (results) => sendResponse({ ok: true, results }),
    (e) => sendResponse({ ok: false, error: String(e && e.message ? e.message : e) })
  );
  return true; // async response
});

/* ActionPin content script: finds `uses:` lines on github.com, labels them, and lists fixes in a panel. */
(() => {
  'use strict';
  if (window.__actionpinLoaded) return;
  window.__actionpinLoaded = true;

  const Core = globalThis.ActionPinCore;
  const SKIP_TAGS = new Set(['TEXTAREA', 'SCRIPT', 'STYLE', 'NOSCRIPT', 'INPUT', 'SELECT', 'OPTION']);
  const USES_HINT = /\buses["']?\s*:/;
  const results = new Map(); // key -> assessment
  const pending = new Set();
  let current = []; // [{key, parsed, count, els: []}]
  let timer = null;
  let open = false;
  let dead = false;

  const strip = (s) => s.trim().replace(/^["']|["']$/g, '');

  function insideSkipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return true;
    }
    return false;
  }

  /** Smallest ancestor whose text contains the `uses:` key for this value. */
  function lineContainer(node) {
    let el = node.parentElement;
    for (let depth = 0; el && depth < 7; depth++, el = el.parentElement) {
      if (el === document.body || el === document.documentElement) return null;
      const t = el.textContent;
      if (t.length > 300000) return null;
      if (USES_HINT.test(t)) return el;
    }
    return null;
  }

  function collect() {
    const root = document.body;
    if (!root) return [];
    const containers = new Set();
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    let visited = 0;
    while ((n = walker.nextNode())) {
      if (++visited > 200000) break;
      const v = n.nodeValue;
      if (v.length < 5 || v.indexOf('/') === -1) continue;
      if (v.indexOf('@') === -1 && v.indexOf('docker://') === -1) continue;
      if (insideSkipped(n)) continue;
      const c = lineContainer(n);
      if (c) containers.add(c);
    }

    const byKey = new Map();
    for (const c of containers) {
      // Skip a container that merely wraps another one we already have.
      let nested = false;
      for (const other of containers) {
        if (other !== c && c.contains(other)) {
          nested = true;
          break;
        }
      }
      if (nested) continue;

      const found = Core.findUses(c.textContent);
      if (!found.length) continue;

      // Token elements whose whole text is exactly the reference, in document order.
      const tokens = new Map(); // spec -> [el]
      const tw = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      let t;
      while ((t = tw.nextNode())) {
        const spec = strip(t.nodeValue);
        if (!spec || spec.indexOf('/') === -1) continue;
        const p = t.parentElement;
        if (!p || p === c || strip(p.textContent) !== spec) continue;
        if (!tokens.has(spec)) tokens.set(spec, []);
        const arr = tokens.get(spec);
        if (arr[arr.length - 1] !== p) arr.push(p);
      }
      const used = new Map();

      for (const f of found) {
        const key = Core.keyOf(f.parsed);
        if (!byKey.has(key)) byKey.set(key, { key, parsed: f.parsed, count: 0, els: [] });
        const entry = byKey.get(key);
        entry.count++;
        const i = used.get(f.parsed.spec) || 0;
        used.set(f.parsed.spec, i + 1);
        const el = (tokens.get(f.parsed.spec) || [])[i];
        if (el) entry.els.push(el);
        else if (found.length === 1 && c.textContent.length < 400) entry.els.push(c); // single-line container: label the line
      }
    }
    return [...byKey.values()];
  }

  function paintInline() {
    const keep = new Set();
    for (const f of current) {
      const a = results.get(f.key);
      if (!a) continue;
      for (const el of f.els) {
        keep.add(el);
        if (el.getAttribute('data-actionpin') !== a.level) el.setAttribute('data-actionpin', a.level);
        if (el.getAttribute('data-actionpin-label') !== a.label) el.setAttribute('data-actionpin-label', a.label);
        if (el.title !== a.detail) el.title = a.detail;
      }
    }
    for (const el of document.querySelectorAll('[data-actionpin]')) {
      if (!keep.has(el)) {
        el.removeAttribute('data-actionpin');
        el.removeAttribute('data-actionpin-label');
        el.removeAttribute('title');
      }
    }
  }

  // ---------- panel (shadow DOM, attached outside <body> so page frameworks never touch it) ----------

  const PANEL_CSS = `
    :host { all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483000;
      font: 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; color-scheme: light dark; }
    .wrap { --bg:#ffffff; --fg:#1f2328; --mut:#59636e; --line:#d1d9e0; --ok:#1a7f37; --warn:#8a5a00; --bad:#c21f2b; --btn:#f3f5f7;
      color: var(--fg); display:flex; flex-direction:column; align-items:flex-end; gap:8px; }
    @media (prefers-color-scheme: dark) { .wrap { --bg:#161b22; --fg:#e6edf3; --mut:#9198a1; --line:#3d444d; --ok:#3fb950; --warn:#d29922; --bad:#ff7b72; --btn:#21262d; } }
    button { font: inherit; color: inherit; cursor: pointer; }
    button:focus-visible { outline: 2px solid #4493f8; outline-offset: 2px; }
    .pill { background: var(--bg); border:1px solid var(--line); border-radius:999px; padding:6px 12px; display:flex; gap:8px; align-items:center;
      box-shadow: 0 4px 16px rgba(0,0,0,.18); font-weight:600; }
    .pill .n { font-weight:500; }
    .ok { color: var(--ok); } .warn { color: var(--warn); } .danger { color: var(--bad); }
    .card { background: var(--bg); border:1px solid var(--line); border-radius:10px; width:min(520px, calc(100vw - 32px)); max-height:min(60vh, 560px);
      display:flex; flex-direction:column; box-shadow: 0 8px 28px rgba(0,0,0,.25); overflow:hidden; }
    .head { display:flex; justify-content:space-between; align-items:center; gap:8px; padding:10px 12px; border-bottom:1px solid var(--line); }
    .head b { font-size:14px; }
    .list { overflow:auto; margin:0; padding:0; list-style:none; }
    .row { padding:9px 12px; border-bottom:1px solid var(--line); display:grid; grid-template-columns: 1fr auto; gap:4px 10px; align-items:start; }
    .row:last-child { border-bottom:0; }
    .spec { font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap:anywhere; }
    .label { font-weight:600; }
    .detail { grid-column: 1 / -1; color: var(--mut); font-size:12px; overflow-wrap:anywhere; }
    .fix { grid-column: 1 / -1; font: 12px/1.4 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: var(--btn); border-radius:6px; padding:5px 7px; overflow-wrap:anywhere; }
    .btn { background: var(--btn); border:1px solid var(--line); border-radius:6px; padding:3px 9px; white-space:nowrap; }
    .x { background:none; border:0; font-size:18px; line-height:1; padding:2px 6px; color: var(--mut); }
    .foot { padding:8px 12px; border-top:1px solid var(--line); display:flex; justify-content:space-between; align-items:center; gap:8px; color: var(--mut); font-size:12px; }
  `;

  let host = null;
  let shadow = null;

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement('actionpin-panel');
    shadow = host.attachShadow({ mode: 'open' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(PANEL_CSS);
    shadow.adoptedStyleSheets = [sheet];
    document.documentElement.appendChild(host);
  }

  async function copy(text, btn) {
    const old = btn.textContent;
    try {
      await navigator.clipboard.writeText(text);
      btn.textContent = 'Copied';
    } catch (_) {
      btn.textContent = 'Copy failed';
    }
    setTimeout(() => (btn.textContent = old), 1400);
  }

  function renderPanel() {
    const rows = current.map((f) => ({ f, a: results.get(f.key) })).filter((r) => r.a);
    if (!rows.length) {
      if (host) host.remove();
      return;
    }
    ensureHost();
    const order = { danger: 0, warn: 1, ok: 2 };
    rows.sort((x, y) => order[x.a.level] - order[y.a.level] || (x.f.parsed.spec < y.f.parsed.spec ? -1 : 1));
    const count = { danger: 0, warn: 0, ok: 0 };
    for (const r of rows) count[r.a.level]++;
    const fixes = rows.filter((r) => r.a.fix);

    const wrap = el('div', 'wrap');

    if (open) {
      const card = el('div', 'card');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-label', 'ActionPin results');
      const head = el('div', 'head');
      head.appendChild(el('b', '', 'ActionPin — ' + rows.length + ' action reference' + (rows.length === 1 ? '' : 's')));
      const close = el('button', 'x', '×');
      close.setAttribute('aria-label', 'Close');
      close.addEventListener('click', () => {
        open = false;
        renderPanel();
      });
      head.appendChild(close);
      card.appendChild(head);

      const list = el('ul', 'list');
      for (const { f, a } of rows) {
        const li = el('li', 'row');
        const left = el('div');
        left.appendChild(el('div', 'spec', f.parsed.spec + (f.count > 1 ? '  ×' + f.count : '')));
        left.appendChild(el('div', 'label ' + a.level, a.label));
        li.appendChild(left);
        if (a.fix) {
          const b = el('button', 'btn', 'Copy fix');
          b.addEventListener('click', () => copy(a.fix, b));
          li.appendChild(b);
        } else {
          li.appendChild(el('span'));
        }
        li.appendChild(el('div', 'detail', a.detail));
        if (a.fix) li.appendChild(el('div', 'fix', 'uses: ' + a.fix));
        list.appendChild(li);
      }
      card.appendChild(list);

      const foot = el('div', 'foot');
      foot.appendChild(el('span', '', 'Resolved from public refs just now. Tags can move again.'));
      if (fixes.length > 1) {
        const all = el('button', 'btn', 'Copy all fixes');
        all.addEventListener('click', () => copy(fixes.map((r) => r.f.parsed.spec + '  ->  ' + r.a.fix).join('\n'), all));
        foot.appendChild(all);
      }
      card.appendChild(foot);
      wrap.appendChild(card);
    }

    const pill = el('button', 'pill');
    pill.setAttribute('aria-expanded', String(open));
    pill.appendChild(el('span', '', 'ActionPin'));
    if (count.danger) pill.appendChild(el('span', 'n danger', '✖ ' + count.danger + ' risky'));
    if (count.warn) pill.appendChild(el('span', 'n warn', '⚠ ' + count.warn + ' unpinned'));
    if (count.ok) pill.appendChild(el('span', 'n ok', '✓ ' + count.ok + ' pinned'));
    pill.addEventListener('click', () => {
      open = !open;
      renderPanel();
    });
    wrap.appendChild(pill);

    shadow.replaceChildren(wrap);
  }

  // ---------- toolbar popup + badge ----------

  function summary() {
    const rows = current
      .map((f) => ({ f, a: results.get(f.key) }))
      .filter((r) => r.a)
      .map((r) => ({ spec: r.f.parsed.spec, count: r.f.count, level: r.a.level, label: r.a.label }));
    const count = { danger: 0, warn: 0, ok: 0 };
    for (const r of rows) count[r.level]++;
    return { found: current.length, checking: current.length - rows.length, count, rows };
  }

  let lastBadge = '';
  function reportBadge() {
    const { found, count } = summary();
    const sig = found + ':' + count.danger + ':' + count.warn + ':' + count.ok;
    if (sig === lastBadge || dead) return;
    lastBadge = sig;
    try {
      chrome.runtime.sendMessage({ type: 'actionpin:badge', count }).catch(() => {});
    } catch (_) {
      dead = true;
    }
  }

  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg) return false;
      if (msg.type === 'actionpin:status') {
        sendResponse(summary());
      } else if (msg.type === 'actionpin:open') {
        open = true;
        renderPanel();
        sendResponse({ ok: true });
      }
      return false;
    });
  } catch (_) {
    /* running outside an extension context */
  }

  // ---------- scan loop ----------

  function scan() {
    timer = null;
    if (dead) return;
    current = collect();
    const need = current.filter((f) => !results.has(f.key) && !pending.has(f.key));
    paintInline();
    renderPanel();
    reportBadge();
    if (!need.length) return;
    for (const f of need) pending.add(f.key);
    let sent;
    try {
      sent = chrome.runtime.sendMessage({ type: 'actionpin:assess', items: need.map((f) => ({ key: f.key, parsed: f.parsed })) });
    } catch (_) {
      dead = true; // extension was reloaded; this copy of the script is orphaned
      return;
    }
    sent.then(
      (res) => {
        for (const f of need) pending.delete(f.key);
        if (!res || !res.ok) return;
        for (const k in res.results) results.set(k, res.results[k]);
        paintInline();
        renderPanel();
        reportBadge();
      },
      () => {
        for (const f of need) pending.delete(f.key);
      }
    );
  }

  function schedule() {
    if (timer || dead) return;
    timer = setTimeout(scan, 450);
  }

  new MutationObserver((muts) => {
    for (const m of muts) {
      if (host && (m.target === host || host.contains(m.target))) continue;
      schedule();
      return;
    }
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  schedule();
})();

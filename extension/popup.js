/* Toolbar popup: says what ActionPin sees on the current tab, and why when it sees nothing. */
const statusEl = document.getElementById('status');
const rowsEl = document.getElementById('rows');
const showBtn = document.getElementById('show');
const hintEl = document.getElementById('hint');
const EXAMPLE = 'https://github.com/actions/checkout/blob/main/.github/workflows/test.yml';

function hint(parts) {
  hintEl.replaceChildren(...parts);
  hintEl.hidden = false;
}

function link(text, href) {
  const a = document.createElement('a');
  a.textContent = text;
  a.href = href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

function code(text) {
  const c = document.createElement('code');
  c.textContent = text;
  return c;
}

(async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  // tab.url is only visible for sites this extension has access to, i.e. github.com.
  if (!tab || !tab.url || !tab.url.startsWith('https://github.com/')) {
    statusEl.textContent = 'This tab is not on github.com, so there is nothing to check here.';
    hint(['ActionPin only runs on GitHub pages that show workflow YAML. Try ', link('this workflow file', EXAMPLE), '.']);
    return;
  }

  let res;
  try {
    res = await chrome.tabs.sendMessage(tab.id, { type: 'actionpin:status' });
  } catch (_) {
    statusEl.textContent = 'Reload this tab.';
    hint(['It was opened before ActionPin was installed or updated, so the checker is not running in it yet.']);
    return;
  }

  if (!res || !res.found) {
    statusEl.textContent = 'No action references on this page.';
    hint(['ActionPin looks for ', code('uses: owner/repo@ref'), ' lines. Open a file under ', code('.github/workflows/'), ' or a pull request that changes one. Try ', link('this workflow file', EXAMPLE), '.']);
    return;
  }

  const c = res.count;
  const bits = [];
  if (c.danger) bits.push(c.danger + ' risky');
  if (c.warn) bits.push(c.warn + ' unpinned');
  if (c.ok) bits.push(c.ok + ' pinned');
  if (res.checking) bits.push(res.checking + ' still being checked');
  statusEl.textContent = res.found + ' action reference' + (res.found === 1 ? '' : 's') + ': ' + bits.join(', ') + '.';

  const order = { danger: 0, warn: 1, ok: 2 };
  res.rows.sort((a, b) => order[a.level] - order[b.level]);
  for (const r of res.rows) {
    const li = document.createElement('li');
    const spec = document.createElement('div');
    spec.className = 'spec';
    spec.textContent = r.spec + (r.count > 1 ? '  ×' + r.count : '');
    const label = document.createElement('div');
    label.className = 'label ' + r.level;
    label.textContent = r.label;
    li.append(spec, label);
    rowsEl.appendChild(li);
  }
  rowsEl.hidden = res.rows.length === 0;

  showBtn.hidden = false;
  showBtn.addEventListener('click', async () => {
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'actionpin:open' });
      window.close();
    } catch (_) {
      statusEl.textContent = 'Reload this tab, then try again.';
    }
  });
})();

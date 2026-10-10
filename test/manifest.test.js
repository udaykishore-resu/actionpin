// Limits the Chrome Web Store enforces at upload time.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', 'extension');
const m = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('manifest fits Chrome Web Store limits', () => {
  assert.equal(m.manifest_version, 3);
  assert.ok(m.description.length <= 132, 'description is ' + m.description.length + ' chars, limit is 132');
  assert.ok(m.name.length <= 75, 'name is ' + m.name.length + ' chars, limit is 75');
  assert.ok(m.short_name.length <= 12, 'short_name is ' + m.short_name.length + ' chars, limit is 12');
  assert.match(m.version, /^\d+(\.\d+){0,3}$/);
});

test('every file the manifest points at exists', () => {
  const files = [m.background.service_worker, m.action.default_popup, ...Object.values(m.icons)];
  for (const cs of m.content_scripts) files.push(...cs.js, ...(cs.css || []));
  for (const f of files) assert.ok(fs.existsSync(path.join(root, f)), 'missing ' + f);
});

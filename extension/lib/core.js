/*
 * ActionPin core — pure logic, no browser APIs.
 * Loaded three ways: content script (classic), service worker (importScripts), Node tests (require).
 */
(function (root) {
  'use strict';

  const SHA_RE = /^[0-9a-f]{40}$/i;

  // Matches a YAML `uses:` entry that starts its line. Tolerates list dashes, diff +/- markers,
  // quoted keys/values and a trailing comment. Commented-out lines and prose do not match.
  const USES_RE = /^[\s+\-]*["']?uses["']?\s*:\s*(["']?)([^\s"'#]+)\1\s*(?:#\s*(.*?))?\s*$/;
  const ACTION_RE = /^([A-Za-z0-9][\w.-]*)\/([\w.-]+)((?:\/[^@\s]+)?)@(\S+)$/;

  /**
   * Parse one line of text. Returns null when the line is not a remote `uses:` reference.
   */
  function parseUsesLine(line) {
    if (typeof line !== 'string' || line.length > 2000) return null;
    const m = USES_RE.exec(line);
    if (!m) return null;
    const spec = m[2];
    const comment = (m[3] || '').trim();
    if (spec.includes('${{')) return null; // templated, cannot be resolved statically
    if (spec.startsWith('./') || spec.startsWith('../')) return null; // local action, same commit as the workflow

    if (spec.startsWith('docker://')) {
      const image = spec.slice('docker://'.length);
      if (!image) return null;
      return { kind: 'docker', spec, comment, image, pinned: /@sha256:[0-9a-f]{64}$/i.test(image) };
    }

    const a = ACTION_RE.exec(spec);
    if (!a) return null;
    return {
      kind: 'action',
      spec,
      comment,
      owner: a[1],
      repo: a[2],
      path: a[3] || '',
      ref: a[4],
    };
  }

  /** Pull a version-looking token out of a trailing comment such as `# v4.2.2` or `# tag=v4`. */
  function extractCommentTag(comment) {
    if (!comment) return null;
    for (const raw of comment.split(/[\s,;()]+/)) {
      const tok = raw.replace(/^(?:tag|version|ratchet:[^@]+@|pin)[=:]?/i, '');
      if (/^v?\d+(?:\.\d+){0,3}(?:[-+.][\w.]+)?$/.test(tok)) return tok;
    }
    return null;
  }

  /**
   * Parse the smart-HTTP ref advertisement returned by
   *   GET https://github.com/<owner>/<repo>.git/info/refs?service=git-upload-pack
   * into { heads: {name: sha}, tags: {name: sha} }. Annotated tags are peeled to the commit.
   */
  function parseRefAdvertisement(text) {
    const heads = Object.create(null);
    const tags = Object.create(null);
    const peeled = Object.create(null);
    let count = 0;
    const re = /([0-9a-f]{40}) (refs\/(heads|tags)\/([^\0\n]+))/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const sha = m[1].toLowerCase();
      const type = m[3];
      let name = m[4].trim();
      count++;
      if (type === 'heads') {
        heads[name] = sha;
      } else if (name.endsWith('^{}')) {
        name = name.slice(0, -3);
        peeled[name] = sha;
      } else if (!(name in tags)) {
        tags[name] = sha;
      }
    }
    for (const name in peeled) tags[name] = peeled[name]; // commit, not the tag object
    return { heads, tags, count };
  }

  function semverParts(tag) {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(tag);
    if (!m) return null;
    return [m[1], m[2], m[3]].filter((x) => x !== undefined).map(Number);
  }

  /** All tags pointing at `sha`, most specific version first (v4.2.2 before v4). */
  function tagsAt(refs, sha) {
    const out = [];
    const want = sha.toLowerCase();
    for (const name in refs.tags) if (refs.tags[name] === want) out.push(name);
    out.sort((a, b) => {
      const pa = semverParts(a);
      const pb = semverParts(b);
      if (pa && !pb) return -1;
      if (!pa && pb) return 1;
      if (pa && pb) {
        if (pa.length !== pb.length) return pb.length - pa.length;
        for (let i = 0; i < pa.length; i++) if (pa[i] !== pb[i]) return pb[i] - pa[i];
      }
      return a < b ? -1 : a > b ? 1 : 0;
    });
    return out;
  }

  function headsAt(refs, sha) {
    const out = [];
    const want = sha.toLowerCase();
    for (const name in refs.heads) if (refs.heads[name] === want) out.push(name);
    return out.sort();
  }

  const short = (sha) => sha.slice(0, 7);

  /**
   * Decide the status of one parsed reference.
   * `refs` is the result of parseRefAdvertisement, or null when the repo could not be read.
   * Statuses: verified | pinned | mismatch | tag | branch | ambiguous | missing | unresolved | docker-pinned | docker-tag
   */
  function assess(parsed, refs, refsError) {
    if (parsed.kind === 'docker') {
      return parsed.pinned
        ? { status: 'docker-pinned', level: 'ok', label: '✓ digest-pinned', detail: 'Image is pinned to a sha256 digest.' }
        : {
            status: 'docker-tag',
            level: 'warn',
            label: '⚠ image tag, not a digest',
            detail: 'Container tags can be re-pushed. Pin with image@sha256:<digest>.',
          };
    }

    const { owner, repo, path, ref, comment } = parsed;
    const isSha = SHA_RE.test(ref);
    const commentTag = extractCommentTag(comment);

    if (!refs) {
      const why = refsError ? ' (' + refsError + ')' : '';
      return isSha
        ? { status: 'pinned', level: 'ok', label: '✓ pinned (not checked)', detail: 'Pinned to a commit SHA. Could not read the repo refs to check it' + why + '.' }
        : { status: 'unresolved', level: 'warn', label: '⚠ not pinned', detail: 'Mutable ref. Could not read the repo refs to resolve it' + why + '.' };
    }

    if (isSha) {
      const sha = ref.toLowerCase();
      const at = tagsAt(refs, sha);
      if (commentTag) {
        const claimed = refs.tags[commentTag] || refs.tags['v' + commentTag] || null;
        if (claimed === sha) {
          return { status: 'verified', level: 'ok', label: '✓ pinned = ' + commentTag, detail: 'SHA matches tag ' + commentTag + ' in ' + owner + '/' + repo + '.' };
        }
        if (claimed) {
          return {
            status: 'mismatch',
            level: 'danger',
            label: '✖ comment says ' + commentTag + ', tag is at ' + short(claimed),
            detail:
              'The comment claims ' + commentTag + ' but that tag currently points to ' + claimed + '. Either the tag was moved after pinning or the comment is wrong.' +
              (at.length ? ' This SHA is actually ' + at[0] + '.' : ''),
            actual: at[0] || null,
            fix: at.length ? owner + '/' + repo + path + '@' + sha + ' # ' + at[0] : undefined,
          };
        }
        return {
          status: 'pinned',
          level: 'ok',
          label: at.length ? '✓ pinned = ' + at[0] : '✓ pinned (tag ' + commentTag + ' not found)',
          detail: 'Tag ' + commentTag + ' named in the comment does not exist in ' + owner + '/' + repo + '.' + (at.length ? ' This SHA is ' + at[0] + '.' : ''),
        };
      }
      if (at.length) {
        return { status: 'verified', level: 'ok', label: '✓ pinned = ' + at[0], detail: 'SHA is the commit behind tag ' + at.join(', ') + '.' };
      }
      const hs = headsAt(refs, sha);
      if (hs.length) {
        return { status: 'pinned', level: 'ok', label: '✓ pinned = tip of ' + hs[0], detail: 'SHA is the current tip of branch ' + hs.join(', ') + ' (no release tag here).' };
      }
      return {
        status: 'pinned',
        level: 'ok',
        label: '✓ pinned (no tag here)',
        detail: 'Pinned to a commit that is not a tag or branch tip. Refs alone cannot prove this commit belongs to ' + owner + '/' + repo + ' rather than a fork.',
      };
    }

    const tagSha = refs.tags[ref] || null;
    const headSha = refs.heads[ref] || null;
    const base = owner + '/' + repo + path + '@';

    if (tagSha && headSha && tagSha !== headSha) {
      return {
        status: 'ambiguous',
        level: 'danger',
        label: '✖ tag and branch both named ' + ref,
        detail: 'Tag ' + ref + ' is at ' + tagSha + ' and branch ' + ref + ' is at ' + headSha + '. Which one runs is easy to get wrong. Pin the SHA you reviewed.',
        fix: base + tagSha + ' # ' + ref,
        sha: tagSha,
      };
    }
    if (tagSha) {
      const best = tagsAt(refs, tagSha)[0] || ref;
      return {
        status: 'tag',
        level: 'warn',
        label: '⚠ tag → ' + short(tagSha),
        detail: 'Tag ' + ref + ' is mutable. Today it points to ' + tagSha + (best !== ref ? ' (' + best + ')' : '') + '.',
        fix: base + tagSha + ' # ' + best,
        sha: tagSha,
      };
    }
    if (headSha) {
      return {
        status: 'branch',
        level: 'danger',
        label: '✖ branch → ' + short(headSha),
        detail: 'Branch ' + ref + ' changes on every push. Its tip today is ' + headSha + '.',
        fix: base + headSha + ' # ' + ref,
        sha: headSha,
      };
    }
    return {
      status: 'missing',
      level: 'warn',
      label: '? ref ' + ref + ' not found',
      detail: 'No tag or branch named ' + ref + ' in ' + owner + '/' + repo + '. It may be a short SHA (unsupported by Actions) or a deleted ref.',
    };
  }

  /** Split text into lines and parse each. Returns [{line, parsed}] in order. */
  function findUses(text) {
    const out = [];
    const lines = String(text).split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const parsed = parseUsesLine(lines[i]);
      if (parsed) out.push({ line: i, parsed });
    }
    return out;
  }

  const keyOf = (p) => p.spec + ' #' + (extractCommentTag(p.comment) || '');

  const api = { parseUsesLine, extractCommentTag, parseRefAdvertisement, tagsAt, headsAt, assess, findUses, keyOf, SHA_RE };
  root.ActionPinCore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);

# Chrome Web Store listing: ActionPin

Everything to paste into the developer dashboard. URLs assume the repo is `github.com/udaykishore-resu/actionpin`; change them if you name it differently.

## Store listing tab

| Field | Value |
|---|---|
| Category | Developer Tools |
| Language | English |
| Store icon | `actionpin-store-icon-128.png` |
| Screenshots | `actionpin-screenshot-1.png`, `actionpin-screenshot-2.png` |
| Small promo tile | `actionpin-promo-440x280.png` |
| Marquee promo tile | leave empty |
| Global promo video | leave empty |
| Official URL | None |
| Homepage URL | `https://github.com/udaykishore-resu/actionpin` |
| Support URL | `https://github.com/udaykishore-resu/actionpin/issues` |
| Mature content | No |

### Description

```
ActionPin shows, on GitHub itself, whether each action a workflow uses is pinned to a commit.

A workflow line like "uses: some/action@v4" runs whatever commit that tag points to today. Tags and branches can be moved, so the code your pipeline runs can change without any change in your repository. Pinning to a full commit SHA closes that gap. ActionPin makes the difference visible while you read or review a workflow.

What you see next to each "uses:" line
- Pinned: the SHA is verified against the repository's tags, and the matching version is shown
- Tag: flagged as mutable, with the commit it points to right now
- Branch: flagged as risky, with its current tip
- Wrong comment: a pinned SHA whose "# v3" comment names a tag that points somewhere else
- Container image referenced by tag instead of digest

One-click fix
A panel lists every reference with a "Copy fix" button. It copies the pinned form with the most specific version as a comment, which is the form Dependabot and Renovate keep up to date:
  uses: actions/checkout@<40-character SHA> # v4.2.1

Where it runs
Any github.com page that shows workflow YAML: file view, pull request diffs and README snippets. The toolbar badge shows how many references on the page are not pinned.

Privacy
No token, no account, no analytics. To resolve a tag, the extension asks github.com for the public ref list of the referenced repository, without cookies. Private action repositories are therefore reported as "not checked" rather than resolved.

Limits
ActionPin reads; it does not edit files or open pull requests. It cannot prove that an untagged commit belongs to the repository rather than a fork.
```

## Privacy tab

**Single purpose**

```
Shows whether GitHub Actions references on github.com pages are pinned to a commit SHA, and resolves tags and branches to the commit they currently point to.
```

**Permission justifications**

| Permission | Justification |
|---|---|
| `storage` | Caches the public ref list of a repository for 10 minutes in session storage so the same repository is not fetched repeatedly. Nothing is synced or kept after the browser closes. |
| Host permission (`github.com`) | Reads `uses:` lines on GitHub pages and fetches the public ref list of each referenced action repository from github.com to resolve tags to commit SHAs. Requests are sent without cookies. |

**Remote code:** No, I am not using remote code.

**Data usage:** tick **Website content** (the extension reads workflow text on the page and requests the public refs of the repositories named there from github.com). Tick nothing else. Certify all three statements.

**Privacy policy URL:** `https://github.com/udaykishore-resu/actionpin/blob/main/PRIVACY.md`

## Distribution tab

Free · Public · All regions.

## Test instructions tab (optional, helps review)

```
No account needed. Open:
  https://github.com/actions/checkout/blob/main/.github/workflows/test.yml
A label appears beside each "uses: actions/..." line, the toolbar icon shows a count, and a summary pill appears at the bottom right. Click the pill for the list of fixes.
```

# ActionPin privacy policy

Last updated: 2026-10-09

ActionPin does not collect, store, sell or share personal data, and has no server of its own.

**What leaves your browser.** When a github.com page shows a line such as `uses: owner/repo@ref`, the extension requests the public ref list of that repository from `https://github.com/<owner>/<repo>.git/info/refs`. The request contains the owner and repository name only. It is sent without cookies or credentials.

**What is stored.** Ref lists are cached in `chrome.storage.session` for up to 10 minutes and are cleared when the browser closes. Nothing is written to disk and nothing is synced.

**What is not done.** No analytics, no tracking, no advertising, no remote code, no access to any site other than github.com.

Contact: open an issue on the project's repository.

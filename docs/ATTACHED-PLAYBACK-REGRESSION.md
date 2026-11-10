# Strict attached playback verification — 2026-10-27

Run in open browser now reuses the exact existing webpage selected beside the
Waypoint side panel. Run clean retains isolated Playwright execution.

## Root cause and implementation

The panel previously sent only a URL. `attachOverCdp()` called
`ensureDebugBrowser()` and `ensureDebugPage()`, which could launch Chrome or
create a page. Selection could fall back to another matching URL, another tab,
or a new context/page. `BROWSER_ENGINE=cdp` could also redirect clean runs into
the attached engine.

The panel now captures its own window's active tab ID, window ID, URL, document
ID where supported, and a one-time document token. The API requires that identity
for attached execution. The runner connects to an existing CDP endpoint, resolves
exactly one existing Page by that token, checks its URL, records its CDP target
ID, and consumes the token. No URL fallback or browser-launch helper remains.
The marker correlates APIs; it is not authentication and is visible to page
scripts. See [BROWSER-MODES.md](BROWSER-MODES.md) for the trust boundary.

Matching starting URLs preserve the document by default. An explicit reload
option reloads once; different URLs navigate the same Page once after the URL
safety check. Cookies and storage are preserved. Disconnect never closes the
browser/context/tabs. Only a recorded `newTab` creates a page. Attachment errors
are actionable HTTP 409 responses; failed preparation releases the busy lock.

Locator resolution, fallback restrictions, ground-truth comparison, repair
records, and independent benchmark families use the existing execution path.
Attached runs carry `researchEligible: false` and selected-tab provenance.

## Validation results

| Check | Result |
| --- | --- |
| `corepack pnpm test` | **226 passed**, 22 files; baseline was 205 |
| `corepack pnpm typecheck` | Passed |
| `corepack pnpm lint` | Passed |
| `corepack pnpm build` | Passed |
| `git diff --check` | Passed |
| `corepack pnpm test:e2e --config playwright.browser.config.ts --headed` | **13 passed**, 0 skipped, 42.9 seconds |

The visible browser suite rebuilt the backend and extension, started a fresh
runner on port 3101, and reloaded the unpacked extension by restarting its
dedicated Chrome for Testing profile before recording and replay. The normal
backend on port 3100 was subsequently restarted with the rebuilt code and the
isolated Chromium default.

The browser tests verified:

- Alpha, Beta, and Gamma receive distinct **trusted DOM click events**, with
  matching persisted expected/resolved identities.
- Removing distinguishing selectors causes `ambiguous_locator` and zero clicks,
  even with ground-truth attributes still present.
- A unique wrong fallback records expected Beta/resolved Alpha as
  `false_positive`; ground truth never selects the target.
- Intent/test-contract strategies cannot borrow structural fallbacks; structural
  and coordinate strategies are evaluated independently.
- A locator becoming ambiguous after resolution never clicks its first match.
- Duplicate URLs select the exact second tab, leaving the first untouched.
- Matching URLs do not navigate; differing URLs navigate the selected page once.
- Explicit refresh reloads once while cookies and local storage survive.
- Missing/stale tab identity fails without a replacement page.
- Missing CDP fails; unit spies additionally prove zero launch/newContext/newPage
  calls on this path.
- Run clean remains isolated and leaves all selected-browser tabs untouched.
- Only an explicit recorded `newTab` creates a page.
- The **actual native side-panel Run in open browser button** completes replay
  in its active webpage with the same existing Page objects still open.

## Visible demonstration and persisted evidence

Native side-panel run: `run_adb1c1d0-f9c3-440e-8fc4-f2e8198a020e`, succeeded.
Selected extension tab `1926257139`, window `1926257134`, CDP target
`92F4C6B5D5D7BEA4664DA868917333F1`.

| Actual clicked item | Expected identity | Resolved identity | Classification |
| --- | --- | --- | --- |
| Item Alpha | `delete-alpha` | `delete-alpha` | `true_positive` |
| Item Beta | `delete-beta` | `delete-beta` | `true_positive` |
| Item Gamma | `delete-gamma` | `delete-gamma` | `true_positive` |

Local artifacts (ignored by Git):

- [Full browser report](../playwright-report/browser/index.html)
- [Native side-panel screenshot](../test-results/attached-demonstration/the-real-side-panel-run-in-open-browser-button-replays-in-its-active-webpage/native-side-panel.png)
- [Actual three-click screenshot](../test-results/attached-demonstration/the-real-side-panel-run-in-open-browser-button-replays-in-its-active-webpage/side-panel-correct-targets.png)
- [Visible browser video](../test-results/attached-demonstration/the-real-side-panel-run-in-open-browser-button-replays-in-its-active-webpage/browser-video.webm)
- [Persisted side-panel run](../test-results/attached-demonstration/the-real-side-panel-run-in-open-browser-button-replays-in-its-active-webpage/side-panel-run.json)
- [Zero-click abstention screenshot](../test-results/attached-demonstration/removing-distinguishing-dom-selectors-safely-abstains-even-with-truth-ids-present/safe-abstention.png)
- [All scenario outcomes](../test-results/attached-demonstration/results.json)

The native-panel test drives Chrome's panel target using test-only CDP commands.
Its HTTP client points to the fresh test runner on 3101. Workflow execution uses
the production API, launcher, resolver, and classifier throughout.

## Changed files

| Area | Files |
| --- | --- |
| Tab capture, run UI, actionable errors | `apps/extension/src/attached-target.ts`, `attached-target.test.ts`, `api.ts`, `service-worker.ts`, `App.tsx`, `views/WorkflowListView.tsx`, `apps/extension/tsconfig.scripts.json` |
| Shared API contract | `packages/shared-types/src/index.ts` |
| API preflight and engine selection | `apps/runner/src/app.ts`, `app.test.ts`, `index.ts`, `env.ts` |
| Strict attachment and executor options | `apps/runner/src/core/debug-browser.ts`, `debug-browser.test.ts`, `playwright-launcher.ts`, `playwright-launcher.test.ts`, `executor.ts` |
| End-to-end browser regression | `tests/browser/ambiguous-replay.spec.ts` |
| Setup and documentation | `scripts/chrome-debug.mjs`, `docs/BROWSER-MODES.md`, `docs/EXPERIMENT-INTEGRITY.md`, this report |

## Remaining limitation

This supports a compatible browser already exposing CDP. It does **not** attach
to ordinary Chrome launched without remote debugging, nor to a different browser
containing a same-URL tab. No `chrome.debugger` permission or second execution
engine was introduced. A possible tab-scoped debugger relay, its permission and
security implications, and Playwright transport limitations are documented in
[BROWSER-MODES.md](BROWSER-MODES.md#ordinary-chrome-and-a-possible-debugger-transport).

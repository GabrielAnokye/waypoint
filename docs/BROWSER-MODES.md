# Browser execution modes

Waypoint offers two explicit execution modes. They share the same Playwright
step executor, strict locator resolver, fallback chain, and ground-truth reporting.

| Button / API engine | Browser ownership | Research data |
| --- | --- | --- |
| **Run clean** / `isolated` | Launch a browser, create a clean context, close it after execution | Suitable with controlled settings |
| **Run in open browser** / `attached` | Connect to the exact existing tab selected beside the side panel | Unsuitable: inherits browser state |

## Strict in-place playback

Open the Waypoint side panel in the browser you intend to drive and select its
webpage tab. **Run in open browser** uses that tab. It never launches Chrome,
creates a fallback context or tab, substitutes a same-URL tab, or reopens a closed
window. If attachment is unavailable, the request returns an actionable error.

The browser must already expose a compatible Chrome DevTools Protocol (CDP)
endpoint. The default is `http://localhost:9222`, configured with
`BROWSER_CDP_ENDPOINT`. A side panel in an ordinary Chrome session without remote
debugging **is not supported** by this implementation, even if another debugging
browser happens to be open at the configured endpoint.

To deliberately start a separate debugging browser yourself:

```sh
corepack pnpm chrome:debug http://localhost:8080/ambiguous.html
```

Then load the unpacked extension from `apps/extension/dist` in **that browser**,
open its side panel, and select the webpage. Starting this helper is an explicit
setup action; pressing the run button never invokes it. The helper uses a
persistent profile at `~/.waypoint/cdp-profile`. Its browser can stay open between
runs. On macOS, closing every window may leave Chrome's debug endpoint alive;
Waypoint will refuse the run until you open the intended tab yourself.

### How exact tab selection works

1. The side panel obtains its own `windowId`. Its service worker queries the
   active tab in that window, not the last-focused window.
2. Using the existing `scripting` permission, the worker injects a random,
   one-time document token into that tab's top document. It captures `tabId`,
   `windowId`, URL, and Chrome's `documentId` when available. It rechecks that the
   selected tab has not navigated, moved, or become inactive during capture.
3. The API requires this `attachedTarget` for `engine: 'attached'`. URL-only
   attached requests are rejected. The runner connects over CDP with
   `noDefaults: true` to avoid overriding settings on the user's existing context.
4. The runner searches only existing Playwright pages for the exact token,
   requires one match, and verifies the captured URL. It obtains the real CDP
   `targetId`, consumes the token, and retains that existing `Page` and context.
5. Run metadata records the extension tab/window/document identities and resolved
   CDP target ID, plus `contextIsolation: 'attached'`, `browserEngine: 'cdp'`, and
   `researchEligible: false`. The token is not persisted as run metadata.

Chrome extension tab IDs and CDP target IDs are separate namespaces. The
per-document handshake correlates them without requesting the broad `debugger`
permission. Duplicate URLs, another browser's tab with the same numeric ID,
closed tabs, replaced documents, and duplicate tokens cannot trigger URL fallback.

The DOM token is a correlation marker, **not authentication**, a locator, or a
ground-truth identity. It is visible to page scripts, expires after 60 seconds,
and is removed when consumed. A hostile page is outside this marker's trust
boundary. Keep both the runner and debugging endpoint local; this mechanism is
not permission to expose either service to untrusted clients.

### Navigation and state

A matching starting URL executes in place with no automatic reload. Query strings
and fragments are significant. If the starting URL differs, the workflow's
`goto` navigates the same selected page exactly once. HTTP and HTTPS destinations
are allowed; local `file:` replay requires the selected tab already to be a local
file. Script/data/internal URLs and URLs containing credentials are rejected.
These checks also apply to later explicit navigations and recorded `newTab` URLs.

The **Reload selected tab before attached replay** checkbox is off by default.
When enabled on the matching starting URL, the runner reloads once before replay.
If the URL differs, the normal navigation establishes the document instead of
performing an extra reload. Cookies, local storage and authentication are not
cleared. Navigation/reload can naturally discard unsaved page state.

Only a recorded `newTab` step creates another page. Recorded tab operations are
explicit workflow actions; disconnecting after execution never closes existing
tabs or the window. One run at a time can use the attached launcher; concurrent
requests return `409 engine_busy`.

Errors such as `attached_browser_unavailable`, `attached_target_not_found`,
`attached_target_changed`, and `unsafe_navigation` are returned before playback
starts when detected during preparation. No replacement browser is opened.
Failures during step execution continue through the existing run-event and
repair-record pipeline.

## Clean execution and settings

**Run clean** always uses the isolated launcher in production. The legacy
`BROWSER_ENGINE=cdp` setting no longer redirects clean runs into the user's
browser; it prints a migration notice. Use an explicit attached request with tab
identity instead. `BROWSER_ENGINE=noop` remains a testing simulator and must not
be used for experiment data.

```sh
corepack pnpm --filter @waypoint/runner start
```

| Variable | Default | Effect |
| --- | --- | --- |
| `BROWSER_HEADLESS` | `true` | Visibility of isolated runs |
| `BROWSER_SLOW_MO` | `0` | Action delay; keep zero for timing measurements |
| `BROWSER_KEEP_OPEN_MS` | `0` | Hold an isolated browser open after playback |
| `BROWSER_CDP_ENDPOINT` | `http://localhost:9222` | Existing browser used only by attached playback |

The attached browser's own viewport and session are preserved. Attached runs
remain unsuitable for controlled mutation benchmarks regardless of correctness.
See [EXPERIMENT-INTEGRITY.md](EXPERIMENT-INTEGRITY.md).

## Ordinary Chrome and a possible debugger transport

Chrome's [`chrome.debugger` API](https://developer.chrome.com/docs/extensions/reference/api/debugger)
can target a normal Chrome tab by `tabId` without a remote-debugging launch flag.
It requires the `debugger` permission, exposes only selected CDP domains, and can
be detached when the tab closes or DevTools opens. It does not provide a normal
browser-wide CDP WebSocket that can simply be passed to Playwright.

A future design would attach in the extension, relay commands and events over a
validated local/native channel, and translate the tab-scoped sessions into a
transport compatible with Playwright. It would need explicit selected-tab
consent, restricted command routing, frame/session lifecycle handling, detachment
errors, and tests for Playwright's browser-level protocol assumptions. This is an
architecture proposal, not implemented or enabled by this change. No `debugger`
permission or second execution engine has been added.

Playwright documents CDP attachment and its `noDefaults` option in its
[BrowserType API](https://playwright.dev/docs/api/class-browsertype#browser-type-connect-over-cdp).
CDP compatibility is tested against the installed Chrome for Testing build, not
claimed for every Chrome version or enterprise policy configuration.

## Regression and visible demonstration

```sh
corepack pnpm test
corepack pnpm test:e2e --config playwright.browser.config.ts --headed
```

The browser command rebuilds the extension/backend, starts a fresh test runner,
and reloads the unpacked extension by restarting a dedicated Chromium profile.
It covers exact duplicate-URL selection, same-tab navigation, optional reload,
state preservation, unavailable/stale attachment, isolated execution, and the
Alpha/Beta/Gamma locator regressions. The headed suite also exercises the actual
side panel run button. Videos, screenshots, recordings, and run JSON are saved in
`playwright-report/browser/index.html`.

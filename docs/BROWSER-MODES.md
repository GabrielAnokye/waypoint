# Browser execution modes

The runner can execute workflow steps three ways, selected with `BROWSER_ENGINE`.
Only one of them produces data you can publish.

| Mode | What it does | Valid for experiment data |
| --- | --- | --- |
| `chromium` (default) | Launches a fresh Playwright browser per run | **Yes** |
| `cdp` | Attaches to a Chrome you already have open and drives its current tab | No |
| `noop` | Simulates success for every step without a browser | No |

---

## Why playback does not use your own tab by default

A common first reaction is that playback should reuse the tab you recorded in.
It does not, for three reasons.

**Trusted input.** Playwright drives the browser over the DevTools Protocol, so
its clicks and keystrokes arrive as real input — `isTrusted: true`,
indistinguishable from a person. A Chrome extension can only dispatch synthetic
events from a content script, which do not reliably reproduce native behaviour
such as focus transitions, form submission semantics, or native scrolling. When
the thing being measured is whether a locator found the right element, the click
has to behave the way a user's click would.

**A normal Chrome is not attachable.** Driving an existing Chrome requires a
debugging endpoint, which only exists when Chrome was started with
`--remote-debugging-port`. A Chrome opened from the dock has none, and Chrome
locks its profile directory, so a second process cannot share it.

**Reproducibility.** The study compares the same workflow across strategy and
mutation combinations. That comparison only holds if every run starts from
identical state. A reused tab carries cookies, `localStorage`, scroll position,
and whatever the previous run left behind. If run 3 inherits state from run 2,
a failure cannot be attributed to the mutation, and attribution is the whole
experiment.

---

## `chromium` — the default, and the only mode for data collection

Launches a new browser with a fresh context, navigates to the workflow's first
`goto` step, and closes when the run ends.

```bash
pnpm --filter @waypoint/runner start
```

Headless by default, because experiment batches run unattended. For demos, make
it visible and slow enough to follow:

```bash
BROWSER_HEADLESS=false BROWSER_SLOW_MO=400 BROWSER_KEEP_OPEN_MS=4000 \
  pnpm --filter @waypoint/runner start
```

| Variable | Default | Notes |
| --- | --- | --- |
| `BROWSER_HEADLESS` | `true` | `false` opens a visible window |
| `BROWSER_SLOW_MO` | `0` | ms delay per action; use ~400 to watch |
| `BROWSER_KEEP_OPEN_MS` | `0` | hold the window open after the run; without it the browser closes instantly and the run looks like it never happened |

## `cdp` — attach to a browser you already have open

Drives the tab you are already looking at, instead of opening its own window.
Useful for demonstrating against a page whose state you set up by hand.

Start Chrome with a debugging port. Use a separate profile directory so your
normal browsing profile is untouched:

```bash
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --remote-debugging-port=9222 \
  --user-data-dir=/tmp/waypoint-cdp-profile \
  --no-first-run --no-default-browser-check
```

Then point the runner at it:

```bash
BROWSER_ENGINE=cdp BROWSER_CDP_ENDPOINT=http://localhost:9222 \
  BROWSER_SLOW_MO=300 pnpm --filter @waypoint/runner start
```

The runner prints a warning on boot in this mode. That is deliberate: a run here
still reports success, so nothing else would tell you the data is unusable.

Behaviour differs from `chromium` in two ways worth knowing:

- It adopts the existing context and tab rather than creating new ones, so a
  workflow's leading `goto` navigates the tab you were on.
- On teardown it disconnects without closing anything. Closing a browser the
  runner did not launch would take the user's real tabs with it.

### Version compatibility

Verified working against **Chrome for Testing 153** (the build Playwright
installs). Attaching to **Chrome 154 stable failed** with:

```
Protocol error (Browser.setDownloadBehavior): Browser context management is not supported
```

This is a handshake incompatibility between Playwright's `connectOverCDP` and
that Chrome build, not a configuration error — the endpoint connects and is then
rejected. If you hit it, attach to the Playwright-installed browser instead:

```bash
~/Library/Caches/ms-playwright/chromium-1243/chrome-mac-arm64/"Google Chrome for Testing.app"/Contents/MacOS/"Google Chrome for Testing" \
  --remote-debugging-port=9222 --user-data-dir=/tmp/waypoint-cdp-profile
```

## `noop` — no browser at all

Every step reports success immediately. Useful only for exercising run
orchestration, persistence, and the HTTP surface without the cost of a browser.

The tell that a run used `noop` is that every step has `resolvedLocator` unset.
A real browser run records which strategy actually matched.

---

Before collecting experiment data, read
[EXPERIMENT-INTEGRITY.md](EXPERIMENT-INTEGRITY.md). It lists every setting and
known defect that has to be in the right state first.

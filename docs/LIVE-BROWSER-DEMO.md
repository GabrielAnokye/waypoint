# Replay your existing recording on a mutated page in the app

## Why Runner 409 occurred

Your original recording starts at a local file URL. When another tab such as
Gemini or an HTTP mutation page is selected, the old replay tries to navigate
that tab back into the recorded local file. That file transition is blocked.
The configured debugging endpoint also was not running on port 9222.

The app now has explicit **Replay options** above the workflow list:

- **Use selected page for the starting URL**: use the matching page you have open
  for this run's first enabled Go to step. Your saved recording, actions,
  locators and capture snapshots stay unchanged. Later navigation steps retain
  their recorded destinations. Unrelated active websites are rejected.
- **Enable self-healing**: try weighted recovery if the locator chain fails;
  uncertain matches halt without an action.
- **Reload selected tab before attached replay**: leave off for manual DevTools
  edits. A reload discards manual edits. Server-generated mutations survive
  reloads because their query parameters remain in the URL.

## Start the app (three terminals when it is not already running)

From `/Users/gabrielanokye/Senior Seminar/waypoint`:

```bash
pnpm build
pnpm serve:mutations
```

In the second terminal:

```bash
BROWSER_HEADLESS=false BROWSER_SLOW_MO=200 pnpm --filter @waypoint/runner start
```

In the third:

```bash
pnpm chrome:debug "http://127.0.0.1:8080/ambiguous.html?mutation=layout&seed=demo"
```

The debugging command loads the built Waypoint extension into the dedicated
Chrome for Testing profile and exposes CDP on 9222. Keep that browser open.
Use its Extensions menu to open Waypoint. Your normal Chrome window can remain
open, but Run in open browser needs the extension and selected page in the
browser exposing that CDP endpoint.

If using an already open Chrome instance after a rebuild, reload Waypoint from
chrome://extensions, then reopen the side panel to load the new controls.

## A. Run your existing events on a layout mutation

1. In **Google Chrome for Testing**, select this actual webpage tab:
   `http://127.0.0.1:8080/ambiguous.html?mutation=layout&seed=demo`.
2. Open the **Waypoint** side panel in that same browser window.
3. Check **Use selected page for the starting URL**.
4. Check **Enable self-healing** if you want recovery available.
5. Leave **Reload selected tab before attached replay** unchecked.
6. Find **LIVE — your recording on a mutated page** and click
   **Run in open browser**.

That workflow is a copy of Recording 1:50:41 PM. All 44 original steps and their
capture metadata are identical; the original recording has not been edited.
The selected-page option overrides only the starting URL for this run. The
browser should remain on the URL containing mutation=layout rather than opening
the recorded file. Layout drift often survives through semantic/structural
locators, so a successful run does not necessarily need a healing attempt.

Select the fixture tab before pressing Run. A panel opened beside Gemini or
another unrelated page is not selecting the fixture; the new matching-page
check refuses that situation instead of sending recorded actions there.

## B. Show an autonomous repair

1. Open/select:
   `http://127.0.0.1:8080/forms.html?mutation=attribute&seed=demo`.
2. Check **Use selected page for the starting URL** and **Enable self-healing**.
3. Click **Run in open browser** on **DEMO — automatic repair (Sign in)**.
4. Open that card's completed recent run. Expand the repaired wait/click step.

The demo uses a frozen baseline Sign in capture with test-ID locators. Attribute
mutation renames the test ID, so that family fails. The healer can still identify
the uniquely named Sign in button from the captured features. Expanded steps
show the healing outcome, score, ambiguity margin, latency and top candidates.
Scores depend slightly on viewport geometry; the margin should comfortably
exceed .15. Clicking the correct button is separate from the form's required-field
validation; this demo does not claim a completed login.

The demo is separate from your 44-step recording so it does not alter your saved
locator choices. With full normal locator chains, another healthy fallback may
resolve the target before healing is needed.

## C. Show safe refusal on identical Delete buttons

1. Open/select:
   `http://127.0.0.1:8080/ambiguous.html?mutation=cosmetic,structural&seed=demo`.
2. Check the selected-page and self-healing options.
3. Run **LIVE — your recording on a mutated page** in the open browser.
4. Open the completed recent run and expand the halted step.

The three Delete buttons retain identical names. Structural/cosmetic mutations
break the recorded structural fallbacks. If the highest two healing scores are
less than .15 apart, the correct result is **Manual review required — this step was not executed**, with three ranked candidates. This may halt on an inferred wait
step before the click. It is a safe refusal, not a wrong-target click.

## Existing-editor alternative

You can also click **Duplicate → Edit**, expand the first **Go to** step, replace
its file URL with the full mutated HTTP URL, and **Save**. Then run that copy.
This is useful if you want the mutation URL stored in the workflow itself.
For a recording with additional Go to or New tab URLs, inspect those too: the
selected-page option changes only the first enabled Go to, not every navigation.

## Verification

- 258 unit/integration tests, including unchanged-recording and unrelated-tab
  protection cases.
- Typecheck, lint and build pass.
- Browser regression coverage includes the file-to-HTTP selected-page override,
  preserved mutation URL, three actual trusted correct clicks, unchanged saved
  recording, and no-click manual healing on the mutated page.
- The isolated benchmark/scorer and previously published results are unchanged.

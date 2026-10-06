# Experiment integrity register

Things that are convenient for demos but invalid for measurement, and defects
that would corrupt results if data were collected before they are fixed.

**Why this file exists.** Every entry below has the same shape: the system
reports success, and nothing in the output tells you the number is wrong. A run
in `cdp` mode succeeds. A coordinate click on empty space succeeds. A `noop` run
succeeds. The failure mode of this project is not a crash, it is a plausible
number. This register is the checklist that stands between a demo setting left
on and a published result that is quietly false.

---

## 1. Settings that must be reverted before collecting data

| Setting | Demo value | Required for collection | Why it invalidates data |
| --- | --- | --- | --- |
| `BROWSER_ENGINE` | `cdp` or `noop` | **`chromium`** | `cdp` inherits the attached browser's cookies, storage, scroll position and other extensions, so runs are not reproducible and a failure cannot be attributed to the mutation. `noop` never touches a page and reports success unconditionally. |
| `BROWSER_HEADLESS` | `false` | `true` | Not strictly invalid, but a visible window is slower and subject to OS focus and window-size effects. Keep batches headless so viewport is deterministic. |
| `BROWSER_SLOW_MO` | `300`–`400` | `0` | Inflates per-step latency, which is one of the dependent measures. Any timing result collected with slow motion on is meaningless. |
| `BROWSER_KEEP_OPEN_MS` | `4000` | `0` | Adds fixed wall-clock time per run. Harmless to correctness, ruinous to a throughput or latency figure. |

Recording source matters too. Record fixtures over `http://localhost:8080`
(`pnpm serve:fixtures`) rather than `file://`. Both work, but the mutation
engine will serve mutated variants over HTTP, and keeping record and playback on
the same origin semantics removes a difference you would otherwise have to
control for.

## 2. Known defects that must be fixed before collecting data

Ordered by how badly each would distort the headline result.

### 2.1 Coordinate clicks on empty space report success — **blocking**

`executeCoordinateClick` guards with `if (!hitInfo) throw`, but
`document.elementFromPoint` returns `null` only when the point is outside the
viewport. A point over empty page background returns `<body>`, which passes the
guard, so the click "succeeds" having hit nothing.

Measured behaviour:

```
(160,70)    on the button           -> BUTTON
(600,500)   empty space in viewport -> BODY     <- passes the guard
(5000,5000) outside viewport        -> NULL
```

Consequence: after a layout-shift mutation, a coordinate that now lands on
background still scores as a success, so coordinate robustness is over-reported.
This is the same class of defect as the original `page.locator('html')` stub,
narrowed rather than removed.

The fix is already computed and unused: the evaluate block returns
`isInteractive`, and nothing reads it. Reject the step when the element at the
point is not interactive.

### 2.2 No ground-truth comparison — **blocking for repair metrics**

Fixtures now carry `data-truth-id` on every interactive element (177 across 8
pages), and `executeCoordinateClick` already reads it into `hitInfo`. Nothing
compares it to the identity recorded at capture time, and the result type has no
field to carry it.

Until that comparison exists, "incorrect repair" cannot be computed at all, and
a repair algorithm could score 100% recovery by resolving to any element it
happens to find. Success rate is measurable now; repair correctness is not.

### 2.3 Coordinate capture is conditional and off-centre — **blocking for the coordinate arm**

The recorder emits a coordinate locator only when no other strategy produced
anything, so a well-labelled element records no coordinate at all and the
coordinate family has nothing to measure. It also records
`rect.x, rect.y` — the element's top-left corner, not a point inside it — which
for a rounded or padded control can land outside the element.

Needs: capture unconditionally, at the element centre, with scroll offset and
viewport size recorded alongside, since a viewport-relative point is meaningless
without them.

### 2.4 `testId` is classified as intent-based — **distorts the headline finding**

The compiler scores `testId` 90 against `label` 80, so it promotes test ids to
primary wherever they exist. Fixture attribute counts:

| Attribute | Occurrences |
| --- | --- |
| `data-testid` | 157 |
| `role="..."` | 13 |
| `aria-label` | 3 |

With test ids on nearly every element and no mutation class touching them, the
intent family wins overwhelmingly — but the real finding would be "`data-testid`
is stable because we never change it", which is circular. A test id is also a
contract a developer added *for automation*, categorically unlike a role or an
accessible name that describes what an element means to a user.

Agreed resolution: report `testId` as its own "test-contract" family, separate
from semantic intent (`role`, `label`, `text`, `placeholder`).

### 2.5 Fixture corpus is uniformly well-instrumented — **limits external validity**

All 8 fixtures are heavily attributed. Pages where automation actually breaks —
`<div onclick>` soup, no labels, no test ids — are not represented. Needs
ARIA-rich and ARIA-poor variants so the corpus spans the range, otherwise
results generalise only to unusually well-built pages.

## 3. Pre-collection checklist

Run through this before any batch whose numbers will appear in the paper.

- [ ] 2.1 coordinate interactivity guard fixed
- [ ] 2.2 ground-truth comparison wired end to end
- [ ] 2.3 coordinate capture unconditional and centre-based
- [ ] 2.4 `testId` split into its own family
- [ ] 2.5 ARIA-rich and ARIA-poor fixtures added
- [ ] `BROWSER_ENGINE=chromium`, confirmed in the runner's boot line
- [ ] `BROWSER_SLOW_MO=0` and `BROWSER_KEEP_OPEN_MS=0`
- [ ] Fixtures served over HTTP, not opened as `file://`
- [ ] A pilot run inspected by hand: `resolvedLocator` populated on every
      interactive step, and the strategies that won are plausible for the page

The last item catches the `noop` case, which is otherwise indistinguishable from
a successful run in the summary output.

## 4. Recommended hardening

The register above is a document, and documents get skipped. The robust version
is to make the data carry its own provenance: stamp `BROWSER_ENGINE`,
`BROWSER_SLOW_MO`, headless state, and the fixture base URL into each run's
`metadata`, then have the analysis step refuse runs that were not collected
under valid conditions.

That converts "remember to check" into "cannot silently publish a demo run",
which is the only version that survives a deadline. Not yet implemented.

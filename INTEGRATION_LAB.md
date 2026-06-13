# Lab Tab — Single-File Architecture (v4.1.0)

The Lab tab (Professor's Lab, Patent Office, Dark Matter Reactor, Crew
Wisdom, and the 4 Dark Matter widgets) is now **one file: `lab.js`**.

## What changed

Previously the Lab tab was assembled from 6 files:

```
lab.js              — invention generation, Patent Office, DM reactor, Crew Wisdom
widgets-shared.js   — WidgetState (Dark Matter transactions, tier/collection storage)
alphabet-widget.js  — Aurebesh Relay
archive-widget.js   — Expedition Log
smelloscope-widget.js — Smell-O-Scope™
slurm-widget.js     — Beverage Machine
```

`sidepanel.js` imported the 5 widget modules as ES modules and rendered
them via a local `_renderLabWidgets()` function into a container selected
by `.lab-widgets-container` — **a class that doesn't exist in
`sidepanel.html`** (the real mount point is `.lab-widgets-mount`). That
selector mismatch meant `_renderLabWidgets()` silently found nothing and
returned early every time — this was the root cause of "none of the newer
widgets appear on the Lab page."

## What it looks like now

All 6 files are merged into **`lab.js`** as one self-contained
`<script type="module">`. `WidgetState` and the 4 widget objects
(`AlphabetWidget`, `ArchiveWidget`, `SmellscopeWidget`, `SlurmWidget`) are
internal consts in `lab.js` — no imports/exports between them and no
separate files to keep in sync.

```
extension/
  ├── lab.js          ← everything Lab-related lives here now
  └── sidepanel.js    ← no longer imports any widget files
```

### `sidepanel.html`

No changes needed beyond what's already in place — the mount point was
already correct:

```html
<!-- inside #panel-lab, after the Crew Wisdom card -->
<div class="lab-widgets-mount" style="display:contents"></div>
```

Both scripts are loaded as separate modules, same as before:

```html
<script type="module" src="sidepanel.js"></script>
<script type="module" src="lab.js"></script>
```

### `sidepanel.js`

The Lab tab click handler now calls the new export instead of the removed
local function:

```js
if (id === "lab") {
  window.LabModule?.startLabWidgets();
  window.LabModule?.renderPatentOffice();
  await window.LabModule?.renderDarkMatterWidgets();
}
```

### `lab.js` — new export

```js
window.LabModule = {
  initWidget,
  renderPatentOffice,
  refreshInventBtn,
  startLabWidgets,
  renderDarkMatterWidgets,   // ← new
};
```

`renderDarkMatterWidgets()` renders all 4 widgets (Alphabet → Archive →
Smelloscope → Slurm) into `.lab-widgets-mount`, each wrapped in try/catch
so one widget's error can't blank the other three.

## Dark Matter bridge

All Dark Matter reads/writes — both the invention system and the 4
widgets — go through the same three functions, defined once in `lab.js`
and exposed on `window`:

```js
window.getDarkMatter()
window.spendDarkMatter(amount, label)
window.earnDarkMatter(amount, label)
```

These wrap `chrome.runtime.sendMessage({ type: "dm_get" | "dm_spend" | "dm_earn" })`,
backed by the single Dark Matter ledger in `background.js`.

## Other fixes bundled into this `lab.js`

- **Aurebesh Relay** (`AlphabetWidget`) was missing its outer closing
  `</div>` — every other widget rendered *inside* it once concatenated.
  Fixed.
- **Generate Invention** / **Discuss with Crew** buttons were never
  wired with `addEventListener` — fixed.
- **Sniff for Lore** (Smelloscope) and **Beverage Machine** spin results
  were wiped immediately by `renderSectionInPlace()` — both now persist
  `_lastResult` across re-renders.

## Reverting to separate files

If you need to split this back up later, each section is clearly
delimited with a banner comment (`// ── widgets-shared.js ──`, etc.) — cut
along those boundaries, re-add `import`/`export` statements, and restore
the 5 imports + `_renderLabWidgets()` call in `sidepanel.js`.

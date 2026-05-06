# Automated screenshot pipeline

Reproducible app-store screenshots driven by Playwright + a single seed dataset.

## Quick start

```bash
# Capture everything (all viewports × all scenarios that apply to that platform)
npm run screenshots

# Or split:
npm run screenshots:capture          # full matrix
npm run screenshots:capture:desktop  # desktopMaster only
npm run screenshots:capture:mobile   # iPhone/iPad/Android viewports only
npm run screenshots:build            # rebuild dist/ layout from existing masters

# One group while iterating (pattern matches `desktop dark|light|catppuccin` etc.)
npx playwright test --config e2e/playwright.store-screenshots.config.ts \
  --project=desktopMaster --grep "desktop dark \(en\)"
```

## Environment overrides

| Var | Effect |
| --- | --- |
| `SCREENSHOT_MODE=electron` | Switches the fixture to the Electron pipeline (set by `screenshots:capture:electron`). |
| `SCREENSHOT_BASE_DATE=2026-05-06T09:30:00` | Pin the "today" anchor used by the seed builder. Default is a Wednesday well clear of midnight in CI timezones. |
| `SP_SCREENSHOT_BG_DARK_URL` / `SP_SCREENSHOT_BG_LIGHT_URL` | Override the default Unsplash backgrounds (e.g. point to a vendored asset for offline / privacy-sensitive runs). |
| `SP_SCREENSHOT_BG_DISABLE=1` | Drop background images entirely. |

Master captures land in `.tmp/screenshots/_master/<viewport>/<locale>/<theme>/<scenario>/<name>.png`.
Per-store assets land in `dist/screenshots/<store>/<locale>/NN-name.png` (and the F-Droid `fastlane/...` layout).

## Scenario lineup

| Slot | Platform | Theme | What it shows |
| ---- | -------- | ----- | ------------- |
| mobile-01 | mobile | dark | Planner |
| mobile-02 | mobile | dark | Planner with calendar nav expanded |
| mobile-03 | mobile | dark | Eisenhower matrix board |
| mobile-04 | mobile | light | Planner expanded (light variant) |
| mobile-05 | mobile | dark | Schedule view |
| mobile-06 | mobile | dark | Today task list |
| desktop-01 | desktop | dark | Today + schedule day-panel open |
| desktop-02 | desktop | dark | Eisenhower matrix board |
| desktop-03 | desktop | dark | Schedule view |
| desktop-04 | desktop | light | Project (Work) + notes panel populated |
| desktop-05 | desktop | dark | Focus mode |
| desktop-06 | desktop | light | Schedule (light variant) |
| desktop-07 | desktop | catppuccin-mocha | Today list with custom theme |

Specs at `scenarios/<platform>/NN-name.spec.ts`. Each spec calls `onlyOn(testInfo, '<platform>')` to skip when running under the wrong viewport class. Each spec runs once per locale (en + de).

## Files

| Path | Purpose |
| ---- | ------- |
| `matrix.ts` | Locales, themes, viewports, mobile/desktop classification, store rules |
| `seed/seed.template.json` | Curated dataset with date offsets and `@@PLANNER_OFFSET_+N` placeholders |
| `seed/build-seed.ts` | Materializes offsets to absolute dates, injects `locale` + `customTheme` |
| `fixture.ts` | Pins clock, applies dark-mode, imports seed via UI flow, exposes `screenshotMaster` |
| `helpers.ts` | `onlyOn`, `gotoAndSettle`, `openNotesPanel`, `openSchedulePanel` |
| `scenarios/mobile/*.spec.ts` | 6 mobile slots |
| `scenarios/desktop/*.spec.ts` | 7 desktop slots |
| `build-store-assets.ts` | Renames + copies masters into per-store directory layouts |
| `../playwright.store-screenshots.config.ts` | Separate Playwright config; one project per viewport |

## How it works

1. **Per-test seed file** is materialized to `.tmp/screenshot-seeds/seed-<date>-<locale>[-<customTheme>].json`.
2. **Fixture** boots the app with `page.clock.install({ time: SCREENSHOT_BASE_DATE })`, sets `localStorage.DARK_MODE`, pins browser context to `en-US` (so `ImportPage`'s English text matchers always work), then imports the seed via `BackupService.importCompleteBackup`. Locale flows through `globalConfig.localization.lng` → `applyLanguageFromState$` effect. Custom themes flow through `globalConfig.misc.customTheme`.
3. **Each scenario spec** drives the app to a state and calls `screenshotMaster(scenario, name)`. The Playwright project name (e.g. `desktopMaster`) determines the viewport.
4. **Post-processor** copies masters into per-store layouts. No resizing — captures are already at native size for each store.

## Adding a scenario

```ts
// scenarios/desktop/08-new-thing.spec.ts
import { test } from '../../fixture';
import { LOCALES } from '../../matrix';
import { gotoAndSettle, onlyOn } from '../../helpers';

for (const locale of LOCALES) {
  test.describe(`@screenshot desktop-08-new-thing (${locale})`, () => {
    test.use({ locale, theme: 'dark' });

    test('new thing', async ({ seededPage, screenshotMaster }, testInfo) => {
      onlyOn(testInfo, 'desktop');
      await gotoAndSettle(seededPage, '/#/whatever');
      await seededPage.locator('whatever-component').waitFor();
      await screenshotMaster('desktop-08-new-thing', 'new-thing');
    });
  });
}
```

## Per-store gotchas

- **MS Store** reserves bottom 1/4 for system-rendered captions → keep critical UI in top 3/4.
- **Mac App Store** rejects letterboxed 16:9 in 16:10 frames — capture native 2880×1800.
- **Snap** caps at 5 items, ≤2 MB each, single global gallery (no per-locale). Pipeline emits all desktops; **trim manually before Snap upload**.
- **Play / Apple** explicitly forbid / discourage device frames.
- **Apple** requires only iPhone 6.9" (1290×2796) and iPad 13" (2064×2752); smaller sizes auto-derive.
- **Flathub** requires native window chrome and forbids overlays — needs the Electron capture path (follow-up; not yet implemented).

## Electron pipeline (Mac App Store, Flathub)

Web Chromium captures don't look "native" on macOS — wrong fonts, wrong scrollbars, no traffic-lights. Flathub explicitly *requires* native window chrome. So there's a parallel pipeline that runs the actual SP Electron build via Playwright's `_electron` API and captures via OS-level region tools (`screencapture` on macOS, `grim`/`import` on Linux).

```bash
# Run the Electron-mode pipeline. Builds Electron first, then captures.
# Outputs land in .tmp/screenshots/_master_electron/.
npm run screenshots:capture:electron
```

Same scenarios, same fixture file — `store-screenshots/fixture.ts` branches on the `SCREENSHOT_MODE` env var (the npm script sets it). Each desktop spec runs unchanged in either mode.

The OS-level capture grabs the full window rect including titlebar, shadow, and traffic-lights / GTK decoration. Bounds come from `BrowserWindow.getBounds()`; on macOS Retina, 1440×900 points capture as 2880×1800 px. On Linux X11/Wayland bounds == pixels.

Per-OS tooling (must be on PATH):
- **macOS** — `screencapture` (built-in)
- **Linux X11** — ImageMagick (`apt install imagemagick`, ships `import`)
- **Linux Wayland** — `grim` (`apt install grim`, wlroots-based compositors only)

The Mac App Store store rule has `masterDir: 'electron'` in `STORE_RULES`, so the post-processor pulls those captures into `dist/screenshots/macappstore/`. All other stores still come from the web pipeline.

## Status

- ✅ Foundation: matrix, seed builder, fixture (web + electron modes), helpers, post-processor
- ✅ 13 scenarios (6 mobile + 7 desktop) covering planner, boards, schedule, focus, notes, custom theme
- ✅ Electron-mode pipeline with OS-level chrome capture (`screencapture` / `grim` / `import`)
- ✅ Mac App Store wired to source from `_master_electron/`
- ⏳ Smoke-test the Electron pipeline on a real Mac (or Linux X11 for plumbing)
- ⏳ Flathub-specific Electron capture (Linux X11/Wayland host) — currently the Linux Electron capture works but isn't wired into a `flathub` STORE_RULE
- ⏳ Snap 2 MB compression (defer until any output exceeds the limit)

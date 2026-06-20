# Android edge-to-edge + soft keyboard (IME)

Why the global add-task bar sits above the keyboard, and how the pieces fit.
Read this before touching anything keyboard/IME-related on Android — this area
has regressed three times (#8295, then #8508's white gap + reversed typing).

## How the bar is positioned

The global add-task bar is `position: fixed` and lifted off the bottom by a CSS
variable only:

```scss
// add-task-bar.component.scss
:host-context(.isTouchOnly).global {
  bottom: calc(var(--keyboard-height) + var(--s2));
}
```

`--keyboard-height` defaults to `0px`. On Android/web it is set by
`GlobalThemeService._initVisualViewportKeyboardTracking()` from
`obscured = window.innerHeight - visualViewport.height`. On iOS the Capacitor
Keyboard plugin sets it.

So the bar only floats above the keyboard if **either** the WebView shrinks
(then `bottom: 0` is already above the IME) **or** the visual viewport shrinks
(then `--keyboard-height` lifts the bar). If neither happens, the bar sits
behind the keyboard.

## The trap: targetSdk 35+ / edge-to-edge

On `targetSdkVersion >= 35` (we are on 36, Android 16) edge-to-edge is
**mandatory** and `android:windowSoftInputMode="adjustResize"` is a **no-op for
the IME** — the system no longer resizes the window when the keyboard opens.
`android:windowOptOutEdgeToEdgeEnforcement` only exists on API 35 (see
`res/values-v35/styles.xml`) and is ignored on API 36, so there is no opt-out.

Under enforced edge-to-edge the **only** thing that can shrink the WebView for
the IME is `@capawesome/capacitor-android-edge-to-edge-support`, which applies
the IME inset as the WebView's bottom margin via a single
`OnApplyWindowInsetsListener`.

## The plugin bug (fixed via patch-package)

`EdgeToEdge.applyInsetsInternal()` ships with:

```java
// When keyboard is visible, don't apply bottom margin to avoid double-counting
// (the system already resizes the window for the keyboard)
int bottomMargin = keyboardVisible ? 0 : Math.max(imeInsets.bottom, systemBarsInsets.bottom);
```

That comment's premise — _"the system already resizes the window"_ — is false on
Android 16. When the keyboard opens the plugin sets `bottomMargin = 0`, the
WebView stays full height, nothing resizes, and the fixed add-task bar ends up
behind the IME.

### The naive fix that broke typing (#8508)

The first patch simply dropped the `keyboardVisible ? 0` case so the inset is
**always** applied:

```java
int bottomMargin = Math.max(imeInsets.bottom, systemBarsInsets.bottom);
```

It fixed positioning on Android 16 but shipped two new bugs (#8508):

1. **Double-count on API ≤35.** The premise "an edge-to-edge window never
   resizes for the IME" is only true at API 36+. On API ≤34, and on API 35 (we
   opt out via `windowOptOutEdgeToEdgeEnforcement` in `values-v35`), the system
   _does_ resize for the IME. Adding our inset on top → the WebView shrinks twice
   → a keyboard-height **blank white gap** above the keyboard.
2. **Reversed / invisible typing on API 36+.** `applyInsetsInternal` runs from a
   per-inset `OnApplyWindowInsetsListener` and ends in an unconditional
   `view.setLayoutParams()` (= `requestLayout()`). The IME inset fluctuates
   _during typing_ (suggestion strip, layout switches), so the WebView relayouts
   mid-IME-composition — resetting the composing region and reversing characters.

### The corrected patch

`patches/@capawesome+...8.0.8.patch` now does three things:

1. **Gate the inset to API 36+** (`Build.VERSION.SDK_INT >= 36`). Below that the
   system resizes for the IME, so we keep the original `keyboardVisible ? 0` — no
   double-count, no gap. (This alone fixes #8508 on API ≤35 devices.)
2. **Latch the keyboard inset** while the keyboard stays visible, so inset
   fluctuations don't relayout the WebView mid-composition. Reset on hide.
3. **Skip the relayout when no margin changed** (`setLayoutParams` always calls
   `requestLayout`).

Verified: the white gap is gone on API 34. The API 36+ typing half needs a real
device (headless/old emulators don't reproduce the IME composition reset).

Apply via `npm install` (runs `patch-package` in `postinstall`). Upstream this
to the plugin so the patch can be dropped. If the latch leaves a small gap when
the suggestion strip appears _after_ the keyboard, switch latch-first → latch-max.

## What NOT to do

Do not stack a second/third keyboard-height source on top of the VisualViewport
signal (native physical-px height + a `baseInnerHeight`-tracking path combined as
`max(obscured, nativeKeyboardHeight - layoutShrink)`). That was #8295; the
sources race on separate async events, the baseline gets reset to the shrunk
`innerHeight` mid-animation, the double-count guard collapses, and the bar is
mispositioned. It was reverted. Fix the inset at the source (the WebView size),
not with JS heuristics layered on top.

## Device test matrix (required before merging IME changes)

Heuristic stacking looks fine on one device and breaks on another — test the
add-task bar opening the keyboard, and content resizing, on:

- Android 10 (API 29) — pre-edge-to-edge; `Type.ime()` insets are unreliable here
- Android 14 (API 34) — edge-to-edge opt-out still possible
- Android 15 (API 35) — edge-to-edge enforced, `windowOptOutEdgeToEdgeEnforcement` honored
- Android 16 (API 36) — edge-to-edge mandatory, no opt-out (our target)

Both gesture-nav and 3-button-nav, light and dark.

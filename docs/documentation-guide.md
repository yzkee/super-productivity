# Documentation Guide

Rules and conventions for keeping Super Productivity's documentation in sync with the code.

## Why this matters

The `docs/wiki/` directory is the manually curated, human-focused wiki that ships to the [GitHub Wiki](https://github.com/super-productivity/super-productivity/wiki) via CI. It is intentionally separate from the auto-generated [DeepWiki](https://deepwiki.com/super-productivity/super-productivity), which describes code mechanics. The wiki is what users read for context, intent, and how features fit together — so keeping it in sync with the code is part of the change, not a follow-up.

See the README's "Documentation: Manual versus Automated" section for the broader rationale.

## When to update the wiki

**When user-facing functionality changes, update `docs/wiki/` in the same PR.** Common cases and their target notes:

| Change                                                               | Note to edit                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| New/changed/removed setting, preference, or config option            | `3.02-Settings-and-Preferences.md`                                             |
| Added/changed/removed keyboard shortcut                              | `3.03-Keyboard-Shortcuts.md`                                                   |
| Short-syntax additions or changes                                    | `3.04-Short-Syntax.md`                                                         |
| New or changed REST / Plugin / Sync API surface                      | `3.01-API.md`                                                                  |
| New issue or sync provider, or behavior change in an existing one    | `3.07-Issue-Integration-Comparison.md` / `3.08-Sync-Integration-Comparison.md` |
| User data shape, storage location, or backup/import behavior changes | `3.06-User-Data.md`                                                            |
| New theming hook or theme variable change                            | `3.09-Theming.md`                                                              |
| Web vs desktop capability differences                                | `3.05-Web-App-vs-Desktop.md`                                                   |

If a change does not map to any of the above and is purely internal (refactor, test, perf, build), no wiki update is needed.

## How to write wiki content

**Read [`docs/wiki/0.00-Wiki-Structure-and-Organization.md`](wiki/0.00-Wiki-Structure-and-Organization.md) before editing.** It defines the four note categories (Quickstarts, How-To, Reference, Concepts), the numbering scheme, and the writing style for each. The wiki follows the [Diátaxis](https://diataxis.fr/) framework, and each category links out to specific writing guidelines.

For Reference notes (`3.XX`) in particular:

- **Do nothing but describe.** References explain accurately and comprehensively — they don't teach, persuade, or narrate.
- **Be accurate.** Verify against the current code; do not copy stale claims forward.
- **Provide examples** where they aid understanding without distracting from the description.
- **Mirror the product's structure.** Documentation should help readers make sense of the product, not impose a foreign structure on it.
- **Be consistent** in structure, language, terminology, and tone with the surrounding notes.

## Default to Reference notes (`3.XX`)

Reference notes are mechanical descriptions of what exists (settings, shortcuts, APIs, data shapes, comparisons). They are the safest target for code-driven updates. The other categories are more human-authored and should be touched with care:

- **Quickstarts (`1.XX`)** — teaching/onboarding narratives. Don't rewrite voice or restructure on your own.
- **How-To (`2.XX`)** — task recipes with assumed audience and tone. Update steps if a workflow genuinely changed; don't expand scope.
- **Concepts (`4.XX`)** — explanatory background and design rationale. Touch only with strong evidence; flag rather than rewrite.

If a change clearly affects a non-Reference note (e.g. a How-To step is now wrong because the UI moved), make the minimal correction needed and call it out in the PR description so a human can review the prose. If unsure which note to edit, or whether a change warrants a wiki update at all, ask before writing.

## Wiki linting and quality

Wiki notes are linted in CI before being synced to GitHub Wiki. See [`docs/wiki/0.02-Wiki-QA-and-Maintenance.md`](wiki/0.02-Wiki-QA-and-Maintenance.md) for linting rules and link-checking, and [`docs/wiki/0.01-Style-Guide.md`](wiki/0.01-Style-Guide.md) for markdown and formatting conventions.

## Developer-facing docs

The wiki is for end users. Developer-facing docs live at the top level of `docs/` and follow the same "update alongside the code" rule when their subject changes:

- [`docs/styling-guide.md`](styling-guide.md) — design system, CSS variables, theme tokens.
- [`docs/sync-and-op-log/`](sync-and-op-log/) — operation log, vector clocks, sync architecture.
- [`docs/plugin-development.md`](plugin-development.md) — plugin authoring guide.
- [`ARCHITECTURE-DECISIONS.md`](../ARCHITECTURE-DECISIONS.md) — load-bearing architectural decisions and their rationale.

For all current downloads, package links, and platform-specific notes: [check the wiki](https://github.com/super-productivity/super-productivity/wiki/2.01-Downloads-and-Install).

## Features

- Added global wallpapers with per-context overrides.
- Expanded Plainspace collaboration: create tasks directly, discover and connect more easily, open shared projects in Plainspace, and poll for new tasks by default.
- Desktop users can now be notified about new releases.
- Added ISO 8601 date formatting and updated Swedish and Romanian translations.
- Focus Mode preparation is now optional, with smoother starts and a repeating break-end sound.
- Added clearer overdue and scheduling-conflict indicators, reminder actions, and Later Today calendar details.
- Added plugin OAuth hooks, local-only secret storage, persistent execution consent, and issue-panel integration.
- Added global shortcut triggers through `superproductivity://` URLs.

## Fixes

- Improved sync safety, encryption prompts, conflict notices, upload verification, and OneDrive and Nextcloud setup feedback.
- Fixed task schedules being lost when moving between the backlog and regular list.
- Fixed adding subtasks from the Planner and parsing short syntax for inline subtasks.
- Fixed dismissed reminders reopening repeatedly and improved notification-action handling.
- Fixed task notes briefly showing raw Markdown and duplicate note views in Focus Mode.
- Fixed CalDAV WebDAV requests on Android and several Android keyboard and status-bar issues.
- Fixed file links containing special characters on Windows, clipboard images, and dropped files.
- Fixed blank task detail panels and improved keyboard focus visibility for subtasks.
- Prevented hangs or crashes when restoring large data stores.
- Improved GitLab project identifier validation and automatic issue imports.
- Fixed plugin execution in packaged apps and made denied execution consent re-enableable.

## Security

- Prevented plaintext operations from being sent through providers that require end-to-end encryption.
- Blocked executable launches through desktop file opening and removed the execution IPC associated with GHSA-256q.

## Performance

- Improved restore reconciliation performance for large data stores.

// Post-pack hook for Linux builds.
//
// Renames the main Electron binary to `superproductivity-bin` and installs
// a shell wrapper at the original name. The wrapper forces
// --ozone-platform=x11 when running in a Snap sandbox on a Wayland session;
// non-Snap launches (AppImage, .deb, .rpm) and X11 sessions hit a no-op
// passthrough, so behavior for those targets is unchanged.
//
// Context: field reports on issue #7270 (v18.2.4/v18.2.5) show that
// app.commandLine.appendSwitch('ozone-platform','x11') from inside the
// main process is not equivalent to passing the flag on argv — Chromium's
// Ozone init in the browser process dlopens libEGL/libgbm on the core22
// Mesa path before the switch is honored, which segfaults under Mesa ABI
// drift (Ubuntu ≥24.04 host + core22 snap runtime). Injecting the flag
// via argv before Electron starts bypasses this.
//
// Same mechanism used by snapcrafters/signal-desktop and
// snapcrafters/mattermost-desktop. See
// docs/research/snap-wayland-gpu-fix-research.md §18.

const { promises: fs } = require('fs');
const { join } = require('path');

const BIN_NAME = 'superproductivity'; // must match linux.executableName
const RENAMED = 'superproductivity-bin';
const WRAPPER_SRC = join(__dirname, '..', 'build', 'snap-wrapper.sh');

async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const { appOutDir } = context;
  const binPath = join(appOutDir, BIN_NAME);
  const renamedPath = join(appOutDir, RENAMED);

  try {
    await fs.access(binPath);
  } catch {
    console.warn(`[afterPack] ${binPath} not found; skipping wrapper install`);
    return;
  }

  // Idempotent: a second invocation over the same appOutDir must not
  // re-rename the already-installed wrapper back to `-bin`.
  try {
    await fs.access(renamedPath);
    console.log(`[afterPack] ${renamedPath} exists; wrapper already installed`);
    return;
  } catch {
    /* first run */
  }

  await fs.rename(binPath, renamedPath);
  const wrapperContent = await fs.readFile(WRAPPER_SRC, 'utf8');
  await fs.writeFile(binPath, wrapperContent, { mode: 0o755 });
  await fs.chmod(renamedPath, 0o755);

  console.log(
    `[afterPack] Installed argv wrapper: ${BIN_NAME} -> ${RENAMED} + shell wrapper`,
  );
}

module.exports = afterPack;

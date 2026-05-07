/**
 * Per-store layout builder.
 *
 * Reads master captures from `.tmp/screenshots/_master/<viewport>/<locale>/<theme>/<scenario>/<name>.png`
 * and writes per-store directory layouts to `dist/screenshots/`.
 *
 * Captures are made at each store's native pixel size (see playwright.store-screenshots.config.ts),
 * so this is mostly rename + copy — no resizing. Stores with a per-file byte
 * cap (`maxBytes` in STORE_RULES; currently Snap @ 2 MB) get re-encoded as
 * JPEG until they fit; everything else stays lossless PNG.
 *
 * Run: npm run screenshots:build
 */

import * as fs from 'fs';
import * as path from 'path';
import sharp from 'sharp';
import {
  LOCALES,
  MASTER_DIR_ELECTRON,
  MASTER_DIR_WEB,
  STORE_RULES,
  type StoreRule,
} from './matrix';

const OUT_DIR = path.resolve(__dirname, '..', '..', 'dist', 'screenshots');

const masterDirFor = (which: 'web' | 'electron'): string =>
  which === 'electron' ? MASTER_DIR_ELECTRON : MASTER_DIR_WEB;

type ScenarioFile = { scenario: string; file: string; theme: string; absPath: string };

/** Strip leading `(mobile|desktop)-NN-` so output names don't double up on the index. */
const cleanScenarioLabel = (scenario: string): string =>
  scenario.replace(/^(?:(?:mobile|desktop)-)?\d+-/, '');

/**
 * Each scenario locks one theme. List all (theme × scenario) captures present
 * for a given viewport+locale, sorted by scenario name (which encodes slot order
 * via the `<platform>-NN-` prefix).
 */
const listScenariosForVariant = (
  viewport: string,
  locale: string,
  masterRoot: string,
): ScenarioFile[] => {
  const out: ScenarioFile[] = [];
  const localeDir = path.join(masterRoot, viewport, locale);
  if (!fs.existsSync(localeDir)) return out;
  const themes = fs.readdirSync(localeDir).filter((t) => {
    try {
      return fs.statSync(path.join(localeDir, t)).isDirectory();
    } catch {
      return false;
    }
  });
  // Index by scenario so we can sort across themes uniformly.
  const all: ScenarioFile[] = [];
  for (const theme of themes) {
    const themeDir = path.join(localeDir, theme);
    for (const scenario of fs.readdirSync(themeDir)) {
      const dir = path.join(themeDir, scenario);
      if (!fs.statSync(dir).isDirectory()) continue;
      for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith('.png')) continue;
        all.push({ scenario, file, theme, absPath: path.join(dir, file) });
      }
    }
  }
  all.sort((a, b) => a.scenario.localeCompare(b.scenario));
  out.push(...all);
  return out;
};

/**
 * Copy `src` to `target`, then enforce `maxBytes` if set. PNGs that already
 * fit go through unchanged. PNGs that exceed the cap are re-encoded as JPEG
 * at stepped-down quality until they fit; the .png target is replaced with a
 * .jpg sibling. Returns the actual path written.
 */
const writeWithCap = async (
  src: string,
  target: string,
  maxBytes?: number,
): Promise<string> => {
  fs.copyFileSync(src, target);
  if (!maxBytes) return target;
  const initialSize = fs.statSync(target).size;
  if (initialSize <= maxBytes) return target;

  const jpgTarget = target.replace(/\.png$/i, '.jpg');
  const buf = fs.readFileSync(src);
  // Step down quality 90 → 60. If even q60 exceeds the cap (vanishingly rare
  // on screenshots that are mostly UI), bail loudly so the operator notices.
  for (const quality of [90, 85, 80, 75, 70, 65, 60]) {
    const out = await sharp(buf)
      .jpeg({ quality, mozjpeg: true, progressive: true, chromaSubsampling: '4:2:0' })
      .toBuffer();
    if (out.byteLength <= maxBytes) {
      fs.writeFileSync(jpgTarget, out);
      if (jpgTarget !== target) fs.rmSync(target);
      return jpgTarget;
    }
  }
  throw new Error(
    `${path.basename(target)} still > ${maxBytes} bytes at JPEG quality 60 — capture too large`,
  );
};

const writeFastlanePath = async (
  locale: string,
  bucket: NonNullable<StoreRule['fastlaneBucket']>,
  index: number,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const bucketDir = `${bucket}Screenshots`;
  const dir = path.join(
    OUT_DIR,
    'fdroid',
    'fastlane',
    'metadata',
    'android',
    locale,
    'images',
    bucketDir,
  );
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${index + 1}.png`);
  return writeWithCap(src, target, maxBytes);
};

const writePerLocale = async (
  store: string,
  locale: string,
  index: number,
  scenario: string,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const dir = path.join(OUT_DIR, store, locale);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  return writeWithCap(src, target, maxBytes);
};

const writeGlobal = async (
  store: string,
  index: number,
  scenario: string,
  src: string,
  maxBytes?: number,
): Promise<string> => {
  const dir = path.join(OUT_DIR, store);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  return writeWithCap(src, target, maxBytes);
};

const buildOneRule = async (
  rule: StoreRule,
): Promise<{ written: number; skipped: number }> => {
  let written = 0;
  let skipped = 0;
  const masterRoot = masterDirFor(rule.masterDir ?? 'web');

  for (const locale of LOCALES) {
    const scenarios = listScenariosForVariant(rule.source, locale, masterRoot);
    if (scenarios.length === 0) {
      skipped += 1;
      continue;
    }
    const limited = rule.maxCount ? scenarios.slice(0, rule.maxCount) : scenarios;
    for (let i = 0; i < limited.length; i += 1) {
      const s = limited[i];
      if (rule.localeLayout === 'fastlane' && rule.fastlaneBucket) {
        await writeFastlanePath(locale, rule.fastlaneBucket, i, s.absPath, rule.maxBytes);
      } else if (rule.localeLayout === 'global') {
        if (locale !== LOCALES[0]) continue; // Snap / Flathub are single-gallery
        await writeGlobal(rule.store, i, s.scenario, s.absPath, rule.maxBytes);
      } else {
        await writePerLocale(rule.store, locale, i, s.scenario, s.absPath, rule.maxBytes);
      }
      written += 1;
    }
  }
  return { written, skipped };
};

const main = async (): Promise<void> => {
  if (!fs.existsSync(MASTER_DIR_WEB) && !fs.existsSync(MASTER_DIR_ELECTRON)) {
    console.error('No master captures found.');
    console.error(
      `Looked in:\n  ${MASTER_DIR_WEB}\n  ${MASTER_DIR_ELECTRON}\nRun \`npm run screenshots:capture\` (or :electron) first.`,
    );
    process.exit(1);
  }

  fs.rmSync(OUT_DIR, { recursive: true, force: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });

  let total = 0;
  for (const rule of STORE_RULES) {
    const res = await buildOneRule(rule);
    total += res.written;
    const tag = rule.fastlaneBucket ? `${rule.store}/${rule.fastlaneBucket}` : rule.store;
    const src = `${rule.masterDir ?? 'web'}:${rule.source}`;
    console.log(
      `${tag.padEnd(28)} source=${src.padEnd(24)} wrote=${res.written}${
        res.skipped ? ` (${res.skipped} variants missing)` : ''
      }`,
    );
  }
  console.log(`\nTotal files written: ${total}`);
  console.log(`Output: ${OUT_DIR}`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

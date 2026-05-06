/**
 * Per-store layout builder.
 *
 * Reads master captures from `.tmp/screenshots/_master/<viewport>/<locale>/<theme>/<scenario>/<name>.png`
 * and writes per-store directory layouts to `dist/screenshots/`.
 *
 * Captures are made at each store's native pixel size (see playwright.store-screenshots.config.ts),
 * so this script is just rename + copy — no resizing or re-encoding. Adding a
 * compression step (e.g. for Snap's 2 MB cap) is a follow-up.
 *
 * Run: npm run screenshots:build
 */

import * as fs from 'fs';
import * as path from 'path';
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

const writeFastlanePath = (
  locale: string,
  bucket: NonNullable<StoreRule['fastlaneBucket']>,
  index: number,
  src: string,
): string => {
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
  fs.copyFileSync(src, target);
  return target;
};

const writePerLocale = (
  store: string,
  locale: string,
  index: number,
  scenario: string,
  src: string,
): string => {
  const dir = path.join(OUT_DIR, store, locale);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  fs.copyFileSync(src, target);
  return target;
};

const writeGlobal = (
  store: string,
  index: number,
  scenario: string,
  src: string,
): string => {
  const dir = path.join(OUT_DIR, store);
  fs.mkdirSync(dir, { recursive: true });
  const num = `${index + 1}`.padStart(2, '0');
  const target = path.join(dir, `${num}-${cleanScenarioLabel(scenario)}.png`);
  fs.copyFileSync(src, target);
  return target;
};

const buildOneRule = (rule: StoreRule): { written: number; skipped: number } => {
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
    limited.forEach((s, i) => {
      if (rule.localeLayout === 'fastlane' && rule.fastlaneBucket) {
        writeFastlanePath(locale, rule.fastlaneBucket, i, s.absPath);
      } else if (rule.localeLayout === 'global') {
        if (locale !== LOCALES[0]) return; // Snap is single-gallery
        writeGlobal(rule.store, i, s.scenario, s.absPath);
      } else {
        writePerLocale(rule.store, locale, i, s.scenario, s.absPath);
      }
      written += 1;
    });
  }
  return { written, skipped };
};

const main = (): void => {
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
    const res = buildOneRule(rule);
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

main();

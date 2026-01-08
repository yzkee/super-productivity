/* eslint-env es6, node */
/**
 * Removes specified unused translation keys from all language files.
 * After running this, run `npm run int` to regenerate t.const.ts.
 *
 * Usage: node tools/cleanup-unused-translations.js
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const I18N_DIR = path.join(__dirname, '../src/assets/i18n');

// Top-level sections to completely remove
const SECTIONS_TO_REMOVE = ['ANDROID', 'THEMES'];

// Nested paths to remove (will remove the last key in the path)
const NESTED_PATHS_TO_REMOVE = [
  ['F', 'CALDAV', 'ISSUE_CONTENT'], // Remove F.CALDAV.ISSUE_CONTENT
];

/**
 * Recursively remove a nested key from an object
 */
function removeNestedKey(obj, pathParts) {
  if (pathParts.length === 0) return false;

  if (pathParts.length === 1) {
    if (obj && pathParts[0] in obj) {
      delete obj[pathParts[0]];
      return true;
    }
    return false;
  }

  const [first, ...rest] = pathParts;
  if (obj && typeof obj[first] === 'object') {
    return removeNestedKey(obj[first], rest);
  }
  return false;
}

/**
 * Remove specified keys from a JSON object
 */
function removeKeys(obj) {
  let removedCount = 0;

  // Remove top-level sections
  for (const section of SECTIONS_TO_REMOVE) {
    if (obj[section]) {
      delete obj[section];
      removedCount++;
    }
  }

  // Remove nested keys
  for (const pathParts of NESTED_PATHS_TO_REMOVE) {
    if (removeNestedKey(obj, pathParts)) {
      removedCount++;
    }
  }

  return removedCount;
}

/**
 * Process all JSON language files
 */
function processJsonFiles() {
  const files = globSync('*.json', { cwd: I18N_DIR, absolute: true });

  console.log(`Processing ${files.length} language files...\n`);

  for (const file of files) {
    const filename = path.basename(file);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const removed = removeKeys(content);

    if (removed > 0) {
      fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
      console.log(`${filename}: removed ${removed} section(s)`);
    } else {
      console.log(`${filename}: no changes needed`);
    }
  }
}

// Main
console.log('=== Cleaning up unused translations ===\n');
console.log('Removing:');
console.log('  - ANDROID.* (5 keys)');
console.log('  - THEMES.* (17 keys)');
console.log('  - F.CALDAV.ISSUE_CONTENT.* (12 keys)');
console.log('');

processJsonFiles();

console.log('\n=== Done! ===');
console.log('\nNow run `npm run int` to regenerate t.const.ts');

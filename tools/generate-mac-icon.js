#!/usr/bin/env node

/**
 * Generate macOS app icon with squircle mask from existing PNG source.
 *
 * macOS does not automatically apply a squircle mask to .icns icons —
 * the shape must be baked into the image. This script applies an
 * Apple-standard squircle (rounded rect with ~18% corner radius)
 * to the square source icon and generates build/icon.icns.
 *
 * The .icns file is assembled directly from PNG buffers (no native tools needed).
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

const SOURCE_PNG = path.join(__dirname, '../build/icons/sq2160x2160.png');
const OUTPUT_ICNS = path.join(__dirname, '../build/icon.icns');

// ICNS OSType codes for PNG-based entries, mapped by pixel size
// See: https://en.wikipedia.org/wiki/Apple_Icon_Image_format
const ICNS_TYPES = [
  { osType: 'ic10', size: 1024 },
  { osType: 'ic09', size: 512 },
  { osType: 'ic08', size: 256 },
  { osType: 'ic07', size: 128 },
  { osType: 'icp5', size: 32 },
  { osType: 'icp4', size: 16 },
];

function squircleSvg(size) {
  const radius = Math.round(size * 0.18);
  return `<svg width="${size}" height="${size}">
  <rect x="0" y="0" width="${size}" height="${size}" rx="${radius}" ry="${radius}" fill="white"/>
</svg>`;
}

function buildIcns(entries) {
  // ICNS file format:
  // Header: 4 bytes magic ('icns') + 4 bytes total file size
  // Entries: 4 bytes OSType + 4 bytes entry size (including header) + PNG data
  const HEADER_SIZE = 8;
  const ENTRY_HEADER_SIZE = 8;

  let totalSize = HEADER_SIZE;
  for (const entry of entries) {
    totalSize += ENTRY_HEADER_SIZE + entry.data.length;
  }

  const buffer = Buffer.alloc(totalSize);
  let offset = 0;

  // File header
  buffer.write('icns', offset, 4, 'ascii');
  offset += 4;
  buffer.writeUInt32BE(totalSize, offset);
  offset += 4;

  // Entries
  for (const entry of entries) {
    buffer.write(entry.osType, offset, 4, 'ascii');
    offset += 4;
    buffer.writeUInt32BE(ENTRY_HEADER_SIZE + entry.data.length, offset);
    offset += 4;
    entry.data.copy(buffer, offset);
    offset += entry.data.length;
  }

  return buffer;
}

async function generateMacIcon() {
  console.log('Generating macOS app icon with squircle mask...\n');

  if (!fs.existsSync(SOURCE_PNG)) {
    throw new Error(`Source PNG not found: ${SOURCE_PNG}`);
  }
  console.log('Source PNG found:', SOURCE_PNG);

  const entries = [];

  for (const { osType, size } of ICNS_TYPES) {
    const svg = squircleSvg(size);

    const pngBuffer = await sharp(SOURCE_PNG)
      .resize(size, size, { fit: 'cover', position: 'center' })
      .composite([{ input: Buffer.from(svg), blend: 'dest-in' }])
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .removeAlpha()
      .png()
      .toBuffer();

    entries.push({ osType, data: pngBuffer });
    console.log(`  Generated ${size}x${size} (${osType}, ${pngBuffer.length} bytes)`);
  }

  // Build and write .icns file
  console.log('\nAssembling .icns file...');
  const icnsBuffer = buildIcns(entries);
  fs.writeFileSync(OUTPUT_ICNS, icnsBuffer);

  const stats = fs.statSync(OUTPUT_ICNS);
  console.log(`Generated: ${OUTPUT_ICNS} (${stats.size} bytes)`);

  // Verify the largest entry has no alpha
  const metadata = await sharp(entries[0].data).metadata();
  console.log(`\nVerification (1024px entry):`);
  console.log(`  Dimensions: ${metadata.width}x${metadata.height}`);
  console.log(`  Channels: ${metadata.channels} (${metadata.hasAlpha ? 'RGBA' : 'RGB'})`);
  console.log(`  Has alpha: ${metadata.hasAlpha ? 'YES (unexpected)' : 'NO (correct)'}`);

  console.log('\nDone! macOS squircle icon generated at build/icon.icns');
}

generateMacIcon().catch((error) => {
  console.error('\nError generating icon:', error.message);
  process.exit(1);
});

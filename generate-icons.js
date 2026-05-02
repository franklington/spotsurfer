#!/usr/bin/env node
/**
 * generate-icons.js
 * Generates icon-192.png and icon-512.png from icon.svg using sharp.
 *
 * Usage:  npm install sharp  &&  node generate-icons.js
 */
const sharp = require('sharp');
const path  = require('path');
const fs    = require('fs');

const svgPath = path.join(__dirname, 'icons', 'icon.svg');
const svg     = fs.readFileSync(svgPath);
const outDir  = path.join(__dirname, 'icons');

const sizes = [192, 512];

Promise.all(sizes.map(size =>
  sharp(svg)
    .resize(size, size)
    .png()
    .toFile(path.join(outDir, `icon-${size}.png`))
    .then(() => console.log(`✔  icon-${size}.png`))
)).catch(err => {
  console.error('Icon generation failed:', err.message);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Docs consistency check: README must mention VITE_HOST when vite.config.ts uses it
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const readmePath = path.join(__dirname, '../../README.md');
const viteConfigPath = path.join(__dirname, '../../web/vite.config.ts');

const readme = fs.readFileSync(readmePath, 'utf-8');
const viteConfig = fs.readFileSync(viteConfigPath, 'utf-8');

// Check if vite.config.ts uses VITE_HOST
const usesViteHost = /process\.env\.VITE_HOST/.test(viteConfig);

if (!usesViteHost) {
  console.log('PASS: vite.config.ts does not use VITE_HOST, no README update needed');
  process.exit(0);
}

// Check if README mentions VITE_HOST
const readmeMentionsViteHost = /VITE_HOST/.test(readme);

if (!readmeMentionsViteHost) {
  console.error('FAIL: README does not mention VITE_HOST but vite.config.ts uses it');
  console.error('  vite.config.ts:11 uses process.env.VITE_HOST');
  console.error('  README.md should document this environment variable');
  process.exit(1);
}

console.log('PASS: README correctly documents VITE_HOST');
process.exit(0);

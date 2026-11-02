// Builds two bundles:
//  - dist/fis-copilot.js      IIFE for <script> tags (legacy web, ASP.NET, WebView2, Electron)
//  - dist/fis-copilot.esm.js  ES module for npm consumers (React, Angular, Vue wrappers)
// Target ES2018 so it runs in the WebView2 / Chromium baseline and older Edge-based intranet browsers.
import { build } from 'esbuild';

const common = {
  entryPoints: ['src/index.js'],
  bundle: true,
  minify: true,
  sourcemap: true,
  target: ['es2018'],
  legalComments: 'none',
};

await build({ ...common, format: 'iife', globalName: 'FisCopilot', outfile: 'dist/fis-copilot.js' });
await build({ ...common, format: 'esm', outfile: 'dist/fis-copilot.esm.js' });
console.log('built dist/fis-copilot.js and dist/fis-copilot.esm.js');

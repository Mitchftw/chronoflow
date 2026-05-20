import { _electron as electron } from 'playwright';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const electronApp = await electron.launch({
  args: [path.join(__dirname, 'dist/electron/main.js')],
  env: { ...process.env, NODE_ENV: 'production' },
});

const window = await electronApp.firstWindow();
await window.waitForSelector('app-root', { timeout: 30000 });
await window.waitForTimeout(1000);

await window.screenshot({ path: 'screenshot.png', type: 'png' });
console.log('Screenshot saved to screenshot.png');

await electronApp.close();

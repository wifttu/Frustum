// 게임 안의 3D 모델로 맵 미리보기와 캐릭터·의상·프로필 아이콘 이미지를 만든다.
// 모든 그림은 이 저장소의 모델(client/world.js, client/character.js)을 직접 렌더링한 것이라 외부 저작물이 없다.
//   사용법: node tools/render-assets.mjs   →  client/img/{maps,chars,skins,icons}/*.webp
// 필요: Playwright(Chromium). 화면 없이 소프트웨어 GL 로 그린다.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = path.resolve(import.meta.dirname, '..');
const out = path.join(root, 'client/img');
const MOUNTS = [
  ['/vendor/three/', path.join(root, 'node_modules/three/build')],
  ['/shared/', path.join(root, 'shared')],
  ['/tools/', path.join(root, 'tools')],
  ['/', path.join(root, 'client')],
];
const TYPES = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css' };

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
page.on('pageerror', (e) => console.error('page error:', e.message));
page.on('console', (m) => m.type() === 'error' && console.error('console:', m.text()));
await page.route('http://assets.local/**', async (route) => {
  const url = new URL(route.request().url()).pathname;
  for (const [prefix, dir] of MOUNTS) {
    if (!url.startsWith(prefix)) continue;
    const file = path.join(dir, url.slice(prefix.length));
    if (fs.existsSync(file)) return route.fulfill({ body: fs.readFileSync(file), contentType: TYPES[path.extname(file)] || 'application/octet-stream' });
  }
  return route.fulfill({ status: 404, body: 'not found' });
});
await page.goto('http://assets.local/tools/assets.html');
await page.waitForFunction(() => window.renderAll, null, { timeout: 30000 });
const only = process.argv[2] || '';
const images = await page.evaluate((only) => window.renderAll(only), only);
let bytes = 0;
for (const [name, dataUrl] of Object.entries(images)) {
  const file = path.join(out, `${name}.webp`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const buf = Buffer.from(dataUrl.split(',')[1], 'base64');
  fs.writeFileSync(file, buf);
  bytes += buf.length;
}
console.log(`wrote ${Object.keys(images).length} images (${(bytes / 1024).toFixed(0)} KB) to ${path.relative(root, out)}`);
await browser.close();

// GitHub Pages용 정적 사이트를 dist/ 에 만든다.
// 서버와 같은 배치(client 파일이 루트, /shared, /server, /vendor/three)를 상대 경로로 그대로 재현한다.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
fs.rmSync(dist, { recursive: true, force: true });

const copy = (from, to) => {
  fs.mkdirSync(path.dirname(path.join(dist, to)), { recursive: true });
  fs.cpSync(path.join(root, from), path.join(dist, to), { recursive: true });
};

for (const f of fs.readdirSync(path.join(root, 'client'))) copy(`client/${f}`, f);
copy('shared', 'shared');
copy('server/game.js', 'server/game.js'); // 오프라인 모드가 서버 로직을 그대로 사용
copy('server/bots.js', 'server/bots.js');
copy('server/nav.js', 'server/nav.js');
copy('node_modules/three/build/three.module.min.js', 'vendor/three/three.module.min.js');
fs.writeFileSync(path.join(dist, '.nojekyll'), '');
console.log('built', dist);

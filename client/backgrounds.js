// 프로필 아이콘 배경 그림 (shared/shop.js 의 PROFILE_BGS). 맵 배경은 맵 미리보기 그림, 나머지는 CSS 로 그린 그림.
import { PROFILE_BGS } from './shared/shop.js';

const stars = (list) => list.map(([x, y, r = 1]) => `radial-gradient(${r}px ${r}px at ${x}% ${y}%, #fff 90%, transparent)`).join(', ');
const STAR_A = stars([[18, 22], [72, 14, 1.5], [44, 38], [86, 46], [28, 62, 1.5], [62, 72], [12, 84], [90, 80, 1.5], [52, 12]]);
const PETALS = [[16, 20], [70, 30], [40, 58], [84, 64], [24, 82], [58, 90], [90, 12]]
  .map(([x, y]) => `radial-gradient(4px 2.5px at ${x}% ${y}%, #ffc8dc 90%, transparent)`)
  .join(', ');

const CSS = {
  night: `${STAR_A}, radial-gradient(circle at 78% 22%, #fff6d8 0 9%, rgba(255,246,216,.18) 10% 18%, transparent 19%), linear-gradient(180deg, #0b1230, #2a2350)`,
  sunset: `radial-gradient(circle at 50% 78%, #fff1b0 0 12%, transparent 13%), linear-gradient(180deg, #2a2a5a 0%, #8a4a7a 42%, #f0965a 72%, #ffd58a 100%)`,
  aurora: `${STAR_A}, radial-gradient(120% 55% at 30% 25%, rgba(80,255,180,.7), transparent 60%), radial-gradient(100% 60% at 82% 38%, rgba(150,120,255,.65), transparent 62%), linear-gradient(180deg, #06122a, #0e2a3a)`,
  galaxy: `${STAR_A}, ${stars([[34, 30], [66, 52], [48, 76], [8, 46], [94, 28]])}, radial-gradient(70% 30% at 50% 50%, rgba(220,170,255,.75), transparent 70%), linear-gradient(135deg, #10062a, #3a0a5a 50%, #06122a)`,
  royal: `repeating-conic-gradient(from 0deg at 50% 62%, rgba(255,255,255,.22) 0 9deg, transparent 9deg 18deg), radial-gradient(circle at 50% 62%, #fff6c8, #ffc83a 45%, #b8862a 100%)`,
  sakura: `${PETALS}, radial-gradient(circle at 75% 22%, #fff 0 7%, transparent 8%), linear-gradient(180deg, #1a1030, #5a2a5a 60%, #ff8ab8)`,
};

// CSS background 값 (없으면 '' → 기본 배경)
export function bgCss(id) {
  const b = PROFILE_BGS[id];
  if (!b) return '';
  if (b.map) return `linear-gradient(rgba(0,0,0,.05), rgba(0,0,0,.25)), url(img/maps/${b.map}.webp) center / cover`;
  return CSS[id] || '';
}

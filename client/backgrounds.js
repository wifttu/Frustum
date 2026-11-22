// 프로필 아이콘 배경 그림 (shared/shop.js 의 PROFILE_BGS). 모두 CSS 로 그린 그림이라 파일이 없다.
import { PROFILE_BGS } from './shared/shop.js';

const dots = (list, color, glow = 'transparent') =>
  list.map(([x, y, r = 1]) => `radial-gradient(${r}px ${r}px at ${x}% ${y}%, ${color} 90%, ${glow})`).join(', ');
const STARS = dots([[18, 22], [72, 14, 1.5], [44, 38], [86, 46], [28, 62, 1.5], [62, 72], [12, 84], [90, 80, 1.5], [52, 12]], '#fff');
const PETALS = [[16, 20], [70, 30], [40, 58], [84, 64], [24, 82], [58, 90], [90, 12]]
  .map(([x, y]) => `radial-gradient(4px 2.5px at ${x}% ${y}%, #ffc8dc 90%, transparent)`)
  .join(', ');
const FLIES = [[20, 30], [70, 22], [46, 52], [84, 60], [30, 76], [62, 84], [12, 56], [88, 36]]
  .map(([x, y], i) => `radial-gradient(${i % 3 ? 5 : 7}px ${i % 3 ? 5 : 7}px at ${x}% ${y}%, #f4ffb0 0 25%, rgba(200, 255, 90, .55) 45%, transparent)`)
  .join(', ');
const FLAKES = dots([[14, 12, 2], [42, 20, 1.5], [74, 10, 2.5], [88, 34, 1.5], [24, 40, 2.5], [58, 44, 2], [10, 64, 1.5], [80, 62, 2], [46, 70, 1.5], [66, 24, 1]], '#fff');

const CSS = {
  night: `${STARS}, radial-gradient(circle at 78% 22%, #fff6d8 0 9%, rgba(255,246,216,.18) 10% 18%, transparent 19%), linear-gradient(180deg, #0b1230, #2a2350)`,
  sunset: `radial-gradient(circle at 50% 78%, #fff1b0 0 12%, transparent 13%), linear-gradient(180deg, #2a2a5a 0%, #8a4a7a 42%, #f0965a 72%, #ffd58a 100%)`,
  // 무료: 캠핑장 밤의 것들과 무늬
  fire: `${dots([[34, 30, 1.5], [62, 20], [48, 12, 1.5], [70, 40]], '#ffd27a')}, radial-gradient(30% 42% at 50% 96%, #fff6b0 0 22%, #ffb43a 45%, #e8502a 72%, transparent 76%), radial-gradient(90% 60% at 50% 115%, rgba(255, 140, 40, .75), transparent 70%), linear-gradient(180deg, #1a0f22, #3a1a14)`,
  firefly: `${FLIES}, linear-gradient(180deg, #08161a, #12382a)`,
  snow: `${FLAKES}, radial-gradient(130% 34% at 50% 108%, #f4f8ff 60%, transparent 62%), linear-gradient(180deg, #1e3a6a, #5a88c0)`,
  wave: `radial-gradient(circle at 78% 22%, #fff6c8 0 11%, transparent 12%), repeating-radial-gradient(circle at 50% 150%, #1d6fa8 0 7px, #3fb0e0 7px 11px, #a8e8ff 11px 12px)`,
  plaid: `repeating-linear-gradient(0deg, rgba(0,0,0,.34) 0 7px, transparent 7px 16px), repeating-linear-gradient(90deg, rgba(0,0,0,.34) 0 7px, transparent 7px 16px), repeating-linear-gradient(90deg, transparent 0 11px, rgba(255,230,190,.22) 11px 12px, transparent 12px 16px), #c8362a`,
  rainbow: `radial-gradient(30% 18% at 16% 96%, #fff 60%, transparent 64%), radial-gradient(30% 18% at 84% 96%, #fff 60%, transparent 64%), radial-gradient(circle at 50% 100%, transparent 0 30%, #8a5aff 30% 36%, #3a8aff 36% 42%, #3ac878 42% 48%, #ffd23a 48% 54%, #ff8a2a 54% 60%, #ff4a4a 60% 66%, transparent 66%), linear-gradient(180deg, #7fd0ff, #d8f2ff)`,
  // 크리스탈 배경
  aurora: `${STARS}, radial-gradient(120% 55% at 30% 25%, rgba(80,255,180,.7), transparent 60%), radial-gradient(100% 60% at 82% 38%, rgba(150,120,255,.65), transparent 62%), linear-gradient(180deg, #06122a, #0e2a3a)`,
  galaxy: `${STARS}, ${dots([[34, 30], [66, 52], [48, 76], [8, 46], [94, 28]], '#fff')}, radial-gradient(70% 30% at 50% 50%, rgba(220,170,255,.75), transparent 70%), linear-gradient(135deg, #10062a, #3a0a5a 50%, #06122a)`,
  royal: `repeating-conic-gradient(from 0deg at 50% 62%, rgba(255,255,255,.22) 0 9deg, transparent 9deg 18deg), radial-gradient(circle at 50% 62%, #fff6c8, #ffc83a 45%, #b8862a 100%)`,
  sakura: `${PETALS}, radial-gradient(circle at 75% 22%, #fff 0 7%, transparent 8%), linear-gradient(180deg, #1a1030, #5a2a5a 60%, #ff8ab8)`,
};

// CSS background 값 (없으면 '' → 기본 배경)
export const bgCss = (id) => (Object.hasOwn(PROFILE_BGS, id) && CSS[id]) || '';

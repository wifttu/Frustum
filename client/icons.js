// 아이콘 그림: 이모지 대신 게임 모델로 렌더링한 이미지(client/img, tools/render-assets.mjs 로 생성)를 쓴다.
// 프로필 아이콘은 서버와 주고받는 값이 이모지 문자열이라 그대로 두고, 화면에 그릴 때만 그림으로 바꾼다.
import { CHARACTERS } from './shared/progress.js';
import { SKIN_ICONS } from './shared/shop.js';

const FREE = { '🔦': 'flashlight', '🏕️': 'tent', '🌲': 'tree', '🔥': 'campfire', '🌙': 'moon', '⭐': 'star', '🦊': 'fox', '🐱': 'cat', '🐶': 'dog', '🐼': 'panda', '🐰': 'rabbit', '🦔': 'hedgehog' };
const IMG = new Map();
for (const [icon, name] of Object.entries(FREE)) IMG.set(icon, `img/icons/${name}.webp`);
for (const [id, c] of Object.entries(CHARACTERS)) IMG.set(c.icon, `img/chars/${id}.webp`);
for (const [id, icon] of Object.entries(SKIN_ICONS)) IMG.set(icon, `img/skins/${id}.webp`);

export const iconSrc = (icon) => IMG.get(icon) || '';
export const charImg = (id) => `img/chars/${id}.webp`;
export const skinImg = (id) => `img/skins/${id}.webp`;
export const mapImg = (id) => `img/maps/${id || 'auto'}.webp`;

export function imgEl(src, cls = 'ic') {
  const im = document.createElement('img');
  im.className = cls;
  im.src = src;
  im.alt = '';
  im.draggable = false;
  im.decoding = 'async';
  return im;
}
// el 안을 아이콘 하나로 채운다 (그림이 없는 이모지는 글자로)
export function setIcon(el, icon) {
  const src = iconSrc(icon);
  el.replaceChildren(src ? imgEl(src) : document.createTextNode(icon));
}
// 아이콘 + 글자 한 줄
export function iconText(el, icon, text) {
  const src = iconSrc(icon);
  el.replaceChildren(...(src ? [imgEl(src, 'ic inline')] : [document.createTextNode(`${icon} `)]), document.createTextNode(text));
}

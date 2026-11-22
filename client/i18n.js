// 언어: 한국어(원문) / English.
// 코드 곳곳의 한국어 문장은 그대로 두고, 화면(DOM)에 들어가는 순간 사전(client/lang-en.js)으로 바꿔 보여 준다.
//   1) 통째로 같은 글  2) 숫자·이름이 들어가는 글(패턴)  3) " · " 로 이어 붙인 글은 조각마다  4) 앞뒤 이모지·기호를 떼고 다시
// 사전에 없는 글은 한국어 그대로 보인다(깨지지 않게). 플레이어가 지은 이름·채팅은 translate="no" 안에 두어 바꾸지 않는다.
import { EN, EN_PATTERNS } from './lang-en.js';

const KO = /[가-힣]/;
const ATTRS = ['placeholder', 'aria-label', 'title'];
let on = false;
let lang = 'ko';
const dict = new Map();
const pats = [];
const cache = new Map();

// 설정값('auto' | 'ko' | 'en') → 실제 언어. 자동이면 기기 언어가 한국어일 때만 한국어.
export function langOf(pref) {
  if (pref === 'ko' || pref === 'en') return pref;
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'ko'];
  return list.some((l) => /^ko/i.test(l)) ? 'ko' : 'en';
}
export const currentLang = () => lang;
// 날짜·시간 표시용 지역 설정
export const locale = () => (lang === 'en' ? 'en-US' : 'ko-KR');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function initLang(pref) {
  lang = langOf(pref);
  document.documentElement.lang = lang;
  if (lang === 'en') {
    on = true;
    for (const [k, v] of Object.entries(EN)) dict.set(k, v);
    for (const [ko, en] of EN_PATTERNS) {
      const parts = ko.split('{}');
      pats.push({ re: new RegExp('^' + parts.map(esc).join('([\\s\\S]+?)') + '$'), en, weight: parts.join('').length });
    }
    pats.sort((a, b) => b.weight - a.weight); // 글자가 많이 정해진(구체적인) 패턴부터
    fix(document.body);
    new MutationObserver(onMutations).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  }
  document.documentElement.classList.remove('i18n-wait');
  return lang;
}

// 글 하나 번역 (영어가 아니면 그대로)
export function tr(s) {
  if (!on || typeof s !== 'string' || !KO.test(s)) return s;
  let out = cache.get(s);
  if (out === undefined) {
    out = s.includes('\n') ? s.split('\n').map((l) => translate(l, 0)).join('\n') : translate(s, 0);
    if (cache.size > 4000) cache.clear();
    cache.set(s, out);
  }
  return out;
}

function translate(s, depth) {
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  const core = m[2];
  if (!KO.test(core)) return s;
  let r = dict.get(core);
  if (r === undefined) r = byPattern(core, depth);
  if (r === null && depth < 6) r = bySplit(core, depth);
  if (r === null && depth < 6) r = byAffix(core, depth);
  return m[1] + (r ?? core) + m[3];
}
function byPattern(s, depth) {
  for (const p of pats) {
    const m = p.re.exec(s);
    if (m) return p.en.replace(/\{(\d)\}/g, (_, i) => translate(m[+i + 1], depth + 1));
  }
  return null;
}
// " · " 로 이어 붙인 글: 조각마다 번역. 단, 이어진 몇 조각이 통째로 사전에 있으면(설명 안에 " · " 가 든 글) 그대로 쓴다.
function bySplit(s, depth) {
  if (!s.includes(' · ')) return null;
  const parts = s.split(' · ');
  const out = [];
  for (let i = 0; i < parts.length; ) {
    let j = parts.length;
    for (; j > i + 1; j--) {
      // 그대로 찾고, 없으면 앞뒤 이모지·기호("✨ ")를 떼고 찾는다 (끝이 숫자인 글 "… · 체력 115" 도 그대로 찾아야 한다)
      const joined = parts.slice(i, j).join(' · ');
      const whole = dict.get(joined);
      if (whole !== undefined) {
        out.push(whole);
        break;
      }
      const m = /^([^가-힣]*)([\s\S]*?)([^가-힣]*)$/.exec(joined);
      const hit = dict.get(m[2]);
      if (hit !== undefined) {
        out.push(m[1] + hit + m[3]);
        break;
      }
    }
    if (j > i + 1) i = j;
    else out.push(translate(parts[i++], depth + 1));
  }
  return out.join(' · ');
}
// 앞뒤의 이모지·숫자·기호를 떼고 가운데 한국어만 번역 ("🔥 모닥불 점령 ▶" 같은 글)
function byAffix(s, depth) {
  const m = /^([^가-힣]*)([가-힣](?:[\s\S]*[가-힣])?)([^가-힣]*)$/.exec(s);
  if (!m || (!m[1] && !m[3])) return null;
  let core = dict.get(m[2]);
  if (core === undefined) core = byPattern(m[2], depth + 1);
  return core === null || core === undefined ? null : m[1] + core + m[3];
}

// ── 화면(DOM) ──
const skip = (el) => !!el?.closest?.('[translate="no"], script, style');
function fixText(n) {
  const v = n.nodeValue;
  if (!v || !KO.test(v) || skip(n.parentElement)) return;
  const t = tr(v);
  if (t !== v) n.nodeValue = t;
}
function fixAttrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v && KO.test(v)) {
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
  }
}
function fix(root) {
  if (root.nodeType === 3) return fixText(root);
  if (root.nodeType !== 1 || skip(root)) return;
  fixAttrs(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.nodeType === 1 && n.matches('[translate="no"], script, style') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeType === 3) fixText(n);
    else fixAttrs(n);
  }
}
function onMutations(list) {
  for (const m of list) {
    if (m.type === 'characterData') fixText(m.target);
    else if (m.type === 'attributes') {
      if (!skip(m.target)) fixAttrs(m.target);
    } else for (const n of m.addedNodes) fix(n);
  }
}

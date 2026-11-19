// 저장 데이터 백업 코드: 프로필 전체를 글자 한 줄로 만들어 두었다가, 다른 기기(또는 지운 뒤)에서 그대로 되살린다.
// 계정 서버가 없어서(무료 서버는 디스크가 배포 때마다 지워진다) 데이터는 각 기기에 있고, 이 코드가 유일한 사본이다.
// 형식: FRU1.<base64url(JSON)>.<검사값 8자>   — 한 글자라도 틀리면 복구하지 않는다.
import { normalizeProfile } from './shop.js';

const TAG = 'FRU1';

// FNV-1a 32비트 (오타 검사용, 암호가 아니다)
function check(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0').slice(-7);
}
const toB64 = (str) => {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const fromB64 = (b64) => {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

// 최근 함께한 플레이어 목록은 빼서 짧게 만든다
export function encodeBackup(profile) {
  const { recent, ...keep } = profile;
  const body = toB64(JSON.stringify({ v: 1, t: Date.now(), p: keep }));
  return `${TAG}.${body}.${check(body)}`;
}

// 성공하면 { profile, savedAt }, 아니면 null (앞뒤 공백·줄바꿈은 무시)
export function decodeBackup(code) {
  const s = String(code ?? '').replace(/\s+/g, '');
  const [tag, body, sum, extra] = s.split('.');
  if (tag !== TAG || !body || extra !== undefined || check(body) !== sum) return null;
  try {
    const data = JSON.parse(fromB64(body));
    if (!data || data.v !== 1 || typeof data.p !== 'object') return null;
    return { profile: normalizeProfile(data.p), savedAt: Number(data.t) || 0 };
  } catch {
    return null;
  }
}

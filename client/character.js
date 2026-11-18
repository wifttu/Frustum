// 캐릭터: 코드로 만든 2등신 후드 캐릭터 + 절차적 애니메이션(걷기, 숨쉬기, 손전등 조준/발사, 구르기, 등장).
// 외부 모델 파일 없음. 캐릭터 하나는 드로우콜 7~8회 (몸통/팔2/다리2/발밑 링/그림자/빔).
import * as THREE from 'three';
import { CFG } from './shared/config.js';
import { SKINS } from './shared/shop.js';

// 색은 정점에 직접 굽는다 (머티리얼 색은 흰색). 후드/망토만 팀 색이고 나머지는 공통.
// 색은 sRGB 16진수로 적고 렌더링용 선형 값으로 바꿔 쓴다 (그대로 넣으면 물 빠진 색이 된다)
export const rgb = (hex) => new THREE.Color(hex).toArray();
const SKIN = rgb(0xffcfa8);
const CHEEK = rgb(0xff8f86);
const EYE = rgb(0x1c1418);
const HAIR = rgb(0x6a4428);
const GOLD = rgb(0xffc83a);
const PANTS = rgb(0x5d4332);
const BOOT = rgb(0x3a271c);
const PACK = rgb(0xa06c3c);
const METAL = rgb(0x50545c);
const GLOW = [3, 3, 2.4]; // 손전등 렌즈: 밝게 빛나 보이게
export const shade = (c, k) => c.map((v) => v * k);

// 여러 지오메트리를 정점 색과 함께 하나로 합친다 (드로우콜 절약)
export function merge(parts) {
  const pos = [];
  const nor = [];
  const col = [];
  for (const [geo, c] of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    const p = g.attributes.position.array;
    const n = g.attributes.normal.array;
    for (let i = 0; i < p.length; i += 3) {
      pos.push(p[i], p[i + 1], p[i + 2]);
      nor.push(n[i], n[i + 1], n[i + 2]);
      col.push(c[0], c[1], c[2]);
    }
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

const HIP_Y = 0.34;
const SHOULDER_Y = 0.8;
const HEAD_Y = 1.14;
const PIVOT_Y = 0.62; // 구를 때 회전 중심
const BODY_SCALE = 1.35; // 위에서 내려다보는 카메라에서 잘 보이도록 몸만 키운다 (판정 크기는 그대로)

// 팀 색(후드, 망토, 소매)을 입힌 부위별 지오메트리
// 캐릭터별 장식: 머리 위/얼굴에 붙는 소품과 몸집. 팀 색(후드, 망토)은 공통이라 아군/적 구분은 그대로다.
function accessories(charId) {
  const H = HEAD_Y;
  const yellow = rgb(0xffd23a);
  const brown = rgb(0x8a5a34);
  const white = rgb(0xf4f4f0);
  const dark = rgb(0x24242c);
  const leaf = rgb(0x58b84a);
  switch (charId) {
    case 'runner': // 번개: 노란 머리띠와 번개 깃
      return [
        [new THREE.TorusGeometry(0.385, 0.045, 6, 18).rotateX(Math.PI / 2).translate(0, H + 0.12, 0), yellow],
        [new THREE.ConeGeometry(0.09, 0.42, 4).rotateX(-0.9).translate(0.2, H + 0.42, -0.12), yellow],
        [new THREE.ConeGeometry(0.09, 0.42, 4).rotateX(-0.9).translate(-0.2, H + 0.42, -0.12), yellow],
      ];
    case 'bear': // 곰돌이: 둥근 귀
      return [
        [new THREE.SphereGeometry(0.15, 10, 8).translate(0.27, H + 0.34, 0), brown],
        [new THREE.SphereGeometry(0.15, 10, 8).translate(-0.27, H + 0.34, 0), brown],
        [new THREE.SphereGeometry(0.08, 8, 6).translate(0.27, H + 0.35, 0.08), rgb(0xe8b890)],
        [new THREE.SphereGeometry(0.08, 8, 6).translate(-0.27, H + 0.35, 0.08), rgb(0xe8b890)],
        [new THREE.SphereGeometry(0.07, 8, 6).translate(0, H - 0.05, 0.35), brown],
      ];
    case 'owl': // 올빼미: 큰 고글과 깃털 뿔
      return [
        [new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateX(Math.PI / 2).translate(0.14, H + 0.02, 0.33), white],
        [new THREE.CylinderGeometry(0.12, 0.12, 0.08, 12).rotateX(Math.PI / 2).translate(-0.14, H + 0.02, 0.33), white],
        [new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateX(Math.PI / 2).translate(0.14, H + 0.02, 0.35), dark],
        [new THREE.CylinderGeometry(0.06, 0.06, 0.1, 10).rotateX(Math.PI / 2).translate(-0.14, H + 0.02, 0.35), dark],
        [new THREE.ConeGeometry(0.08, 0.3, 5).rotateZ(-0.5).translate(0.3, H + 0.38, 0.05), brown],
        [new THREE.ConeGeometry(0.08, 0.3, 5).rotateZ(0.5).translate(-0.3, H + 0.38, 0.05), brown],
      ];
    case 'collector': // 반디: 머리 위 등불
      return [
        [new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5).translate(0, H + 0.55, 0), dark],
        [new THREE.SphereGeometry(0.12, 10, 8).translate(0, H + 0.8, 0), [3.2, 2.8, 0.9]],
        [new THREE.CylinderGeometry(0.14, 0.14, 0.04, 8).translate(0, H + 0.68, 0), brown],
      ];
    case 'ninja': // 그림자: 얼굴 가리개와 긴 머리띠
      return [
        [new THREE.BoxGeometry(0.5, 0.17, 0.2).translate(0, H - 0.1, 0.26), dark],
        [new THREE.TorusGeometry(0.385, 0.04, 6, 18).rotateX(Math.PI / 2).translate(0, H + 0.14, 0), dark],
        [new THREE.BoxGeometry(0.08, 0.04, 0.45).rotateX(0.5).translate(0.1, H + 0.02, -0.55), dark],
        [new THREE.BoxGeometry(0.08, 0.04, 0.38).rotateX(0.7).translate(-0.08, H - 0.02, -0.5), dark],
      ];
    case 'healer': // 약초꾼: 머리 위 새싹
      return [
        [new THREE.CylinderGeometry(0.025, 0.025, 0.22, 5).translate(0, H + 0.48, 0), leaf],
        [new THREE.SphereGeometry(0.14, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(0.5).translate(0.14, H + 0.64, 0), leaf],
        [new THREE.SphereGeometry(0.14, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(-0.5).translate(-0.14, H + 0.64, 0), leaf],
        [new THREE.BoxGeometry(0.2, 0.2, 0.05).translate(0, 0.62, -0.39), white],
      ];
    default:
      return [];
  }
}
const BODY_WIDTH = { bear: 1.18, runner: 0.92 }; // 몸집 (그 외 1)

// 스킨(의상)별 모자와 소품. 색이 고정이라 아군/적 누구에게나 같은 모양으로 보인다.
function costume(skinId) {
  const H = HEAD_Y;
  const c = (hex) => rgb(hex);
  switch (skinId) {
    case 'strawberry': { // 딸기 요정: 잎사귀 왕관, 꼭지, 씨앗
      const parts = [[new THREE.CylinderGeometry(0.03, 0.04, 0.16, 6).translate(0, H + 0.5, -0.05), c(0x5a8a2a)]];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([
          new THREE.SphereGeometry(0.15, 8, 6).scale(1, 0.28, 0.55).rotateZ(-0.45).rotateY(a).translate(Math.cos(a) * 0.16, H + 0.4, -0.05 - Math.sin(a) * 0.16),
          c(0x4fae3c),
        ]);
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2 + 0.3;
        const up = 0.12 + (i % 3) * 0.1;
        const r = Math.sqrt(Math.max(0, 0.4 * 0.4 - up * up));
        if (Math.sin(a) > 0.55) continue; // 얼굴 쪽은 비운다
        parts.push([new THREE.SphereGeometry(0.03, 5, 4).scale(1, 1.4, 1).translate(Math.cos(a) * r, H + up, -Math.sin(a) * r), c(0xfff0a0)]);
      }
      return parts;
    }
    case 'lime': // 개구리: 툭 튀어나온 눈
      return [-1, 1].flatMap((s) => [
        [new THREE.SphereGeometry(0.15, 10, 8).translate(s * 0.2, H + 0.36, 0.06), c(0x63b52c)],
        [new THREE.SphereGeometry(0.105, 10, 8).translate(s * 0.2, H + 0.39, 0.15), c(0xffffff)],
        [new THREE.SphereGeometry(0.055, 8, 6).translate(s * 0.2, H + 0.4, 0.23), c(0x15151a)],
        [new THREE.SphereGeometry(0.05, 6, 5).scale(1.5, 0.5, 0.6).translate(s * 0.25, H - 0.02, 0.3), c(0xff9ab0)],
      ]);
    case 'pumpkin': // 호박 마법사: 챙 넓은 뾰족 모자
      return [
        [new THREE.CylinderGeometry(0.56, 0.56, 0.05, 20).rotateX(-0.18).translate(0, H + 0.3, -0.03), c(0x5a2f8a)],
        [new THREE.ConeGeometry(0.3, 0.62, 12).rotateX(-0.3).translate(0, H + 0.6, -0.1), c(0x6a3aa2)],
        [new THREE.ConeGeometry(0.11, 0.3, 8).rotateX(-1.1).translate(0, H + 0.9, -0.3), c(0x6a3aa2)],
        [new THREE.CylinderGeometry(0.31, 0.33, 0.09, 14).rotateX(-0.2).translate(0, H + 0.36, -0.04), c(0xff8a2e)],
        [new THREE.BoxGeometry(0.12, 0.11, 0.05).translate(0, H + 0.38, 0.29), c(0xffd23a)],
        [new THREE.SphereGeometry(0.06, 6, 5).translate(0, H + 1.0, -0.42), c(0xffd23a)],
      ];
    case 'snow': // 눈사람: 중절모, 당근 코, 석탄 단추, 빨간 목도리
      return [
        [new THREE.CylinderGeometry(0.36, 0.36, 0.05, 18).translate(0, H + 0.34, -0.02), c(0x1c1c22)],
        [new THREE.CylinderGeometry(0.23, 0.25, 0.36, 16).translate(0, H + 0.54, -0.02), c(0x25252c)],
        [new THREE.CylinderGeometry(0.255, 0.255, 0.08, 16).translate(0, H + 0.41, -0.02), c(0xd83a3a)],
        [new THREE.ConeGeometry(0.055, 0.26, 8).rotateX(Math.PI / 2).translate(0, H - 0.03, 0.46), c(0xff8a2e)],
        [new THREE.TorusGeometry(0.22, 0.075, 6, 14).rotateX(Math.PI / 2).translate(0, 0.87, 0), c(0xd83a3a)],
        [new THREE.BoxGeometry(0.12, 0.3, 0.06).rotateZ(0.2).translate(0.16, 0.72, 0.24), c(0xd83a3a)],
        ...[0.72, 0.6, 0.48].map((y) => [new THREE.SphereGeometry(0.04, 6, 5).translate(0, y, 0.2 + (0.84 - y) * 0.28), c(0x1c1c22)]),
      ];
    case 'night': // 우주비행사: 헬멧 테, 안테나, 산소통, 가슴 계기판
      return [
        [new THREE.TorusGeometry(0.4, 0.07, 8, 24).rotateX(0.852).translate(0, H, 0), c(0xe8eef5)],
        [new THREE.TorusGeometry(0.3, 0.07, 8, 20).rotateX(Math.PI / 2).translate(0, 0.86, 0), c(0xe8eef5)],
        [new THREE.CylinderGeometry(0.02, 0.02, 0.34, 5).translate(0.22, H + 0.5, -0.1), c(0xc8d0d8)],
        [new THREE.SphereGeometry(0.06, 8, 6).translate(0.22, H + 0.7, -0.1), [3, 0.6, 0.5]],
        [new THREE.CapsuleGeometry(0.09, 0.26, 3, 8).translate(0.11, 0.66, -0.42), c(0xe8eef5)],
        [new THREE.CapsuleGeometry(0.09, 0.26, 3, 8).translate(-0.11, 0.66, -0.42), c(0xe8eef5)],
        [new THREE.BoxGeometry(0.2, 0.13, 0.04).translate(0, 0.68, 0.27), c(0xe8eef5)],
        [new THREE.BoxGeometry(0.05, 0.05, 0.05).translate(-0.05, 0.69, 0.29), [0.6, 2.6, 3]],
        [new THREE.BoxGeometry(0.05, 0.05, 0.05).translate(0.05, 0.69, 0.29), [3, 0.8, 0.6]],
      ];
    case 'gold': { // 황금 왕: 보석 왕관, 털 망토 깃
      const gold = c(0xffc21a);
      const parts = [[new THREE.CylinderGeometry(0.27, 0.25, 0.16, 16, 1, true).translate(0, H + 0.4, -0.02), gold]];
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        parts.push([new THREE.ConeGeometry(0.07, 0.2, 5).translate(Math.cos(a) * 0.25, H + 0.57, -0.02 + Math.sin(a) * 0.25), gold]);
        parts.push([new THREE.SphereGeometry(0.04, 6, 5).translate(Math.cos(a) * 0.27, H + 0.41, -0.02 + Math.sin(a) * 0.27), i % 2 ? [2.6, 0.3, 0.4] : [0.4, 1.2, 3]]);
      }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        parts.push([new THREE.SphereGeometry(0.1, 7, 5).translate(Math.cos(a) * 0.25, 0.88, Math.sin(a) * 0.25), c(0xfdfdfd)]);
        if (i % 3 === 0) parts.push([new THREE.SphereGeometry(0.03, 5, 4).translate(Math.cos(a) * 0.33, 0.9, Math.sin(a) * 0.33), c(0x1c1c22)]);
      }
      return parts;
    }
    default:
      return [];
  }
}
// 의상을 입으면 머리 위 장식(귀, 등불, 새싹 등)은 모자에 가려지므로 뺀다. 얼굴 장식(고글, 가리개)은 남긴다.
function faceOnly(parts) {
  return parts.filter(([geo]) => {
    geo.computeBoundingBox();
    return (geo.boundingBox.min.y + geo.boundingBox.max.y) / 2 < HEAD_Y + 0.2;
  });
}

function buildParts(teamHex, charId, skinId = 'default') {
  const dressed = skinId !== 'default';
  const team = rgb(teamHex);
  const dark = shade(team, 0.72);
  const torso = merge([
    // 망토: 아래로 퍼지는 원뿔대 + 밑단
    [new THREE.CylinderGeometry(0.19, 0.36, 0.52, 14).translate(0, 0.6, 0), team],
    [new THREE.CylinderGeometry(0.37, 0.37, 0.07, 14).translate(0, 0.36, 0), dark],
    // 큰 머리와 얼굴
    [new THREE.SphereGeometry(0.35, 16, 12).translate(0, HEAD_Y, 0), SKIN],
    [new THREE.SphereGeometry(0.052, 8, 6).scale(1, 1.35, 0.6).translate(0.13, HEAD_Y + 0.01, 0.325), EYE],
    [new THREE.SphereGeometry(0.052, 8, 6).scale(1, 1.35, 0.6).translate(-0.13, HEAD_Y + 0.01, 0.325), EYE],
    [new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.6, 0.4).translate(0.21, HEAD_Y - 0.1, 0.275), CHEEK],
    [new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.6, 0.4).translate(-0.21, HEAD_Y - 0.1, 0.275), CHEEK],
    // 눈 반짝임, 미소, 앞머리, 망토 단추
    [new THREE.SphereGeometry(0.02, 6, 4).translate(0.145, HEAD_Y + 0.045, 0.352), [2.5, 2.5, 2.5]],
    [new THREE.SphereGeometry(0.02, 6, 4).translate(-0.115, HEAD_Y + 0.045, 0.352), [2.5, 2.5, 2.5]],
    [new THREE.TorusGeometry(0.055, 0.013, 4, 10, Math.PI).rotateZ(Math.PI).translate(0, HEAD_Y - 0.1, 0.335), EYE],
    [new THREE.SphereGeometry(0.2, 10, 6).scale(1.5, 0.42, 0.55).translate(0, HEAD_Y + 0.23, 0.2), HAIR],
    [new THREE.SphereGeometry(0.05, 8, 6).translate(0, 0.83, 0.22), GOLD],
    [new THREE.BoxGeometry(0.07, 0.36, 0.04).translate(0.15, 0.66, 0.2), dark], // 배낭 끈
    [new THREE.BoxGeometry(0.07, 0.36, 0.04).translate(-0.15, 0.66, 0.2), dark],
    // 후드: 얼굴만 내놓고 머리 위와 뒤를 덮는다 + 뾰족한 끝
    [new THREE.SphereGeometry(0.39, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.52).rotateX(-0.72).translate(0, HEAD_Y, 0), team],
    ...(dressed ? [] : [[new THREE.ConeGeometry(0.15, 0.34, 10).rotateX(-1.2).translate(0, HEAD_Y + 0.28, -0.3), dark]]),
    // 후드 테두리: 얼굴을 감싸는 도톰한 단
    [new THREE.TorusGeometry(0.385, 0.05, 6, 22).rotateX(0.852).translate(0, HEAD_Y, 0), dark],
    [new THREE.TorusGeometry(0.2, 0.06, 6, 14).rotateX(Math.PI / 2).translate(0, 0.86, 0), dark], // 목도리
    [new THREE.BoxGeometry(0.3, 0.3, 0.16).translate(0, 0.62, -0.3), PACK], // 배낭
    ...(dressed ? faceOnly(accessories(charId)) : accessories(charId)),
    ...costume(skinId),
  ]);
  const bw = BODY_WIDTH[charId];
  if (bw) torso.scale(bw, 1, bw);
  const leg = merge([
    [new THREE.CapsuleGeometry(0.1, 0.1, 3, 8).translate(0, -0.14, 0), PANTS],
    [new THREE.SphereGeometry(0.12, 8, 6).scale(1, 0.75, 1.35).translate(0, -0.27, 0.04), BOOT],
  ]);
  const armParts = [
    [new THREE.CapsuleGeometry(0.08, 0.14, 3, 8).translate(0, -0.14, 0), team],
    [new THREE.SphereGeometry(0.085, 8, 6).translate(0, -0.3, 0), SKIN], // 손
  ];
  const armL = merge(armParts);
  const armR = merge([
    ...armParts,
    [new THREE.CylinderGeometry(0.055, 0.085, 0.3, 8).translate(0, -0.46, 0), METAL], // 손전등
    [new THREE.CylinderGeometry(0.08, 0.08, 0.03, 8).translate(0, -0.62, 0), GLOW], // 렌즈
  ]);
  return { torso, leg, armL, armR };
}
const ringGeo = new THREE.RingGeometry(0.5, 0.6, 28).rotateX(-Math.PI / 2).translate(0, 0.05, 0);
const shadowGeo = new THREE.CircleGeometry(0.44, 16).rotateX(-Math.PI / 2).translate(0, 0.03, 0);

// 손전등 빔: 판정 범위(ATTACK_RANGE, ATTACK_ARC)와 같은 모양의 부채꼴. 손에서 멀어질수록 흐려진다.
function makeBeamGeometry() {
  const seg = 16;
  const pos = [0.42, 1.08, 0.9];
  const col = [0.62, 0.58, 0.42];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const a = -CFG.ATTACK_ARC / 2 + (CFG.ATTACK_ARC * i) / seg;
    pos.push(Math.sin(a) * CFG.ATTACK_RANGE, 0.5, Math.cos(a) * CFG.ATTACK_RANGE);
    col.push(0.05, 0.045, 0.025);
    if (i > 0) idx.push(0, i, i + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
const beamGeo = makeBeamGeometry();
// 조준 가이드: 빔 사거리 끝을 표시하는 얇은 호 (내 캐릭터만)
const aimGeo = new THREE.RingGeometry(
  CFG.ATTACK_RANGE - 0.07, CFG.ATTACK_RANGE, 20, 1, -Math.PI / 2 - CFG.ATTACK_ARC / 2, CFG.ATTACK_ARC,
).rotateX(-Math.PI / 2).translate(0, 0.06, 0);

const COLORS = { self: 0x4fc46a, ally: 0x3d9cf0, enemy: 0xf0503d }; // 아군: 파랑, 적: 빨강
// 내 캐릭터(와 선택 화면)는 캐릭터 고유 색을 입는다. 아군 파랑/적 빨강과 헷갈리지 않는 색만 쓴다.
export const SIGNATURE = {
  explorer: 0x4fc46a, runner: 0xf2c230, bear: 0xa9744a, owl: 0x8a68d8, collector: 0xf2903a, ninja: 0x4a4f5c, healer: 0x3cc4a8,
};
const lerp = (a, b, t) => a + (b - a) * t;
const approach = (v, to, k) => v + (to - v) * Math.min(1, k);
// 스킬 동작 길이(초). 그동안 팔·몸이 그 스킬 자세로 갔다가 돌아온다.
const CAST_DUR = { heal: 0.8, magnet: 0.7, scan: 1.0, shield: 0.5, stealth: 0.45, dash: 0.4, flare: 0.5 };
// 0→1→0 부드러운 봉우리 (앞 20% 동안 올라가고 뒤 35% 동안 내려온다)
const envelope = (p) => (p < 0.2 ? Math.sin((p / 0.2) * Math.PI / 2) : p > 0.65 ? Math.cos(((p - 0.65) / 0.35) * Math.PI / 2) : 1);

// 방패 스킬: 가장자리가 밝게 빛나는 반투명 구 (가운데는 거의 투명, 결이 천천히 흐른다)
const shieldGeo = new THREE.SphereGeometry(1.15, 28, 18).scale(1, 0.95, 1).translate(0, 0.95, 0);
function shieldMat() {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uA: { value: 0 }, uT: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        vP = position;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uA; uniform float uT;
      varying vec3 vN; varying vec3 vV; varying vec3 vP;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.4);
        float flow = 0.5 + 0.5 * sin(vP.y * 9.0 - uT * 3.0 + sin(atan(vP.x, vP.z) * 6.0) * 0.6);
        float a = uA * (0.07 + f * 1.1 + flow * f * 0.3);
        gl_FragColor = vec4(vec3(0.55, 0.85, 1.0) * a, a);
      }`,
  });
}

// 레벨별 몸집 배율 (Lv 1 = 1, Lv 20 = 약 1.4)
export const growOf = (level) => 1 + Math.min(Math.max(level, 1) - 1, 19) * 0.022;
const easeOutBack = (t) => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);

export class Characters {
  constructor(mask) {
    // 장면 조명이 밝아서(반구광 + 직사광) 색이 하얗게 날아가지 않도록 살짝 눌러 준다
    this.bodyMat = mask.apply(new THREE.MeshLambertMaterial({ color: 0xd8d8d8, vertexColors: true }));
    this.showMat = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true });
    this.parts = {};
    this.ring = {};
    for (const [kind, color] of Object.entries(COLORS)) {
      this.ring[kind] = mask.apply(
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: kind === 'self' ? 0.45 : 0.8, depthWrite: false }),
      );
    }
    this.shadow = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false });
    this.beam = mask.apply(
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false,
      }),
    );
    this.aim = mask.apply(
      new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }),
    );
    // 그림자 망토: 나와 아군에게만 반투명하게 보인다 (적에게는 서버가 위치를 보내지 않는다)
    this.cloakMat = mask.apply(
      new THREE.MeshLambertMaterial({ color: 0xb8a8ff, vertexColors: true, transparent: true, opacity: 0.35, depthWrite: false }),
    );
    // 반사 조끼: 몸을 감싸는 은빛 보호막
    this.vestMat = mask.apply(
      new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    this.vestGeo = new THREE.SphereGeometry(1.05, 18, 12).scale(1, 0.95, 1).translate(0, 0.95, 0);
  }

  // 팀 종류 × 캐릭터 조합별 지오메트리 (처음 쓸 때 한 번 만든다)
  // skin: 스킨(의상) ID. 모자와 소품이 붙고, 내 캐릭터는 후드/망토 색도 바뀐다.
  partsFor(kind, char, skin = 'default') {
    const color = kind === 'self' ? (SKINS[skin]?.color ?? SIGNATURE[char] ?? COLORS.self) : COLORS[kind];
    const key = `${kind}:${char}:${skin}`;
    if (!this.parts[key]) this.parts[key] = buildParts(color, char, skin);
    return this.parts[key];
  }

  // show: 선택 화면용 (시야 마스크를 타지 않는 머티리얼, 발밑 링 없음)
  make(kind, char = 'explorer', show = false, skin = 'default') {
    const root = new THREE.Group();
    const pose = new THREE.Group(); // 구르기/들썩임이 적용되는 그룹
    const inner = new THREE.Group();
    pose.position.y = PIVOT_Y;
    inner.position.y = -PIVOT_Y;
    pose.add(inner);

    const m = show ? this.showMat : this.bodyMat;
    const g = this.partsFor(kind, char, skin);
    const torso = new THREE.Mesh(g.torso, m);
    const legL = new THREE.Mesh(g.leg, m);
    const legR = new THREE.Mesh(g.leg, m);
    const armL = new THREE.Mesh(g.armL, m);
    const armR = new THREE.Mesh(g.armR, m);
    legL.position.set(0.13, HIP_Y, 0);
    legR.position.set(-0.13, HIP_Y, 0);
    armL.position.set(-0.29, SHOULDER_Y, 0);
    armR.position.set(0.29, SHOULDER_Y, 0);
    inner.add(torso, legL, legR, armL, armR);

    const ring = new THREE.Mesh(ringGeo, this.ring[kind]);
    const shadow = new THREE.Mesh(shadowGeo, this.shadow);
    const beam = new THREE.Mesh(beamGeo, this.beam);
    beam.visible = false;
    const body = new THREE.Group();
    body.add(pose);
    const vest = new THREE.Mesh(this.vestGeo, this.vestMat);
    vest.visible = false;
    const shield = new THREE.Mesh(shieldGeo, shieldMat());
    shield.visible = false;
    shield.renderOrder = 3;
    root.add(body, shadow, ring, beam, vest, shield);
    if (show) ring.visible = false;
    let aim = null;
    if (kind === 'self') {
      aim = new THREE.Mesh(aimGeo, this.aim);
      root.add(aim);
    }
    root.userData = {
      mat: m, kind, char, skin, body, pose, torso, legL, legR, armL, armR, ring, beam, aim, vest, shield, cloaked: false,
      phase: Math.random() * 6, seed: Math.random() * 6, atk: 0, spawn: 0, speed: 0, grow: 1, lx: null, lz: 0,
      castSkill: null, castT: 9, dashK: 0, scanK: 0, shieldK: 0,
    };
    // 그룹 단위로 컬링하므로 자식의 자동 컬링은 끈다
    root.traverse((o) => (o.frustumCulled = false));
    return root;
  }

  setKind(root, kind, char = root.userData.char, skin = 'default') {
    const u = root.userData;
    if (u.kind === kind && u.char === char && u.skin === skin) return;
    u.skin = skin;
    u.kind = kind;
    u.char = char;
    const g = this.partsFor(kind, char, skin);
    u.torso.geometry = g.torso;
    u.legL.geometry = u.legR.geometry = g.leg;
    u.armL.geometry = g.armL;
    u.armR.geometry = g.armR;
    u.ring.material = this.ring[kind];
  }

  // 강화된 사거리/폭에 맞춰 빔과 조준선을 늘린다 (빔 꼭짓점은 손 위치에 고정)
  setBeamStats(root, range, arc) {
    const u = root.userData;
    const sz = range / CFG.ATTACK_RANGE;
    const sx = sz * (Math.tan(arc / 2) / Math.tan(CFG.ATTACK_ARC / 2));
    u.beam.scale.set(sx, 1, sz);
    u.beam.position.set(0.42 * (1 - sx), 0, 0.9 * (1 - sz));
    if (u.aim) u.aim.scale.set(sx, 1, sz);
  }

  // 스킬을 썼다: 잠깐 그 스킬의 자세를 취한다
  cast(root, skill) {
    root.userData.castSkill = skill;
    root.userData.castT = 0;
  }

  // 등장 애니메이션을 처음부터 다시 (부활, 새 라운드)
  respawn(root) {
    root.userData.spawn = 0;
    root.userData.lx = null;
  }

  // s: { beam: 빔 발사 중, roll: 구르기 진행도 0..1 (아니면 -1), aimReady: 조준 가이드 표시 }
  animate(root, dt, t, s) {
    const u = root.userData;
    // 이동 속도는 위치 변화에서 추정한다 (원격 플레이어도 같은 코드)
    if (u.lx !== null && dt > 0) {
      const v = Math.hypot(root.position.x - u.lx, root.position.z - u.lz) / dt;
      u.speed = lerp(u.speed, Math.min(v, CFG.ROLL_SPEED), Math.min(1, dt * 12));
    }
    u.lx = root.position.x;
    u.lz = root.position.z;

    u.spawn = Math.min(1, u.spawn + dt * 4);
    // 레벨이 오를수록 몸집이 커진다 (왕귀가 한눈에 보이게). 판정 크기는 그대로다.
    u.grow += ((s.level ? growOf(s.level) : 1) - u.grow) * Math.min(1, dt * 3);
    u.body.scale.setScalar(Math.max(0.01, easeOutBack(u.spawn)) * BODY_SCALE * u.grow);

    const rolling = s.roll >= 0;
    const amt = rolling ? 0 : Math.min(1, u.speed / CFG.PLAYER_SPEED);
    u.phase += dt * 11 * amt;
    const sw = Math.sin(u.phase) * 0.9 * amt;
    const breathe = Math.sin(t * 2.2 + u.seed) * (1 - amt);

    u.atk = lerp(u.atk, s.beam ? 1 : 0, Math.min(1, dt * (s.beam ? 30 : 7)));
    u.legL.rotation.x = sw;
    u.legR.rotation.x = -sw;
    u.armL.rotation.x = -sw * 0.8;
    u.armL.rotation.z = -0.25;
    // 오른팔은 손전등을 앞으로 겨누고, 발사 순간 쭉 뻗는다
    u.armR.rotation.x = -1.1 - 0.47 * u.atk + sw * 0.12 + breathe * 0.03;
    u.armR.position.z = 0.02 + 0.14 * u.atk;
    u.torso.rotation.x = 0.1 * amt - 0.08 * u.atk;
    u.torso.rotation.z = Math.sin(u.phase) * 0.06 * amt; // 걸을 때 좌우로 뒤뚱
    u.torso.scale.y = 1 + breathe * 0.012;

    const pose = u.pose;
    if (rolling) {
      // 앞구르기: 몸을 말고 한 바퀴
      const tuck = Math.sin(s.roll * Math.PI);
      pose.rotation.x = s.roll * Math.PI * 2;
      pose.position.y = PIVOT_Y - 0.2 * tuck;
      pose.scale.setScalar(1 - 0.2 * tuck);
      u.legL.rotation.x = u.legR.rotation.x = -1.5 * tuck;
      u.armL.rotation.x = -1.2 * tuck;
    } else {
      pose.rotation.x = 0;
      pose.scale.setScalar(1);
      pose.position.y = PIVOT_Y + Math.abs(Math.cos(u.phase)) * 0.07 * amt + breathe * 0.012;
    }

    if (!rolling) this.skillPose(u, dt, t, s, sw);
    else u.pose.rotation.y = 0;

    u.beam.visible = !!s.beam;
    u.vest.visible = !!s.vest && !s.shield;
    // 방패: 톡 하고 부풀었다가 끝나면 스르르 사라진다
    u.shieldK = approach(u.shieldK, s.shield ? 1 : 0, dt * (s.shield ? 9 : 5));
    u.shield.visible = u.shieldK > 0.01;
    if (u.shield.visible) {
      const k = s.shield ? easeOutBack(u.shieldK) : u.shieldK;
      u.shield.scale.setScalar((0.55 + 0.45 * k) * u.grow);
      u.shield.material.uniforms.uA.value = u.shieldK;
      u.shield.material.uniforms.uT.value = t;
    }
    if (s.vest) u.vest.scale.setScalar(1 + Math.sin(t * 5) * 0.03);
    const cloak = !!s.cloak;
    if (cloak !== u.cloaked) {
      u.cloaked = cloak;
      for (const part of [u.torso, u.legL, u.legR, u.armL, u.armR]) part.material = cloak ? this.cloakMat : u.mat;
      u.ring.visible = !cloak;
    }
    if (u.aim) u.aim.visible = !!s.aimReady;
  }
}

// 스킬 자세: 기본 걷기/조준 자세 위에 덧씌운다 (Characters.prototype 에 붙인다)
Characters.prototype.skillPose = function (u, dt, t, s, sw) {
  u.castT += dt;
  const dur = CAST_DUR[u.castSkill] || 0.6;
  const p = u.castT / dur;
  const k = u.castSkill && p < 1 ? envelope(p) : 0;
  u.dashK = approach(u.dashK, s.dash ? 1 : 0, dt * 6);
  u.scanK = approach(u.scanK, s.scan ? 1 : 0, dt * 4);
  const { torso, armL, armR, legL, legR, pose } = u;
  torso.rotation.y = 0;

  // 질주: 몸을 앞으로 숙이고 보폭과 팔 흔들기가 커진다
  if (u.dashK > 0.01) {
    const d = u.dashK;
    torso.rotation.x += 0.2 * d;
    legL.rotation.x *= 1 + 0.4 * d;
    legR.rotation.x *= 1 + 0.4 * d;
    armL.rotation.x = lerp(armL.rotation.x, -sw * 1.5, d);
    armR.rotation.x = lerp(armR.rotation.x, -0.7 + sw * 0.6, d * (1 - u.atk));
  }
  // 매의 눈: 몸을 천천히 좌우로 돌리며 둘러본다
  pose.rotation.y = Math.sin(t * 1.7 + u.seed) * 0.5 * u.scanK;
  // 방패가 켜져 있는 동안: 살짝 웅크리고 한 팔로 몸을 가린다
  if (u.shieldK > 0.01 && s.shield) {
    const b = u.shieldK;
    pose.position.y -= 0.05 * b;
    armL.rotation.x = lerp(armL.rotation.x, -1.3, b);
    armL.rotation.z = lerp(armL.rotation.z, 0.6, b);
  }
  if (!k) return;
  switch (u.castSkill) {
    case 'heal': // 두 팔을 하늘로, 발끝으로 살짝
      armL.rotation.x = lerp(armL.rotation.x, -2.7, k);
      armL.rotation.z = lerp(armL.rotation.z, -0.45, k);
      armR.rotation.x = lerp(armR.rotation.x, -2.5, k);
      pose.position.y += 0.07 * k;
      break;
    case 'magnet': { // 두 팔을 앞으로 뻗었다가 끌어당긴다
      const pull = p < 0.45 ? -1.5 : lerp(-1.5, -0.7, Math.min(1, (p - 0.45) / 0.3));
      armL.rotation.x = lerp(armL.rotation.x, pull, k);
      armL.rotation.z = lerp(armL.rotation.z, 0.2, k);
      armR.rotation.x = lerp(armR.rotation.x, pull, k);
      torso.rotation.x -= 0.12 * k * (p > 0.45 ? 1 : 0.3);
      break;
    }
    case 'scan': // 손을 이마에 대고 멀리 본다
      armL.rotation.x = lerp(armL.rotation.x, -2.45, k);
      armL.rotation.z = lerp(armL.rotation.z, 0.8, k);
      torso.rotation.x -= 0.08 * k;
      break;
    case 'shield': // 순간적으로 몸을 낮춰 버틴다
      pose.position.y -= 0.08 * k;
      torso.rotation.x += 0.1 * k;
      break;
    case 'stealth': // 몸을 웅크리며 연기 속으로
      pose.position.y -= 0.14 * k;
      torso.rotation.x += 0.35 * k;
      armL.rotation.x = lerp(armL.rotation.x, 0.5, k);
      break;
    case 'dash': // 출발: 앞으로 확 숙인다
      torso.rotation.x += 0.3 * k;
      pose.position.y -= 0.05 * k;
      break;
    case 'flare': { // 뒤로 젖혔다가 앞으로 던진다
      const arm = p < 0.35 ? lerp(0, 0.9, p / 0.35) : lerp(0.9, -2.3, Math.min(1, (p - 0.35) / 0.3));
      armL.rotation.x = lerp(armL.rotation.x, arm, k);
      torso.rotation.y = lerp(0, p < 0.35 ? 0.25 : -0.2, k);
      break;
    }
  }
};

// 처치 이펙트: 바닥 충격파 링 + 흩어지는 파편. 내가 보고 있던 플레이어(또는 나)가 쓰러질 때만 쓴다.
const BURST_N = 14;
export class DeathFx {
  constructor(scene) {
    this.scene = scene;
    this.pool = [];
    this.ringGeo = new THREE.RingGeometry(0.75, 1, 28).rotateX(-Math.PI / 2);
  }

  spawn(x, z, kind) {
    let fx = this.pool.find((f) => f.t >= 1);
    if (!fx) {
      const ring = new THREE.Mesh(
        this.ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BURST_N * 3), 3));
      const pts = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ size: 0.22, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }),
      );
      ring.frustumCulled = pts.frustumCulled = false;
      this.scene.add(ring, pts);
      fx = { ring, pts, vel: new Float32Array(BURST_N * 3), t: 1 };
      this.pool.push(fx);
    }
    const color = kind === 'shield' ? 0x9fe8ff : kind === 'heal' ? 0x7dff9a : kind === 'level' ? 0xffe27a : (COLORS[kind] ?? 0xffffff);
    fx.ring.material.color.set(color);
    fx.pts.material.color.set(color);
    fx.ring.position.set(x, 0.07, z);
    const p = fx.pts.geometry.attributes.position.array;
    for (let i = 0; i < BURST_N; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 2 + Math.random() * 4;
      p[i * 3] = x;
      p[i * 3 + 1] = 0.6 + Math.random() * 0.8;
      p[i * 3 + 2] = z;
      fx.vel[i * 3] = Math.cos(a) * sp;
      fx.vel[i * 3 + 1] = 2 + Math.random() * 4;
      fx.vel[i * 3 + 2] = Math.sin(a) * sp;
    }
    fx.t = 0;
    fx.ring.visible = fx.pts.visible = true;
  }

  update(dt) {
    for (const fx of this.pool) {
      if (fx.t >= 1) continue;
      fx.t = Math.min(1, fx.t + dt / 0.7);
      const fade = 1 - fx.t;
      fx.ring.scale.setScalar(0.4 + fx.t * 2.6);
      fx.ring.material.opacity = fade * 0.9;
      fx.pts.material.opacity = fade;
      const p = fx.pts.geometry.attributes.position.array;
      for (let i = 0; i < BURST_N; i++) {
        fx.vel[i * 3 + 1] -= 14 * dt;
        p[i * 3] += fx.vel[i * 3] * dt;
        p[i * 3 + 1] = Math.max(0.05, p[i * 3 + 1] + fx.vel[i * 3 + 1] * dt);
        p[i * 3 + 2] += fx.vel[i * 3 + 2] * dt;
      }
      fx.pts.geometry.attributes.position.needsUpdate = true;
      if (fx.t >= 1) fx.ring.visible = fx.pts.visible = false;
    }
  }
}

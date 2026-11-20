// 스킨(의상) 모양: 캐릭터마다 3벌, 캐릭터의 특징(곰 귀, 올빼미 고글, 반딧불, 새싹…)을 살려서 만든다.
// 외부 모델 없이 도형만 쓰고 색은 정점에 굽는다. 1보다 큰 색 값은 빛나 보인다.
// costume(id, H) → { parts: 몸통에 붙는 것, arm: 왼손에 드는 것(지팡이, 돋보기),
//   acc: 캐릭터 기본 장식 중 남길 것 ('all' 전부 | 'face' 얼굴·몸 장식만 | 'none' 없음),
//   tip: 후드 끝(뾰족한 꼭지)을 남기나, boot: 신발 색(없으면 기본) }
// H 는 머리 중심 높이(character.js 의 HEAD_Y). 앞은 +z, 몸통 망토는 y 0.34~0.86 의 원뿔대.
import * as THREE from 'three';

const c = (hex) => new THREE.Color(hex).toArray();
const ball = (r, x, y, z, seg = 8) => new THREE.SphereGeometry(r, seg, Math.max(4, Math.round(seg * 0.75))).translate(x, y, z);
const cyl = (rt, rb, h, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const cone = (r, h, seg = 8) => new THREE.ConeGeometry(r, h, seg);
const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const torus = (R, r, rs = 6, ts = 18, arc = Math.PI * 2) => new THREE.TorusGeometry(R, r, rs, ts, arc);
// 머리를 덮는 반구 모자: tilt 만큼 뒤로 젖혀 이마는 덮고 얼굴은 남긴다
const dome = (r, tilt, seg = 18) => new THREE.SphereGeometry(r, seg, 9, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-tilt);
// 반구 모자의 테두리 (dome 과 같은 기울기)
const rim = (r, tube, tilt) => torus(r, tube, 6, 26).rotateX(Math.PI / 2 - tilt);

// 망토(원뿔대) 반지름: 높이 y 에서
const capeR = (y) => 0.19 + ((0.86 - y) / 0.52) * 0.17;
const SLOPE = Math.atan(0.17 / 0.52);
// +z 를 보는 납작한 장식을 망토 앞면 (x, y) 위치에 붙인다 (기울기와 둘레를 맞춘다)
function onCape(geo, x, y, lift = 0.012) {
  const r = capeR(y);
  const yaw = Math.asin(Math.max(-0.95, Math.min(0.95, x / r)));
  const z = Math.sqrt(Math.max(0, r * r - x * x));
  return geo.rotateX(-SLOPE).rotateY(yaw).translate(x, y, z + lift);
}
// 망토 둘레를 감는 띠 (줄무늬, 허리띠)
const band = (y, h, out = 0.008) => new THREE.CylinderGeometry(capeR(y + h / 2) + out, capeR(y - h / 2) + out, h, 18, 1, true).translate(0, y, 0);
// 여러 조각을 같은 변환으로 한 번에 옮긴다
const xf = (parts, fn) => parts.map(([g, col]) => [fn(g), col]);
// 꽃 한 송이 (+z 를 본다)
function flower(petal, center, r = 0.05, n = 5) {
  const out = [[ball(r * 0.5, 0, 0, r * 0.25, 6), center]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    out.push([new THREE.SphereGeometry(r * 0.58, 6, 4).scale(1, 1, 0.4).translate(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, 0), petal]);
  }
  return out;
}
// 머리 둘레 화관: 덩굴 + 꽃 n 송이
function circlet(H, y, R, colors, n = 8) {
  const out = [[torus(R, 0.024, 4, 26).rotateX(Math.PI / 2).translate(0, H + y - 0.02, 0), c(0x4fae3c)]];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.PI / 2;
    out.push(...xf(flower(c(colors[i % colors.length]), c(0xffe08a), 0.06), (g) => g.rotateX(-0.9).rotateY(Math.PI / 2 - a).translate(Math.cos(a) * R, H + y, Math.sin(a) * R)));
  }
  return out;
}
// 떠다니는 빛 알갱이 (반딧불, 포자)
const motes = (list, col) => list.map(([x, y, z, r]) => [ball(r, x, y, z, 6), col]);

export function costume(id, H) {
  const k = { parts: [], arm: [], acc: 'all', tip: true, boot: null };
  const P = k.parts;
  switch (id) {
    // ───────── 탐험가: 어디든 가는 모험가 ─────────
    case 'explorer_safari': { // 사파리 탐험 모자 + 목에 건 쌍안경
      k.tip = false;
      const hat = c(0xe8d6a0), band_ = c(0x6a4a2a);
      P.push(
        [new THREE.SphereGeometry(0.41, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.8, 1.05).translate(0, H + 0.15, -0.02), hat],
        [cyl(0.6, 0.62, 0.035, 24).rotateX(0.06).translate(0, H + 0.17, -0.02), c(0xd6c288)],
        [new THREE.CylinderGeometry(0.415, 0.415, 0.07, 22, 1, true).scale(1, 1, 1.05).translate(0, H + 0.21, -0.02), band_],
        [ball(0.045, 0, H + 0.48, -0.02), band_],
        [torus(0.29, 0.014, 4, 22).rotateX(Math.PI / 2 + 0.5).translate(0, 0.86, 0), band_],
      );
      const bino = [[box(0.06, 0.035, 0.07).translate(0, 0, 0.04), c(0x3a3a42)]];
      for (const s of [-1, 1]) {
        bino.push([cyl(0.045, 0.05, 0.13, 10).rotateX(Math.PI / 2).translate(s * 0.058, 0, 0.05), c(0x2a2a30)]);
        bino.push([cyl(0.034, 0.034, 0.01, 10).rotateX(Math.PI / 2).translate(s * 0.058, 0, 0.118), [0.9, 1.4, 2.2]]);
      }
      P.push(...xf(bino, (g) => onCape(g, 0, 0.66, 0)));
      k.boot = 0x6a4a2a;
      return k;
    }
    case 'explorer_pirate': { // 삼각 모자(해골 문장), 안대, 금화 목걸이, 허리띠
      k.tip = false;
      const black = c(0x22222a), gold = c(0xffc83a), bone = c(0xf4f0e6);
      P.push(
        [cyl(0.62, 0.56, 0.12, 3).translate(0, H + 0.32, -0.04), black],
        [new THREE.CylinderGeometry(0.64, 0.64, 0.03, 3, 1, true).translate(0, H + 0.375, -0.04), gold],
        [new THREE.SphereGeometry(0.3, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, H + 0.37, -0.04), black],
        [ball(0.052, 0, H + 0.45, 0.255, 10), bone],
        [ball(0.014, 0.018, H + 0.455, 0.302, 4), black],
        [ball(0.014, -0.018, H + 0.455, 0.302, 4), black],
        [box(0.17, 0.024, 0.02).rotateZ(0.6).translate(0, H + 0.45, 0.24), bone],
        [box(0.17, 0.024, 0.02).rotateZ(-0.6).translate(0, H + 0.45, 0.24), bone],
        // 안대 + 끈
        [cyl(0.076, 0.076, 0.03, 12).rotateX(Math.PI / 2).translate(0.13, H + 0.01, 0.345), black],
        [box(0.026, 0.27, 0.02).rotateZ(-0.8).translate(0.23, H + 0.105, 0.265), black],
        // 금화 목걸이와 허리띠
        [torus(0.27, 0.014, 4, 22).rotateX(Math.PI / 2 + 0.45).translate(0, 0.86, 0), gold],
        [onCape(cyl(0.066, 0.066, 0.022, 14).rotateX(Math.PI / 2), 0, 0.71, 0.012), gold],
        [band(0.47, 0.07), c(0x3a2418)],
        [onCape(box(0.1, 0.085, 0.02), 0, 0.47, 0.014), gold],
      );
      k.boot = 0x1c1c22;
      return k;
    }
    case 'explorer_astro': { // 우주 헬멧, 안테나, 산소통과 분사구, 가슴 계기판
      k.tip = false;
      const white = c(0xe8eef5), grey = c(0xc8d0d8), jet = [0.8, 2.2, 3.2];
      P.push(
        [dome(0.43, 0.72).translate(0, H, 0), white],
        [torus(0.4, 0.07, 8, 24).rotateX(0.852).translate(0, H, 0), grey],
        [torus(0.3, 0.07, 8, 20).rotateX(Math.PI / 2).translate(0, 0.86, 0), white],
        [cyl(0.02, 0.02, 0.34, 5).translate(0.22, H + 0.52, -0.12), grey],
        [ball(0.06, 0.22, H + 0.72, -0.12), [3, 0.6, 0.5]],
      );
      for (const s of [-1, 1]) {
        P.push(
          [new THREE.CapsuleGeometry(0.09, 0.26, 3, 8).translate(s * 0.11, 0.66, -0.42), white],
          [cone(0.07, 0.1, 8).rotateX(Math.PI).translate(s * 0.11, 0.42, -0.42), grey],
          [ball(0.05, s * 0.11, 0.35, -0.42), jet],
        );
      }
      P.push(...xf([
        [box(0.22, 0.14, 0.04), white],
        [box(0.05, 0.05, 0.02).translate(-0.06, 0.02, 0.025), [0.6, 2.6, 3]],
        [box(0.05, 0.05, 0.02).translate(0.06, 0.02, 0.025), [3, 0.8, 0.6]],
        [box(0.14, 0.025, 0.02).translate(0, -0.04, 0.025), [3, 2.6, 0.6]],
      ], (g) => onCape(g, 0, 0.66, 0.01)));
      k.boot = 0xe8eef5;
      return k;
    }

    // ───────── 번개: 빠른 달리기 ─────────
    case 'runner_sprinter': { // 땀받이 머리띠, 번개 깃, 등번호 7, 형광 운동화
      k.acc = 'none';
      const white = c(0xf4f4f0), blue = c(0x2f7fd8), yellow = c(0xffd23a), ink = c(0x1a3a7a);
      P.push(
        [torus(0.39, 0.058, 6, 24).rotateX(Math.PI / 2).translate(0, H + 0.12, 0), white],
        [torus(0.435, 0.016, 4, 24).rotateX(Math.PI / 2).translate(0, H + 0.12, 0), blue],
        [cone(0.09, 0.42, 4).rotateX(-0.9).translate(0.2, H + 0.42, -0.12), yellow],
        [cone(0.09, 0.42, 4).rotateX(-0.9).translate(-0.2, H + 0.42, -0.12), yellow],
      );
      P.push(...xf([
        [box(0.27, 0.21, 0.015), white],
        [box(0.11, 0.03, 0.01).translate(0.005, 0.05, 0.012), ink],
        [box(0.032, 0.13, 0.01).rotateZ(-0.5).translate(0.022, -0.012, 0.012), ink],
        [ball(0.013, -0.11, 0.08, 0.01, 4), c(0xb8b8c0)],
        [ball(0.013, 0.11, 0.08, 0.01, 4), c(0xb8b8c0)],
      ], (g) => onCape(g, 0, 0.6, 0.01)));
      k.boot = 0x3aa0ff;
      return k;
    }
    case 'runner_racer': { // 줄무늬 레이싱 헬멧(고글, 날개, 스포일러), 등에 꽂은 체크무늬 깃발
      k.acc = 'none';
      k.tip = false;
      const red = c(0xe03a2a), white = c(0xf4f4f0), yellow = c(0xffd23a), black = c(0x1c1c22);
      P.push(
        [dome(0.43, 0.5).translate(0, H, 0), red],
        [rim(0.43, 0.03, 0.5).translate(0, H, 0), black],
        ...[-1, 1].map((s) => [torus(0.425, 0.022, 4, 18, Math.PI).rotateY(Math.PI / 2).translate(s * 0.075, 0, 0).rotateX(-0.5).translate(0, H, 0), white]),
        [box(0.42, 0.025, 0.13).translate(0, H + 0.38, -0.31), red],
        [box(0.025, 0.07, 0.025).translate(0.13, H + 0.34, -0.28), black],
        [box(0.025, 0.07, 0.025).translate(-0.13, H + 0.34, -0.28), black],
        [cone(0.08, 0.38, 4).rotateX(-0.9).translate(0.25, H + 0.4, -0.16), yellow],
        [cone(0.08, 0.38, 4).rotateX(-0.9).translate(-0.25, H + 0.4, -0.16), yellow],
      );
      for (const s of [-1, 1]) {
        P.push(
          [cyl(0.072, 0.072, 0.04, 12).rotateX(Math.PI / 2 - 0.75).translate(s * 0.11, H + 0.27, 0.33), yellow],
          [cyl(0.05, 0.05, 0.05, 12).rotateX(Math.PI / 2 - 0.75).translate(s * 0.11, H + 0.275, 0.335), [0.6, 1.3, 2.2]],
          [onCape(box(0.035, 0.44, 0.01), s * 0.055, 0.6, 0.008), white],
        );
      }
      const flag = [[cyl(0.014, 0.014, 0.75, 5).translate(0, 0.375, 0), c(0xc8c8c8)]];
      for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) flag.push([box(0.075, 0.075, 0.012).translate(0.05 + i * 0.075, 0.68 - j * 0.075, 0), (i + j) % 2 ? black : white]);
      P.push(...xf(flag, (g) => g.rotateZ(-0.3).translate(0.12, 0.55, -0.44)));
      k.boot = 0x1c1c22;
      return k;
    }
    case 'runner_thunder': { // 빛나는 번개 왕관, 큰 번개 깃, 먹구름 깃, 가슴 번개 문장
      k.acc = 'none';
      k.tip = false;
      const bolt = [3, 2.6, 0.5], gold = c(0xffc83a), cloud = c(0x6a5a9a);
      P.push([torus(0.3, 0.045, 6, 22).rotateX(Math.PI / 2).translate(0, H + 0.36, -0.02), gold]);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + Math.PI / 2;
        const h = i % 2 ? 0.16 : 0.3;
        P.push([cone(0.05, h, 4).rotateX(Math.sin(a) * 0.3).rotateZ(-Math.cos(a) * 0.3).translate(Math.cos(a) * 0.3, H + 0.36 + h / 2, -0.02 + Math.sin(a) * 0.3), bolt]);
      }
      P.push(
        [cone(0.1, 0.52, 4).rotateX(-0.9).translate(0.22, H + 0.44, -0.18), bolt],
        [cone(0.1, 0.52, 4).rotateX(-0.9).translate(-0.22, H + 0.44, -0.18), bolt],
        [cone(0.04, 0.2, 4).rotateZ(-0.6).translate(0.46, 1.02, 0.02), bolt],
        [cone(0.04, 0.18, 4).rotateZ(0.7).translate(-0.45, 0.82, -0.05), bolt],
      );
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        P.push([ball(i % 2 ? 0.075 : 0.09, Math.cos(a) * 0.23, 0.88 + (i % 3) * 0.015, Math.sin(a) * 0.23), cloud]);
      }
      P.push(...xf([
        [cyl(0.11, 0.11, 0.015, 16).rotateX(Math.PI / 2).translate(0, 0, -0.008), c(0x2a1f5a)],
        [box(0.05, 0.13, 0.015).rotateZ(-0.5).translate(0.01, 0.055, 0), bolt],
        [box(0.11, 0.035, 0.015), bolt],
        [box(0.05, 0.13, 0.015).rotateZ(-0.5).translate(-0.005, -0.06, 0), bolt],
      ], (g) => onCape(g, 0, 0.62, 0.01)));
      k.boot = 0xffd23a;
      return k;
    }

    // ───────── 곰돌이: 튼튼한 몸, 방패 ─────────
    case 'bear_panda': { // 판다 털모자(까만 귀와 눈 무늬), 까만 어깨, 등에 멘 대나무
      k.acc = 'none';
      const black = c(0x1c1c22), white = c(0xf4f4f0);
      for (const s of [-1, 1]) {
        P.push(
          [ball(0.15, s * 0.27, H + 0.34, 0, 10), black],
          [new THREE.SphereGeometry(0.075, 10, 8).scale(1, 1.3, 0.45).rotateX(-0.7).rotateZ(s * 0.5).translate(s * 0.115, H + 0.33, 0.19), black],
          [ball(0.026, s * 0.11, H + 0.35, 0.215, 6), white],
        );
      }
      P.push(
        [new THREE.SphereGeometry(0.045, 8, 6).scale(1.3, 0.9, 1).translate(0, H + 0.28, 0.27), black],
        [torus(0.24, 0.085, 8, 18).rotateX(Math.PI / 2).translate(0, 0.85, 0), black],
      );
      const bamboo = c(0x6ab84a), node = c(0x3f8a32), leaf = c(0x4fae3c);
      for (const [x, a, len] of [[0.06, 0.45, 0.95], [-0.05, 0.22, 0.8]]) {
        const g = [[cyl(0.035, 0.035, len, 7), bamboo]];
        for (const t of [-0.3, 0, 0.3]) g.push([cyl(0.043, 0.043, 0.03, 7).translate(0, t * len, 0), node]);
        g.push(
          [new THREE.SphereGeometry(0.11, 6, 4).scale(0.35, 0.12, 1).rotateX(-0.5).translate(0.03, len / 2 + 0.02, 0.08), leaf],
          [new THREE.SphereGeometry(0.1, 6, 4).scale(1, 0.12, 0.35).rotateZ(0.4).translate(-0.08, len / 2 - 0.02, 0.02), leaf],
        );
        P.push(...xf(g, (gg) => gg.rotateZ(a).translate(x, 0.82, -0.44)));
      }
      k.boot = 0x1c1c22;
      return k;
    }
    case 'bear_polar': { // 북극곰 털모자(하얀 귀와 코), 털목도리, 눈꽃 배지
      k.acc = 'none';
      const fur = c(0xf4f8ff), inner = c(0xbfd8ff), scarf = c(0x5ab4ff), white = c(0xffffff), black = c(0x1c1c22);
      for (const s of [-1, 1]) {
        P.push(
          [ball(0.15, s * 0.27, H + 0.34, 0, 10), fur],
          [ball(0.08, s * 0.27, H + 0.35, 0.08), inner],
          [ball(0.024, s * 0.1, H + 0.35, 0.2, 6), black],
        );
      }
      P.push(
        [new THREE.SphereGeometry(0.1, 10, 8).scale(1.25, 0.8, 1).translate(0, H + 0.28, 0.24), fur],
        [ball(0.04, 0, H + 0.31, 0.33), black],
        [torus(0.24, 0.088, 8, 18).rotateX(Math.PI / 2).translate(0, 0.87, 0), scarf],
      );
      P.push(...xf([
        [box(0.12, 0.32, 0.05), scarf],
        [box(0.125, 0.035, 0.055).translate(0, -0.04, 0), white],
        [box(0.125, 0.035, 0.055).translate(0, -0.11, 0), white],
        ...[-0.04, 0, 0.04].map((x) => [box(0.02, 0.05, 0.02).translate(x, -0.18, 0), white]),
      ], (g) => onCape(g, 0.13, 0.68, 0.02)));
      const ice = [1.6, 2.2, 2.9];
      P.push(...xf([
        [box(0.15, 0.024, 0.012), ice],
        [box(0.15, 0.024, 0.012).rotateZ(Math.PI / 3), ice],
        [box(0.15, 0.024, 0.012).rotateZ(-Math.PI / 3), ice],
        [ball(0.025, 0, 0, 0.004, 6), white],
      ], (g) => onCape(g, -0.12, 0.6, 0.012)));
      k.boot = 0x8ab8e8;
      return k;
    }
    case 'bear_knight': { // 깃털 투구(곰 귀가 나온다), 어깨 갑옷, 방패 문장
      k.acc = 'none';
      k.tip = false;
      const steel = c(0xb8c0cc), gold = c(0xffc83a), plume = c(0xd83a3a), brown = c(0x8a5a34);
      P.push(
        [dome(0.43, 0.45).translate(0, H, 0), steel],
        [rim(0.43, 0.035, 0.45).translate(0, H, 0), gold],
        [box(0.055, 0.2, 0.04).translate(0, H + 0.095, 0.355), steel],
        [cyl(0.04, 0.05, 0.08, 8).translate(0, H + 0.45, -0.05), gold],
        [new THREE.SphereGeometry(0.1, 8, 6).scale(0.55, 1.5, 0.9).rotateX(-0.3).translate(0, H + 0.58, -0.04), plume],
        [new THREE.SphereGeometry(0.1, 8, 6).scale(0.55, 1.5, 0.9).rotateX(-0.95).translate(0, H + 0.56, -0.2), plume],
        [new THREE.SphereGeometry(0.09, 8, 6).scale(0.55, 1.5, 0.9).rotateX(-1.45).translate(0, H + 0.47, -0.35), plume],
      );
      for (const s of [-1, 1]) {
        P.push(
          [ball(0.13, s * 0.3, H + 0.3, 0, 10), brown],
          [ball(0.07, s * 0.3, H + 0.31, 0.07), c(0xe8b890)],
          ...xf([
            [new THREE.SphereGeometry(0.17, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1.1), steel],
            [torus(0.17, 0.02, 4, 16).rotateX(Math.PI / 2).scale(1, 1, 1.1), gold],
          ], (g) => g.rotateZ(-s * 0.35).translate(s * 0.3, 0.84, 0)),
        );
      }
      const blue = c(0x2f5fb8);
      P.push(...xf([
        [box(0.2, 0.1, 0.012).translate(0, 0.09, -0.006), gold],
        [cyl(0.115, 0.115, 0.012, 3).rotateX(Math.PI / 2).translate(0, 0, -0.006), gold],
        [box(0.173, 0.08, 0.015).translate(0, 0.09, 0), blue],
        [cyl(0.1, 0.1, 0.015, 3).rotateX(Math.PI / 2), blue],
        [new THREE.SphereGeometry(0.03, 8, 6).scale(1.2, 1, 0.5).translate(0, 0.02, 0.012), gold],
        [ball(0.014, -0.032, 0.065, 0.012, 5), gold],
        [ball(0.014, 0, 0.078, 0.012, 5), gold],
        [ball(0.014, 0.032, 0.065, 0.012, 5), gold],
      ], (g) => onCape(g, 0, 0.58, 0.012)));
      k.boot = 0x8c96a4;
      return k;
    }

    // ───────── 올빼미: 멀리 보는 눈 ─────────
    case 'owl_snow': { // 금테 고글(호박색으로 빛나는 렌즈), 하얀 깃털 뿔, 점박이 가슴 깃털
      k.acc = 'none';
      const white = c(0xf4f2ea), gold = c(0xffc83a), lens = [2.4, 1.6, 0.4], speck = c(0x3a3a42);
      P.push([torus(0.372, 0.02, 4, 26).rotateX(Math.PI / 2).translate(0, H + 0.02, 0), gold]);
      for (const s of [-1, 1]) {
        P.push(
          [cyl(0.12, 0.12, 0.08, 14).rotateX(Math.PI / 2).translate(s * 0.14, H + 0.02, 0.33), gold],
          [cyl(0.075, 0.075, 0.1, 12).rotateX(Math.PI / 2).translate(s * 0.14, H + 0.02, 0.345), lens],
          [cone(0.08, 0.3, 5).rotateZ(-s * 0.5).translate(s * 0.3, H + 0.38, 0.05), white],
        );
      }
      for (const [x, y] of [[0, 0.72], [-0.08, 0.63], [0.08, 0.63], [0, 0.55], [-0.13, 0.5], [0.13, 0.5], [0, 0.45]]) {
        P.push([onCape(new THREE.SphereGeometry(0.07, 8, 6).scale(1.2, 0.7, 0.35), x, y, 0), white]);
      }
      for (const [x, y] of [[-0.06, 0.66], [0.07, 0.56], [-0.1, 0.47], [0.12, 0.44]]) P.push([onCape(ball(0.017, 0, 0, 0, 4), x, y, 0.02), speck]);
      k.boot = 0xe8b030;
      return k;
    }
    case 'owl_detective': { // 사냥 모자, 외알 안경, 나비넥타이, 왼손에 돋보기
      k.acc = 'none';
      k.tip = false;
      const tweed = c(0x8a6a40), line = c(0x5a4428), gold = c(0xffc83a), red = c(0xa82a2a), brown = c(0x8a5a34);
      P.push(
        [new THREE.SphereGeometry(0.41, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.85, 1).translate(0, H + 0.12, 0), tweed],
        [new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14, 1, false, -Math.PI / 2, Math.PI).rotateX(0.18).translate(0, H + 0.15, 0.22), tweed],
        [new THREE.CylinderGeometry(0.3, 0.3, 0.03, 14, 1, false, Math.PI / 2, Math.PI).rotateX(-0.18).translate(0, H + 0.15, -0.22), tweed],
        [new THREE.CylinderGeometry(0.412, 0.41, 0.03, 22, 1, true).translate(0, H + 0.2, 0), line],
        [torus(0.41, 0.012, 4, 20, Math.PI).scale(1, 0.85, 1).translate(0, H + 0.12, 0), line],
        [torus(0.41, 0.012, 4, 20, Math.PI).rotateY(Math.PI / 2).scale(1, 0.85, 1).translate(0, H + 0.12, 0), line],
        [ball(0.035, 0, H + 0.48, 0), line],
        [new THREE.SphereGeometry(0.04, 6, 5).scale(1.4, 0.7, 1).translate(0.06, H + 0.47, 0), line],
        [new THREE.SphereGeometry(0.04, 6, 5).scale(1.4, 0.7, 1).translate(-0.06, H + 0.47, 0), line],
        [cone(0.08, 0.3, 5).rotateZ(-0.55).translate(0.33, H + 0.36, 0.0), brown],
        [cone(0.08, 0.3, 5).rotateZ(0.55).translate(-0.33, H + 0.36, 0.0), brown],
        // 외알 안경과 줄
        [torus(0.08, 0.016, 6, 18).translate(0.13, H + 0.01, 0.35), gold],
        [box(0.012, 0.28, 0.012).rotateZ(0.4).translate(0.185, H - 0.2, 0.28), gold],
        // 나비넥타이
        [cone(0.056, 0.11, 4).rotateZ(Math.PI / 2).translate(0.056, 0.83, 0.25), red],
        [cone(0.056, 0.11, 4).rotateZ(-Math.PI / 2).translate(-0.056, 0.83, 0.25), red],
        [ball(0.03, 0, 0.83, 0.27), c(0x7a1a1a)],
      );
      k.arm = [
        [cyl(0.022, 0.022, 0.18, 6).rotateX(-0.5).translate(0, -0.38, 0.043), c(0x6a4428)],
        [torus(0.085, 0.018, 6, 18).rotateX(-0.5).translate(0, -0.53, 0.13), gold],
        [cyl(0.07, 0.07, 0.012, 14).rotateX(Math.PI / 2 - 0.5).translate(0, -0.53, 0.13), [1.3, 1.7, 2.0]],
      ];
      return k;
    }
    case 'owl_wizard': { // 별이 빛나는 뾰족 모자와 초승달, 금색 옷단, 왼손에 별 지팡이
      k.acc = 'face';
      k.tip = false;
      const navy = c(0x2a3280), brim = c(0x232a6a), gold = c(0xffc83a), star = [3, 2.7, 1.3];
      const onHat = (g) => g.rotateX(-0.28).translate(0, H + 0.3, -0.05);
      P.push(
        [cyl(0.56, 0.56, 0.04, 24).rotateX(-0.12).translate(0, H + 0.3, -0.03), brim],
        [onHat(cone(0.31, 0.72, 16).translate(0, 0.36, 0)), navy],
        [cone(0.1, 0.32, 8).rotateX(-1.9).translate(0, H + 0.9, -0.38), navy],
        [onHat(new THREE.CylinderGeometry(0.3, 0.315, 0.08, 16, 1, true).translate(0, 0.05, 0)), gold],
        [onHat(torus(0.075, 0.024, 6, 14, Math.PI * 1.25).rotateZ(Math.PI * 0.375).rotateX(-0.41).translate(0, 0.22, 0.25)), [3, 2.4, 0.8]],
        [torus(0.35, 0.022, 4, 24).rotateX(Math.PI / 2).translate(0, 0.41, 0), gold],
      );
      for (const [a, h] of [[0.9, 0.16], [2.3, 0.3], [-1.2, 0.42], [1.4, 0.55], [3.0, 0.12], [-2.4, 0.26], [-0.3, 0.4]]) {
        const r = 0.31 * (1 - h / 0.72) + 0.01;
        P.push([onHat(new THREE.OctahedronGeometry(0.04).translate(r * Math.sin(a), h, r * Math.cos(a))), star]);
      }
      k.arm = [
        [cyl(0.022, 0.03, 0.95, 6).translate(0, -0.28, 0.1), c(0x6a4428)],
        [new THREE.OctahedronGeometry(0.085).translate(0, 0.28, 0.1), star],
        [torus(0.075, 0.012, 4, 16).translate(0, 0.28, 0.1), gold],
      ];
      k.boot = 0x2a2f7a;
      return k;
    }

    // ───────── 반디: 반딧불을 모으는 등불 ─────────
    case 'collector_bee': { // 줄무늬 망토, 빛나는 더듬이, 반짝이는 날개, 침
      k.acc = 'none';
      const black = c(0x1c1c22), wing = [1.3, 1.5, 1.65], tip = [3, 2.6, 0.6];
      P.push([band(0.66, 0.07), black], [band(0.5, 0.07), black], [cone(0.05, 0.16, 6).rotateX(-Math.PI / 2).translate(0, 0.45, -0.38), black]);
      for (const s of [-1, 1]) {
        P.push(
          [cyl(0.016, 0.016, 0.34, 5).rotateZ(-s * 0.45).translate(s * 0.114, H + 0.473, 0.06), black],
          [ball(0.06, s * 0.19, H + 0.63, 0.06, 10), tip],
          [new THREE.SphereGeometry(0.2, 12, 8).scale(1, 0.5, 0.1).rotateZ(s * 0.55).rotateY(s * 0.35).translate(s * 0.22, 0.86, -0.43), wing],
          [new THREE.SphereGeometry(0.14, 10, 6).scale(1, 0.5, 0.1).rotateZ(-s * 0.25).rotateY(s * 0.35).translate(s * 0.2, 0.66, -0.43), wing],
        );
      }
      k.boot = 0x1c1c22;
      return k;
    }
    case 'collector_fairy': { // 머리 위 등불은 그대로 + 꽃 화관, 빛나는 네 날개, 주위를 도는 반딧불
      const wing = [0.7, 1.9, 1.6], wing2 = [1.1, 1.6, 2.2], fly = [2.8, 3, 1];
      for (const s of [-1, 1]) {
        P.push(
          [new THREE.SphereGeometry(0.24, 12, 8).scale(1, 0.55, 0.08).rotateZ(s * 0.7).rotateY(s * 0.3).translate(s * 0.25, 0.94, -0.42), wing],
          [new THREE.SphereGeometry(0.17, 10, 6).scale(1, 0.5, 0.08).rotateZ(-s * 0.35).rotateY(s * 0.3).translate(s * 0.2, 0.64, -0.42), wing2],
        );
      }
      P.push(...circlet(H, 0.22, 0.36, [0xff8ab8, 0xffd23a, 0xffffff, 0xc58bff]));
      P.push(...motes([[0.46, 1.05, 0.12, 0.035], [-0.44, 0.78, -0.1, 0.03], [0.32, 1.62, -0.25, 0.028], [-0.3, 0.45, 0.32, 0.03]], fly));
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        P.push([ball(0.022, Math.cos(a) * 0.375, 0.39, Math.sin(a) * 0.375, 5), [1.8, 2.6, 2.2]]);
      }
      k.boot = 0x4fae3c;
      return k;
    }
    case 'collector_lord': { // 반딧불 보석 왕관, 담비털 깃, 반딧불 메달, 왼손에 등불 지팡이
      k.acc = 'none';
      k.tip = false;
      const gold = c(0xffc21a), gem = [3.2, 2.6, 0.8];
      P.push(
        [new THREE.CylinderGeometry(0.27, 0.25, 0.16, 16, 1, true).translate(0, H + 0.4, -0.02), gold],
        [new THREE.SphereGeometry(0.25, 14, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.6, 1).translate(0, H + 0.42, -0.02), c(0x6a2a8a)],
      );
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + Math.PI / 2;
        const x = Math.cos(a) * 0.26, z = -0.02 + Math.sin(a) * 0.26;
        P.push([cone(0.07, 0.22, 5).translate(x, H + 0.58, z), gold], [ball(0.05, x, H + 0.72, z, 10), gem]);
      }
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        P.push([ball(0.1, Math.cos(a) * 0.25, 0.88, Math.sin(a) * 0.25, 7), c(0xfdfdfd)]);
        if (i % 3 === 0) P.push([ball(0.03, Math.cos(a) * 0.33, 0.9, Math.sin(a) * 0.33, 4), c(0x1c1c22)]);
      }
      P.push(...xf([
        [cyl(0.07, 0.07, 0.022, 14).rotateX(Math.PI / 2), gold],
        [ball(0.035, 0, 0, 0.015), gem],
      ], (g) => onCape(g, 0, 0.68, 0.012)));
      P.push(...motes([[0.44, 1.2, 0.1, 0.03], [-0.42, 0.95, -0.15, 0.026]], gem));
      k.arm = [
        [cyl(0.024, 0.032, 1.0, 6).translate(0, -0.25, 0.1), c(0x4a2f1e)],
        [cyl(0.085, 0.085, 0.03, 6).translate(0, 0.27, 0.1), gold],
        [cyl(0.065, 0.065, 0.14, 6).translate(0, 0.355, 0.1), gem],
        [cone(0.095, 0.09, 6).translate(0, 0.47, 0.1), gold],
        [torus(0.03, 0.01, 4, 10).translate(0, 0.53, 0.1), gold],
      ];
      k.boot = 0x5a3a22;
      return k;
    }

    // ───────── 그림자: 숨어서 노린다 ─────────
    case 'ninja_fox': { // 여우 귀, 옆머리에 쓴 여우 가면, 바람에 날리는 붉은 목도리
      k.acc = 'face';
      const white = c(0xf4f0ea), red = c(0xd83a2a), scarf = c(0xc0302a);
      for (const s of [-1, 1]) {
        P.push(...xf([
          [cone(0.11, 0.26, 4), white],
          [cone(0.06, 0.15, 4).translate(0, -0.03, 0.05), red],
        ], (g) => g.rotateZ(-s * 0.35).translate(s * 0.2, H + 0.38, -0.02)));
      }
      P.push(...xf([
        [new THREE.SphereGeometry(0.15, 12, 8).scale(0.95, 1, 0.5), white],
        [cone(0.06, 0.12, 6).rotateX(Math.PI / 2).translate(0, -0.04, 0.1), white],
        [ball(0.022, 0, -0.04, 0.16, 5), c(0x1c1c22)],
        [box(0.07, 0.018, 0.01).rotateZ(0.5).translate(0.06, 0.04, 0.072), red],
        [box(0.07, 0.018, 0.01).rotateZ(-0.5).translate(-0.06, 0.04, 0.072), red],
        [ball(0.02, 0, 0.09, 0.07, 5), red],
        [cone(0.05, 0.11, 4).rotateZ(-0.3).translate(0.08, 0.15, -0.01), white],
        [cone(0.05, 0.11, 4).rotateZ(0.3).translate(-0.08, 0.15, -0.01), white],
      ], (g) => g.rotateZ(-0.25).rotateY(1.25).translate(0.34, H + 0.14, 0.04)));
      P.push(
        [torus(0.23, 0.07, 6, 18).rotateX(Math.PI / 2).translate(0, 0.87, 0), scarf],
        [box(0.1, 0.035, 0.5).rotateX(0.35).translate(0.12, 0.82, -0.5), scarf],
        [box(0.09, 0.035, 0.42).rotateX(0.5).translate(-0.05, 0.76, -0.46), scarf],
      );
      k.boot = 0x2a2a30;
      return k;
    }
    case 'ninja_samurai': { // 초승달 장식 투구와 목 가리개, 어깨 갑옷, 등에 멘 칼 (얼굴 가리개는 그대로)
      k.acc = 'face';
      k.tip = false;
      const lac = c(0x2a2228), red = c(0xb8302a), red2 = c(0x8a2420), gold = c(0xffc83a);
      const tilt = (g) => g.rotateX(-0.45).translate(0, H, 0);
      P.push(
        [dome(0.43, 0.45).translate(0, H, 0), lac],
        [rim(0.43, 0.03, 0.45).translate(0, H, 0), gold],
        [tilt(new THREE.CylinderGeometry(0.43, 0.5, 0.12, 20, 1, true, 1.0, Math.PI * 2 - 2.0).translate(0, -0.06, 0)), red],
        [tilt(new THREE.CylinderGeometry(0.5, 0.57, 0.1, 20, 1, true, 1.1, Math.PI * 2 - 2.2).translate(0, -0.165, 0)), red2],
        [torus(0.2, 0.028, 6, 18, Math.PI * 1.3).rotateZ(Math.PI * 0.85).rotateX(-0.25).translate(0, H + 0.45, 0.38), gold],
        [cyl(0.05, 0.05, 0.03, 12).rotateX(Math.PI / 2 - 0.3).translate(0, H + 0.27, 0.37), gold],
        [box(0.03, 0.12, 0.16).rotateY(0.5).translate(0.37, H + 0.1, 0.17), red],
        [box(0.03, 0.12, 0.16).rotateY(-0.5).translate(-0.37, H + 0.1, 0.17), red],
      );
      for (const s of [-1, 1]) {
        P.push(...xf([
          [box(0.2, 0.16, 0.22), red],
          [box(0.205, 0.018, 0.225).translate(0, 0.03, 0), gold],
          [box(0.205, 0.018, 0.225).translate(0, -0.03, 0), gold],
        ], (g) => g.rotateZ(-s * 0.4).translate(s * 0.33, 0.8, 0)));
      }
      P.push(...xf([
        [cyl(0.032, 0.028, 0.62, 6).translate(0, -0.2, 0), c(0x1c1c22)],
        [cyl(0.036, 0.036, 0.04, 6).translate(0, -0.49, 0), gold],
        [cyl(0.075, 0.075, 0.02, 10).translate(0, 0.12, 0), gold],
        [cyl(0.03, 0.03, 0.24, 6).translate(0, 0.25, 0), c(0xe8e2d6)],
        [cyl(0.032, 0.032, 0.03, 6).translate(0, 0.38, 0), gold],
      ], (g) => g.rotateZ(0.75).translate(-0.02, 0.72, -0.44)));
      k.boot = 0x2a2228;
      return k;
    }
    case 'ninja_void': { // 보랏빛으로 빛나는 눈, 길게 늘어진 두건, 발밑을 떠다니는 그림자
      k.acc = 'face';
      k.tip = false;
      const dark = c(0x1a1428), shadow = c(0x2a1f44), purple = [2.2, 0.9, 3.2];
      P.push(
        ...[-1, 1].map((s) => [new THREE.SphereGeometry(0.055, 8, 6).scale(1.5, 0.55, 0.4).rotateZ(s * 0.25).translate(s * 0.13, H + 0.02, 0.345), purple]),
        [cone(0.19, 0.62, 10).rotateX(-1.25).translate(0, H + 0.3, -0.44), dark],
        [torus(0.425, 0.014, 4, 24).rotateX(Math.PI / 2).translate(0, H + 0.14, 0), purple],
        [torus(0.355, 0.02, 4, 26).rotateX(Math.PI / 2).translate(0, 0.39, 0), purple],
      );
      P.push(...motes([[0.26, 0.46, -0.36, 0.1], [-0.22, 0.52, -0.4, 0.09], [0.04, 0.4, -0.5, 0.085], [-0.36, 0.38, -0.12, 0.07], [0.38, 0.4, 0.0, 0.065], [0.12, 0.3, -0.62, 0.06], [-0.1, 0.28, -0.7, 0.045]], shadow));
      P.push(...motes([[0.45, 1.05, -0.1, 0.03], [-0.42, 0.9, 0.1, 0.025], [0.25, 1.55, -0.35, 0.028], [-0.3, 0.55, 0.35, 0.025]], [1.8, 0.8, 3]));
      k.boot = 0x1a1428;
      return k;
    }

    // ───────── 약초꾼: 치유 ─────────
    case 'healer_mushroom': { // 물방울무늬 버섯 모자(꼭대기에 새싹), 허리띠에 찬 물약 두 병
      k.acc = 'face';
      k.tip = false;
      const cap = c(0xd84a3a), dot = c(0xfff4e6), leaf = c(0x58b84a), glass = c(0xcfe8ff), cork = c(0x9a6a4a);
      P.push(
        [new THREE.SphereGeometry(0.52, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.62, 1).translate(0, H + 0.2, -0.02), cap],
        [cyl(0.5, 0.3, 0.06, 20).translate(0, H + 0.19, -0.02), c(0xf4e6c8)],
        [cyl(0.025, 0.025, 0.16, 5).translate(0, H + 0.58, -0.02), leaf],
        [new THREE.SphereGeometry(0.12, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(0.5).translate(0.12, H + 0.68, -0.02), leaf],
        [new THREE.SphereGeometry(0.12, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(-0.5).translate(-0.12, H + 0.68, -0.02), leaf],
      );
      for (const [th, ph] of [[0.75, 0.3], [0.75, 1.9], [0.75, 3.5], [0.75, 5.0], [1.25, 1.1], [1.25, 2.7], [1.25, 4.2], [1.25, 5.8], [1.25, 0.2]]) {
        P.push([ball(0.06, 0.5 * Math.sin(th) * Math.cos(ph), H + 0.2 + 0.31 * Math.cos(th), -0.02 + 0.5 * Math.sin(th) * Math.sin(ph)), dot]);
      }
      P.push([band(0.5, 0.06), c(0x5a3a22)]);
      for (const [s, liquid] of [[1, [0.6, 2.4, 0.9]], [-1, [2.4, 0.8, 1.4]]]) {
        P.push(
          [ball(0.072, s * 0.2, 0.43, 0.3, 10), liquid],
          [cyl(0.028, 0.034, 0.07, 8).translate(s * 0.2, 0.52, 0.3), glass],
          [cyl(0.03, 0.03, 0.04, 8).translate(s * 0.2, 0.57, 0.3), cork],
        );
      }
      k.boot = 0x6a4a2a;
      return k;
    }
    case 'healer_flower': { // 새싹이 활짝 핀 꽃, 꽃 화관, 가슴 꽃, 치맛단 꽃잎
      k.acc = 'face';
      const leaf = c(0x58b84a), pink = c(0xff8ab8), yellow = c(0xffd23a);
      P.push(...circlet(H, 0.24, 0.35, [0xff8ab8, 0xffffff, 0xffd23a, 0xc58bff, 0xff5a8a]));
      P.push(
        [cyl(0.025, 0.025, 0.26, 5).translate(0, H + 0.5, 0), leaf],
        [new THREE.SphereGeometry(0.12, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(0.5).translate(0.12, H + 0.52, 0), leaf],
        [new THREE.SphereGeometry(0.12, 8, 6).scale(1.3, 0.35, 0.8).rotateZ(-0.5).translate(-0.12, H + 0.52, 0), leaf],
      );
      P.push(...xf(flower(pink, yellow, 0.13, 6), (g) => g.rotateX(-Math.PI / 2 + 0.3).translate(0, H + 0.65, 0.02)));
      P.push(...xf(flower(c(0xff5a8a), yellow, 0.07), (g) => onCape(g, -0.12, 0.66, 0.015)));
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        P.push([new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.4, 0.7).rotateY(-a).translate(Math.cos(a) * 0.37, 0.38, Math.sin(a) * 0.37), i % 2 ? pink : c(0xffffff)]);
      }
      k.boot = 0x4fae3c;
      return k;
    }
    case 'healer_sage': { // 잎사귀 달린 사슴뿔, 잎사귀 망토, 떠다니는 포자, 왼손에 빛나는 지팡이
      k.acc = 'face';
      const bone = c(0xe0d2b4), leaf = c(0x58b84a), leaf2 = c(0x3f9a4a), bloom = [2.4, 2.8, 1.6], spore = [1.6, 3, 1.2];
      for (const s of [-1, 1]) {
        P.push(
          [cyl(0.025, 0.036, 0.36, 6).rotateZ(-s * 0.5).translate(s * 0.234, H + 0.454, -0.02), bone],
          [cyl(0.018, 0.024, 0.2, 5).rotateZ(s * 0.2).translate(s * 0.214, H + 0.552, -0.02), bone],
          [cyl(0.018, 0.024, 0.17, 5).rotateZ(-s * 1.1).translate(s * 0.362, H + 0.595, -0.02), bone],
          [new THREE.SphereGeometry(0.07, 6, 4).scale(1, 0.35, 0.6).rotateZ(-s * 0.6).translate(s * 0.33, H + 0.63, -0.02), leaf],
          [new THREE.SphereGeometry(0.06, 6, 4).scale(1, 0.35, 0.6).rotateZ(s * 0.4).translate(s * 0.19, H + 0.67, -0.02), leaf2],
          [ball(0.035, s * 0.44, H + 0.64, -0.02, 6), bloom],
        );
      }
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        P.push([new THREE.SphereGeometry(0.12, 8, 5).scale(0.55, 0.18, 1.1).rotateX(0.55).rotateY(a).translate(Math.sin(a) * 0.25, 0.86, Math.cos(a) * 0.25), i % 2 ? leaf : leaf2]);
      }
      P.push(...motes([[0.44, 1.1, 0.15, 0.028], [-0.4, 0.7, 0.2, 0.024], [0.3, 1.66, -0.2, 0.026], [-0.35, 1.4, -0.3, 0.022]], spore));
      k.arm = [
        [cyl(0.022, 0.034, 1.0, 6).translate(0, -0.26, 0.1), c(0x6a4a2a)],
        [ball(0.085, 0, 0.33, 0.1, 12), spore],
        [torus(0.1, 0.016, 4, 14, 4.8).rotateY(0.6).translate(0, 0.3, 0.1), leaf2],
        [new THREE.SphereGeometry(0.06, 6, 4).scale(1, 0.3, 0.6).rotateZ(0.5).translate(0.08, 0.2, 0.1), leaf],
        [new THREE.SphereGeometry(0.05, 6, 4).scale(1, 0.3, 0.6).rotateZ(-0.6).translate(-0.07, 0.41, 0.12), leaf],
      ];
      k.boot = 0x4a3420;
      return k;
    }
    default:
      return k;
  }
}

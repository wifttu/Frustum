// 맵 데이터. 모든 맵은 같은 크기의 정사각형 아레나이고 축 정렬 상자(AABB)로 이루어진다.
//   walls: 이동과 시야를 모두 막는다 (울타리, 나무, 건물...)
//   water: 이동만 막고 시야는 막지 않는다 (호수: 건너편은 보이지만 건너갈 수 없다)
// kind 는 클라이언트가 그릴 모양이다 (판정과 무관).
export const MAP_SIZE = 64;
export const WALL_HEIGHT = 3;

const H = MAP_SIZE / 2;
const OUTER = [
  [0, -H, MAP_SIZE + 1, 1, 'palisade'],
  [0, H, MAP_SIZE + 1, 1, 'palisade'],
  [-H, 0, 1, MAP_SIZE + 1, 'palisade'],
  [H, 0, 1, MAP_SIZE + 1, 'palisade'],
];

// 한 사분면(x>0, z>0)의 정의를 네 방향으로 대칭 복사한다 (공정한 맵)
function mirror4(list) {
  const out = [];
  for (const [x, z, w, d, kind] of list) {
    for (const sx of [1, -1]) for (const sz of [1, -1]) out.push([x * sx, z * sz, w, d, kind]);
  }
  return out;
}
// 축 위의 오브젝트는 두 방향으로만
function mirror2(list) {
  const out = [];
  for (const [x, z, w, d, kind] of list) {
    out.push([x, z, w, d, kind], [-x, -z, w, d, kind]);
  }
  return out;
}

function box([cx, cz, w, d, kind]) {
  return { cx, cz, w, d, kind, minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2 };
}

function makeMap(id, name, def) {
  const walls = [...OUTER, ...def.walls].map(box);
  const water = (def.water || []).map(box);
  return {
    id, name, walls, water,
    solid: water.length ? [...walls, ...water] : walls, // 이동 충돌용
    roads: def.roads || [],
    ground: def.ground,
  };
}

// 1) 캠핑장: 중앙 오두막, 텐트, 울타리, 돌담
const CAMP = makeMap('camp', '한밤의 캠핑장', {
  ground: { base: '#86b356', patches: ['rgba(120,170,70,.35)', 'rgba(150,195,95,.3)', 'rgba(95,150,70,.3)'], road: ['#b8935c', '#d2b07a'] },
  walls: [
    [0, 0, 6, 6, 'cabin'],
    ...mirror2([[0, 14, 8, 1.5], [14, 0, 1.5, 8], [0, 25, 1.5, 6], [25, 0, 6, 1.5]]),
    ...mirror4([[10, 10, 2, 2], [18, 8, 8, 1.5], [8, 19, 1.5, 9], [22, 20, 3, 3, 'tent'], [16, 26, 10, 1.5], [27, 12, 1.5, 7], [14, 15, 2, 2]]),
  ],
  roads: [
    [[[-30, 5], [-12, 6], [-6, 6], [6, 6], [12, 5], [30, 6]], 1],
    [[[5, -30], [6, -12], [6, 6], [5, 12], [6, 30]], 1],
    [[[-21, -21], [21, -21], [21, 21], [-21, 21], [-21, -21]], 0.8],
  ],
});

// 2) 소나무 숲: 나무가 빽빽해 시야가 자주 끊긴다. 좁은 오솔길과 생울타리.
const FOREST = makeMap('forest', '소나무 숲', {
  ground: { base: '#6f9c4a', patches: ['rgba(80,130,60,.4)', 'rgba(120,160,80,.3)', 'rgba(110,95,60,.25)'], road: ['#9c7b4c', '#b8955f'] },
  walls: [
    [0, 0, 2.4, 2.4, 'rock'],
    ...mirror4([
      [6, 6, 1.6, 1.6, 'tree'], [10, 3.5, 1.6, 1.6, 'tree'], [3.5, 11, 1.6, 1.6, 'tree'], [13, 10, 1.6, 1.6, 'tree'],
      [9, 15, 1.6, 1.6, 'tree'], [17, 6, 1.6, 1.6, 'tree'], [20, 12, 1.6, 1.6, 'tree'], [15, 19, 1.6, 1.6, 'tree'],
      [25, 25, 1.6, 1.6, 'tree'], [26, 8, 1.6, 1.6, 'tree'], [5, 22, 1.6, 1.6, 'tree'], [27, 17, 1.6, 1.6, 'tree'],
      [18, 27.5, 1.6, 1.6, 'tree'], [11, 28, 1.6, 1.6, 'tree'], [28, 3, 1.6, 1.6, 'tree'],
      [12, 25, 8, 1.4, 'hedge'], [22, 18, 1.4, 8, 'hedge'], [20, 4, 1.8, 1.8, 'rock'], [4, 17, 2, 2, 'crates'],
    ]),
  ],
  roads: [
    [[[-31, 0.5], [-20, -1], [-8, 1], [8, -1], [20, 1], [31, -0.5]], 0.9],
    [[[0.5, -31], [-1, -20], [1, -8], [-1, 8], [1, 20], [-0.5, 31]], 0.9],
  ],
});

// 3) 호숫가: 가운데 십자 모양 호수. 건너편이 훤히 보이지만 손전등(6m)은 닿지 않는다.
const LAKE = makeMap('lake', '호숫가', {
  ground: { base: '#8dba5c', patches: ['rgba(130,180,80,.35)', 'rgba(160,200,100,.3)', 'rgba(100,150,70,.3)'], road: ['#c2a26c', '#dcc08a'] },
  water: [[0, 0, 12, 8], [0, 0, 8, 12]],
  walls: mirror4([
    [21, 21, 5, 5, 'cabin'], [14, 12, 3, 3, 'tent'], [8, 15, 1.8, 1.8, 'rock'], [17, 6, 2, 2, 'rock'],
    [26, 10, 1.4, 7, 'fence'], [10, 26, 7, 1.4, 'fence'], [27, 3.5, 2, 2, 'crates'], [13, 22, 6, 1.4, 'stone'],
    [4, 27, 1.6, 1.6, 'tree'], [27, 27, 1.6, 1.6, 'tree'],
  ]),
  roads: [[[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], 1], [[[-21, -21], [-10, -10]], 0.8], [[[21, 21], [10, 10]], 0.8], [[[21, -21], [10, -10]], 0.8], [[[-21, 21], [-10, 10]], 0.8]],
});

export const MAPS = { camp: CAMP, forest: FOREST, lake: LAKE };
export const MAP_ROTATION = ['camp', 'forest', 'lake'];

// 기존 코드 호환: 기본 맵(캠핑장)
export const WALLS = CAMP.walls;

export function isFree(x, z, clearance, walls = WALLS) {
  const lim = H - 0.5 - clearance;
  if (x < -lim || x > lim || z < -lim || z > lim) return false;
  for (const w of walls) {
    if (x > w.minX - clearance && x < w.maxX + clearance && z > w.minZ - clearance && z < w.maxZ + clearance)
      return false;
  }
  return true;
}

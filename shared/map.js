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

// def.outer: 바깥 울타리 모양, def.deco: 판정 없는 꾸밈 [x, z, 종류], def.look: 조명·물 모양 (클라이언트 전용)
// def.half: 작은 맵. 바깥 울타리를 ±half 에 세우고, 그 밖은 들어갈 수 없는 어둠('void')으로 채운다.
function makeMap(id, name, def) {
  const h = def.half || H;
  const L = h * 2 + 1;
  const outer = [[0, -h, L, 1], [0, h, L, 1], [-h, 0, 1, L], [h, 0, 1, L]].map(([x, z, w, d]) => [x, z, w, d, def.outer || 'palisade']);
  // 울타리 바깥: 맵 끝까지 막는 큰 상자 4개 (그리지 않는다)
  const t = H - h; // 두께
  const voids = def.half
    ? [[0, -(h + 0.5 + t / 2), MAP_SIZE + 1, t], [0, h + 0.5 + t / 2, MAP_SIZE + 1, t], [-(h + 0.5 + t / 2), 0, t, L], [h + 0.5 + t / 2, 0, t, L]].map((b) => [...b, 'void'])
    : [];
  const walls = [...outer, ...voids, ...def.walls].map(box);
  const water = (def.water || []).map(box);
  return {
    id, name, walls, water,
    solid: water.length ? [...walls, ...water] : walls, // 이동 충돌용
    roads: def.roads || [],
    ground: def.ground,
    deco: def.deco || [],
    look: { water: 'lake', sky: 0xfff0d8, earth: 0x6b5a45, sun: 0xfff2dc, ...def.look },
    half: h, // 걸어 다닐 수 있는 범위 (작은 맵이면 32 보다 작다)
    gates: (def.gates || []).map(box), // 닫을 수 있는 문 (평소에는 열려 있다 = walls 에 없음)
  };
}
// 문을 닫은 맵: 문을 벽으로 더한 사본 (원래 맵은 그대로)
export function closedMap(map) {
  if (!map.gates?.length) return map;
  const walls = [...map.walls, ...map.gates];
  return { ...map, walls, solid: map.water.length ? [...walls, ...map.water] : walls, closed: true };
}
// 꾸밈 대칭 복사
const deco4 = (list) => mirror4(list.map(([x, z, k]) => [x, z, 0, 0, k])).map(([x, z, , , k]) => [x, z, k]);

// 1) 캠핑장: 중앙 오두막, 텐트, 울타리, 돌담
const CAMP = makeMap('camp', '한밤의 캠핑장', {
  ground: { base: '#86b356', patches: ['rgba(120,170,70,.35)', 'rgba(150,195,95,.3)', 'rgba(95,150,70,.3)'], road: ['#b8935c', '#d2b07a'] },
  walls: [
    [0, 0, 6, 6, 'cabin'],
    ...mirror2([[0, 14, 8, 1.5], [14, 0, 1.5, 8], [0, 25, 1.5, 6], [25, 0, 6, 1.5]]),
    ...mirror4([[10, 10, 2, 2], [18, 8, 8, 1.5], [8, 19, 1.5, 9], [22, 20, 3, 3, 'tent'], [16, 26, 10, 1.5], [27, 12, 1.5, 7], [14, 15, 2, 2]]),
    ...mirror4([[25.5, 25.5, 1.6, 1.6, 'tree'], [29, 20, 1.6, 1.6, 'tree'], [20, 29, 1.6, 1.6, 'tree']]),
  ],
  deco: [
    ...deco4([[4.5, 4.5, 'campfire'], [12, 3, 'lamp'], [3, 12, 'lamp'], [21, 14, 'log'], [14, 21, 'log'], [27.5, 27.5, 'lamp'], [11, 23, 'bush'], [23, 11, 'bush'], [29, 4, 'stump'], [4, 29, 'stump']]),
    ...deco4([[18, 18, 'flowers'], [6, 9, 'flowers'], [26, 16, 'bush'], [16, 22, 'chair']]),
  ],
  look: { sky: 0xfff0d8, earth: 0x6b5a45, sun: 0xfff2dc },
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
  deco: deco4([
    [8, 2.5, 'mushroom'], [2.5, 8, 'mushroom'], [15, 13, 'stump'], [11, 18, 'bush'], [23, 23, 'mushroom'], [19, 15, 'log'],
    [6, 13, 'flowers'], [24, 4, 'bush'], [29, 12, 'stump'], [14, 6, 'lamp'], [28, 28, 'bush'], [7, 28, 'mushroom'],
  ]),
  look: { sky: 0xe8f5d8, earth: 0x4a5a3a, sun: 0xf0ffe0 },
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
  deco: deco4([[7, 5, 'reeds'], [5, 7, 'reeds'], [11, 9, 'lamp'], [9, 11, 'lamp'], [17, 17, 'bench'], [23, 14, 'flowers'], [14, 23, 'flowers'], [3, 20, 'bush'], [20, 3, 'bush'], [29, 22, 'stump']]),
  look: { sky: 0xf0f2ff, earth: 0x5a6a5a, sun: 0xfff6e8 },
  roads: [[[[-10, -10], [10, -10], [10, 10], [-10, 10], [-10, -10]], 1], [[[-21, -21], [-10, -10]], 0.8], [[[21, 21], [10, 10]], 0.8], [[[21, -21], [10, -10]], 0.8], [[[-21, 21], [-10, 10]], 0.8]],
});

// 4) 눈 덮인 마을: 가운데 얼어붙은 연못(못 건넘, 건너편은 보임), 눈 지붕 오두막, 이글루, 눈사람, 얼음 벽
const WINTER = makeMap('winter', '눈 덮인 마을', {
  ground: {
    base: '#dce6f0', patches: ['rgba(255,255,255,.55)', 'rgba(190,210,232,.45)', 'rgba(170,195,225,.35)'], road: ['#aebccd', '#c4d0dd'],
    detail: 'snow', under: 'rgba(160,180,205,.55)', shore: '#eef4fb',
  },
  outer: 'snowfence',
  water: [[0, 0, 9, 9]],
  walls: [
    ...mirror2([[0, 12, 4, 1.4, 'ice'], [12, 0, 1.4, 4, 'ice']]),
    ...mirror4([
      [20, 20, 6, 6, 'snowcabin'], [14, 5, 2, 2, 'snowman'], [5, 15, 3.4, 3.4, 'igloo'],
      [26, 9, 1.4, 8, 'ice'], [10, 26, 8, 1.4, 'ice'], [21, 12, 1.4, 3, 'woodpile'], [17, 26, 3, 1.4, 'woodpile'],
      [15, 13, 1.6, 1.6, 'snowtree'], [28, 27, 1.6, 1.6, 'snowtree'], [27, 18, 1.6, 1.6, 'snowtree'], [12, 20, 1.6, 1.6, 'snowtree'],
      [21, 3, 1.6, 1.6, 'snowtree'], [3, 22, 1.6, 1.6, 'snowtree'],
    ]),
  ],
  deco: deco4([
    [6.5, 6.5, 'lamp'], [9, 17, 'snowpile'], [17, 9, 'snowpile'], [24, 14, 'sled'], [16, 18, 'lamp'], [29, 3, 'snowpile'],
    [3, 29, 'snowpile'], [23, 27, 'snowpile'], [7, 22, 'sled'], [19, 6, 'snowpile'],
  ]),
  roads: [
    [[[-7.5, -7.5], [7.5, -7.5], [7.5, 7.5], [-7.5, 7.5], [-7.5, -7.5]], 0.9],
    [[[-20, -20], [-7.5, -7.5]], 0.7], [[[20, 20], [7.5, 7.5]], 0.7], [[[20, -20], [7.5, -7.5]], 0.7], [[[-20, 20], [-7.5, 7.5]], 0.7],
  ],
  look: { water: 'ice', sky: 0xdfeaff, earth: 0x8a9ab8, sun: 0xe8f0ff },
});

// 5) 달빛 해변: 위아래가 바다(못 들어감, 멀리 보임). 바다로 뻗은 나무 부두, 야자수, 해변 오두막, 뒤집힌 보트, 감시탑
const SEA = (z) => [[-22.75, z, 17.5, 7], [0, z, 20, 7], [22.75, z, 17.5, 7]];
const BEACH = makeMap('beach', '달빛 해변', {
  ground: {
    base: '#e4d09a', patches: ['rgba(240,222,170,.5)', 'rgba(205,180,120,.35)', 'rgba(250,235,190,.4)'], road: ['#8a6440', '#a87c50'],
    detail: 'sand', under: 'rgba(185,150,95,.45)', shore: '#cdb27a',
    decks: [[12, 28, 4, 7], [-12, 28, 4, 7], [12, -28, 4, 7], [-12, -28, 4, 7]], // 부두 (나무 바닥)
  },
  outer: 'seawall',
  water: [...SEA(28), ...SEA(-28)],
  walls: [
    [0, 0, 2.6, 2.6, 'rock'],
    ...mirror2([[0, 14, 1.6, 1.6, 'palm'], [12, 0, 1.4, 4, 'sandbag']]),
    ...mirror4([
      [20, 14, 5, 5, 'hut'], [8, 8, 1.6, 1.6, 'palm'], [14, 20, 1.6, 1.6, 'palm'], [26, 6, 1.6, 1.6, 'palm'], [4, 18, 1.6, 1.6, 'palm'],
      [27, 21, 1.6, 1.6, 'palm'], [12, 13, 3.2, 1.6, 'boat'], [16, 4, 6, 1.4, 'sandbag'], [6, 22, 2.2, 2.2, 'lifeguard'], [21, 21, 2, 2, 'rock'],
    ]),
  ],
  deco: deco4([
    [4, 9, 'umbrella'], [17, 10, 'umbrella'], [9, 3, 'shell'], [23, 3, 'shell'], [2.5, 23, 'shell'], [18, 17, 'torch'], [10, 18, 'torch'],
    [24, 10, 'chair'], [29, 15, 'shell'], [15, 23, 'sandcastle'], [6, 14, 'torch'], [12, 24, 'buoy'],
  ]),
  roads: [
    [[[-28, 0.5], [-14, 0.5]], 0.6], [[[14, 0.5], [28, 0.5]], 0.6],
    [[[-20, 9], [-12, 6], [12, 6], [20, 9]], 0.6], [[[-20, -9], [-12, -6], [12, -6], [20, -9]], 0.6],
  ],
  look: { water: 'sea', sky: 0xe8f4ff, earth: 0x7a6a50, sun: 0xd8e8ff },
});

// 6) 버려진 공장: 콘크리트 마당, 컨테이너, 파이프 벽, 기름통, 창고, 저장 탱크, 초록 독성 웅덩이
const FACTORY = makeMap('factory', '버려진 공장', {
  ground: {
    base: '#8a8780', patches: ['rgba(60,58,55,.35)', 'rgba(120,118,110,.3)', 'rgba(40,38,34,.3)'], road: ['#48484b', '#545458'],
    detail: 'concrete', under: 'rgba(40,38,36,.45)', shore: '#4a5236', roadLine: '#e8c23a',
  },
  outer: 'brick',
  water: mirror4([[12, 12, 3, 3]]),
  walls: [
    [0, 0, 3.6, 3.6, 'tank'],
    ...mirror2([[0, 11, 5, 1.4, 'brick'], [12, 0, 1.4, 4, 'brick']]),
    ...mirror4([
      [21, 21, 7, 6, 'warehouse'], [17, 8, 6, 2.4, 'container'], [8, 17, 2.4, 6, 'container'], [27, 13, 1.4, 8, 'pipes'], [13, 27, 8, 1.4, 'pipes'],
      [5, 10, 2, 2, 'barrels'], [11, 5.5, 2, 2, 'barrels'], [27, 4, 2.2, 2.2, 'tank'], [4, 27, 2.2, 2.2, 'tank'], [21, 14, 2, 2, 'crates'], [14, 21, 2, 2, 'barrels'],
    ]),
  ],
  deco: deco4([
    [3, 6, 'cone'], [6, 3, 'cone'], [16, 15, 'pallet'], [9, 22, 'lamp'], [22, 9, 'lamp'], [24, 28, 'pallet'], [28, 24, 'cone'],
    [17, 2.5, 'drum'], [2.5, 17, 'drum'], [29, 29, 'pallet'], [19, 12, 'cone'],
  ]),
  roads: [[[[-31, 0], [31, 0]], 1.3], [[[0, -31], [0, 31]], 1.3], [[[-17, -17], [17, -17], [17, 17], [-17, 17], [-17, -17]], 0.8]],
  look: { water: 'toxic', sky: 0xffe2b8, earth: 0x5a5248, sun: 0xffd9a0 },
});

// 7) 훈련장(연습 전용, 순환·선택에 없음): 30m x 30m 의 울타리 친 마당. 구역마다 연습할 거리가 있다.
//   남쪽: 울타리 친 시작 마당(나무 가림막 + 가운데 문. 연습 처음에는 문이 닫혀 있다)  서쪽: 허수아비  가운데: 상자·건초 엄폐물
//   동쪽: 경비 허수아비 자리(숨을 건초 더미)  북쪽: 돌담 뒤 숨은 허수아비 + 조명탄 발판
const TRAINING = makeMap('training', '훈련장', {
  half: 15,
  outer: 'fence',
  ground: {
    base: '#b39463', patches: ['rgba(205,175,125,.35)', 'rgba(150,120,80,.3)', 'rgba(120,150,80,.22)'], road: ['#8c7350', '#a08460'],
    detail: 'sand', under: 'rgba(110,85,55,.45)',
  },
  walls: [
    [-8, -6, 13, 1.2, 'plank'], // 남쪽 가림막 (시작 마당을 막는다)
    [8, -6, 13, 1.2, 'plank'],
    [0.5, 10, 13, 1.2, 'stone'], // 북쪽 돌담 (숨은 허수아비를 가린다)
    [0, 2, 2, 2, 'crates'], // 가운데 엄폐물
    [5.5, -1.5, 1.8, 1.8, 'haybale'],
    [6, 5, 1.8, 1.8, 'haybale'],
    [-6.5, 5, 1.8, 1.8, 'haybale'],
    [12.5, -10, 1.8, 1.8, 'haybale'],
    [-12.5, -10, 2, 2, 'crates'],
    [-12, 12, 1.6, 1.6, 'tree'],
  ],
  deco: [
    [-4, -12, 'target'], [4, -12, 'target'], [-13.5, -3, 'flag'], [13.5, -3, 'flag'], [-13.5, 13.5, 'lamp'], [13.5, 13.5, 'lamp'],
    [-13.5, -13.5, 'lamp'], [13.5, -13.5, 'lamp'], [0, -14, 'flag'], [-8, 8, 'drum'], [9, -4.5, 'pallet'], [-3, 6, 'log'],
  ],
  gates: [[0, -6, 3, 1.2, 'gate']], // 시작 마당의 문 (가림막 사이 3m)
  roads: [[[[0, -14], [0, -7.5], [-8, -4], [-10, 2], [-2, 4], [8, 2], [11, 8]], 0.9]],
  look: { sky: 0xffe9c8, earth: 0x6a5a40, sun: 0xfff0d8 },
});

export const MAPS = { camp: CAMP, forest: FOREST, lake: LAKE, winter: WINTER, beach: BEACH, factory: FACTORY, training: TRAINING };
export const MAP_ROTATION = ['camp', 'winter', 'forest', 'beach', 'lake', 'factory'];

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

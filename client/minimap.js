// 미니맵: 벽, 독구름 구역, 내 시야 방향, 아군, 그리고 "지금 보이는" 적만 그린다.
// 서버가 보내준 정보만 쓰므로 시야 밖의 적은 여기에도 나타나지 않는다.
const COLORS = { ally: '#5ab4ff', enemy: '#ff6b5e' };

export class Minimap {
  constructor(canvas, map, mapSize) {
    this.canvas = canvas;
    this.mapSize = mapSize;
    const S = (this.S = 208); // 내부 해상도 (CSS 크기의 2배)
    canvas.width = canvas.height = S;
    this.ctx = canvas.getContext('2d');
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = S;
    this.setMap(map);
  }

  // 지형은 맵이 바뀔 때만 다시 그려 둔다
  setMap(map) {
    const g = this.base.getContext('2d');
    g.clearRect(0, 0, this.S, this.S);
    const rect = (w) => {
      const [x0, y0] = this.pt(w.maxX, w.maxZ);
      const [x1, y1] = this.pt(w.minX, w.minZ);
      g.fillRect(x0, y0, Math.max(1.5, x1 - x0), Math.max(1.5, y1 - y0));
    };
    g.fillStyle = 'rgba(70, 150, 220, .8)';
    map.water.forEach(rect);
    g.fillStyle = 'rgba(160, 180, 200, .75)';
    map.walls.filter((w) => w.kind !== 'void').forEach(rect);
  }

  // 월드 → 캔버스. 카메라가 +z 를 볼 때 화면 오른쪽이 -x 이므로 x 를 뒤집어 위쪽이 +z 가 되게 한다.
  pt(x, z) {
    const k = this.S / this.mapSize;
    const h = this.mapSize / 2;
    return [(h - x) * k, (h - z) * k];
  }

  draw({ me, alive, ents, flares, items, zone, fov, range }) {
    const { ctx: g, S } = this;
    const k = S / this.mapSize;
    g.clearRect(0, 0, S, S);
    g.fillStyle = 'rgba(8, 14, 20, .72)';
    g.fillRect(0, 0, S, S);

    if (zone > 0) {
      // 안전 구역 바깥을 초록으로
      const [zx, zy] = this.pt(zone, zone);
      g.fillStyle = 'rgba(90, 210, 50, .38)';
      g.beginPath();
      g.rect(0, 0, S, S);
      g.rect(zx, zy, zone * 2 * k, zone * 2 * k);
      g.fill('evenodd');
      g.strokeStyle = 'rgba(170, 255, 100, .9)';
      g.lineWidth = 2;
      g.strokeRect(zx, zy, zone * 2 * k, zone * 2 * k);
    }
    g.drawImage(this.base, 0, 0);

    for (const f of flares) {
      const [x, y] = this.pt(f[0], f[1]);
      g.fillStyle = 'rgba(255, 150, 80, .9)';
      g.beginPath();
      g.arc(x, y, 4, 0, 7);
      g.fill();
    }
    for (const it of items) {
      const [x, y] = this.pt(it.x, it.z);
      g.fillStyle = '#ffe27a';
      g.fillRect(x - 3, y - 3, 6, 6);
    }
    for (const e of ents) {
      const [x, y] = this.pt(e.x, e.z);
      g.fillStyle = COLORS[e.kind];
      g.beginPath();
      g.arc(x, y, 5, 0, 7);
      g.fill();
    }
    if (alive) {
      const [x, y] = this.pt(me.x, me.z);
      const a = Math.atan2(-Math.cos(me.yaw), -Math.sin(me.yaw)); // 캔버스에서의 전방 각도
      g.fillStyle = 'rgba(255, 240, 190, .22)';
      g.beginPath();
      g.moveTo(x, y);
      g.arc(x, y, range * k, a - fov / 2, a + fov / 2);
      g.fill();
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(x + Math.cos(a) * 9, y + Math.sin(a) * 9);
      g.lineTo(x + Math.cos(a + 2.5) * 7, y + Math.sin(a + 2.5) * 7);
      g.lineTo(x + Math.cos(a - 2.5) * 7, y + Math.sin(a - 2.5) * 7);
      g.fill();
    }
  }
}

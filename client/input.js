// 입력: 모바일(왼쪽 가상 조이스틱 + 오른쪽 드래그 회전 + 공격 버튼), 데스크톱(WASD + 마우스 드래그/방향키 + Space).
const STICK_R = 56;
const LOOK_SENS = 0.006; // rad / px
const KEY_TURN = 2.8; // rad / s

export class Input {
  constructor({ surface, stick, knob, attackBtn }) {
    this.mx = 0;
    this.mz = 0;
    this.yaw = 0; // 목표 방향 (누적)
    this.atk = false; // 다음 틱에서 소비
    this.keys = new Set();
    this.moveId = null;
    this.lookId = null;
    this.origin = [0, 0];
    this.last = [0, 0];
    this.stick = stick;
    this.knob = knob;

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) surface.addEventListener(t, (e) => this.up(e));
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    attackBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.atk = true;
    });

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyJ') this.atk = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  down(e) {
    const touch = e.pointerType === 'touch';
    if (touch && e.clientX < innerWidth / 2 && this.moveId === null) {
      this.moveId = e.pointerId;
      this.origin = [e.clientX, e.clientY];
      this.stick.style.display = 'block';
      this.stick.style.left = `${e.clientX}px`;
      this.stick.style.top = `${e.clientY}px`;
      this.knob.style.transform = 'translate(-50%, -50%)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.last = [e.clientX, e.clientY];
    }
    e.target.setPointerCapture?.(e.pointerId);
  }

  move(e) {
    if (e.pointerId === this.moveId) {
      let dx = e.clientX - this.origin[0];
      let dy = e.clientY - this.origin[1];
      const len = Math.hypot(dx, dy);
      if (len > STICK_R) {
        dx *= STICK_R / len;
        dy *= STICK_R / len;
      }
      this.touchMx = dx / STICK_R;
      this.touchMz = -dy / STICK_R;
      this.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    } else if (e.pointerId === this.lookId) {
      // 오른쪽으로 끌면 오른쪽으로 회전 (yaw 감소)
      this.yaw -= (e.clientX - this.last[0]) * LOOK_SENS;
      this.last = [e.clientX, e.clientY];
    }
  }

  up(e) {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.touchMx = this.touchMz = 0;
      this.stick.style.display = 'none';
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  }

  // 프레임마다 호출: 키보드 회전 반영 + 이동 벡터 계산
  update(dt) {
    const k = this.keys;
    if (k.has('ArrowLeft') || k.has('KeyQ')) this.yaw += KEY_TURN * dt;
    if (k.has('ArrowRight') || k.has('KeyE')) this.yaw -= KEY_TURN * dt;
    let mx = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    let mz = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    if (this.moveId !== null) {
      mx = this.touchMx || 0;
      mz = this.touchMz || 0;
    }
    this.mx = mx;
    this.mz = mz;
  }

  consumeAttack() {
    const a = this.atk;
    this.atk = false;
    return a;
  }
}

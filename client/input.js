// 입력: 모바일(왼쪽 가상 조이스틱 + 오른쪽 드래그 회전 + 공격/구르기/조명탄 버튼),
// 데스크톱(WASD + 마우스 드래그/방향키 + Space 공격 + Shift 구르기 + F 조명탄).
const STICK_R = 56;
const LOOK_SENS = 0.006; // rad / px
const KEY_TURN = 2.8; // rad / s

export class Input {
  constructor({ surface, stick, knob, attackBtn, rollBtn, flareBtn }) {
    this.mx = 0;
    this.mz = 0;
    this.yaw = 0; // 목표 방향 (누적)
    // 버튼 입력은 다음 틱에서 한 번 소비된다
    this.atk = false;
    this.roll = false;
    this.flare = false;
    this.keys = new Set();
    this.moveId = null;
    this.lookId = null;
    this.origin = [0, 0];
    this.last = [0, 0];
    this.stick = stick;
    this.knob = knob;
    this.opts = { fixedStick: false, lefty: false, sens: 1 };
    addEventListener('resize', () => this.placeStick());

    surface.addEventListener('pointerdown', (e) => this.down(e));
    surface.addEventListener('pointermove', (e) => this.move(e));
    for (const t of ['pointerup', 'pointercancel']) surface.addEventListener(t, (e) => this.up(e));
    surface.addEventListener('contextmenu', (e) => e.preventDefault());

    const bind = (btn, key) =>
      btn.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this[key] = true;
      });
    bind(attackBtn, 'atk');
    bind(rollBtn, 'roll');
    bind(flareBtn, 'flare');

    addEventListener('keydown', (e) => {
      if (e.target instanceof HTMLInputElement) return;
      this.keys.add(e.code);
      if (e.code === 'Space' || e.code === 'KeyJ') this.atk = true;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyK') this.roll = true;
      if (e.code === 'KeyF' || e.code === 'KeyL') this.flare = true;
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  // 설정 반영
  setOptions(o) {
    Object.assign(this.opts, o);
    this.placeStick();
  }

  fixedCenter() {
    return [this.opts.lefty ? innerWidth - 110 : 110, innerHeight - 110];
  }

  // 고정 조이스틱이면 항상 같은 자리에 보여준다
  placeStick() {
    if (this.moveId !== null) return;
    this.knob.style.transform = 'translate(-50%, -50%)';
    if (this.opts.fixedStick) {
      const [x, y] = this.fixedCenter();
      this.stick.style.display = 'block';
      this.stick.style.left = `${x}px`;
      this.stick.style.top = `${y}px`;
    } else {
      this.stick.style.display = 'none';
    }
  }

  down(e) {
    const touch = e.pointerType === 'touch';
    const moveSide = this.opts.lefty ? e.clientX > innerWidth / 2 : e.clientX < innerWidth / 2;
    if (touch && moveSide && this.moveId === null) {
      this.moveId = e.pointerId;
      this.origin = this.opts.fixedStick ? this.fixedCenter() : [e.clientX, e.clientY];
      this.stick.style.display = 'block';
      this.stick.style.left = `${this.origin[0]}px`;
      this.stick.style.top = `${this.origin[1]}px`;
      this.move(e); // 고정 조이스틱은 누른 위치가 곧 방향
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
      this.yaw -= (e.clientX - this.last[0]) * LOOK_SENS * this.opts.sens;
      this.last = [e.clientX, e.clientY];
    }
  }

  up(e) {
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.touchMx = this.touchMz = 0;
      this.placeStick();
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

  consume(key) {
    const v = this[key];
    this[key] = false;
    return v;
  }
}

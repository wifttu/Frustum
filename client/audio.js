// 효과음: 오디오 파일 없이 Web Audio로 합성한다 (다운로드 0바이트, 모바일 친화적).
// 모바일 브라우저는 사용자 터치 이후에만 소리를 낼 수 있으므로 unlock()을 첫 터치에서 호출한다.
export class Sfx {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.8;
    try {
      this.muted = localStorage.getItem('frustum.muted') === '1';
    } catch {}
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.volume;
      // 큰 소리가 겹쳐도 찢어지지 않게
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  setMuted(m) {
    this.muted = m;
    try {
      localStorage.setItem('frustum.muted', m ? '1' : '0');
    } catch {}
    if (this.master) this.master.gain.value = m ? 0 : this.volume;
  }

  setVolume(v) {
    this.volume = v;
    if (this.master && !this.muted) this.master.gain.value = v;
  }

  get ready() {
    return this.ctx && this.ctx.state === 'running' && !this.muted;
  }

  // 출력 노드: 음량 + 좌우 위치
  out(vol, pan) {
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan && this.ctx.createStereoPanner) {
      const p = this.ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p).connect(this.master);
    } else {
      g.connect(this.master);
    }
    return g;
  }

  tone(type, f0, f1, dur, vol, pan = 0, delay = 0) {
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out(vol, pan));
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  hiss(f0, f1, q, dur, vol, pan = 0, delay = 0, type = 'bandpass') {
    const t = this.ctx.currentTime + delay;
    const s = this.ctx.createBufferSource();
    s.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(1, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g).connect(this.out(vol, pan));
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.02);
  }

  // 손전등 빔: 전기 "지잉" + 짧은 섬광
  beam(vol = 1, pan = 0) {
    if (!this.ready) return;
    this.tone('sawtooth', 1400, 260, 0.22, 0.18 * vol, pan);
    this.tone('square', 2600, 1800, 0.08, 0.07 * vol, pan);
    this.hiss(5000, 1200, 1.5, 0.18, 0.25 * vol, pan);
  }

  roll(vol = 1, pan = 0) {
    if (!this.ready) return;
    this.hiss(400, 2200, 1.2, 0.28, 0.5 * vol, pan);
  }

  flare() {
    if (!this.ready) return;
    this.tone('triangle', 300, 900, 0.12, 0.25);
    this.hiss(3000, 6000, 0.8, 0.6, 0.18, 0, 0.12, 'highpass');
  }

  // 내가 처치: 상승 2음
  kill() {
    if (!this.ready) return;
    this.tone('sine', 880, 880, 0.12, 0.3);
    this.tone('sine', 1320, 1320, 0.2, 0.3, 0, 0.09);
  }

  // 아군이 처치 / 아군이 당함
  allyKill() {
    if (!this.ready) return;
    this.tone('sine', 1040, 1040, 0.1, 0.12);
  }
  allyDown() {
    if (!this.ready) return;
    this.tone('sine', 520, 390, 0.18, 0.12);
  }

  death() {
    if (!this.ready) return;
    this.tone('sawtooth', 320, 50, 0.7, 0.28);
    this.hiss(800, 80, 0.7, 0.6, 0.3, 0, 0, 'lowpass');
  }

  // 시야에 적이 새로 들어옴
  spot(pan = 0) {
    if (!this.ready) return;
    this.tone('sine', 1760, 1760, 0.06, 0.1, pan);
    this.tone('sine', 1760, 1760, 0.06, 0.08, pan, 0.08);
  }

  // 독구름 안: 쉭 하는 가스 소리 + 낮은 경고음
  gas() {
    if (!this.ready) return;
    this.hiss(1800, 600, 0.9, 0.35, 0.3);
    this.tone('square', 150, 120, 0.12, 0.1);
  }

  // 고유 스킬 소리
  skill(name, vol = 1, pan = 0) {
    if (!this.ready) return;
    if (name === 'dash') this.hiss(600, 3200, 1.2, 0.35, 0.45 * vol, pan);
    else if (name === 'shield') {
      this.tone('sine', 300, 600, 0.25, 0.2 * vol, pan);
      this.tone('triangle', 900, 1200, 0.3, 0.1 * vol, pan, 0.05);
    } else if (name === 'scan') [1200, 1600, 2000].forEach((f, i) => this.tone('sine', f, f, 0.1, 0.12 * vol, pan, i * 0.09));
    else if (name === 'magnet') this.tone('sawtooth', 200, 900, 0.3, 0.12 * vol, pan);
    else if (name === 'stealth') this.hiss(3000, 400, 0.8, 0.4, 0.3 * vol, pan, 0, 'lowpass');
    else if (name === 'heal') [660, 880, 1100].forEach((f, i) => this.tone('sine', f, f * 1.02, 0.25, 0.14 * vol, pan, i * 0.08));
  }

  // 반딧불 줍기: 아주 작은 반짝
  firefly() {
    if (!this.ready) return;
    const f = 1500 + Math.random() * 400;
    this.tone('sine', f, f * 1.5, 0.08, 0.06);
  }

  // 빛이 상대에게 맞음
  hit(vol = 1, pan = 0) {
    if (!this.ready) return;
    this.tone('triangle', 520, 260, 0.12, 0.2 * vol, pan);
    this.hiss(3000, 800, 1, 0.08, 0.15 * vol, pan);
  }

  // 내가 맞음
  hurt() {
    if (!this.ready) return;
    this.tone('sawtooth', 220, 110, 0.18, 0.18);
  }

  // 레벨 업: 올라가는 아르페지오
  levelUp() {
    if (!this.ready) return;
    [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.22, 0.17, 0, i * 0.07));
  }

  // 강화 선택
  choose() {
    if (!this.ready) return;
    this.tone('sine', 880, 1760, 0.18, 0.18);
  }

  // 아이템 줍기: 반짝 3음
  pickup() {
    if (!this.ready) return;
    [988, 1319, 1760].forEach((f, i) => this.tone('triangle', f, f, 0.12, 0.16, 0, i * 0.06));
  }

  // 반사 조끼가 빛을 막음: 쨍
  block() {
    if (!this.ready) return;
    this.tone('square', 1800, 900, 0.18, 0.14);
    this.tone('sine', 2600, 2400, 0.3, 0.12);
  }

  // 밤 분위기: 풀벌레 소리 (가끔, 아주 작게)
  cricket() {
    if (!this.ready) return;
    const pan = Math.random() * 1.6 - 0.8;
    const f = 4200 + Math.random() * 900;
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) this.tone('sine', f, f * 0.98, 0.045, 0.022, pan, i * 0.075);
  }

  step(vol = 1) {
    if (!this.ready) return;
    this.hiss(260, 140, 1, 0.07, 0.12 * vol, 0, 0, 'lowpass');
  }

  respawn() {
    if (!this.ready) return;
    this.tone('sine', 440, 880, 0.3, 0.15);
  }

  win() {
    if (!this.ready) return;
    [523, 659, 784, 1046].forEach((f, i) => this.tone('triangle', f, f, 0.35, 0.22, 0, i * 0.12));
  }

  lose() {
    if (!this.ready) return;
    [392, 330, 262].forEach((f, i) => this.tone('triangle', f, f * 0.98, 0.45, 0.2, 0, i * 0.18));
  }
}

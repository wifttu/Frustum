// 시야 마스크(Fog of War).
// 시야 다각형(FOV 부채꼴 - 벽 그림자)을 맵 전체를 덮는 저해상도 텍스처에 그리고,
// 모든 월드 머티리얼이 자기 월드 좌표로 이 텍스처를 샘플링해 시야 밖을 어둡게 만든다.
// 추가 풀스크린 패스가 없어서(512² 패스 2번뿐) 모바일 GPU에서도 가볍다.
import * as THREE from 'three';
import { computeVisionFan, MAX_FAN_POINTS } from './shared/vision.js';

const CIRCLE_SEG = 20;

const fanVert = /* glsl */ `
uniform float uHalf;
varying vec2 vW;
void main() {
  vW = position.xz;
  gl_Position = vec4(position.xz / uHalf, 0.0, 1.0);
}`;
const fanFrag = /* glsl */ `
uniform vec2 uEye;
uniform float uRange;
varying vec2 vW;
void main() {
  float a = 1.0 - smoothstep(uRange * 0.85, uRange, distance(vW, uEye));
  gl_FragColor = vec4(a, a, a, 1.0);
}`;
const blurVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const blurFrag = /* glsl */ `
uniform sampler2D uTex;
uniform float uPx;
varying vec2 vUv;
void main() {
  float s = 0.0;
  for (int x = -1; x <= 1; x++)
    for (int y = -1; y <= 1; y++)
      s += texture2D(uTex, vUv + vec2(float(x), float(y)) * uPx * 1.5).r;
  gl_FragColor = vec4(vec3(s / 9.0), 1.0);
}`;

export class VisionMask {
  constructor(mapSize, walls, cfg, { maxSources = 14, res = 512 } = {}) {
    this.mapSize = mapSize;
    this.walls = walls;
    this.cfg = cfg;
    this.seen = new Uint8Array(walls.length); // 이번 프레임에 시야에 걸린 벽
    this.pts = new Float32Array(MAX_FAN_POINTS * 2);

    const rtOpts = {
      depthBuffer: false,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      generateMipmaps: false,
    };
    this.rtA = new THREE.WebGLRenderTarget(res, res, rtOpts);
    this.rtB = new THREE.WebGLRenderTarget(res, res, rtOpts);
    this.texture = this.rtB.texture;
    this.cam = new THREE.Camera();

    this.scene = new THREE.Scene();
    this.fans = [];
    const maxVerts = 1 + MAX_FAN_POINTS + CIRCLE_SEG + 1;
    for (let i = 0; i < maxSources; i++) {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(maxVerts * 3), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      const idx = new THREE.BufferAttribute(new Uint16Array((MAX_FAN_POINTS + CIRCLE_SEG) * 3), 1);
      idx.setUsage(THREE.DynamicDrawUsage);
      geo.setIndex(idx);
      const mat = new THREE.ShaderMaterial({
        vertexShader: fanVert,
        fragmentShader: fanFrag,
        uniforms: {
          uHalf: { value: mapSize / 2 },
          uEye: { value: new THREE.Vector2() },
          uRange: { value: cfg.VIEW_RANGE },
        },
        depthTest: false,
        depthWrite: false,
        side: THREE.DoubleSide,
        // 여러 시야원(팀원)의 합집합: MAX 블렌딩
        blending: THREE.CustomBlending,
        blendEquation: THREE.MaxEquation,
        blendSrc: THREE.OneFactor,
        blendDst: THREE.OneFactor,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.scene.add(mesh);
      this.fans.push(mesh);
    }

    // 시야에 걸린 소품(벽)은 통째로 밝힌다: 광선이 닿은 벽의 바닥 면적을 마스크에 칠한다.
    // 벽은 고정 지형이라 숨길 정보가 아니고, 이렇게 해야 지붕이나 나무 꼭대기까지 색이 보인다.
    // 맵을 두르는 긴 외곽 벽(처음 4개)은 제외한다.
    {
      const geo = new THREE.BufferGeometry();
      const pos = new THREE.BufferAttribute(new Float32Array(walls.length * 12), 3);
      pos.setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute('position', pos);
      const idx = new Uint16Array(walls.length * 6);
      for (let i = 0; i < walls.length; i++) idx.set([0, 1, 2, 0, 2, 3].map((v) => v + i * 4), i * 6);
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      this.props = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          vertexShader: fanVert,
          fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }',
          uniforms: { uHalf: { value: mapSize / 2 } },
          depthTest: false,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.CustomBlending,
          blendEquation: THREE.MaxEquation,
          blendSrc: THREE.OneFactor,
          blendDst: THREE.OneFactor,
        }),
      );
      this.props.frustumCulled = false;
      this.scene.add(this.props);
    }

    this.blurScene = new THREE.Scene();
    const blur = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({
        vertexShader: blurVert,
        fragmentShader: blurFrag,
        uniforms: { uTex: { value: this.rtA.texture }, uPx: { value: 1 / res } },
        depthTest: false,
        depthWrite: false,
      }),
    );
    blur.frustumCulled = false;
    this.blurScene.add(blur);
  }

  // sources: [{x,z,yaw, view?}] — 나 + 살아있는 팀원 + 팀 조명탄(view: 시야 설정 덮어쓰기)
  update(renderer, sources) {
    const { cfg, pts, seen } = this;
    seen.fill(0);
    for (let i = 0; i < this.fans.length; i++) {
      const mesh = this.fans[i];
      const s = sources[i];
      mesh.visible = !!s;
      if (!s) continue;
      const view = s.view || cfg;
      const n = computeVisionFan(s.x, s.z, s.yaw, this.walls, view, pts, seen);
      const pos = mesh.geometry.attributes.position;
      const idx = mesh.geometry.index;
      const P = pos.array;
      const I = idx.array;
      P[0] = s.x;
      P[2] = s.z;
      let v = 1;
      let k = 0;
      for (let j = 0; j < n; j++, v++) {
        P[v * 3] = pts[j * 2];
        P[v * 3 + 2] = pts[j * 2 + 1];
        if (j > 0) {
          I[k++] = 0;
          I[k++] = v - 1;
          I[k++] = v;
        }
      }
      // 몸 주변 근접 원
      const c0 = v;
      for (let j = 0; j < CIRCLE_SEG; j++, v++) {
        const a = (j / CIRCLE_SEG) * Math.PI * 2;
        P[v * 3] = s.x + Math.sin(a) * view.NEAR_RADIUS;
        P[v * 3 + 2] = s.z + Math.cos(a) * view.NEAR_RADIUS;
        I[k++] = 0;
        I[k++] = c0 + j;
        I[k++] = c0 + ((j + 1) % CIRCLE_SEG);
      }
      pos.needsUpdate = true;
      idx.needsUpdate = true;
      mesh.geometry.setDrawRange(0, k);
      mesh.material.uniforms.uEye.value.set(s.x, s.z);
      mesh.material.uniforms.uRange.value = view.VIEW_RANGE;
    }

    // 보인 소품의 바닥 면적 (조금 넓혀서 처마나 나뭇잎까지 덮는다)
    {
      const P = this.props.geometry.attributes.position.array;
      let n = 0;
      for (let i = 4; i < this.walls.length; i++) {
        if (!seen[i]) continue;
        const w = this.walls[i];
        const m = 0.45;
        P.set([w.minX - m, 0, w.minZ - m, w.maxX + m, 0, w.minZ - m, w.maxX + m, 0, w.maxZ + m, w.minX - m, 0, w.maxZ + m], n * 12);
        n++;
      }
      this.props.geometry.attributes.position.needsUpdate = true;
      this.props.geometry.setDrawRange(0, n * 6);
      this.props.visible = n > 0;
    }

    const prevTarget = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rtA);
    renderer.clear();
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(this.rtB);
    renderer.render(this.blurScene, this.cam);
    renderer.setRenderTarget(prevTarget);
  }

  // 표준 머티리얼에 마스크 샘플링을 주입한다. dark: 시야 밖 밝기(0 = 완전 암흑).
  apply(material, dark = 0) {
    const tex = this.texture;
    const inv = 1 / this.mapSize;
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uMask = { value: tex };
      shader.uniforms.uMaskInv = { value: inv };
      shader.uniforms.uDark = { value: dark };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMaskUv;\nuniform float uMaskInv;')
        .replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 maskWp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            maskWp = instanceMatrix * maskWp;
          #endif
          maskWp = modelMatrix * maskWp;
          vMaskUv = maskWp.xz * uMaskInv + 0.5;`,
        );
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vMaskUv;\nuniform sampler2D uMask;\nuniform float uDark;')
        .replace(
          '#include <dithering_fragment>',
          `// 시야 안: 따뜻한 손전등 빛, 시야 밖: 푸른 달빛 (uDark 가 0 이면 완전한 어둠)
          gl_FragColor.rgb *= mix(uDark * vec3(0.55, 0.75, 1.25), vec3(1.08, 1.0, 0.86), texture2D(uMask, vMaskUv).r);
          #include <dithering_fragment>`,
        );
    };
    material.customProgramCacheKey = () => 'visionMask';
    return material;
  }
}

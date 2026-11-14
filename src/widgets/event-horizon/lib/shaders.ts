/**
 * 빛이 휘는 블랙홀 근사: 별 배경의 중력 렌즈, 기울어진 강착 원반,
 * 원반 뒤쪽이 그림자 위로 휘어 보이는 후광, 광자 고리를 차례로 그립니다.
 * 색은 #8B0000(진홍)에서 시작해 안쪽으로 갈수록 뜨거운 주황·흰색으로 오릅니다.
 */
export const fragmentShader = /* glsl */ `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform float uTime;
uniform float uProgress;
uniform vec2 uResolution;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

float fbm(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amp * noise(p);
    p *= 2.03;
    amp *= 0.5;
  }
  return value;
}

vec3 stars(vec2 uv) {
  vec2 grid = uv * 70.0;
  vec2 id = floor(grid);
  vec2 f = fract(grid) - 0.5;
  float h = hash(id);
  vec2 offset = vec2(hash(id + 1.3), hash(id + 7.1)) - 0.5;
  float star = step(0.975, h) * smoothstep(0.09, 0.0, length(f - offset * 0.7));
  float twinkle = 0.65 + 0.35 * sin(uTime * (1.0 + h * 3.0) + h * 40.0);
  return vec3(1.0, 0.86, 0.82) * star * twinkle * (0.4 + 0.6 * h);
}

void main() {
  vec2 res = max(uResolution, vec2(1.0));
  vec2 p = (vUv - 0.5) * vec2(res.x / res.y, 1.0);
  float aspect = res.x / res.y;
  // 좁은 화면에서는 블랙홀이 화면을 넘지 않게 줄입니다.
  float fit = mix(0.62, 1.0, smoothstep(0.6, 1.2, aspect));
  float zoom = mix(1.0, 3.4, smoothstep(0.0, 1.0, uProgress));
  p /= zoom * fit;
  p.y += 0.02;

  float rs = 0.085;
  float r = length(p);
  vec2 dir = p / max(r, 1e-4);

  // 1. 중력 렌즈로 휜 별 배경과 붉은 성운
  float bend = rs * rs * 2.2 / max(r, 1e-3);
  vec2 bg = p - dir * bend;
  vec3 col = stars(bg + vec2(uTime * 0.003, 0.0));
  col += vec3(0.33, 0.015, 0.01) * pow(fbm(bg * 2.6 + uTime * 0.01), 2.2) * 0.9;

  // 2. 기울어진 강착 원반
  float tilt = mix(0.2, 0.42, uProgress);
  vec2 d = vec2(p.x, p.y / tilt);
  float dr = length(d);
  float ang = atan(d.y, d.x);
  float band = smoothstep(rs * 1.5, rs * 2.1, dr) * smoothstep(rs * 7.0, rs * 2.6, dr);
  float swirl = fbm(vec2(ang * 3.0 + uTime * 0.35 - dr * 16.0, dr * 10.0 - uTime * 0.1));
  float doppler = 0.55 + 0.6 * cos(ang + 0.4);
  float heat = smoothstep(rs * 5.0, rs * 1.6, dr);
  vec3 crimson = vec3(0.545, 0.0, 0.0);
  vec3 hot = mix(crimson, vec3(1.0, 0.38, 0.18), heat);
  hot = mix(hot, vec3(1.0, 0.86, 0.72), smoothstep(rs * 2.4, rs * 1.6, dr) * 0.7);
  vec3 disk = hot * band * (0.3 + swirl * 1.2) * doppler * 1.7;

  // 3. 원반 뒤쪽이 그림자 위로 휘어 보이는 후광과 광자 고리
  float pa = atan(p.y, p.x);
  float halo = smoothstep(rs * 2.7, rs * 1.35, r) * smoothstep(rs * 1.02, rs * 1.3, r);
  float haloSwirl = fbm(vec2(pa * 4.0 - uTime * 0.45, r * 22.0));
  vec3 lensed = mix(crimson, vec3(1.0, 0.45, 0.25), 0.6) * halo * (0.35 + haloSwirl) * (0.6 + 0.4 * cos(pa + 0.4)) * 1.2;
  float ring = exp(-pow((r - rs * 1.07) / (rs * 0.035), 2.0));
  vec3 photon = vec3(1.0, 0.62, 0.48) * ring;

  float shadow = smoothstep(rs * 1.02, rs * 0.95, r);
  float front = step(p.y, 0.0);
  col = (col + lensed + photon) * (1.0 - shadow);
  col += disk * (front + (1.0 - front) * (1.0 - shadow));

  // 4. 깊이 들어갈수록 진홍으로 물들고, 가장자리는 어둡게
  col = mix(col, col * vec3(1.15, 0.55, 0.5) + vec3(0.06, 0.0, 0.0) * (1.0 - shadow), uProgress * 0.5);
  float vignette = smoothstep(1.25, 0.25, length((vUv - 0.5) * vec2(aspect, 1.0)));
  col *= mix(0.35, 1.0, vignette);
  col += (hash(vUv * res + uTime) - 0.5) * 0.025;
  col = col / (1.0 + col * 0.35);

  gl_FragColor = vec4(col, 1.0);
}
`

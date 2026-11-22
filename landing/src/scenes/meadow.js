// The living meadow: one small WebGL pass over the hero photograph.
// The photo is drawn as an ordered (Bayer) dither in two ramps, cobalt for the sky and green to lime for the field.
// The grass sways, the clouds drift, and a round lens follows the pointer showing the real photograph underneath:
// the rough idea outside, the finished picture inside. With no pointer (phones), the lens drifts on its own.
// No library: about 4 KB. It runs only while the hero is on screen and the tab is visible, caps the pixel ratio,
// and never runs under reduced motion (the pre-rendered dither image stands instead).

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main(){ vUv = p * .5 + .5; vUv.y = 1. - vUv.y; gl_Position = vec4(p, 0., 1.); }`;

// keep the two ramps in step with scripts/images.mjs
const FRAG = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uImg;
uniform vec2 uRes, uImgRes, uLens;
uniform float uTime, uPos, uCell, uLensR, uDpr;

float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float b2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float b4(vec2 a){ return b2(.5 * a) * .25 + b2(a); }
float b8(vec2 a){ return b4(.5 * a) * .25 + b2(a); }

vec3 rampS(float q){
  if (q < .5) return vec3(.039,.059,.361);
  if (q < 1.5) return vec3(.118,.184,.847);
  if (q < 2.5) return vec3(.310,.420,1.);
  if (q < 3.5) return vec3(.667,.722,1.);
  return vec3(.965,.937,.886);
}
vec3 rampG(float q){
  if (q < .5) return vec3(.039,.137,.278);
  if (q < 1.5) return vec3(.059,.416,.322);
  if (q < 2.5) return vec3(.153,.690,.494);
  if (q < 3.5) return vec3(.776,.933,.353);
  return vec3(.961,.839,.227);
}

vec2 cover(vec2 uv){
  float ra = uRes.x / uRes.y, ri = uImgRes.x / uImgRes.y;
  vec2 s = ra > ri ? vec2(1., ri / ra) : vec2(ra / ri, 1.);
  return uv * s + vec2((1. - s.x) * .5, (1. - s.y) * uPos);
}

vec2 wind(vec2 uv){
  float t = uTime;
  float grass = smoothstep(.60, .98, uv.y);
  float sky = 1. - smoothstep(.30, .62, uv.y);
  float wave = sin(uv.x * 5.5 - t * .9 + n(uv * 3. + t * .15) * 2.);
  float blades = n(vec2(uv.x * 140., uv.y * 22. - t * 1.6)) - .5;
  vec2 d = vec2(wave * .0032 + blades * .0022, 0.) * grass;
  d += vec2(n(uv * 2.4 + t * .03) - .5, n(uv * 2.4 - t * .025) - .5) * .008 * sky;
  return d;
}

void main(){
  vec2 px = gl_FragCoord.xy; px.y = uRes.y - px.y;          // device pixels, top-left origin
  // the lens: distance from the pointer, in css pixels
  float dist = length((px - uLens * uRes) / uDpr);
  float inLens = 1. - smoothstep(uLensR - 1.5, uLensR + 1.5, dist);
  float ring = smoothstep(uLensR - 3., uLensR - 1.5, dist) * (1. - smoothstep(uLensR + 1.5, uLensR + 3., dist));

  // dither: sample once per cell
  vec2 cellPx = floor(px / uCell) * uCell + uCell * .5;
  vec2 uvc = cover(cellPx / uRes);
  vec3 c = texture2D(uImg, uvc + wind(uvc)).rgb;
  float lum = dot(c, vec3(.2126, .7152, .0722));
  float ground = step(c.b + .03, c.g);
  float t = ground > .5 ? clamp((lum - .22) / .68, 0., 1.) : clamp((lum - .42) / .55, 0., 1.);
  float q = clamp(floor(t * 4. + b8(px / uCell)), 0., 4.);
  vec3 dith = ground > .5 ? rampG(q) : rampS(q);

  // inside the lens: the real photograph, a touch magnified
  vec2 uv = cover(px / uRes);
  vec2 l = cover(uLens);
  vec3 real = texture2D(uImg, l + (uv - l) * .86 + wind(uv)).rgb;

  vec3 col = mix(dith, real, inLens);
  col = mix(col, vec3(.965,.937,.886), ring);
  gl_FragColor = vec4(col, 1.);
}`;

export function initMeadow(root) {
  const canvas = root.querySelector('.meadow__gl');
  const img = root.querySelector('.meadow__img');
  if (!canvas || !img) return () => {};
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return () => {};

  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return () => {};
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (k) => gl.getUniformLocation(prog, k);
  const U = { res: u('uRes'), imgRes: u('uImgRes'), lens: u('uLens'), time: u('uTime'), pos: u('uPos'), cell: u('uCell'), lensR: u('uLensR'), dpr: u('uDpr') };

  const tex = gl.createTexture();
  let ready = false;
  const load = () => {
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.uniform2f(U.imgRes, img.naturalWidth, img.naturalHeight);
    gl.uniform1f(U.pos, .78);
    ready = true;
  };

  let dpr = 1;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(root.clientWidth * dpr), h = Math.round(root.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, w, h);
    gl.uniform1f(U.dpr, dpr);
    // a dither cell is 3 css px on a laptop, 2 on a phone
    gl.uniform1f(U.cell, Math.round((root.clientWidth < 640 ? 2 : 3) * dpr));
  };

  // the lens: eased toward the pointer; when the pointer is away it wanders slowly over the field
  const lens = { x: .72, y: .7, tx: .72, ty: .7, r: 0, tr: 0 };
  let lastMove = -1e9;
  const onMove = (e) => {
    const r = root.getBoundingClientRect();
    lens.tx = (e.clientX - r.left) / r.width; lens.ty = (e.clientY - r.top) / r.height;
    lastMove = performance.now();
  };
  const onLeave = () => { lastMove = -1e9; };
  root.addEventListener('pointermove', onMove, { passive: true });
  root.addEventListener('pointerleave', onLeave);

  let raf = 0, visible = false;
  const t0 = performance.now();
  const frame = (now) => {
    raf = 0;
    if (!visible || document.hidden) return;
    const t = (now - t0) / 1000;
    const idle = now - lastMove > 2500;
    if (idle) { lens.tx = .5 + Math.sin(t * .17) * .32; lens.ty = .74 + Math.sin(t * .23 + 1) * .1; }
    lens.tr = Math.min(130, root.clientWidth * .2);
    const k = idle ? .02 : .12;
    lens.x += (lens.tx - lens.x) * k; lens.y += (lens.ty - lens.y) * k;
    lens.r += (lens.tr - lens.r) * .05;
    gl.uniform1f(U.time, t);
    gl.uniform2f(U.lens, lens.x, lens.y);
    gl.uniform1f(U.lensR, lens.r);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && ready && visible) raf = requestAnimationFrame(frame); };

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); });
  const ro = new ResizeObserver(() => { size(); });
  const go = () => {
    load(); size(); ro.observe(root); io.observe(root);
    requestAnimationFrame(() => root.classList.add('is-live'));
  };
  if (img.complete && img.naturalWidth) go(); else img.addEventListener('load', go, { once: true });
  const onVis = () => start();
  document.addEventListener('visibilitychange', onVis);

  return () => {
    cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
    root.removeEventListener('pointermove', onMove); root.removeEventListener('pointerleave', onLeave);
    document.removeEventListener('visibilitychange', onVis);
    root.classList.remove('is-live');
  };
}

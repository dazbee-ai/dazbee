import { PALETTE_HEX, PAPER_HEX, hex3 } from '../content/valley-look.js';

// The hero valley: one WebGL pass over the graded photograph (public/images/valley-*.webp, made by scripts/valley-render.mjs).
// The sky stays smooth: light blue with white clouds that sway a little. The land is drawn in blocks: each cell sampled
// once, snapped to a small palette with ordered dither, lit on its top edge, so it reads like stacked voxels. Near the
// bottom the blocks dissolve into the page's paper, so the hero runs into the next section with no edge.
// A small lens sits under the pointer (no easing, and it stays where the pointer stops) and shows the smooth picture.
// Runs only while on screen and the tab is visible; never under reduced motion (valley-pixel-*.webp stands instead).

// zoom and its fixed point (screen uv): the point at headline height stays put and everything spreads out from it
export const ZOOM = [1.3, .5, .26];

const VERT = `
attribute vec2 p;
varying vec2 vUv;
void main(){ vUv = p * .5 + .5; vUv.y = 1. - vUv.y; gl_Position = vec4(p, 0., 1.); }`;

const N = PALETTE_HEX.length;
const FRAG = `
precision mediump float;
uniform sampler2D uImg, uMask;
uniform vec2 uRes, uImgRes, uLens, uCell;
uniform float uTime, uPos, uLensR, uDpr, uFade, uZoom;
uniform vec2 uZoomAt;
uniform vec3 uPal[${N}];
uniform vec3 uPaper;

float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
float b2(vec2 a){ a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float b4(vec2 a){ return b2(.5 * a) * .25 + b2(a); }
float b8(vec2 a){ return b4(.5 * a) * .25 + b2(a); }

vec2 cover(vec2 uv){
  uv = (uv - uZoomAt) / uZoom + uZoomAt;                     // v3.4: a little closer, so the hills open out beside the headline
  float ra = uRes.x / uRes.y, ri = uImgRes.x / uImgRes.y;
  vec2 s = ra > ri ? vec2(1., ri / ra) : vec2(ra / ri, 1.);
  return uv * s + vec2((1. - s.x) * .5, (1. - s.y) * uPos);
}

vec3 nearest(vec3 c){
  vec3 best = uPal[0]; float bd = 1e9;
  for (int k = 0; k < ${N}; k++) {
    vec3 d = c - uPal[k];
    float e = d.r * d.r * .3 + d.g * d.g * .59 + d.b * d.b * .11;
    if (e < bd) { bd = e; best = uPal[k]; }
  }
  return best;
}

void main(){
  vec2 px = gl_FragCoord.xy; px.y = uRes.y - px.y;            // device px, top-left origin
  vec2 uvS = px / uRes;
  float t = uTime;

  // which cell, and is it sky or land (decided once per cell, so the skyline is stepped)
  vec2 cell = floor(px / uCell);
  vec2 cc = (cell + .5) * uCell;
  vec2 uvc = cover(cc / uRes);
  float grass = smoothstep(.55, .9, uvc.y);
  uvc.x += (sin(uvc.x * 7. - t * .9 + n(uvc * 3. + t * .1) * 2.) * .0025 + (n(vec2(uvc.x * 90., t * 1.3)) - .5) * .002) * grass;
  float sky = step(.5, texture2D(uMask, uvc).r);

  // sky: smooth, the clouds sway a touch
  vec2 uv = cover(uvS);
  vec2 drift = vec2(n(uv * 2.2 + t * .04) - .5, n(uv * 2.2 - t * .03) - .5) * .006;
  vec3 skyCol = texture2D(uImg, uv + drift * (1. - smoothstep(.35, .6, uv.y))).rgb;

  // land: one sample per cell, snapped to the palette, lit like a block
  float d = b8(cell) - .5;
  vec3 src = texture2D(uImg, uvc).rgb;
  vec3 land = mix(nearest(src + d * .035), src, .4);          // a light dither and part of the true colour, so the blocks stay but the noise goes
  float row = px.y - cell.y * uCell.y;
  land *= row < 1. * uDpr ? 1.03 : (row >= uCell.y - 1. * uDpr ? .965 : 1.);

  vec3 col = mix(land, skyCol, sky);

  // the bottom dissolves into paper, block by block
  float f = (uvS.y - (1. - uFade)) / uFade;
  if (f > 0. && b8(cell) < f) col = uPaper;

  // the lens: the smooth picture, slightly magnified
  float dist = length((px - uLens * uRes) / uDpr);
  float inLens = 1. - smoothstep(uLensR - 1., uLensR + 1., dist);
  float ring = smoothstep(uLensR - 2.5, uLensR - 1., dist) * (1. - smoothstep(uLensR + 1., uLensR + 2.5, dist));
  vec2 l = cover(uLens);
  vec3 real = texture2D(uImg, l + (uv - l) * .88).rgb;
  col = mix(col, real, inLens * step(f, 0.));
  col = mix(col, vec3(1.), ring * .95);
  gl_FragColor = vec4(col, 1.);
}`;

export function initValley(root) {
  const canvas = root.querySelector('.valley__gl');
  const img = root.querySelector('.valley__img');
  const maskImg = new Image();
  maskImg.src = '/images/valley-mask.png';
  if (!canvas || !img) return () => {};
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'low-power' });
  if (!gl) return () => {};

  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn(gl.getProgramInfoLog(prog)); return () => {}; }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const u = (k) => gl.getUniformLocation(prog, k);
  const U = { res: u('uRes'), imgRes: u('uImgRes'), lens: u('uLens'), time: u('uTime'), pos: u('uPos'), cell: u('uCell'),
    lensR: u('uLensR'), dpr: u('uDpr'), fade: u('uFade'), zoom: u('uZoom'), zoomAt: u('uZoomAt') };
  gl.uniform3fv(u('uPal'), new Float32Array(PALETTE_HEX.flatMap(hex3)));
  gl.uniform3fv(u('uPaper'), new Float32Array(hex3(PAPER_HEX)));
  gl.uniform1i(u('uImg'), 0);
  gl.uniform1i(u('uMask'), 1);

  const texFrom = (unit, source, filter) => {
    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, source);
  };

  let dpr = 1;
  const size = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const w = Math.round(root.clientWidth * dpr), h = Math.round(root.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    gl.viewport(0, 0, w, h);
    gl.uniform2f(U.res, w, h);
    gl.uniform1f(U.dpr, dpr);
    const phone = root.clientWidth < 640;
    gl.uniform2f(U.cell, Math.round((phone ? 4 : 6) * dpr), Math.round((phone ? 3 : 4) * dpr));
    gl.uniform1f(U.fade, phone ? .1 : .14);
    gl.uniform1f(U.pos, phone ? .62 : .74);
    gl.uniform1f(U.zoom, phone ? 1 : ZOOM[0]);
    gl.uniform2f(U.zoomAt, ZOOM[1], ZOOM[2]);
    draw();
  };

  // the lens sits exactly under the pointer and stays where it stops; before any pointer it rests on the meadow
  const lens = { x: .7, y: .74, r: 0 };
  const setR = () => { lens.r = Math.min(84, Math.max(52, root.clientWidth * .065)); };
  const onMove = (e) => {
    const r = root.getBoundingClientRect();
    lens.x = (e.clientX - r.left) / r.width; lens.y = (e.clientY - r.top) / r.height;
    draw();
  };
  const host = root.closest('[data-hero]') || root;
  host.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerdown', onMove, { passive: true });

  let raf = 0, visible = false, ready = 0;
  const t0 = performance.now();
  const render = (now) => {
    gl.uniform1f(U.time, (now - t0) / 1000);
    gl.uniform2f(U.lens, lens.x, lens.y);
    gl.uniform1f(U.lensR, lens.r);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  function draw() { if (ready === 2) render(performance.now()); }
  const frame = (now) => {
    raf = 0;
    if (!visible || document.hidden || ready < 2) return;
    render(now);
    raf = requestAnimationFrame(frame);
  };
  const start = () => { if (!raf && ready === 2 && visible) raf = requestAnimationFrame(frame); };

  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; start(); });
  const ro = new ResizeObserver(() => { setR(); size(); });
  const loaded = () => {
    if (++ready < 2) return;
    texFrom(0, img, gl.LINEAR);
    texFrom(1, maskImg, gl.NEAREST);
    gl.uniform2f(U.imgRes, img.naturalWidth, img.naturalHeight);
    setR(); size(); ro.observe(root); io.observe(root);
    requestAnimationFrame(() => root.classList.add('is-live'));
    start();
  };
  const whenReady = (im) => { if (im.complete && im.naturalWidth) loaded(); else im.addEventListener('load', loaded, { once: true }); };
  whenReady(img); whenReady(maskImg);
  const onVis = () => start();
  document.addEventListener('visibilitychange', onVis);

  return () => {
    cancelAnimationFrame(raf); io.disconnect(); ro.disconnect();
    host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerdown', onMove);
    document.removeEventListener('visibilitychange', onVis);
    root.classList.remove('is-live');
  };
}

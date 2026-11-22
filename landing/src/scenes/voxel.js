import * as THREE from 'three';

// Voxel picture: a real photo rebuilt as blocks with depth. The sky stays the smooth photo; everything below the skyline
// becomes a block per cell, coloured from the photo and pushed out towards the viewer. Nearer ground (lower in the frame)
// stands further out, and bright details (flowers, highlights) stand a little proud, like studs. The camera leans with
// the pointer and sways slowly, so the sides of the blocks show and the picture reads as a model, not a filter.
// Depth is estimated from position, not measured, so it works with any landscape photo that has a sky.
//
// opts: src (the photo), cols (blocks across), focal (vertical focal point, like object-position y), mask (optional
// sky mask image: white = sky); without a mask the skyline is found per column by colour.

const lin = (c) => c / 255;

export function voxelPicture(root, { src, mask = null, cols = 150, focal = .74, depth = .22, still = false, onReady } = {}) {
  const canvas = root.querySelector('canvas');
  if (!canvas) return () => {};
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'low-power' });
  } catch { return () => {}; }
  if (!renderer.getContext()) return () => {};
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#f7f5ef');
  const camera = new THREE.PerspectiveCamera(28, 1, .01, 50);
  scene.add(new THREE.HemisphereLight('#ffffff', '#c8c4b0', 1.05));
  const sun = new THREE.DirectionalLight('#fff6e6', .95);
  sun.position.set(-.6, .9, 1.2);
  scene.add(sun);

  let A = 16 / 9, ready = false, disposed = false;
  const group = new THREE.Group();
  scene.add(group);

  const load = (url) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });

  Promise.all([load(src), mask ? load(mask) : null]).then(([img, mimg]) => {
    if (disposed) return;
    A = img.naturalWidth / img.naturalHeight;
    const rows = Math.round(cols / A);
    // sample the photo per cell (and the mask, if any)
    const cv = document.createElement('canvas');
    cv.width = cols; cv.height = rows;
    const cx = cv.getContext('2d', { willReadFrequently: true });
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(img, 0, 0, cols, rows);
    const px = cx.getImageData(0, 0, cols, rows).data;
    let sky = null;
    if (mimg) {
      cx.clearRect(0, 0, cols, rows);
      cx.drawImage(mimg, 0, 0, cols, rows);
      const m = cx.getImageData(0, 0, cols, rows).data;
      sky = (x, y) => m[(y * cols + x) * 4] > 127;
    }
    // without a mask: per column, sky runs down from the top until the first clearly green or dark cell
    const skyline = new Array(cols).fill(rows);
    for (let x = 0; x < cols; x++) {
      const land = (y) => {
        const i = (y * cols + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        return sky ? !sky(x, y) : g > b * 1.04 && g > r * 1.04;   // ground is green-led; blue sky and white cloud are not
      };
      for (let y = 0; y < rows - 1; y++) if (land(y) && land(y + 1)) { skyline[x] = y; break; }
    }
    // smooth the skyline a little so single stray cells don't spike
    const sl = skyline.map((v, x) => Math.round((skyline[Math.max(0, x - 1)] + v * 2 + skyline[Math.min(cols - 1, x + 1)]) / 4));

    // the smooth photo as a plane behind everything (it shows as the sky)
    const tex = new THREE.Texture(img);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.needsUpdate = true;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(A, 1), new THREE.MeshBasicMaterial({ map: tex }));
    group.add(plane);

    // the blocks
    const cell = 1 / rows;
    const cells = [];
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      if (y < sl[x]) continue;
      const i = (y * cols + x) * 4;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const lum = (.2126 * r + .7152 * g + .0722 * b) / 255;
      const below = (y - sl[x]) / Math.max(1, rows - sl[x]);          // 0 at the skyline, 1 at the bottom edge
      const near = Math.pow(Math.max(0, (y / rows - .35) / .65), 1.6); // lower in the frame = nearer
      let z = depth * (.08 + .55 * near + .25 * below) + Math.max(0, lum - .55) * depth * .5;
      z = Math.round(z / (cell * .5)) * cell * .5;                    // whole half-blocks, so steps read as voxels
      cells.push({ x, y, z: Math.max(cell * .5, z), r, g, b });
    }
    const geo = new THREE.BoxGeometry(A / cols, cell, 1);
    geo.translate(0, 0, .5);                                          // grow forward from the photo's plane
    const mat = new THREE.MeshLambertMaterial();
    const mesh = new THREE.InstancedMesh(geo, mat, cells.length);
    const m4 = new THREE.Matrix4(), col = new THREE.Color();
    cells.forEach((c, n) => {
      m4.makeScale(1, 1, c.z);
      m4.setPosition(-A / 2 + (c.x + .5) * cell * (rows * A / cols), .5 - (c.y + .5) * cell, 0);
      mesh.setMatrixAt(n, m4);
      col.setRGB(lin(c.r), lin(c.g), lin(c.b), THREE.SRGBColorSpace);
      mesh.setColorAt(n, col);
    });
    group.add(mesh);
    ready = true;
    size();
    frame(performance.now());
    root.classList.add('is-live');
    onReady?.();
  }).catch(() => {});

  // camera: frame the photo like CSS "cover" with the focal point, from straight on, a little overscanned
  let W = 1, H = 1, base = { x: 0, y: 0, d: 1 };
  const size = () => {
    const r = root.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    const ra = W / H;
    const visH = (ra > A ? A / ra : 1) * .9;                          // 10% overscan, so leaning never shows an edge
    const d = visH / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    base = { x: 0, y: .5 - ((1 - visH) * focal + visH / 2), d: d + depth * .15 };
    camera.updateProjectionMatrix();
  };

  // the lean: pointer position, eased; plus a slow sway when the pointer is still
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const onMove = (e) => { look.tx = (e.clientX / innerWidth - .5) * 2; look.ty = (e.clientY / innerHeight - .5) * 2; };
  if (!still) window.addEventListener('pointermove', onMove, { passive: true });
  const frame = (now) => {
    if (!ready) return;
    const t = now / 1000;
    look.x += (look.tx - look.x) * .06; look.y += (look.ty - look.y) * .06;
    const sway = still ? 0 : Math.sin(t * .35) * .25;
    const yaw = (look.x * .55 + sway) * .07, pitch = .045 - look.y * .03;   // a touch from above, so block tops show
    camera.position.set(base.x + Math.sin(yaw) * base.d, base.y + pitch * base.d, Math.cos(yaw) * base.d);
    camera.lookAt(base.x, base.y, depth * .15);
    renderer.render(scene, camera);
  };

  // only draw while on screen
  let raf = 0, on = false;
  const loop = (now) => { frame(now); raf = requestAnimationFrame(loop); };
  const io = new IntersectionObserver(([e]) => {
    if (still) return;
    if (e.isIntersecting && !on) { on = true; raf = requestAnimationFrame(loop); }
    if (!e.isIntersecting && on) { on = false; cancelAnimationFrame(raf); }
  });
  io.observe(root);
  const ro = new ResizeObserver(() => { size(); if (still || !on) frame(performance.now()); });
  ro.observe(root);

  return () => {
    disposed = true; io.disconnect(); ro.disconnect(); cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove);
    renderer.dispose();
  };
}

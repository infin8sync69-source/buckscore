// universe-map.js — Bucks Universal Map
// A continuously zoomable, realistic map of the known universe rendered as the
// landing-page background. Scroll to travel from your own rooftop to the
// cosmic microwave background; drag to look around; hover anything to name it;
// double-click to fly there. Planet positions are computed live from JPL
// Keplerian elements; stars, nebulae and galaxies sit at their true
// coordinates and distances.
//
// Architecture: five nested "scale bands" (Earth · Solar System · Stars ·
// Milky Way · Cosmos), each built in its own natural unit and rescaled every
// frame around a shared camera, cross-fading as you travel. One global zoom
// value logD = log10(camera distance in metres), from ~7 (Earth orbit) to
// 26.9 (edge of the observable universe).
(function () {
  'use strict';
  try {
    main();
  } catch (err) {
    console.error('[UniverseMap] fatal, falling back to legacy background:', err);
    fallback();
  }

  function fallback() {
    const s = document.createElement('script');
    s.src = 'background-animation.js';
    document.body.appendChild(s);
  }

  function main() {
    const D = window.UNIVERSE_DATA;
    const canvas = document.getElementById('three-bg-canvas');
    if (!window.THREE || !D || !canvas) throw new Error('missing THREE / data / canvas');

    // ════════════════════════ CONSTANTS ════════════════════════
    const AU = 1.496e11;            // metres
    const LY = 9.4607e15;           // metres
    const R_CAM = 100;              // camera orbit radius in render units
    const LOG_MIN = 6.9, LOG_MAX = 26.9;
    const OBLIQ = 23.43928 * Math.PI / 180;
    const V3 = THREE.Vector3;

    // ════════════════════════ MATH / ASTRO ════════════════════════
    const rad = (d) => d * Math.PI / 180;
    const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    const easeIO = (t) => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const julianDay = () => Date.now() / 86400000 + 2440587.5;
    const daysJ2000 = () => julianDay() - 2451545.0;

    // math ecliptic frame (x→equinox, z→north) → three.js frame (y up)
    const m2t = (x, y, z) => new V3(x, z, -y);
    function eclVec(lonDeg, latDeg, r) {
      const l = rad(lonDeg), b = rad(latDeg);
      return m2t(r * Math.cos(b) * Math.cos(l), r * Math.cos(b) * Math.sin(l), r * Math.sin(b));
    }
    function eqVec(raH, decDeg, r) {
      const a = rad(raH * 15), d = rad(decDeg);
      const xe = Math.cos(d) * Math.cos(a), ye = Math.cos(d) * Math.sin(a), ze = Math.sin(d);
      const ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ);
      return m2t(r * xe, r * (ye * ce + ze * se), r * (-ye * se + ze * ce));
    }
    // galactic (l, b) → world; A_G rows are the equatorial→galactic matrix
    const AG = [[-0.0548755604, -0.8734370902, -0.4838350155], [0.4941094279, -0.4448296300, 0.7469822445], [-0.8676661490, -0.1980763734, 0.4559837762]];
    function galVec(lDeg, bDeg, r) {
      const l = rad(lDeg), b = rad(bDeg);
      const g = [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
      const xe = AG[0][0] * g[0] + AG[1][0] * g[1] + AG[2][0] * g[2];
      const ye = AG[0][1] * g[0] + AG[1][1] * g[1] + AG[2][1] * g[2];
      const ze = AG[0][2] * g[0] + AG[1][2] * g[1] + AG[2][2] * g[2];
      const ce = Math.cos(OBLIQ), se = Math.sin(OBLIQ);
      return m2t(r * xe, r * (ye * ce + ze * se), r * (-ye * se + ze * ce));
    }

    // JPL approximate planetary position (heliocentric ecliptic, AU)
    function planetPos(p, T) {
      const a = p.elems[0] + p.rates[0] * T, e = p.elems[1] + p.rates[1] * T;
      const I = rad(p.elems[2] + p.rates[2] * T);
      const L = p.elems[3] + p.rates[3] * T, lp = p.elems[4] + p.rates[4] * T, ln = p.elems[5] + p.rates[5] * T;
      const w = rad(lp - ln), N = rad(ln);
      let M = rad(((L - lp) % 360 + 540) % 360 - 180);
      let E = M + e * Math.sin(M);
      for (let i = 0; i < 8; i++) E = E - (E - e * Math.sin(E) - M) / (1 - e * Math.cos(E));
      const xp = a * (Math.cos(E) - e), yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
      const cw = Math.cos(w), sw = Math.sin(w), cN = Math.cos(N), sN = Math.sin(N), ci = Math.cos(I), si = Math.sin(I);
      const x = (cw * cN - sw * sN * ci) * xp + (-sw * cN - cw * sN * ci) * yp;
      const y = (cw * sN + sw * cN * ci) * xp + (-sw * sN + cw * cN * ci) * yp;
      const z = (sw * si) * xp + (cw * si) * yp;
      return m2t(x, y, z);
    }
    // geocentric Moon (ecliptic, km) — truncated lunar theory, ~0.3° accuracy
    function moonPos() {
      const n = daysJ2000();
      const Lm = 218.316 + 13.176396 * n, Mm = rad(134.963 + 13.064993 * n), F = rad(93.272 + 13.229350 * n);
      const lon = Lm + 6.289 * Math.sin(Mm), lat = 5.128 * Math.sin(F);
      const r = 385001 - 20905 * Math.cos(Mm);
      return eclVec(lon, lat, r);
    }
    const gmstHours = () => (((18.697374558 + 24.06570982441908 * daysJ2000()) % 24) + 24) % 24;

    // ════════════════════════ PROCEDURAL TEXTURES ════════════════════════
    function makeCanvas(w, h, fn) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      fn(c.getContext('2d'), w, h);
      const t = new THREE.CanvasTexture(c); t.anisotropy = 4; return t;
    }
    // seeded value noise
    function makeNoise(seed) {
      const g = new Float32Array(256 * 256); let s = seed;
      const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
      for (let i = 0; i < g.length; i++) g[i] = rnd();
      return function fbm(x, y, oct) {
        let v = 0, amp = 0.5, f = 1;
        for (let o = 0; o < oct; o++) {
          const xi = Math.floor(x * f) & 255, yi = Math.floor(y * f) & 255;
          const xf = (x * f) % 1, yf = (y * f) % 1;
          const q = (a, b) => g[((yi + b) & 255) * 256 + ((xi + a) & 255)];
          const u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
          v += amp * lerp(lerp(q(0, 0), q(1, 0), u), lerp(q(0, 1), q(1, 1), u), w);
          amp *= 0.5; f *= 2;
        }
        return v;
      };
    }
    function texGlow(sharp) {
      return makeCanvas(128, 128, (ctx) => {
        const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(sharp ? 0.18 : 0.35, 'rgba(255,255,255,' + (sharp ? 0.7 : 0.32) + ')');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
      });
    }
    function texDot() {
      return makeCanvas(32, 32, (ctx) => {
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
      });
    }
    function texBanded(stops, turb, seed) {
      const n = makeNoise(seed);
      return makeCanvas(512, 256, (ctx, w, h) => {
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x += 4) {
            const t = clamp(y / h + (n(x / w * 6, y / h * 3, 4) - 0.5) * turb, 0, 1);
            const i = Math.min(stops.length - 2, Math.floor(t * (stops.length - 1)));
            const f = t * (stops.length - 1) - i;
            const c0 = stops[i], c1 = stops[i + 1];
            ctx.fillStyle = 'rgb(' + Math.round(lerp(c0[0], c1[0], f)) + ',' + Math.round(lerp(c0[1], c1[1], f)) + ',' + Math.round(lerp(c0[2], c1[2], f)) + ')';
            ctx.fillRect(x, y, 4, 1);
          }
        }
      });
    }
    function texRocky(base, dark, seed) {
      const n = makeNoise(seed);
      return makeCanvas(512, 256, (ctx, w, h) => {
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const v = n(x / 42, y / 42, 5);
          ctx.fillStyle = 'rgb(' + Math.round(lerp(dark[0], base[0], v)) + ',' + Math.round(lerp(dark[1], base[1], v)) + ',' + Math.round(lerp(dark[2], base[2], v)) + ')';
          ctx.fillRect(x, y, 2, 2);
        }
      });
    }
    function texEarthFallback() {
      const n = makeNoise(77);
      return makeCanvas(1024, 512, (ctx, w, h) => {
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const lat = 1 - Math.abs(y / h - 0.5) * 2;
          const v = n(x / 90, y / 90, 5) + 0.12 * n(x / 22, y / 22, 3);
          let r, g, b;
          if (v > 0.62) { r = 84; g = 112; b = 66; }        // land
          else if (v > 0.58) { r = 148; g = 138; b = 96; }   // coast
          else { r = 16; g = 42; b = 84; }                   // ocean
          if (lat < 0.12) { r = 224; g = 232; b = 240; }     // ice caps
          ctx.fillStyle = 'rgb(' + r + ',' + g + ',' + b + ')';
          ctx.fillRect(x, y, 2, 2);
        }
      });
    }
    function texSun() {
      const n = makeNoise(9);
      return makeCanvas(512, 256, (ctx, w, h) => {
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const v = n(x / 26, y / 26, 4);
          ctx.fillStyle = 'rgb(255,' + Math.round(170 + v * 70) + ',' + Math.round(60 + v * 60) + ')';
          ctx.fillRect(x, y, 2, 2);
        }
      });
    }
    function texRings() {
      return makeCanvas(256, 8, (ctx, w) => {
        for (let x = 0; x < w; x++) {
          const t = x / w;
          const gap = (t > 0.62 && t < 0.68) ? 0.08 : 1;    // Cassini division
          const a = gap * (0.16 + 0.5 * Math.abs(Math.sin(t * 41) * Math.sin(t * 13)));
          ctx.fillStyle = 'rgba(216,197,160,' + a.toFixed(3) + ')';
          ctx.fillRect(x, 0, 1, 8);
        }
      });
    }
    function texCMB() {
      const n = makeNoise(1965);
      return makeCanvas(512, 256, (ctx, w, h) => {
        for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
          const v = n(x / 18, y / 18, 4);
          const r = Math.round(lerp(22, 150, v)), b = Math.round(lerp(120, 30, v));
          ctx.fillStyle = 'rgb(' + r + ',' + Math.round(30 + 45 * v) + ',' + b + ')';
          ctx.fillRect(x, y, 2, 2);
        }
      });
    }
    const GLOW = texGlow(false), GLOW_SHARP = texGlow(true), DOT = texDot();

    // ════════════════════════ RENDERER / SCENE ════════════════════════
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, logarithmicDepthBuffer: true });
    } catch (e) {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, logarithmicDepthBuffer: true });
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(0x04060c, 0.82);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 2e6);
    scene.add(new THREE.AmbientLight(0xffffff, 0.22));
    const sunLight = new THREE.DirectionalLight(0xfff3e0, 1.35);
    scene.add(sunLight);

    // ════════════════════════ STATE ════════════════════════
    const state = {
      logD: 26.8, tLogD: 26.8,
      theta: Math.random() * 6.28, phi: 1.15, tTheta: 0, tPhi: 1.15,
      vTheta: 0, vPhi: 0,
      dragging: false, lastInput: performance.now(),
      fly: null,                 // active tween
      solarFocus: 'Earth',       // which solar body the solar band is centred on
      cosmosHome: true,          // cosmos band centred on the Milky Way?
      hover: null, pinned: null,
      active: false,             // newtab view visible → HUD + interaction on
      user: { lat: null, lon: null, label: 'Your location' },
    };
    state.tTheta = state.theta;
    const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ════════════════════════ BANDS ════════════════════════
    // logUnit: exponent of metres-per-render-unit. center: band-local focus.
    function makeBand(key, logUnit, logMin, logMax) {
      const group = new THREE.Group();
      scene.add(group);
      const b = {
        key, logUnit, logMin, logMax, group,
        mats: [],                       // [material, baseOpacity]
        center: new V3(), centerFrom: new V3(), centerToFn: null,
        entries: [], fade: 0, scale: 1,
        mat(m, base) { m.transparent = true; b.mats.push([m, base === undefined ? m.opacity : base]); return m; },
      };
      return b;
    }
    const EARTH = makeBand('earth', 6, 6.9, 10.2);
    const SOLAR = makeBand('solar', 11, 9.3, 13.6);
    const STARS = makeBand('stars', 17, 13.0, 19.6);
    const GALXY = makeBand('galaxy', 20, 17.6, 22.3);
    const COSMO = makeBand('cosmos', 24, 20.7, 26.9);
    const bands = [EARTH, SOLAR, STARS, GALXY, COSMO];

    // ════════════════════════ REGISTRY ════════════════════════
    const entries = [];
    // glow sprites whose on-screen size must be capped (else they whiteout up close)
    const cappedSprites = [];
    // spec: {name,type,note,node,band,kind,logMin,logMax,viewLog,pri,label,rows,hideR}
    function reg(spec) {
      spec.pri = spec.pri === undefined ? 5 : spec.pri;
      spec.rows = spec.rows || (() => []);
      entries.push(spec);
      if (spec.band) spec.band.entries.push(spec);
      return spec;
    }
    const node = (parent, pos) => { const o = new THREE.Object3D(); if (pos) o.position.copy(pos); parent.add(o); return o; };

    const fmtLen = (m) => {
      if (m < 1e9) return Math.round(m / 1e3).toLocaleString() + ' km';
      if (m < 0.05 * AU) return (m / 1e9).toFixed(2) + ' million km';
      if (m < 0.05 * LY) return (m / AU).toFixed(m < 10 * AU ? 2 : 1) + ' AU';
      if (m < 1e4 * LY) return (m / LY).toFixed(m < 100 * LY ? 1 : 0) + ' ly';
      if (m < 1e8 * LY) return Math.round(m / LY).toLocaleString() + ' ly';
      if (m < 1e9 * LY * 0.5) return (m / (1e6 * LY)).toFixed(1) + ' Mly';
      return (m / (1e9 * LY)).toFixed(2) + ' Gly';
    };
    const fmtKm = (km) => km >= 1 ? Math.round(km).toLocaleString() + ' km' : (km * 1000).toFixed(0) + ' m';

    // live camera→object distance in metres
    const _wp = new V3();
    function liveDist(e) {
      if (!e.band || e.band.fade <= 0) return null;
      e.node.getWorldPosition(_wp);
      return _wp.distanceTo(camera.position) / e.band.scale * Math.pow(10, e.band.logUnit);
    }

    // ─────────────── BACKDROP (real sky as seen from here) ───────────────
    const SKY = 2e5;
    const backdrop = new THREE.Group(); scene.add(backdrop);
    const backdropMats = [];
    const bmat = (m, base) => { m.transparent = true; backdropMats.push([m, base === undefined ? m.opacity : base]); return m; };
    function specColor(sp) {
      const c = { O: 0x9bb0ff, B: 0xaabfff, A: 0xcad7ff, F: 0xf8f7ff, G: 0xfff4ea, K: 0xffd2a1, M: 0xffcc6f, D: 0xe8e8ff, L: 0xffb46b, P: 0xbfe3ff, C: 0x9bb0ff, T: 0xff9f7f }[sp && sp[0].toUpperCase()];
      return new THREE.Color(c || 0xdfe8ff);
    }
    (function buildBackdrop() {
      // faint random stars, three size classes
      [[2600, 1.6, 0.55], [700, 2.6, 0.7], [180, 3.6, 0.9]].forEach(([count, size, op], k) => {
        const pos = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
          const u = Math.random() * 2 - 1, ph = Math.random() * 6.283, s = Math.sqrt(1 - u * u);
          pos[i * 3] = SKY * s * Math.cos(ph); pos[i * 3 + 1] = SKY * u; pos[i * 3 + 2] = SKY * s * Math.sin(ph);
        }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        backdrop.add(new THREE.Points(g, bmat(new THREE.PointsMaterial({ size, map: DOT, color: 0xd8e4ff, sizeAttenuation: false, depthWrite: false, opacity: op, blending: THREE.AdditiveBlending }))));
      });
      // real catalogue stars in their true directions
      const n = D.STARS.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      D.STARS.forEach((s, i) => {
        const v = eqVec(s[1], s[2], SKY * 0.98);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        const c = specColor(s[4]); const boost = clamp(1.15 - s[5] * 0.16, 0.25, 1.3);
        col[i * 3] = c.r * boost; col[i * 3 + 1] = c.g * boost; col[i * 3 + 2] = c.b * boost;
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      backdrop.add(new THREE.Points(g, bmat(new THREE.PointsMaterial({ size: 4.4, map: DOT, vertexColors: true, sizeAttenuation: false, depthWrite: false, opacity: 0.95, blending: THREE.AdditiveBlending }))));
      // Milky Way band along the true galactic equator
      const mwN = 3800, mp = new Float32Array(mwN * 3), mc = new Float32Array(mwN * 3);
      for (let i = 0; i < mwN; i++) {
        const l = Math.random() * 360;
        let b = (Math.random() + Math.random() + Math.random() + Math.random() - 2) * 9;
        const towardCore = Math.exp(-Math.pow(((l + 180) % 360 - 180) / 70, 2));
        if (Math.random() < towardCore * 0.5) b *= 0.5;
        const v = galVec(l, b, SKY * 0.99);
        mp[i * 3] = v.x; mp[i * 3 + 1] = v.y; mp[i * 3 + 2] = v.z;
        const w = 0.25 + 0.75 * towardCore, warm = Math.random() * 0.3;
        mc[i * 3] = 0.62 * w + warm * 0.2; mc[i * 3 + 1] = 0.68 * w + warm * 0.1; mc[i * 3 + 2] = 0.85 * w;
      }
      const mg = new THREE.BufferGeometry();
      mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
      mg.setAttribute('color', new THREE.BufferAttribute(mc, 3));
      backdrop.add(new THREE.Points(mg, bmat(new THREE.PointsMaterial({ size: 2.0, map: DOT, vertexColors: true, sizeAttenuation: false, depthWrite: false, opacity: 0.5, blending: THREE.AdditiveBlending }))));
      // galactic-centre glow
      const core = new THREE.Sprite(bmat(new THREE.SpriteMaterial({ map: GLOW, color: 0xd9c9a8, depthWrite: false, opacity: 0.4, blending: THREE.AdditiveBlending })));
      core.position.copy(galVec(0, 0, SKY * 0.97)); core.scale.set(SKY * 0.5, SKY * 0.28, 1);
      backdrop.add(core);
    })();
    // the Sun in the sky (position updated live)
    const skySun = new THREE.Sprite(bmat(new THREE.SpriteMaterial({ map: GLOW_SHARP, color: 0xfff2cf, depthWrite: false, opacity: 0.95, blending: THREE.AdditiveBlending })));
    skySun.scale.set(SKY * 0.09, SKY * 0.09, 1); backdrop.add(skySun);
    const skySunNode = node(backdrop);
    // hoverable backdrop stars (true directions, from Earth to solar-system scale)
    D.STARS.forEach((s) => {
      reg({
        name: s[0], type: s[4] + ' · mag ' + s[5], note: s[6], kind: 'star',
        node: node(backdrop, eqVec(s[1], s[2], SKY * 0.98)), band: null, backdropStar: true,
        logMin: 6.9, logMax: 13.4, viewLog: Math.min(17.4, Math.max(15.3, Math.log10(s[3] * LY) - 0.7)), pri: clamp(Math.round(s[5] + 3), 0, 9),
        rows: () => [['Distance', s[3] + ' light-years'], ['Class', s[4]], ['Magnitude', String(s[5])]],
        star: s,
      });
    });
    reg({ name: 'The Sun', type: 'G2V star · our star', note: '4.6 billion years old · 99.86% of the Solar System’s mass', kind: 'sun', node: skySunNode, band: null, logMin: 6.9, logMax: 9.2, viewLog: 10.2, pri: 1, when: () => state.solarFocus === 'Earth', rows: () => [['Distance', '1.00 AU · 8.3 light-minutes'], ['Radius', '696,000 km']] });

    // ─────────────── EARTH BAND (unit 10⁶ m) ───────────────
    const earthTilt = new THREE.Group(); EARTH.group.add(earthTilt);
    const earthSpin = new THREE.Group(); earthTilt.add(earthSpin);
    const axis = m2t(0, Math.sin(OBLIQ), Math.cos(OBLIQ)).normalize(); // equatorial pole in world
    earthTilt.quaternion.setFromUnitVectors(new V3(0, 1, 0), axis);

    const earthMat = EARTH.mat(new THREE.MeshPhongMaterial({ map: texEarthFallback(), shininess: 12, specular: new THREE.Color(0x202830) }), 1);
    const earthMesh = new THREE.Mesh(new THREE.SphereGeometry(6.371, 72, 48), earthMat);
    earthSpin.add(earthMesh);
    // try real Blue Marble texture, keep procedural as fallback
    (function loadEarth() {
      const urls = [
        'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg',
        'https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/earth_atmos_2048.jpg',
      ];
      const loader = new THREE.TextureLoader(); loader.crossOrigin = 'anonymous';
      (function tryNext(i) {
        if (i >= urls.length) return;
        loader.load(urls[i], (t) => { t.anisotropy = 8; earthMat.map = t; earthMat.needsUpdate = true; }, undefined, () => tryNext(i + 1));
      })(0);
      loader.load('https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/textures/planets/moon_1024.jpg', (t) => { moonMat.map = t; moonMat.needsUpdate = true; }, undefined, () => {});
    })();
    // atmosphere rim
    const atmo = new THREE.Mesh(new THREE.SphereGeometry(6.371 * 1.035, 48, 32), EARTH.mat(new THREE.ShaderMaterial({
      uniforms: { c: { value: new THREE.Color(0x5fa8ff) } },
      vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vN = normalize(normalMatrix*normal); vec4 mv = modelViewMatrix*vec4(position,1.0); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
      fragmentShader: 'uniform vec3 c; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0-abs(dot(vN,vV)), 3.2); gl_FragColor = vec4(c, f*0.9); }',
      side: THREE.FrontSide, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }), 1));
    earthTilt.add(atmo);

    // sphere-surface position in mesh space (matches equirect UV mapping)
    function latLonToVec(lat, lon, r) {
      const th = rad(90 - lat), ph = rad(lon + 180);
      return new V3(-r * Math.cos(ph) * Math.sin(th), r * Math.cos(th), r * Math.sin(ph) * Math.sin(th));
    }
    // Moon
    const moonMat = EARTH.mat(new THREE.MeshPhongMaterial({ map: texRocky([176, 172, 166], [72, 70, 68], 31), shininess: 4 }), 1);
    const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(1.7374, 40, 28), moonMat);
    EARTH.group.add(moonMesh);
    const moonEntry = reg({
      name: 'The Moon', type: 'Natural satellite', note: 'Drifting 3.8 cm farther from Earth every year', kind: 'moon',
      node: moonMesh, band: EARTH, logMin: 7.4, logMax: 10.2, viewLog: 7.4, pri: 1, label: true, hideR: 1.74,
      rows: (e) => [['Distance', fmtLen(liveDist(e) || 3.84e8)], ['Radius', '1,737 km'], ['Orbital period', '27.3 days']],
    });
    const earthEntry = reg({
      name: 'Earth', type: 'Planet · your home', note: D.PLANETS[2].info, kind: 'planet',
      node: earthMesh, band: EARTH, logMin: 7.6, logMax: 9.8, viewLog: 7.55, pri: 0, label: true, hideR: 6.371,
      rows: () => [['Radius', '6,371 km'], ['Orbital speed', '29.8 km/s'], ['Age', '4.54 billion years']],
    });
    // user location marker (position set once located)
    const userNode = node(earthSpin, latLonToVec(20, 0, 6.45));
    const userEntry = reg({
      name: 'Your location', type: 'You are here', note: 'Locating…', kind: 'user',
      node: userNode, band: EARTH, logMin: 6.9, logMax: 8.5, viewLog: 7.15, pri: 0, label: true,
      rows: () => [['Coordinates', state.user.lat === null ? 'locating…' : state.user.lat.toFixed(2) + '°, ' + state.user.lon.toFixed(2) + '°']],
    });
    // satellites & JWST
    const satRing = (altKm, incDeg, color) => {
      const r = (6371 + altKm) / 1000, pts = [];
      for (let i = 0; i <= 128; i++) { const a = i / 128 * 6.283; pts.push(new V3(r * Math.cos(a), 0, r * Math.sin(a))); }
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), EARTH.mat(new THREE.LineBasicMaterial({ color, opacity: 0.22, depthWrite: false }), 0.22));
      line.rotation.x = rad(incDeg); earthTilt.add(line); return line;
    };
    let jwstNode = null;
    D.EARTH_SATS.forEach((s, i) => {
      let nd;
      if (s.l2) { nd = node(EARTH.group); jwstNode = nd; }
      else {
        const ring = s.ring ? satRing(s.alt, [51.6, 28.5, 55, 0][i] || 0, 0x6fa8d8) : null;
        const r = (6371 + s.alt) / 1000;
        nd = node(ring || earthTilt, new V3(r * 0.71, 0, r * 0.71));
        if (!ring) { const p = latLonToVec(28, -80, r); nd.position.copy(p); }
      }
      reg({
        name: s.name, type: 'Spacecraft · Earth system', note: s.note, kind: 'craft',
        node: nd, band: EARTH, logMin: 6.9, logMax: s.l2 ? 9.9 : 8.3, viewLog: s.l2 ? 9.3 : 7.1, pri: 3,
        rows: (e) => [['Distance', fmtLen(liveDist(e) || 1)], [s.l2 ? 'Station' : 'Altitude', s.l2 ? 'Sun–Earth L2' : fmtKm(s.alt) + ' up']],
      });
    });

    // ─────────────── SOLAR BAND (unit 10¹¹ m; 1 AU = 1.496) ───────────────
    const AUu = AU / 1e11;
    const sunPointLight = new THREE.PointLight(0xfff0dd, 1.15, 0, 0);
    SOLAR.group.add(sunPointLight);
    const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(6.96e8 / 1e11, 32, 24), SOLAR.mat(new THREE.MeshBasicMaterial({ map: texSun() }), 1));
    SOLAR.group.add(sunMesh);
    [[0.09, 0.9, 0xffdca8, 130], [0.5, 0.28, 0xffb46b, 340]].forEach(([sc, op, col, maxPx]) => {
      const sp = new THREE.Sprite(SOLAR.mat(new THREE.SpriteMaterial({ map: GLOW, color: col, depthWrite: false, opacity: op, blending: THREE.AdditiveBlending }), op));
      sunMesh.add(sp);
      cappedSprites.push({ sp, band: SOLAR, natural: sc, maxPx });
    });
    reg({
      name: 'The Sun', type: 'G2V main-sequence star', note: 'Converts 4 million tonnes of matter to light every second', kind: 'sun',
      node: sunMesh, band: SOLAR, logMin: 9.3, logMax: 13.6, viewLog: 9.6, pri: 0, label: true, hideR: 6.96e8 / 1e11,
      rows: (e) => [['Distance', fmtLen(liveDist(e) || AU)], ['Radius', '696,000 km — 109 Earths across'], ['Surface', '5,505 °C']],
    });

    const planetObjs = [];
    const T0 = (julianDay() - 2451545.0) / 36525;
    D.PLANETS.forEach((p) => {
      const holder = new THREE.Group(); SOLAR.group.add(holder);
      const rU = p.radiusKm * 1000 / 1e11;
      let mat;
      if (p.tex === 'jupiter') mat = new THREE.MeshLambertMaterial({ map: texBanded([[216, 180, 140], [176, 128, 96], [232, 208, 176], [190, 148, 110], [222, 196, 160], [166, 118, 90]], 0.18, 5) });
      else if (p.tex === 'saturn') mat = new THREE.MeshLambertMaterial({ map: texBanded([[227, 207, 163], [206, 182, 137], [236, 220, 184], [214, 192, 150]], 0.1, 6) });
      else if (p.tex === 'venus') mat = new THREE.MeshLambertMaterial({ map: texBanded([[230, 201, 141], [212, 180, 122], [238, 214, 160]], 0.3, 7) });
      else if (p.tex === 'mars') mat = new THREE.MeshLambertMaterial({ map: texRocky([193, 99, 60], [96, 48, 30], 8) });
      else if (p.tex === 'ice') mat = new THREE.MeshLambertMaterial({ map: texBanded(p.name === 'Uranus' ? [[159, 214, 217], [140, 198, 205], [176, 226, 228]] : [[74, 114, 232], [56, 88, 200], [96, 136, 240]], 0.12, 9) });
      else if (p.tex === 'earth') mat = new THREE.MeshLambertMaterial({ color: 0x4a7ac9 });
      else mat = new THREE.MeshLambertMaterial({ map: texRocky([156, 142, 127], [70, 64, 58], 10) });
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rU, 40, 26), SOLAR.mat(mat, 1));
      holder.add(mesh);
      if (p.rings) {
        const ring = new THREE.Mesh(new THREE.RingGeometry(rU * 1.24, rU * 2.35, 96), SOLAR.mat(new THREE.MeshBasicMaterial({ map: texRings(), side: THREE.DoubleSide, transparent: true, depthWrite: false }), 1));
        ring.rotation.x = rad(63); holder.add(ring);
      }
      // orbit line: sweep mean longitude through 360° at the current epoch's elements
      const seg = 240, pts = [];
      for (let i = 0; i <= seg; i++) {
        const el = planetPos({
          elems: [p.elems[0] + p.rates[0] * T0, p.elems[1] + p.rates[1] * T0, p.elems[2] + p.rates[2] * T0, (i / seg) * 360 + p.elems[4], p.elems[4] + p.rates[4] * T0, p.elems[5] + p.rates[5] * T0],
          rates: [0, 0, 0, 0, 0, 0],
        }, 0);
        pts.push(el.multiplyScalar(AUu));
      }
      const orbit = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), SOLAR.mat(new THREE.LineBasicMaterial({ color: p.dwarf ? 0x6a6f8a : 0x5a7fa8, opacity: p.dwarf ? 0.16 : 0.26, depthWrite: false }), p.dwarf ? 0.16 : 0.26));
      SOLAR.group.add(orbit);
      // moons
      const moonsGroup = new THREE.Group(); holder.add(moonsGroup);
      const moonEntries = [];
      p.moons.forEach((m) => {
        const mr = m[1] * 1000 / 1e11;
        const mpts = [];
        for (let i = 0; i <= 64; i++) { const a = i / 64 * 6.283; mpts.push(new V3(mr * Math.cos(a), 0, mr * Math.sin(a))); }
        moonsGroup.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(mpts), SOLAR.mat(new THREE.LineBasicMaterial({ color: 0x7a8fa8, opacity: 0.3, depthWrite: false }), 0.3)));
        const mm = new THREE.Mesh(new THREE.SphereGeometry(Math.max(m[3] * 1000 / 1e11, rU * 0.05), 20, 14), SOLAR.mat(new THREE.MeshLambertMaterial({ color: 0xb8b4ae }), 1));
        moonsGroup.add(mm);
        const en = reg({
          name: m[0], type: 'Moon of ' + p.name, note: m[4], kind: 'moon',
          node: mm, band: SOLAR, logMin: 8.0, logMax: 11.0, viewLog: Math.max(8.2, Math.log10(Math.max(m[3] * 1000 * 20, m[1] * 1000 * 0.8))), pri: 4, moonOf: p.name,
          rows: (e) => [['Distance', fmtLen(liveDist(e) || 1)], ['Radius', fmtKm(m[3])], ['Orbit', fmtKm(m[1]) + ' · ' + m[2] + ' d']],
        });
        moonEntries.push({ e: en, mesh: mm, r: mr, period: m[2], seed: Math.random() * 6.283 });
      });
      const entry = reg({
        name: p.name, type: (p.dwarf ? 'Dwarf planet' : 'Planet') + ' · period ' + p.period, note: p.info, kind: 'planet',
        node: mesh, band: SOLAR, logMin: p.name === 'Earth' ? 9.9 : 8.0, logMax: 13.6, viewLog: Math.max(8.15, Math.log10(p.radiusKm * 1000 * 9)), pri: p.dwarf ? 3 : 1, label: !p.dwarf, hideR: rU,
        rows: (e) => {
          const d = liveDist(e), hp = planetPos(p, (julianDay() - 2451545.0) / 36525);
          return [['Distance from you', d ? fmtLen(d) : '—'], ['Distance from Sun', hp.length().toFixed(2) + ' AU'], ['Radius', fmtKm(p.radiusKm)]];
        },
        planet: p,
      });
      planetObjs.push({ p, holder, mesh, orbit, moonsGroup, moonEntries, entry, rU });
    });

    // small bodies + probes
    D.SMALL_BODIES.forEach((s) => {
      const nd = node(SOLAR.group, eclVec(s[2], s[3], s[4] * AUu));
      reg({
        name: s[0], type: s[1] + ' · position approximate', note: s[6], kind: s[1].indexOf('Comet') >= 0 ? 'comet' : 'small',
        node: nd, band: SOLAR, logMin: 10.2, logMax: 13.6, viewLog: clamp(Math.log10(Math.max(s[5] * 1000 * 4000, 1e9)), 9.3, 12), pri: 5,
        rows: (e) => [['Distance from Sun', s[4] + ' AU'], ['Radius', fmtKm(s[5])]],
      });
    });
    D.SPACECRAFT.forEach((s) => {
      const nd = node(SOLAR.group, eclVec(s[1], s[2], s[3] * AUu));
      reg({
        name: s[0], type: 'Deep-space probe', note: s[4], kind: 'craft',
        node: nd, band: SOLAR, logMin: 11.5, logMax: 13.6, viewLog: 13.0, pri: 4,
        rows: () => [['Distance from Sun', '~' + s[3] + ' AU'], ['Signal delay', (s[3] * 499 / 3600).toFixed(1) + ' hours']],
      });
    });
    // belts
    function belt(parent, mat, count, rMin, rMax, spread, yScale) {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const r = (rMin + Math.pow(Math.random(), 0.8) * (rMax - rMin)) * AUu;
        const a = Math.random() * 6.283, y = (Math.random() + Math.random() - 1) * spread * r * yScale;
        pos[i * 3] = r * Math.cos(a); pos[i * 3 + 1] = y; pos[i * 3 + 2] = r * Math.sin(a);
      }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const pt = new THREE.Points(g, mat); parent.add(pt); return pt;
    }
    const beltMat = SOLAR.mat(new THREE.PointsMaterial({ size: 1.5, map: DOT, color: 0x9a8d7a, sizeAttenuation: false, depthWrite: false, opacity: 0.4, blending: THREE.AdditiveBlending }), 0.4);
    const asteroidBelt = belt(SOLAR.group, beltMat, 4500, 2.1, 3.3, 0.14, 1);
    const kuiperMat = SOLAR.mat(new THREE.PointsMaterial({ size: 1.5, map: DOT, color: 0x6f86a8, sizeAttenuation: false, depthWrite: false, opacity: 0.32, blending: THREE.AdditiveBlending }), 0.32);
    const kuiperBelt = belt(SOLAR.group, kuiperMat, 6000, 30, 50, 0.18, 1);
    reg({ name: 'Asteroid Belt', type: 'Main belt · 2.1–3.3 AU', note: '1–2 million asteroids over 1 km — total mass 3% of the Moon', kind: 'small', node: node(SOLAR.group, eclVec(45, 0, 2.7 * AUu)), band: SOLAR, logMin: 11.2, logMax: 12.6, viewLog: 11.8, pri: 6, rows: () => [] });
    reg({ name: 'Kuiper Belt', type: 'Trans-Neptunian belt · 30–50 AU', note: 'Icy frontier — home of Pluto, Makemake and Haumea', kind: 'small', node: node(SOLAR.group, eclVec(210, 0, 42 * AUu)), band: SOLAR, logMin: 12.4, logMax: 13.6, viewLog: 13.0, pri: 6, rows: () => [] });

    // ─────────────── STARS BAND (unit 10¹⁷ m; 1 ly = 0.0946) ───────────────
    const LYu = LY / 1e17;
    (function buildStars() {
      const n = D.STARS.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      D.STARS.forEach((s, i) => {
        const v = eqVec(s[1], s[2], s[3] * LYu);
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        const c = specColor(s[4]);
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        reg({
          name: s[0], type: s[4] + ' star', note: s[6], kind: 'star',
          node: node(STARS.group, v), band: STARS, logMin: 13.0, logMax: 19.6,
          viewLog: Math.min(17.4, Math.max(15.0, Math.log10(s[3] * LY) - 0.9)), pri: clamp(Math.round(s[5] + 3), 0, 9),
          rows: (e) => [['Distance from Sun', s[3] + ' ly'], ['Class', s[4]], ['Magnitude', String(s[5])]],
        });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      STARS.group.add(new THREE.Points(g, STARS.mat(new THREE.PointsMaterial({ size: 5, map: DOT, vertexColors: true, sizeAttenuation: false, depthWrite: false, opacity: 0.95, blending: THREE.AdditiveBlending }), 0.95)));
      // Sun at origin
      const sunSp = new THREE.Sprite(STARS.mat(new THREE.SpriteMaterial({ map: GLOW_SHARP, color: 0xfff0c8, depthWrite: false, opacity: 0.95, blending: THREE.AdditiveBlending }), 0.95));
      STARS.group.add(sunSp);
      cappedSprites.push({ sp: sunSp, band: STARS, natural: 0.2, maxPx: 34 });
      reg({
        name: 'The Sun', type: 'Our star — you are here', note: 'One of ~200 billion stars in the Milky Way', kind: 'sun',
        node: sunSp, band: STARS, logMin: 13.0, logMax: 19.6, viewLog: 16.6, pri: 0, label: true,
        rows: () => [['Neighbourhood', 'Local Bubble, Orion Arm']],
      });
      // Oort cloud shell
      const oN = 3000, op = new Float32Array(oN * 3);
      for (let i = 0; i < oN; i++) {
        const u = Math.random() * 2 - 1, ph = Math.random() * 6.283, s2 = Math.sqrt(1 - u * u);
        const r = (0.03 + Math.pow(Math.random(), 1.6) * 0.12);
        op[i * 3] = r * s2 * Math.cos(ph); op[i * 3 + 1] = r * u; op[i * 3 + 2] = r * s2 * Math.sin(ph);
      }
      const og = new THREE.BufferGeometry(); og.setAttribute('position', new THREE.BufferAttribute(op, 3));
      STARS.group.add(new THREE.Points(og, STARS.mat(new THREE.PointsMaterial({ size: 1.3, map: DOT, color: 0x8fa8c8, sizeAttenuation: false, depthWrite: false, opacity: 0.35, blending: THREE.AdditiveBlending }), 0.35)));
      reg({ name: 'Oort Cloud', type: 'Comet reservoir · 0.03–1.5 ly', note: 'Trillions of icy bodies — the Sun’s outermost shell', kind: 'small', node: node(STARS.group, new V3(0.09, 0.02, 0)), band: STARS, logMin: 14.6, logMax: 16.4, viewLog: 15.5, pri: 6, rows: () => [] });
    })();

    // ─────────────── GALAXY BAND (unit 10²⁰ m; 1 kly = 0.0946) ───────────────
    const KLYu = 1000 * LY / 1e20;
    (function buildGalaxy() {
      const toCore = galVec(0, 0, 1), pole = galVec(0, 90, 1), l90 = galVec(90, 0, 1);
      // band-local frame: Sun at origin; galactic core at +toCore * C
      const gpos = (u, v, w) => new V3().addScaledVector(toCore, u).addScaledVector(pole, v).addScaledVector(l90, w);
      const C = 26.67 * KLYu; // galactocentric distance of the Sun
      const total = 34000, pos = new Float32Array(total * 3), col = new Float32Array(total * 3);
      let i = 0;
      // (u,v,w) measured from the CORE; +C shifts into the Sun-centred frame
      const put = (u, v, w, r2, g2, b2) => { const p = gpos(u + C, v, w); pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z; col[i * 3] = r2; col[i * 3 + 1] = g2; col[i * 3 + 2] = b2; i++; };
      const R = 50 * KLYu;
      while (i < 24000) {
        const arm = Math.floor(Math.random() * 4), major = arm < 2;
        const r = Math.pow(Math.random(), 0.65) * R;
        const wind = Math.log(Math.max(r / (2.4 * KLYu), 0.12)) / Math.tan(rad(12.5));
        const th = wind + arm * Math.PI / 2 + (Math.random() - 0.5) * (0.5 + 0.7 * (1 - r / R));
        const spread = 0.05 * R * (0.35 + r / R);
        const du = Math.cos(th) * r + (Math.random() - 0.5) * spread;
        const dw = Math.sin(th) * r + (Math.random() - 0.5) * spread;
        const dv = (Math.random() + Math.random() - 1) * 0.016 * R * (1.2 - 0.7 * r / R);
        const hot = Math.random();
        if (major && hot > 0.82) put(du, dv, dw, 1.0, 0.62, 0.72);          // HII regions
        else if (hot > 0.45) put(du, dv, dw, 0.62 + 0.2 * hot, 0.72 + 0.15 * hot, 1.0);
        else put(du, dv, dw, 0.85, 0.83, 0.72);
      }
      // central bar + bulge
      while (i < 31000) {
        const t = Math.random() * 2 - 1;
        const bu = t * 4.2 * KLYu + (Math.random() - 0.5) * 2.2 * KLYu;
        const bw = t * 1.6 * KLYu + (Math.random() - 0.5) * 2.2 * KLYu;
        const bv = (Math.random() + Math.random() - 1) * 1.4 * KLYu;
        put(bu, bv, bw, 1.0, 0.85, 0.6);
      }
      // halo
      while (i < total) {
        const u2 = Math.random() * 2 - 1, ph = Math.random() * 6.283, s2 = Math.sqrt(1 - u2 * u2);
        const r = Math.pow(Math.random(), 0.5) * R * 1.6;
        put(r * s2 * Math.cos(ph), r * u2 * 0.7, r * s2 * Math.sin(ph), 0.5, 0.5, 0.62);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      GALXY.group.add(new THREE.Points(g, GALXY.mat(new THREE.PointsMaterial({ size: 1.8, map: DOT, vertexColors: true, sizeAttenuation: false, depthWrite: false, opacity: 0.75, blending: THREE.AdditiveBlending }), 0.75)));
      // core glow (screen-size-capped each frame)
      const coreSp = new THREE.Sprite(GALXY.mat(new THREE.SpriteMaterial({ map: GLOW, color: 0xffe2b0, depthWrite: false, opacity: 0.75, blending: THREE.AdditiveBlending }), 0.75));
      coreSp.position.copy(gpos(C, 0, 0)); GALXY.group.add(coreSp);
      cappedSprites.push({ sp: coreSp, band: GALXY, natural: 9 * KLYu, maxPx: 320 });

      reg({
        name: 'Sagittarius A*', type: 'Supermassive black hole', note: D.DSOS[26][5], kind: 'bh',
        node: node(GALXY.group, gpos(C, 0, 0)), band: GALXY, logMin: 17.6, logMax: 22.3, viewLog: 20.4, pri: 0, label: true,
        rows: () => [['Distance', '26,670 ly'], ['Mass', '4.15 million Suns']],
      });
      reg({
        name: 'The Sun · you are here', type: 'Orion Arm, Milky Way', note: 'One galactic orbit takes ~230 million years', kind: 'sun',
        node: node(GALXY.group, new V3()), band: GALXY, logMin: 18.2, logMax: 21.4, viewLog: 18.4, pri: 0, label: true,
        rows: () => [['Galactocentric distance', '26,670 ly']],
      });
      // spiral arm labels: (distFromSun kly toward/away core, sideways kly)
      [['Orion Arm', -1.2, 3.5], ['Perseus Arm', -6.4, 2.0], ['Scutum–Centaurus Arm', 11.0, -3.0], ['Sagittarius Arm', 5.2, 2.5]].forEach(([nm, du, dw]) => {
        reg({
          name: nm, type: 'Spiral arm', note: nm === 'Orion Arm' ? 'Our home arm — a minor spur between giants' : 'Major spiral arm of the Milky Way', kind: 'arm',
          node: node(GALXY.group, gpos(du * KLYu, 0, dw * KLYu)), band: GALXY, logMin: 19.6, logMax: 21.6, viewLog: 20.2, pri: 7, rows: () => [],
        });
      });
      // DSOs at true positions
      D.DSOS.forEach((d2, idx) => {
        if (idx === 26) return; // Sgr A* handled above
        const v = eqVec(d2[1], d2[2], d2[3] * LY / 1e20);
        const kind = d2[4].indexOf('cluster') >= 0 || d2[4].indexOf('Cluster') >= 0 ? 'cluster' : 'nebula';
        reg({
          name: d2[0], type: d2[4], note: d2[5], kind,
          node: node(GALXY.group, v), band: GALXY, logMin: 17.6, logMax: 21.8, viewLog: clamp(Math.log10(d2[3] * LY) - 0.9, 17.4, 20.3), pri: 4,
          rows: () => [['Distance', d2[3].toLocaleString() + ' ly'], ['Type', d2[4]]],
        });
      });
    })();

    // ─────────────── COSMOS BAND (unit 10²⁴ m; 1 Mly = 0.00946) ───────────────
    const MLYu = 1e6 * LY / 1e24;
    (function buildCosmos() {
      // Milky Way marker at origin
      const mw = new THREE.Sprite(COSMO.mat(new THREE.SpriteMaterial({ map: GLOW, color: 0xcfd8ff, depthWrite: false, opacity: 0.9, blending: THREE.AdditiveBlending }), 0.9));
      COSMO.group.add(mw);
      cappedSprites.push({ sp: mw, band: COSMO, natural: 0.11 * MLYu * 10, maxPx: 160 });
      reg({
        name: 'Milky Way', type: 'Barred spiral galaxy — home', note: '~200 billion stars, 100,000 ly across', kind: 'galaxy',
        node: mw, band: COSMO, logMin: 20.7, logMax: 26.9, viewLog: 21.6, pri: 0, label: true,
        rows: () => [['Diameter', '105,700 ly'], ['Stars', '100–400 billion']],
      });
      // real (approximate) visual diameters, Mly — drawn as tilted glow discs
      const GAL_DIA = { 'Andromeda (M31)': 0.22, 'Triangulum (M33)': 0.06, 'Large Magellanic Cloud': 0.032, 'Small Magellanic Cloud': 0.018, 'Bode’s Galaxy (M81)': 0.09, 'Cigar Galaxy (M82)': 0.037, 'Virgo A (M87)': 0.24, 'Pinwheel Galaxy (M101)': 0.17, 'Whirlpool Galaxy (M51)': 0.076, 'Sombrero Galaxy (M104)': 0.082, 'Centaurus A': 0.097, 'Southern Pinwheel (M83)': 0.118, 'Sculptor Galaxy (NGC 253)': 0.09, 'IC 1101': 4.0 };
      const n = D.GALAXIES.length, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      D.GALAXIES.forEach((g2, i) => {
        const v = eqVec(g2[1], g2[2], g2[3] * MLYu);
        const dia = GAL_DIA[g2[0]];
        if (dia) {
          const sp = new THREE.Sprite(COSMO.mat(new THREE.SpriteMaterial({ map: GLOW, color: g2[4].indexOf('lliptical') >= 0 ? 0xffe8c8 : 0xc8d8ff, depthWrite: false, opacity: 0.75, blending: THREE.AdditiveBlending, rotation: Math.random() * Math.PI }), 0.75));
          sp.position.copy(v);
          sp.scale.set(dia * MLYu, dia * MLYu * (0.32 + Math.random() * 0.35), 1);
          COSMO.group.add(sp);
        }
        pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z;
        const big = g2[3] < 3;
        const c = new THREE.Color(g2[4].indexOf('uasar') >= 0 ? 0x9fd8ff : (g2[4].indexOf('lliptical') >= 0 ? 0xffe0b8 : 0xc8d4ff));
        col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
        reg({
          name: g2[0], type: g2[4], note: g2[5], kind: 'galaxy',
          node: node(COSMO.group, v), band: COSMO, logMin: 20.7, logMax: 26.9,
          viewLog: clamp(Math.log10(g2[3] * 1e6 * LY) - 1.1, 21.0, 25.4), pri: big ? 1 : (g2[3] < 60 ? 3 : 5), label: g2[0].indexOf('Andromeda') >= 0,
          rows: () => [['Distance', g2[3] < 1 ? Math.round(g2[3] * 1000).toLocaleString() + ' kly' : g2[3].toLocaleString() + ' Mly'], ['Type', g2[4]]],
        });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      COSMO.group.add(new THREE.Points(g, COSMO.mat(new THREE.PointsMaterial({ size: 5.5, map: DOT, vertexColors: true, sizeAttenuation: false, depthWrite: false, opacity: 0.95, blending: THREE.AdditiveBlending }), 0.95)));
      // structures: labelled cluster clumps
      D.STRUCTURES.forEach((s) => {
        const center = eqVec(s[1], s[2], s[3] * MLYu);
        const cn = 90, cp = new Float32Array(cn * 3), sig = Math.max(s[3] * 0.05, 6) * MLYu;
        for (let k = 0; k < cn; k++) {
          cp[k * 3] = center.x + (Math.random() + Math.random() - 1) * sig;
          cp[k * 3 + 1] = center.y + (Math.random() + Math.random() - 1) * sig * 0.7;
          cp[k * 3 + 2] = center.z + (Math.random() + Math.random() - 1) * sig;
        }
        const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
        COSMO.group.add(new THREE.Points(cg, COSMO.mat(new THREE.PointsMaterial({ size: 2.4, map: DOT, color: 0x9fc0e8, sizeAttenuation: false, depthWrite: false, opacity: 0.5, blending: THREE.AdditiveBlending }), 0.5)));
        reg({
          name: s[0], type: 'Large-scale structure', note: s[4], kind: 'structure',
          node: node(COSMO.group, center), band: COSMO, logMin: 22.4, logMax: 26.9, viewLog: clamp(Math.log10(s[3] * 1e6 * LY) - 0.6, 23, 26.2), pri: 2,
          rows: () => [['Distance', s[3].toLocaleString() + ' Mly']],
        });
      });
      // cosmic web
      const wn = 14000, wp = new Float32Array(wn * 3);
      const seeds = [];
      for (let k = 0; k < 110; k++) {
        const u = Math.random() * 2 - 1, ph = Math.random() * 6.283, s2 = Math.sqrt(1 - u * u);
        const r = 3 + Math.pow(Math.random(), 0.7) * 90;
        seeds.push(new V3(r * s2 * Math.cos(ph), r * u, r * s2 * Math.sin(ph)));
      }
      for (let k = 0; k < wn; k++) {
        const a = seeds[(Math.random() * seeds.length) | 0];
        let b = seeds[(Math.random() * seeds.length) | 0], tries = 0;
        while (a.distanceTo(b) > 55 && tries++ < 6) b = seeds[(Math.random() * seeds.length) | 0];
        const t = Math.random(), jit = 1.6;
        wp[k * 3] = lerp(a.x, b.x, t) + (Math.random() - 0.5) * jit;
        wp[k * 3 + 1] = lerp(a.y, b.y, t) + (Math.random() - 0.5) * jit;
        wp[k * 3 + 2] = lerp(a.z, b.z, t) + (Math.random() - 0.5) * jit;
      }
      const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wp, 3));
      const webMat = COSMO.mat(new THREE.PointsMaterial({ size: 1.6, map: DOT, color: 0x86a4d8, sizeAttenuation: false, depthWrite: false, opacity: 0.45, blending: THREE.AdditiveBlending }), 0.45);
      const web = new THREE.Points(wg, webMat); COSMO.group.add(web);
      // CMB shell
      const cmb = new THREE.Mesh(new THREE.SphereGeometry(440, 48, 32), COSMO.mat(new THREE.MeshBasicMaterial({ map: texCMB(), side: THREE.BackSide, transparent: true, opacity: 0.22, depthWrite: false }), 0.22));
      COSMO.group.add(cmb);
      COSMO.cmb = cmb; COSMO.web = web;
      reg({
        name: 'Cosmic Microwave Background', type: 'Afterglow of the Big Bang', note: 'Light released 380,000 years after the Big Bang — 13.8 billion years old, now stretched to 2.7 K', kind: 'structure',
        node: node(COSMO.group, new V3(0, 300, 240)), band: COSMO, logMin: 25.6, logMax: 26.9, viewLog: 26.5, pri: 0, label: true,
        rows: () => [['Temperature', '2.725 K'], ['Edge of the observable universe', '46.5 Gly comoving']],
      });
    })();

    // ════════════════════════ HUD / DOM ════════════════════════
    const css = document.createElement('style');
    css.textContent = [
      '#umap-root{position:fixed;inset:0;z-index:2;pointer-events:none;font-family:"IBM Plex Mono","SF Mono",Menlo,monospace;opacity:0;transition:opacity .5s ease;}',
      '#umap-root.on{opacity:1;}',
      '#umap-root:not(.on) *{pointer-events:none !important;}',
      '#umap-dots{position:absolute;inset:0;overflow:hidden;}',
      '.umap-dot{position:absolute;left:0;top:0;display:flex;align-items:center;gap:7px;pointer-events:auto;cursor:pointer;will-change:transform;}',
      '.umap-dot i{display:block;width:7px;height:7px;border-radius:50%;background:#cfe2ff;box-shadow:0 0 8px 1px rgba(160,200,255,.8);transition:transform .15s ease;}',
      '.umap-dot b{font-weight:500;font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:rgba(214,231,255,.92);text-shadow:0 1px 6px rgba(0,0,0,.9),0 0 2px rgba(0,0,0,.9);white-space:nowrap;opacity:0;transform:translateX(-3px);transition:opacity .18s,transform .18s;}',
      '.umap-dot:hover b,.umap-dot.lbl b{opacity:1;transform:none;}',
      '.umap-dot:hover i{transform:scale(1.7);}',
      '.umap-dot.k-sun i{background:#ffc46b;box-shadow:0 0 10px 2px rgba(255,196,107,.9);}',
      '.umap-dot.k-planet i{background:#ffd9a8;box-shadow:0 0 8px 1px rgba(255,217,168,.8);}',
      '.umap-dot.k-moon i{width:5px;height:5px;background:#cdd3dc;box-shadow:0 0 6px 1px rgba(205,211,220,.7);}',
      '.umap-dot.k-small i,.umap-dot.k-comet i{width:5px;height:5px;background:#b9c8d8;box-shadow:0 0 5px 1px rgba(185,200,216,.6);}',
      '.umap-dot.k-craft i{width:6px;height:6px;border-radius:1px;transform:rotate(45deg);background:#9fffe0;box-shadow:0 0 8px 1px rgba(159,255,224,.8);}',
      '.umap-dot.k-craft:hover i{transform:rotate(45deg) scale(1.6);}',
      '.umap-dot.k-nebula i{background:#ff9fd0;box-shadow:0 0 9px 2px rgba(255,159,208,.75);}',
      '.umap-dot.k-cluster i{background:#ffe2a8;box-shadow:0 0 8px 1px rgba(255,226,168,.75);}',
      '.umap-dot.k-bh i{background:#0a0a12;border:1.5px solid #b9a8ff;box-shadow:0 0 10px 2px rgba(185,168,255,.8);}',
      '.umap-dot.k-galaxy i{background:#c3b2ff;box-shadow:0 0 9px 2px rgba(195,178,255,.8);}',
      '.umap-dot.k-structure i{background:transparent;border:1.5px solid rgba(143,216,200,.9);box-shadow:0 0 8px 1px rgba(143,216,200,.5);}',
      '.umap-dot.k-arm i{background:transparent;border:1px dashed rgba(190,205,235,.65);box-shadow:none;}',
      '.umap-dot.k-star i{width:6px;height:6px;}',
      '.umap-dot.k-user i{background:#7fd4ff;box-shadow:0 0 0 3px rgba(127,212,255,.25),0 0 12px 2px rgba(127,212,255,.9);animation:umapPulse 2.2s infinite;}',
      '@keyframes umapPulse{0%{box-shadow:0 0 0 0 rgba(127,212,255,.5),0 0 12px 2px rgba(127,212,255,.9);}70%{box-shadow:0 0 0 11px rgba(127,212,255,0),0 0 12px 2px rgba(127,212,255,.9);}100%{box-shadow:0 0 0 0 rgba(127,212,255,0),0 0 12px 2px rgba(127,212,255,.9);}}',
      // tooltip
      '#umap-tip{position:absolute;min-width:180px;max-width:270px;padding:11px 13px;border-radius:11px;background:rgba(7,11,20,.86);border:1px solid rgba(140,180,255,.22);backdrop-filter:blur(16px);-webkit-backdrop-filter:blur(16px);box-shadow:0 14px 40px rgba(0,0,0,.5);opacity:0;transform:translateY(4px);transition:opacity .16s,transform .16s;}',
      '#umap-tip.on{opacity:1;transform:none;}',
      '.umap-tip-name{font-family:Sora,sans-serif;font-weight:600;font-size:13.5px;color:#f2f7ff;margin-bottom:2px;}',
      '.umap-tip-type{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:#7fd4ff;margin-bottom:8px;}',
      '.umap-tip-row{display:flex;justify-content:space-between;gap:14px;font-size:10.5px;line-height:1.75;}',
      '.umap-tip-row s{color:rgba(190,205,230,.55);text-decoration:none;}',
      '.umap-tip-row t{color:rgba(232,240,255,.95);text-align:right;}',
      '.umap-tip-note{margin-top:7px;padding-top:7px;border-top:1px solid rgba(140,180,255,.14);font-family:"Instrument Sans",sans-serif;font-size:11px;font-style:italic;color:rgba(200,215,240,.72);line-height:1.45;}',
      '.umap-tip-cta{margin-top:7px;font-size:8.5px;letter-spacing:.12em;text-transform:uppercase;color:rgba(140,180,255,.5);}',
      // readout
      '#umap-read{position:absolute;left:24px;bottom:22px;pointer-events:none;user-select:none;}',
      '.umap-eyebrow{display:flex;align-items:center;gap:7px;font-size:8.5px;letter-spacing:.22em;color:rgba(140,180,255,.55);text-transform:uppercase;margin-bottom:7px;}',
      '.umap-eyebrow em{width:5px;height:5px;border-radius:50%;background:#7fd4ff;box-shadow:0 0 8px 1px rgba(127,212,255,.9);font-style:normal;}',
      '#umap-regime{font-family:Sora,sans-serif;font-weight:700;font-size:14.5px;letter-spacing:.13em;color:rgba(238,245,255,.94);text-transform:uppercase;text-shadow:0 2px 12px rgba(0,0,0,.7);margin-bottom:5px;transition:opacity .3s;}',
      '#umap-field{font-size:10px;letter-spacing:.06em;color:rgba(180,200,230,.6);}',
      '#umap-field b{color:rgba(220,235,255,.9);font-weight:500;}',
      // rail
      '#umap-rail{position:absolute;right:16px;top:50%;transform:translateY(-50%);display:flex;flex-direction:column;align-items:center;gap:9px;pointer-events:auto;user-select:none;}',
      '.umap-btn{width:29px;height:29px;border-radius:50%;border:1px solid rgba(150,190,255,.22);background:rgba(10,15,26,.6);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);color:rgba(214,231,255,.85);font-size:15px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s;font-family:inherit;padding:0;}',
      '.umap-btn:hover{background:rgba(127,212,255,.16);border-color:rgba(127,212,255,.5);color:#fff;}',
      '#umap-track{position:relative;width:26px;height:190px;cursor:pointer;}',
      '#umap-track::before{content:"";position:absolute;left:50%;top:0;bottom:0;width:1px;background:linear-gradient(rgba(150,190,255,.06),rgba(150,190,255,.34),rgba(150,190,255,.06));}',
      '#umap-handle{position:absolute;left:50%;width:11px;height:11px;border-radius:50%;background:#7fd4ff;box-shadow:0 0 10px 2px rgba(127,212,255,.7);transform:translate(-50%,-50%);}',
      '.umap-tick{position:absolute;left:50%;width:5px;height:5px;border-radius:50%;background:rgba(170,200,240,.5);transform:translate(-50%,-50%);cursor:pointer;}',
      '.umap-tick:hover{background:#fff;}',
      '.umap-tick span{position:absolute;right:14px;top:50%;transform:translateY(-50%);font-size:8.5px;letter-spacing:.14em;text-transform:uppercase;color:rgba(214,231,255,.85);white-space:nowrap;opacity:0;transition:opacity .15s;pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.9);}',
      '.umap-tick:hover span{opacity:1;}',
      // hint
      '#umap-hint{position:absolute;top:84px;left:50%;transform:translateX(-50%);font-size:9.5px;letter-spacing:.16em;text-transform:uppercase;color:rgba(190,210,240,.5);text-shadow:0 1px 6px rgba(0,0,0,.8);animation:umapHint 11s forwards;}',
      '@keyframes umapHint{0%{opacity:0;}12%{opacity:1;}80%{opacity:1;}100%{opacity:0;visibility:hidden;}}',
      // info card
      '#umap-info{position:absolute;right:64px;bottom:22px;width:272px;padding:15px 17px;border-radius:14px;background:rgba(7,11,20,.88);border:1px solid rgba(140,180,255,.24);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);box-shadow:0 18px 50px rgba(0,0,0,.55);pointer-events:auto;opacity:0;transform:translateY(8px);transition:opacity .22s,transform .22s;visibility:hidden;}',
      '#umap-info.on{opacity:1;transform:none;visibility:visible;}',
      '#umap-info .x{position:absolute;top:9px;right:12px;background:none;border:none;color:rgba(190,205,230,.5);font-size:15px;cursor:pointer;padding:2px 5px;font-family:inherit;}',
      '#umap-info .x:hover{color:#fff;}',
      '#umap-info .fly{margin-top:11px;width:100%;padding:7px 0;border-radius:9px;border:1px solid rgba(127,212,255,.35);background:rgba(127,212,255,.1);color:#aee2ff;font-family:inherit;font-size:9.5px;letter-spacing:.18em;text-transform:uppercase;cursor:pointer;transition:all .15s;}',
      '#umap-info .fly:hover{background:rgba(127,212,255,.22);color:#fff;}',
      '@media (prefers-reduced-motion:reduce){.umap-dot.k-user i{animation:none;}}',
    ].join('\n');
    document.head.appendChild(css);

    const root = document.createElement('div'); root.id = 'umap-root';
    root.innerHTML =
      '<div id="umap-dots"></div>' +
      '<div id="umap-tip"></div>' +
      '<div id="umap-read"><div class="umap-eyebrow"><em></em>Universal Map · live sky</div><div id="umap-regime"></div><div id="umap-field"></div></div>' +
      '<div id="umap-rail"><button class="umap-btn" id="umap-zin" title="Zoom in">+</button><div id="umap-track"><div id="umap-handle"></div></div><button class="umap-btn" id="umap-zout" title="Zoom out">−</button><button class="umap-btn" id="umap-home" title="Back to your location" style="font-size:12px;">⌖</button></div>' +
      '<div id="umap-hint">drag to look around · scroll to travel · double-click to fly</div>' +
      '<div id="umap-info"><button class="x">×</button><div class="body"></div><button class="fly">Fly here →</button></div>';
    document.body.appendChild(root);
    const dotsLayer = root.querySelector('#umap-dots');
    const tipEl = root.querySelector('#umap-tip');
    const regimeEl = root.querySelector('#umap-regime');
    const fieldEl = root.querySelector('#umap-field');
    const handleEl = root.querySelector('#umap-handle');
    const trackEl = root.querySelector('#umap-track');
    const infoEl = root.querySelector('#umap-info');

    // rail ticks
    const TICKS = [
      ['Earth', 7.5], ['Moon', 8.7], ['Solar System', 11.6], ['Stars', 16.9], ['Milky Way', 20.8], ['Universe', 25.9],
    ];
    const logToT = (l) => 1 - (l - LOG_MIN) / (LOG_MAX - LOG_MIN);
    TICKS.forEach(([nm, l]) => {
      const t = document.createElement('div'); t.className = 'umap-tick';
      t.style.top = (logToT(l) * 100) + '%';
      t.innerHTML = '<span>' + nm + '</span>';
      t.addEventListener('click', (e) => { e.stopPropagation(); if (nm === 'Earth') goHome(); else flyLog(l, true); });
      trackEl.appendChild(t);
    });

    // ════════════════════════ REGIMES ════════════════════════
    function regimeName(l) {
      if (!state.cosmosHome && l < 24.3) return (state.focusName || 'Deep Field') + ' · Intergalactic Space';
      if (state.solarFocus !== 'Earth' && state.solarFocus !== 'Sun' && l < 10.8) return state.solarFocus + ' · Local Space';
      if (l < 7.7) return 'Earth · Low Orbit';
      if (l < 9.0) return 'Earth–Moon System';
      if (l < 10.6) return 'Near-Earth Space';
      if (l < 11.8) return 'Inner Solar System';
      if (l < 13.2) return 'Outer Solar System';
      if (l < 15.9) return 'Interstellar Space';
      if (l < 19.4) return 'Stellar Neighbourhood';
      if (l < 21.8) return 'Milky Way Galaxy';
      if (l < 24.3) return 'Local Group · Nearby Galaxies';
      return 'Cosmic Web · Observable Universe';
    }

    // ════════════════════════ INTERACTION ════════════════════════
    const INTERACTIVE = 'button,input,textarea,select,a,[contenteditable],webview,.nt-status-card,.nt-dock-wrap,.nt-search-wrap,.nt-model-picker,.nt-ephemeral-zone,.nt-pending-zone,.left-dock,.urlbar,.tab-strip,.chat-panel,#nav-chat-panel,#umap-info,#umap-rail,#umap-surface,.leaflet-container';
    function isMapSurface(t) {
      if (!state.active || !t || !t.closest) return false;
      if (t.closest(INTERACTIVE)) return false;
      return !!(t.closest('#view-newtab') || t.closest('#umap-root') || t === document.body || t.closest('.dashboard-view') || t.closest('#main-content-wrapper'));
    }
    const poke = () => { state.lastInput = performance.now(); state.fly = null; };

    let dragStart = null;
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !isMapSurface(e.target)) return;
      dragStart = { x: e.clientX, y: e.clientY, th: state.tTheta, ph: state.tPhi, moved: false };
    });
    document.addEventListener('pointermove', (e) => {
      mouse.x = e.clientX; mouse.y = e.clientY;
      if (!dragStart) return;
      const dx = e.clientX - dragStart.x, dy = e.clientY - dragStart.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) { dragStart.moved = true; state.dragging = true; poke(); }
      if (!dragStart.moved) return;
      state.tTheta = dragStart.th - dx * 0.0052;
      state.tPhi = clamp(dragStart.ph - dy * 0.0052, 0.06, Math.PI - 0.06);
    });
    document.addEventListener('pointerup', () => { dragStart = null; setTimeout(() => { state.dragging = false; }, 40); });
    let surfaceIntent = 0;
    document.addEventListener('wheel', (e) => {
      if (state.surface || !isMapSurface(e.target)) return;
      poke();
      const before = state.tLogD;
      state.tLogD = clamp(state.tLogD + e.deltaY * 0.0016, LOG_MIN, LOG_MAX);
      // keep zooming in at ground level → hand off to the street-level map
      if (e.deltaY < 0 && before <= LOG_MIN + 1e-9 && state.solarFocus === 'Earth' && window.BucksEarthMap) {
        if (++surfaceIntent >= 2) {
          surfaceIntent = 0;
          const c = getCenterLatLon();
          window.BucksEarthMap.openAt(c.lat, c.lon, 5);
        }
      } else surfaceIntent = 0;
    }, { passive: true });

    const mouse = { x: -999, y: -999 };

    // zoom buttons — hold to keep zooming
    function holdButton(el, fn) {
      let iv = null;
      el.addEventListener('pointerdown', () => { poke(); fn(); iv = setInterval(fn, 60); });
      ['pointerup', 'pointerleave'].forEach((ev) => el.addEventListener(ev, () => { clearInterval(iv); iv = null; }));
    }
    holdButton(root.querySelector('#umap-zin'), () => { state.tLogD = clamp(state.tLogD - 0.09, LOG_MIN, LOG_MAX); });
    holdButton(root.querySelector('#umap-zout'), () => { state.tLogD = clamp(state.tLogD + 0.09, LOG_MIN, LOG_MAX); });
    root.querySelector('#umap-home').addEventListener('click', goHome);
    trackEl.addEventListener('pointerdown', (e) => {
      poke();
      const move = (ev) => {
        const r = trackEl.getBoundingClientRect();
        state.tLogD = clamp(LOG_MIN + (1 - (ev.clientY - r.top) / r.height) * (LOG_MAX - LOG_MIN), LOG_MIN, LOG_MAX);
      };
      move(e);
      const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
      document.addEventListener('pointermove', move); document.addEventListener('pointerup', up);
    });
    infoEl.querySelector('.x').addEventListener('click', () => { state.pinned = null; infoEl.classList.remove('on'); });
    infoEl.querySelector('.fly').addEventListener('click', () => { if (state.pinned) flyTo(state.pinned); });

    // ════════════════════════ FLY / FOCUS ════════════════════════
    function bandLocal(band, obj) {
      const v = obj.getWorldPosition(new V3());
      return band.group.worldToLocal(v);
    }
    function setCenters(entry) {
      // set per-band centre target fns for focusing this entry
      bands.forEach((b) => { b.centerFrom.copy(b.center); b.centerToFn = null; });
      if (!entry || entry.kind === 'user' || entry === earthEntry) {
        state.solarFocus = 'Earth'; state.cosmosHome = true;
        SOLAR.centerToFn = () => earthHelio;
        return;
      }
      const b = entry.band;
      if (!b) { state.solarFocus = 'Earth'; state.cosmosHome = true; SOLAR.centerToFn = () => earthHelio; return; }
      if (b === EARTH) {
        // Moon / satellites: keep the solar band on Earth, slide the Earth band
        state.solarFocus = 'Earth'; state.cosmosHome = true;
        SOLAR.centerToFn = () => earthHelio;
        EARTH.centerToFn = () => bandLocal(EARTH, entry.node);
        return;
      }
      if (b === SOLAR) {
        state.solarFocus = entry.name; state.cosmosHome = true;
        SOLAR.centerToFn = () => bandLocal(SOLAR, entry.node);
        return;
      }
      if (b === STARS) { state.solarFocus = 'Sun'; state.cosmosHome = true; STARS.centerToFn = () => bandLocal(STARS, entry.node); SOLAR.centerToFn = () => new V3(); return; }
      if (b === GALXY) {
        state.solarFocus = 'Sun'; state.cosmosHome = true;
        GALXY.centerToFn = () => bandLocal(GALXY, entry.node);
        // keep the stars band consistent with the new galactic viewpoint
        STARS.centerToFn = () => bandLocal(GALXY, entry.node).multiplyScalar(1e20 / 1e17);
        return;
      }
      if (b === COSMO) {
        state.cosmosHome = entry.name === 'Milky Way'; state.solarFocus = 'Sun';
        state.focusName = entry.name;
        COSMO.centerToFn = entry.name === 'Milky Way' ? null : () => bandLocal(COSMO, entry.node);
        return;
      }
    }
    function flyTo(entry) {
      // a backdrop (sky-view) star maps to its true 3-D twin in the stars band
      if (entry.backdropStar) {
        const twin = entries.find((x) => x.band === STARS && x.name === entry.name);
        if (twin) entry = twin;
      }
      state.pinned = null; infoEl.classList.remove('on'); hideTip();
      setCenters(entry);
      state.fly = { t: 0, dur: reduceMotion ? 0.01 : 2.8, fromLog: state.tLogD, toLog: clamp(entry.viewLog, LOG_MIN, LOG_MAX), aimUser: entry.kind === 'user' };
      state.lastInput = performance.now();
    }
    function flyLog(l, home) {
      if (home) setCenters(null);
      state.fly = { t: 0, dur: reduceMotion ? 0.01 : 2.2, fromLog: state.tLogD, toLog: clamp(l, LOG_MIN, LOG_MAX) };
      state.lastInput = performance.now();
    }
    function goHome() {
      setCenters(null);
      state.fly = { t: 0, dur: reduceMotion ? 0.01 : 2.6, fromLog: state.tLogD, toLog: 7.5, aimUser: true };
      state.lastInput = performance.now();
    }
    function aimAtNode(n2) {
      const v = n2.getWorldPosition(new V3()).sub(earthMesh.getWorldPosition(new V3())).normalize();
      state.tPhi = clamp(Math.acos(clamp(v.y, -1, 1)), 0.06, Math.PI - 0.06);
      state.tTheta = Math.atan2(v.x, v.z);
    }
    const aimAtUser = () => aimAtNode(userNode);
    function flyToLatLon(lat, lon, label) {
      pinActive = true; pinLat = lat; pinLon = lon;
      pinNode.position.copy(latLonToVec(lat, lon, 6.43));
      pinEntry.name = label || 'Searched location';
      const d = dotPool.get(pinEntry);
      if (d) d.querySelector('b').textContent = pinEntry.name;
      state.pinned = null; infoEl.classList.remove('on'); hideTip();
      setCenters(null);
      state.fly = { t: 0, dur: reduceMotion ? 0.01 : 2.4, fromLog: state.tLogD, toLog: 7.1, aimPin: true };
      state.lastInput = performance.now();
    }
    // lat/lon of the point of Earth currently facing the camera
    function getCenterLatLon() {
      const local = earthSpin.worldToLocal(camera.position.clone()).normalize();
      const lat = 90 - THREE.MathUtils.radToDeg(Math.acos(clamp(local.y, -1, 1)));
      let lon = THREE.MathUtils.radToDeg(Math.atan2(local.z, -local.x)) - 180;
      while (lon < -180) lon += 360; while (lon > 180) lon -= 360;
      return { lat, lon };
    }

    // ════════════════════════ TOOLTIP / CARD ════════════════════════
    function tipHTML(e2) {
      let h = '<div class="umap-tip-name">' + e2.name + '</div><div class="umap-tip-type">' + e2.type + '</div>';
      e2.rows(e2).forEach(([k, v]) => { h += '<div class="umap-tip-row"><s>' + k + '</s><t>' + v + '</t></div>'; });
      if (e2.note) h += '<div class="umap-tip-note">' + e2.note + '</div>';
      return h;
    }
    function showTip(e2, x, y) {
      tipEl.innerHTML = tipHTML(e2) + '<div class="umap-tip-cta">double-click to fly here</div>';
      tipEl.classList.add('on');
      const w = tipEl.offsetWidth, h = tipEl.offsetHeight;
      tipEl.style.left = clamp(x + 16, 8, window.innerWidth - w - 8) + 'px';
      tipEl.style.top = clamp(y - h - 14 < 8 ? y + 20 : y - h - 14, 8, window.innerHeight - h - 8) + 'px';
    }
    const hideTip = () => tipEl.classList.remove('on');
    function pinInfo(e2) {
      state.pinned = e2;
      infoEl.querySelector('.body').innerHTML = tipHTML(e2);
      infoEl.classList.add('on');
    }

    // ════════════════════════ DOTS (projected markers) ════════════════════════
    const dotPool = new Map();  // entry → div
    const _v = new V3(), _c = new V3();
    const fovFactor = () => window.innerHeight / (2 * Math.tan(rad(camera.fov / 2)));
    function projectNode(n2, out) {
      n2.getWorldPosition(_v);
      _c.copy(_v).applyMatrix4(camera.matrixWorldInverse);
      if (_c.z > -0.02) return false;
      const d = _v.distanceTo(camera.position);
      _v.project(camera);
      out.x = (_v.x * 0.5 + 0.5) * window.innerWidth;
      out.y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      out.d = d;
      return out.x > -60 && out.x < window.innerWidth + 60 && out.y > -60 && out.y < window.innerHeight + 60;
    }
    function getDot(e2) {
      let d = dotPool.get(e2);
      if (!d) {
        d = document.createElement('div');
        d.className = 'umap-dot k-' + e2.kind + (e2.label ? ' lbl' : '');
        d.innerHTML = '<i></i><b>' + e2.name + '</b>';
        d.addEventListener('mouseenter', () => { if (!state.dragging) { state.hover = e2; showTip(e2, e2.sx, e2.sy); } });
        d.addEventListener('mouseleave', () => { if (state.hover === e2) { state.hover = null; hideTip(); } });
        d.addEventListener('click', (ev) => { ev.stopPropagation(); pinInfo(e2); });
        d.addEventListener('dblclick', (ev) => { ev.stopPropagation(); flyTo(e2); });
        dotsLayer.appendChild(d);
        dotPool.set(e2, d);
      }
      return d;
    }
    const proj = { x: 0, y: 0, d: 0 };
    function updateDots() {
      const wanted = [];
      if (state.active) {
        const backFade = backdropFade();
        for (let i = 0; i < entries.length; i++) {
          const e2 = entries[i];
          if (state.logD < e2.logMin || state.logD > e2.logMax) continue;
          if (e2.when && !e2.when()) continue;
          if (e2.backdropStar) { if (backFade < 0.45) continue; }
          else if (e2.band) {
            if (e2.band.fade < 0.12) continue;
            if (e2.moonOf && state.solarFocus !== e2.moonOf) continue;
          }
          if (!projectNode(e2.node, proj)) continue;
          // suppress the dot when the real body already fills the view
          if (e2.hideR && e2.band) {
            const app = e2.hideR * e2.band.scale / proj.d * fovFactor();
            if (app > 15) continue;
          }
          // occlusion by the Earth globe
          if (EARTH.fade > 0.4 && e2 !== earthEntry && e2.band === EARTH) {
            earthMesh.getWorldPosition(_v);
            const toObj = e2.node.getWorldPosition(new V3()).sub(camera.position);
            const toC = _v.clone().sub(camera.position);
            const tt = clamp(toObj.clone().normalize().dot(toC) / toObj.length(), 0, 1) * toObj.length();
            if (tt < toObj.length() - 0.001) {
              const closest = camera.position.clone().addScaledVector(toObj.clone().normalize(), Math.min(tt, toObj.length()));
              if (closest.distanceTo(_v) < 6.3 * EARTH.scale && toObj.length() > toC.length()) continue;
            }
          }
          e2.sx = proj.x; e2.sy = proj.y; e2.sd = proj.d;
          wanted.push(e2);
        }
        wanted.sort((a, b) => a.pri - b.pri);
        if (wanted.length > 80) wanted.length = 80;
      }
      const set = new Set(wanted);
      dotPool.forEach((d, e2) => { if (!set.has(e2)) d.style.display = 'none'; });
      wanted.forEach((e2) => {
        const d = getDot(e2);
        d.style.display = 'flex';
        d.style.transform = 'translate3d(' + (e2.sx - 4) + 'px,' + (e2.sy - 4) + 'px,0)';
      });
      if (state.hover && set.has(state.hover)) showTip(state.hover, state.hover.sx, state.hover.sy);
      else if (state.hover) { state.hover = null; hideTip(); }
    }
    const backdropFade = () => 1 - smooth(14.2, 16.4, state.logD);

    // ════════════════════════ USER LOCATION ════════════════════════
    function setUser(lat, lon, label) {
      state.user.lat = lat; state.user.lon = lon; state.user.label = label;
      userNode.position.copy(latLonToVec(lat, lon, 6.45));
      userEntry.name = label; userEntry.note = 'Latitude ' + lat.toFixed(2) + '° · Longitude ' + lon.toFixed(2) + '°';
      const d = dotPool.get(userEntry); if (d) d.querySelector('b').textContent = label;
    }
    (function locate() {
      const tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || '';
      const guess = D.TZ_LATLON[tz];
      if (guess) setUser(guess[0], guess[1], 'You · ' + tz.split('/').pop().replace(/_/g, ' '));
      else setUser(20, 0, 'You are here');
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
          (p) => { setUser(p.coords.latitude, p.coords.longitude, 'You are here'); if (state.fly && state.fly.aimUser) return; if (performance.now() - state.lastInput > 3000 && state.logD < 9) aimAtUser(); },
          () => {}, { timeout: 6000, maximumAge: 3600000 }
        );
      }
    })();

    // ════════════════════════ NEWTAB VISIBILITY ════════════════════════
    function checkActive() {
      const v = document.getElementById('view-newtab');
      const on = !!(v && !v.classList.contains('hidden') && v.offsetParent !== null && !document.body.classList.contains('em-surface-open'));
      if (on !== state.active) { state.active = on; root.classList.toggle('on', on); if (!on) { hideTip(); state.pinned = null; infoEl.classList.remove('on'); } }
    }
    const vt = document.getElementById('view-newtab');
    if (vt) new MutationObserver(checkActive).observe(vt, { attributes: true, attributeFilter: ['class'] });
    setInterval(checkActive, 1200);
    checkActive();

    // ════════════════════════ EARTH SPIN CALIBRATION ════════════════════════
    // find rotation.y that puts longitude 0 under the current sidereal time
    function solveSpin(gmstH) {
      const target = eqVec(gmstH, 0, 1);
      const v0 = new V3(1, 0, 0); // local direction of lat 0, lon 0
      let best = 0, bestDot = -2;
      for (let k = 0; k < 720; k++) {
        const g2 = k / 720 * Math.PI * 2;
        const v = v0.clone().applyAxisAngle(new V3(0, 1, 0), g2).applyQuaternion(earthTilt.quaternion);
        const dt = v.dot(target);
        if (dt > bestDot) { bestDot = dt; best = g2; }
      }
      return best;
    }
    const gmst0 = gmstHours();
    const spin0 = solveSpin(gmst0);
    const spinDelta = (() => {
      const s1 = solveSpin(gmst0 + 0.5);
      let d = s1 - spin0;
      while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      return d / 0.5; // rad per sidereal hour
    })();

    // ════════════════════════ INTRO ════════════════════════
    const seen = (() => { try { return localStorage.getItem('umap-intro'); } catch (e) { return 1; } })();
    if (reduceMotion) {
      state.logD = state.tLogD = 7.5;
    } else if (seen) {
      state.logD = state.tLogD = 13.4;
      state.fly = { t: 0, dur: 3.4, fromLog: 13.4, toLog: 7.5, aimUser: true, intro: true };
    } else {
      state.logD = state.tLogD = 26.8;
      state.fly = { t: 0, dur: 9.5, fromLog: 26.8, toLog: 7.5, aimUser: true, intro: true };
      try { localStorage.setItem('umap-intro', '1'); } catch (e) {}
    }
    state.lastInput = -1e9; // so geolocation aim + idle drift behave at startup

    // ════════════════════════ FRAME LOOP ════════════════════════
    let earthHelio = new V3();        // Earth heliocentric, SOLAR units
    SOLAR.centerToFn = () => earthHelio;
    SOLAR.center.copy(planetPos(D.PLANETS[2], T0).multiplyScalar(AUu));
    SOLAR.centerFrom.copy(SOLAR.center);

    let lastT = performance.now(), frameAcc = 0, frameN = 0, degraded = false;
    let hudT = 0;

    function frame(now) {
      requestAnimationFrame(frame);
      if (document.hidden) { lastT = now; return; }
      const dt = Math.min((now - lastT) / 1000, 0.1); lastT = now;

      // perf watchdog: drop pixel ratio if consistently slow
      frameAcc += dt; frameN++;
      if (frameN >= 120) {
        if (!degraded && frameAcc / frameN > 0.042) { degraded = true; renderer.setPixelRatio(1); }
        frameAcc = 0; frameN = 0;
      }

      const T = (julianDay() - 2451545.0) / 36525;

      // fly tween
      if (state.fly) {
        const f = state.fly;
        f.t += dt / f.dur;
        const k = easeIO(clamp(f.t, 0, 1));
        state.tLogD = lerp(f.fromLog, f.toLog, k);
        state.logD = state.tLogD;
        if (f.intro) state.tTheta += dt * 0.06 * (1 - k);
        bands.forEach((b) => {
          if (b.centerToFn) b.center.copy(b.centerFrom).lerp(b.centerToFn(), k);
          else if (b !== SOLAR) b.center.copy(b.centerFrom).multiplyScalar(1 - k);
        });
        if (f.t >= 1) {
          bands.forEach((b) => { b.centerFrom.copy(b.center); });
          if (f.aimUser) aimAtUser();
          if (f.aimPin) aimAtNode(pinNode);
          state.fly = null;
        }
      } else {
        // settle centres onto their live targets (planets move)
        bands.forEach((b) => {
          if (b.centerToFn) { const tgt = b.centerToFn(); if (tgt) b.center.lerp(tgt, Math.min(1, dt * 3)); }
        });
        state.logD = lerp(state.logD, state.tLogD, Math.min(1, dt * 7));
      }

      // idle drift
      if (!state.dragging && now - state.lastInput > 26000 && !state.fly && !reduceMotion) {
        state.tTheta += dt * 0.010;
      }
      state.theta = lerp(state.theta, state.tTheta, Math.min(1, dt * 8));
      state.phi = lerp(state.phi, state.tPhi, Math.min(1, dt * 8));

      camera.position.set(
        R_CAM * Math.sin(state.phi) * Math.sin(state.theta),
        R_CAM * Math.cos(state.phi),
        R_CAM * Math.sin(state.phi) * Math.cos(state.theta)
      );
      camera.lookAt(0, 0, 0);
      camera.updateMatrixWorld();

      // ephemerides
      earthHelio = planetPos(D.PLANETS[2], T).multiplyScalar(AUu);
      const sunDirWorld = earthHelio.clone().negate().normalize();
      sunLight.position.copy(sunDirWorld).multiplyScalar(4000);
      skySun.position.copy(sunDirWorld).multiplyScalar(SKY * 0.95);
      skySunNode.position.copy(skySun.position);
      earthSpin.rotation.y = spin0 + spinDelta * ((gmstHours() - gmst0 + 24) % 24);
      moonMesh.position.copy(moonPos().multiplyScalar(0.001)); // km → 10⁶ m units
      if (jwstNode) jwstNode.position.copy(sunDirWorld).multiplyScalar(-1500); // anti-sunward L2

      planetObjs.forEach((o) => {
        o.holder.position.copy(planetPos(o.p, T).multiplyScalar(AUu));
        o.mesh.rotation.y += dt * 0.05;
        const showMoons = state.logD < 11.0 && state.solarFocus === o.p.name;
        o.moonsGroup.visible = showMoons;
        if (showMoons) {
          const days = daysJ2000();
          o.moonEntries.forEach((me) => {
            const a = (days / me.period) * 2 * Math.PI + me.seed;
            me.mesh.position.set(me.r * Math.cos(a), 0, me.r * Math.sin(a));
          });
        }
      });

      // band scaling + fades
      const l = state.logD;
      bands.forEach((b) => {
        const s = R_CAM / Math.pow(10, l - b.logUnit);
        b.scale = s;
        // when the solar band is focused on a body other than Earth, the Earth
        // globe band is hidden, so the solar band may extend much closer in
        const bmin = (b === SOLAR && state.solarFocus !== 'Earth') ? 7.9 : b.logMin;
        let fade = smooth(bmin, bmin + 0.55, l) * (1 - smooth(b.logMax - 0.55, b.logMax, l));
        if (b === EARTH && state.solarFocus !== 'Earth') fade = 0;   // solar band focused elsewhere
        if (!state.cosmosHome && b !== COSMO) fade = 0;              // focused on another galaxy

        b.fade = fade;
        const on = fade > 0.003 && s < 3e7 && s > 3e-8;
        b.group.visible = on;
        if (on) {
          b.group.scale.setScalar(s);
          b.group.position.copy(b.center).multiplyScalar(-s);
          b.mats.forEach(([m, base]) => { m.opacity = base * fade; });
        }
      });
      // per-object windows
      if (SOLAR.group.visible) {
        asteroidBelt.visible = l > 10.8 && l < 12.9;
        kuiperBelt.visible = l > 12.0;
      }
      if (COSMO.group.visible) {
        COSMO.cmb.visible = l > 25.6;
        COSMO.web.visible = l > 22.6 && !degraded;
        COSMO.cmb.material.opacity = 0.22 * smooth(25.8, 26.7, l) * COSMO.fade;
      }
      // backdrop
      const bf = backdropFade();
      backdrop.visible = bf > 0.01;
      backdropMats.forEach(([m, base]) => { m.opacity = base * bf; });
      skySun.material.opacity = state.solarFocus === 'Earth' ? 0.95 * bf * (1 - smooth(9.0, 9.6, l)) : 0;

      // cap glow sprites to a maximum on-screen size
      const ff = fovFactor();
      cappedSprites.forEach((cs) => {
        if (!cs.band.group.visible) return;
        cs.sp.getWorldPosition(_v);
        const d = _v.distanceTo(camera.position);
        const maxLocal = cs.maxPx / ff * d / cs.band.scale;
        const sc = Math.min(cs.natural, maxLocal);
        cs.sp.scale.set(sc, sc, 1);
      });

      // HUD (throttled)
      hudT += dt;
      if (hudT > 0.12) {
        hudT = 0;
        if (state.active) {
          regimeEl.textContent = regimeName(l);
          const field = Math.pow(10, l) * 1.35;
          fieldEl.innerHTML = 'field of view ≈ <b>' + fmtLen(field) + '</b>' + (state.solarFocus !== 'Earth' && state.solarFocus !== 'Sun' ? ' · focused on <b>' + state.solarFocus + '</b>' : '');
          handleEl.style.top = (logToT(l) * 100) + '%';
        }
      }
      updateDots();
      renderer.render(scene, camera);
    }
    requestAnimationFrame(frame);

    // resize
    window.addEventListener('resize', () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // public hook for the rest of the browser (agent, search, …)
    window.BucksUniverseMap = {
      flyTo: (name) => {
        const e2 = entries.find((x) => x.name.toLowerCase().indexOf(String(name).toLowerCase()) >= 0);
        if (e2) flyTo(e2);
        return !!e2;
      },
      home: goHome,
      entries: () => entries.map((e2) => e2.name),
    };
    console.log('[UniverseMap] online —', entries.length, 'named objects');
  }
})();

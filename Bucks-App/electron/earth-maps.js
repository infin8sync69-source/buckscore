// earth-maps.js — Bucks Earth Surface Map
// The street-level continuation of the Universal Map: when the globe hands off
// (keep zooming at ground level), this module opens a FULL-BLEED interactive
// world map with live OpenStreetMap data — roads, rail + metro networks,
// public-transport view, reverse-geocode inspection, live weather (Open-Meteo)
// and turn-by-turn routing with alternatives (OSRM/FOSSGIS).
//
// Design: minimal monochrome glass. No separate search UI — the global agentic
// bar at the bottom becomes the map search while the surface is open ("Mysore"
// flies there, "Bangalore to Mysore" routes). Controls are a small icon rail
// (layers · locate · directions) top-right. The left app dock hides for a full
// view and can be pulled back with an edge handle. Exit = zoom out fully (or Esc).
//
// Public API (consumed by universe-map.js):
//   window.BucksEarthMap.openAt(lat, lon, zoom)
//   window.BucksEarthMap.close()
//   window.BucksEarthMap.isOpen()
(function () {
  'use strict';

  const NOMINATIM = 'https://nominatim.openstreetmap.org';
  const METEO = 'https://api.open-meteo.com/v1/forecast';
  // FOSSGIS OSRM instances (the servers behind openstreetmap.org directions).
  const OSRM = {
    drive: 'https://routing.openstreetmap.de/routed-car',
    bike: 'https://routing.openstreetmap.de/routed-bike',
    walk: 'https://routing.openstreetmap.de/routed-foot',
  };
  const OSRM_FALLBACK = 'https://router.project-osrm.org'; // car only

  let map = null;               // Leaflet instance (created lazily, kept alive)
  let open = false;
  let baseLayers = null, overlayLayers = null, currentBase = null;
  let searchMarker = null, locateMarker = null, locateRing = null, stepDot = null;
  let route = { from: null, to: null, lines: [], markers: [], picking: null, routes: [], selected: 0 };
  let els = {};                 // UI elements
  let savedChrome = null;       // inline styles we override while open
  let savedPlaceholder = null;
  let closingViaZoom = false;
  let weatherT = null, weatherKey = '';
  let barWired = false, barDebounce = null;

  // ════════════════════════ SVG ICON SET (Lucide-style, stroke) ════════════════════════
  const P = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/>',
    nav: '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
    locate: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>',
    layers: '<polygon points="12 2 2 7.5 12 13 22 7.5 12 2"/><polyline points="2 12.5 12 18 22 12.5"/><polyline points="2 17.5 12 23 22 17.5"/>',
    map: '<polygon points="1.5 6 1.5 22 8.5 18.5 15.5 22 22.5 18.5 22.5 2.5 15.5 6 8.5 2.5 1.5 6"/><path d="M8.5 2.5v16M15.5 6v16"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"/>',
    satellite: '<path d="M13 7 9 3 5 7l4 4"/><path d="m17 11 4 4-4 4-4-4"/><path d="m8 12 4 4 6-6-4-4-6 6z"/><path d="m16 8 3-3"/><path d="M9 21a6 6 0 0 0-6-6"/>',
    bus: '<path d="M4 6c0-1.7 1.3-3 3-3h10c1.7 0 3 1.3 3 3v11c0 .6-.4 1-1 1h-1"/><path d="M4 17c-.6 0-1-.4-1-1"/><path d="M3 10h18"/><path d="M8 3v7M16 3v7"/><circle cx="7.5" cy="18" r="2"/><circle cx="16.5" cy="18" r="2"/><path d="M9.5 18h5"/>',
    train: '<rect x="4" y="3" width="16" height="14" rx="3"/><path d="M4 10h16"/><path d="M8.5 14h.01M15.5 14h.01"/><path d="m8 17-2.5 4M16 17l2.5 4M7 21h10"/>',
    car: '<path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9-1.8-.5-4.5-1.1-4.5-1.1s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.5 2.8c-.1.2-.1.5-.1.7v4.6c0 .6.4 1 1 1h2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/><path d="M9 17h6"/>',
    bike: '<circle cx="5.5" cy="17.5" r="3.5"/><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/>',
    walk: '<circle cx="13" cy="4.5" r="2"/><path d="M11.5 8.5 9 12l1.5 3L9 22"/><path d="M11.5 8.5c.8-.6 2.2-.6 3 0l1.5 2 3 1"/><path d="m13 14 2 2 1 6"/>',
    swap: '<path d="m3 16 4 4 4-4"/><path d="M7 20V4"/><path d="m21 8-4-4-4 4"/><path d="M17 4v16"/>',
    trash: '<path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><path d="M10 11v6M14 11v6"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    route: '<circle cx="6" cy="19" r="2.6"/><circle cx="18" cy="5" r="2.6"/><path d="M8.6 19h7.9a3.5 3.5 0 0 0 0-7h-9a3.5 3.5 0 0 1 0-7h7.9"/>',
    pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z"/><circle cx="12" cy="10" r="3"/>',
    crosshair: '<circle cx="12" cy="12" r="8"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flag: '<path d="M4 22V4c0-.6.4-1 1-1 4 0 6.5 2 10 2 1.5 0 2.5-.3 4-1v11c-1.5.7-2.5 1-4 1-3.5 0-6-2-10-2"/><path d="M4 15h.01"/>',
    dot: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none"/>',
    up: '<path d="M12 20V4"/><path d="m5 11 7-7 7 7"/>',
    upLeft: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v5"/>',
    upRight: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0-6 6v5"/>',
    arrLeft: '<path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>',
    arrRight: '<path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>',
    slLeft: '<path d="M17 20v-6a6 6 0 0 0-2.5-4.9L7 4"/><path d="M7 10V4h6"/>',
    slRight: '<path d="M7 20v-6a6 6 0 0 1 2.5-4.9L17 4"/><path d="M17 10V4h-6"/>',
    uturn: '<path d="m9 14-5-5 5-5"/><path d="M4 9h9.5a6.5 6.5 0 0 1 0 13H9"/>',
    round: '<path d="M21 12a9 9 0 1 1-2.6-6.4"/><path d="M21 3v6h-6"/>',
    merge: '<path d="m8 7 4-4 4 4"/><path d="M12 3v6.6c0 1-.4 2-1.2 2.8L5 18"/><path d="m19 18-4.8-4.8"/>',
    sun: '<circle cx="12" cy="12" r="4.5"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    cloud: '<path d="M17.5 19H7a5 5 0 1 1 .9-9.9A6.5 6.5 0 0 1 20 11.6 4 4 0 0 1 17.5 19z"/>',
    rain: '<path d="M17.5 16H7a5 5 0 1 1 .9-9.9A6.5 6.5 0 0 1 20 8.6 4 4 0 0 1 17.5 16z"/><path d="M8 19v2M12 19v3M16 19v2"/>',
    snow: '<path d="M17.5 16H7a5 5 0 1 1 .9-9.9A6.5 6.5 0 0 1 20 8.6 4 4 0 0 1 17.5 16z"/><path d="M8 19h.01M12 21h.01M16 19h.01"/>',
    fog: '<path d="M17.5 14H7a5 5 0 1 1 .9-9.9A6.5 6.5 0 0 1 20 6.6 4 4 0 0 1 17.5 14z"/><path d="M5 18h14M7 21h10"/>',
    storm: '<path d="M17.5 15H7a5 5 0 1 1 .9-9.9A6.5 6.5 0 0 1 20 7.6 4 4 0 0 1 17.5 15z"/><path d="m13 14-2.5 4h3L11 22"/>',
    wind: '<path d="M17.7 7.7A2.5 2.5 0 1 1 19.5 12H2"/><path d="M9.6 4.6A2 2 0 1 1 11 8H2"/><path d="M12.6 19.4A2 2 0 1 0 14 16H2"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-5"/><path d="M12 8h.01"/>',
    chevL: '<path d="m15 18-6-6 6-6"/>',
    chevR: '<path d="m9 18 6-6-6-6"/>',
  };
  const ico = (n, s, w) =>
    `<svg class="em-i" width="${s || 16}" height="${s || 16}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || P.info}</svg>`;

  // ════════════════════════ STYLES — minimal monochrome glass ════════════════════════
  function injectCSS() {
    if (document.getElementById('earthmap-css')) return;
    const st = document.createElement('style');
    st.id = 'earthmap-css';
    st.textContent = `
      #umap-surface { font-family: 'Instrument Sans', -apple-system, sans-serif; }
      #umap-surface .em-i { display: block; flex: none; }
      #umap-surface .leaflet-container { width: 100%; height: 100%; background: #0b0e16; font: inherit; }
      #umap-surface .leaflet-control-attribution {
        background: rgba(10,12,18,0.6); color: rgba(200,208,226,0.45);
        backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
        font-size: 10px; border-radius: 8px 0 0 0; padding: 3px 8px;
      }
      #umap-surface .leaflet-control-attribution a { color: rgba(200,208,226,0.7); }
      #umap-surface .leaflet-bar { border: none; border-radius: 12px; overflow: hidden;
        box-shadow: 0 8px 28px rgba(0,0,0,0.5); }
      #umap-surface .leaflet-bar a {
        background: rgba(13,15,22,0.78); color: rgba(226,232,244,0.85);
        border-bottom: 1px solid rgba(255,255,255,0.07);
        backdrop-filter: blur(28px); -webkit-backdrop-filter: blur(28px);
        width: 36px; height: 36px; line-height: 36px; font-size: 16px; font-weight: 300;
        transition: background 0.15s ease, color 0.15s ease;
      }
      #umap-surface .leaflet-bar a:hover { background: rgba(255,255,255,0.12); color: #fff; }
      #umap-surface .leaflet-popup-content-wrapper {
        background: rgba(13,15,22,0.88); color: #e6eaf4; border-radius: 14px;
        backdrop-filter: blur(36px); -webkit-backdrop-filter: blur(36px);
        border: 1px solid rgba(255,255,255,0.09);
        box-shadow: 0 20px 54px rgba(0,0,0,0.6);
      }
      #umap-surface .leaflet-popup-content { margin: 13px 15px; font: 12.5px/1.45 'Instrument Sans', sans-serif; }
      #umap-surface .leaflet-popup-tip { background: rgba(13,15,22,0.88); border: 1px solid rgba(255,255,255,0.09); }
      #umap-surface .leaflet-popup-close-button { color: rgba(220,226,242,0.5) !important; font-size: 17px !important; padding: 5px 7px 0 0 !important; }

      .em-glass {
        background: rgba(12,14,21,0.82);
        backdrop-filter: blur(40px); -webkit-backdrop-filter: blur(40px);
        border: 1px solid rgba(255,255,255,0.08); border-radius: 15px;
        box-shadow: 0 16px 48px rgba(0,0,0,0.5);
        color: #e6eaf4;
      }

      /* ── icon rail (top-right): layers · locate · directions ── */
      .em-rail { position: absolute; top: 14px; right: 14px; z-index: 1200;
        display: flex; flex-direction: column; gap: 6px; padding: 6px; }
      .em-ib { width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
        border: none; background: transparent; border-radius: 11px; cursor: pointer;
        color: rgba(226,232,244,0.72); transition: background 0.15s ease, color 0.15s ease; }
      .em-ib:hover { background: rgba(255,255,255,0.1); color: #fff; }
      .em-ib.em-on { background: rgba(255,255,255,0.14); color: #fff; }

      /* ── layers dropdown ── */
      .em-layers { position: absolute; top: 14px; right: 66px; z-index: 1200; padding: 10px 12px; width: auto; display: none; flex-direction: column; gap: 4px; }
      .em-layers.on { display: flex; }
      .em-layers h4 { margin: 2px 2px 5px; font-size: 8.5px; text-transform: uppercase;
        letter-spacing: 0.15em; color: rgba(200,208,226,0.45); font-weight: 600; }
      .em-lrow { display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; border-radius: 9px;
        cursor: pointer; border: 1px solid rgba(255,255,255,0.06); background: rgba(255,255,255,0.04); color: rgba(226,232,244,0.65);
        transition: all 0.15s ease; box-shadow: inset 0 1px 0 rgba(255,255,255,0.05); padding: 0; }
      .em-lrow:hover { background: rgba(255,255,255,0.12); color: #fff; border-color: rgba(255,255,255,0.15); }
      .em-lrow.sel, .em-lrow.on { background: rgba(255, 255, 255, 0.22) !important; color: #ffffff !important; border-color: rgba(255, 255, 255, 0.45) !important; box-shadow: 0 0 12px rgba(255, 255, 255, 0.25); }

      /* ── directions panel ── */
      .em-dir { position: absolute; top: 14px; right: 66px; z-index: 1200; width: 300px;
        display: none; flex-direction: column; max-height: calc(100% - 120px); }
      .em-dir.on { display: flex; }
      .em-dir-head { display: flex; align-items: center; gap: 8px; padding: 13px 15px 7px; }
      .em-dir-head b { font-size: 13px; font-weight: 600; letter-spacing: 0.01em; }
      .em-dir-head .em-x { margin-left: auto; cursor: pointer; color: rgba(220,226,242,0.45); padding: 3px;
        border-radius: 7px; display: flex; transition: all 0.13s ease; }
      .em-dir-head .em-x:hover { color: #fff; background: rgba(255,255,255,0.08); }
      .em-modes { display: flex; gap: 6px; padding: 3px 15px 10px; }
      .em-mode { flex: 1; display: flex; align-items: center; justify-content: center; padding: 8px 4px;
        border-radius: 10px; cursor: pointer; color: rgba(210,218,236,0.55);
        background: rgba(255,255,255,0.04); transition: all 0.15s ease; }
      .em-mode:hover { background: rgba(255,255,255,0.09); color: #fff; }
      .em-mode.sel { background: rgba(255,255,255,0.14); color: #fff; }
      .em-field { display: flex; align-items: center; gap: 9px; margin: 0 15px 8px; padding: 0 10px;
        background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.07); border-radius: 11px;
        transition: border-color 0.15s ease; }
      .em-field:focus-within { border-color: rgba(255,255,255,0.22); }
      .em-field .em-end { width: 8px; height: 8px; border-radius: 50%; flex: none; }
      .em-field .em-end.a { background: rgba(255,255,255,0.9); }
      .em-field .em-end.b { background: #ffffff; }
      .em-field input { flex: 1; background: transparent; border: none; outline: none; color: #eef1f9;
        font-size: 12.5px; padding: 9px 0; font-family: inherit; min-width: 0; }
      .em-field input::placeholder { color: rgba(200,208,226,0.35); }
      .em-field .em-pick { cursor: pointer; color: rgba(200,208,226,0.4); flex: none; padding: 3px;
        border-radius: 7px; display: flex; transition: all 0.13s ease; }
      .em-field .em-pick:hover { color: #fff; background: rgba(255,255,255,0.1); }
      .em-field .em-pick.arm { color: #0b0e16; background: #fff; }
      .em-dir-actions { display: flex; gap: 7px; margin: 2px 15px 12px; }
      .em-dir-actions .em-btn { display: inline-flex; align-items: center; justify-content: center; gap: 7px;
        height: 37px; border-radius: 11px; border: none; cursor: pointer; font-family: inherit;
        font-size: 12.5px; font-weight: 600; color: rgba(226,232,244,0.85);
        background: rgba(255,255,255,0.06); transition: background 0.15s ease, color 0.15s ease; }
      .em-dir-actions .em-btn:hover { background: rgba(255,255,255,0.12); color: #fff; }
      .em-dir-actions .em-iconbtn { width: 37px; flex: none; }
      .em-dir-actions .em-go { flex: 1; background: rgba(255,255,255,0.92); color: #0b0e16; }
      .em-dir-actions .em-go:hover { background: #fff; color: #000; }
      .em-summary { margin: 0 15px 9px; padding: 11px 13px; border-radius: 12px; display: none;
        background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.08); font-size: 11.5px; }
      .em-summary.on { display: block; }
      .em-summary .em-sm-main { display: flex; align-items: baseline; gap: 9px; }
      .em-summary b { font-size: 17px; font-weight: 700; color: #fff; }
      .em-summary .em-sm-eta { color: rgba(214,222,238,0.8); font-size: 12.5px; }
      .em-summary .em-sm-sub { display: flex; align-items: center; gap: 6px; margin-top: 4px; color: rgba(200,208,226,0.5); }
      .em-summary .em-sm-sub .em-i { width: 12px; height: 12px; }
      .em-alts { display: none; gap: 6px; margin: 0 15px 9px; }
      .em-alts.on { display: flex; }
      .em-alt { flex: 1; padding: 7px 8px; border-radius: 10px; cursor: pointer; font-size: 10.5px; text-align: center;
        background: rgba(255,255,255,0.04); color: rgba(210,218,236,0.6); transition: all 0.13s ease; }
      .em-alt b { display: block; font-size: 12px; color: inherit; }
      .em-alt:hover { background: rgba(255,255,255,0.09); color: #fff; }
      .em-alt.sel { background: rgba(255,255,255,0.13); color: #fff; }
      .em-steps { overflow-y: auto; margin: 0 7px 11px 7px; padding: 0 8px; display: none; }
      .em-steps.on { display: block; }
      .em-steps::-webkit-scrollbar { width: 3px; }
      .em-steps::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.18); border-radius: 3px; }
      .em-step { display: flex; gap: 10px; padding: 8px 8px; font-size: 12px; line-height: 1.4; cursor: pointer;
        border-radius: 10px; color: rgba(222,228,244,0.82); transition: background 0.13s ease; align-items: flex-start; }
      .em-step:hover { background: rgba(255,255,255,0.07); }
      .em-step .em-si { color: rgba(200,208,226,0.55); margin-top: 1px; }
      .em-step s { text-decoration: none; display: block; color: rgba(200,208,226,0.4); font-size: 10.5px; margin-top: 1px; }

      /* ── info chip ── */
      .em-chip { position: absolute; left: 14px; top: 14px; z-index: 1200; display: flex; align-items: center;
        gap: 11px; padding: 8px 13px; font-size: 10.5px; color: rgba(208,216,234,0.75); border-radius: 12px; }
      .em-chip .em-ch { display: flex; align-items: center; gap: 6px; }
      .em-chip .em-ch .em-i { width: 12px; height: 12px; opacity: 0.6; }
      .em-chip .em-sep { width: 1px; height: 12px; background: rgba(255,255,255,0.12); }
      .em-chip b { font-weight: 600; color: rgba(240,244,252,0.95); font-family: 'IBM Plex Mono', monospace; font-size: 10px; }

      .em-toast { position: fixed; bottom: 108px; left: 50%; transform: translateX(-50%); z-index: 1400;
        padding: 10px 18px; font-size: 12px; border-radius: 12px; display: none; max-width: 70%; }
      .em-toast.on { display: block; animation: em-fade 0.25s ease; }
      @keyframes em-fade { from { opacity: 0; transform: translate(-50%, 8px); } to { opacity: 1; transform: translate(-50%, 0); } }

      /* ── agent-bar search results (floats above the global bottom bar) ── */
      .em-bar-results { position: fixed; left: 50%; transform: translateX(-50%); bottom: 108px; z-index: 1500;
        width: min(560px, 86vw); max-height: 300px; overflow: auto; display: none; padding: 6px; }
      .em-bar-results.on { display: block; }
      .em-result { display: flex; gap: 11px; align-items: center; padding: 9px 11px; cursor: pointer;
        font-size: 12.5px; line-height: 1.35; border-radius: 10px; transition: background 0.13s ease; }
      .em-result:hover { background: rgba(255,255,255,0.08); }
      .em-result .em-ric { color: rgba(200,208,226,0.55); flex: none; }
      .em-result b { display: block; font-weight: 600; color: #fff; }
      .em-result s { text-decoration: none; color: rgba(200,208,226,0.48); font-size: 11px; display: block;
        overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 460px; }

      /* ── markers ── */
      .em-marker { position: relative; }
      .em-marker .em-pin { width: 14px; height: 14px; border-radius: 50%;
        background: #fff; border: 2px solid rgba(11,14,22,0.9);
        box-shadow: 0 3px 10px rgba(0,0,0,0.5); }
      .em-marker.em-b .em-pin { background: #ffffff; border-color: rgba(255,255,255,0.9); }
      .em-marker .em-pulse { position: absolute; inset: -6px; border-radius: 50%;
        border: 1.5px solid rgba(255,255,255,0.5); animation: em-pulse 1.6s ease-out infinite; }
      @keyframes em-pulse { from { transform: scale(0.55); opacity: 1; } to { transform: scale(1.5); opacity: 0; } }
      .em-locate-dot { width: 13px; height: 13px; border-radius: 50%; background: #fff;
        border: 2px solid rgba(11,14,22,0.85); box-shadow: 0 0 12px rgba(255,255,255,0.7); }

      .em-pop b.em-pt { font-size: 13px; display: block; margin-bottom: 3px; color: #fff; font-weight: 600; }
      .em-pop .em-pa { color: rgba(205,213,232,0.62); margin-bottom: 4px; }
      .em-pop .em-pc { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: rgba(200,208,226,0.5); margin-bottom: 9px; }
      .em-pop .em-pbtns { display: flex; gap: 6px; }
      .em-pop .em-pbtn { display: inline-flex; align-items: center; gap: 6px; padding: 7px 10px; border-radius: 9px;
        cursor: pointer; font-size: 11.5px; font-weight: 600; color: rgba(230,236,248,0.9); border: none; font-family: inherit;
        background: rgba(255,255,255,0.09); transition: background 0.13s ease; }
      .em-pop .em-pbtn:hover { background: rgba(255,255,255,0.18); color: #fff; }

      /* ── left dock edge handle ── */
      .em-dock-toggle { position: fixed; left: 0; top: 50%; transform: translateY(-50%); z-index: 1300;
        width: 16px; height: 58px; display: none; align-items: center; justify-content: center;
        background: rgba(12,14,21,0.85); backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
        border: 1px solid rgba(255,255,255,0.1); border-left: none; border-radius: 0 11px 11px 0;
        cursor: pointer; color: rgba(220,226,242,0.6); transition: width 0.15s ease, color 0.15s ease; }
      .em-dock-toggle:hover { width: 20px; color: #fff; }
      body.em-surface-open .em-dock-toggle { display: flex; }

      #umap-surface.em-picking .leaflet-container { cursor: crosshair; }

      /* ── full-bleed chrome while surface is open ── */
      body.em-surface-open #umap-root { opacity: 0 !important; pointer-events: none !important; }
      body.em-surface-open .left-dock { display: none !important; }
      body.em-surface-open.em-dock-show .left-dock { display: flex !important; z-index: 1310; }
      #view-newtab.nt-surface-active { position: relative; height: 100%; min-height: 0;
        justify-content: flex-start; padding: 0 !important; }
      #view-newtab.nt-surface-active #umap-surface { inset: 0; border-radius: 0; border: none; box-shadow: none; }
      #view-newtab.nt-surface-active .nt-hero,
      #view-newtab.nt-surface-active .nt-dock-wrap,
      #view-newtab.nt-surface-active .nt-status-row,
      #view-newtab.nt-surface-active .nt-pending-zone { display: none !important; }

      /* ── 3D Satellite Map Perspective ── */
      #umap-surface.em-3d-view .leaflet-container {
        perspective: 1200px;
        perspective-origin: 50% 60%;
      }
      #umap-surface.em-3d-view .leaflet-map-pane {
        transform: perspective(1200px) rotateX(46deg) rotateZ(-5deg) scale(1.32);
        transform-origin: 50% 60%;
        transition: transform 1.2s cubic-bezier(0.25, 1, 0.5, 1);
      }
      #umap-surface.em-3d-view .leaflet-tile-pane {
        /* smooth tile loading rendering */
        image-rendering: -webkit-optimize-contrast;
      }
    `;
    document.head.appendChild(st);
  }

  // ════════════════════════ MAP / LAYERS ════════════════════════
  function buildMap(lat, lon, zoom) {
    const container = document.getElementById('umap-surface');
    if (!container || !window.L) throw new Error('missing #umap-surface / Leaflet');
    injectCSS();
    buildUI(container);

    map = L.map(container.querySelector('.em-map'), {
      center: [lat, lon], zoom: zoom, minZoom: 2, maxZoom: 19,
      worldCopyJump: true, zoomControl: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map);

    const osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank">OpenStreetMap</a> contributors';
    baseLayers = {
      streets: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: osmAttr }),
      dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
        maxZoom: 19, subdomains: 'abcd', attribution: osmAttr + ' &middot; &copy; <a href="https://carto.com/attributions" target="_blank">CARTO</a>' }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, attribution: 'Imagery &copy; Esri &middot; Maxar, Earthstar Geographics' }),
      transit: L.tileLayer('https://tileserver.memomaps.de/tilegen/{z}/{x}/{y}.png', {
        maxZoom: 18, attribution: osmAttr + ' &middot; <a href="https://memomaps.de/" target="_blank">&Ouml;PNVKarte</a>' }),
    };
    overlayLayers = {
      rail: L.tileLayer('https://{s}.tiles.openrailwaymap.org/standard/{z}/{x}/{y}.png', {
        maxZoom: 19, subdomains: 'abc', opacity: 0.85,
        attribution: 'Rail &copy; <a href="https://www.openrailwaymap.org/" target="_blank">OpenRailwayMap</a> (CC-BY-SA)' }),
    };
    setBase('streets');

    map.on('click', onMapClick);
    map.on('moveend zoomend', updateChip);
    // zooming all the way back out returns you to the universe map
    map.on('zoomend', () => {
      if (open && !closingViaZoom && map.getZoom() <= 2) {
        closingViaZoom = true;
        toast('Back to the Universal Map');
        setTimeout(() => { close(); closingViaZoom = false; }, 500);
      }
    });
    updateChip();
    console.log('[EarthMap] online — surface map ready (OSM · OpenRailwayMap · ÖPNVKarte · OSRM · Open-Meteo)');
  }

  function setBase(name) {
    if (currentBase === name) return;
    Object.values(baseLayers).forEach((l) => map.removeLayer(l));
    baseLayers[name].addTo(map);
    baseLayers[name].bringToBack();
    currentBase = name;
    els.baseRows.forEach((r) => r.classList.toggle('sel', r.dataset.base === name));

    const container = document.getElementById('umap-surface');
    if (container) {
      container.classList.toggle('em-3d-view', name === 'satellite');
    }
  }
  function toggleOverlay(name) {
    const l = overlayLayers[name];
    const on = map.hasLayer(l);
    if (on) map.removeLayer(l); else l.addTo(map);
    els.overlayRows.forEach((r) => { if (r.dataset.overlay === name) r.classList.toggle('on', !on); });
  }

  // ════════════════════════ UI ════════════════════════
  function buildUI(container) {
    container.innerHTML = `
      <div class="em-map" style="position:absolute;inset:0;"></div>
      <div class="em-rail em-glass">
        <button class="em-ib em-layersbtn" title="Base map & overlays">${ico('layers', 17)}</button>
        <button class="em-ib em-locbtn" title="My location">${ico('locate', 17)}</button>
        <button class="em-ib em-dirbtn" title="Directions">${ico('nav', 16)}</button>
      </div>
      <div class="em-layers em-glass">
        <h4>Base map</h4>
        <div style="display:flex; gap:6px; margin-bottom:10px;">
          <button class="em-lrow" data-base="streets" title="Streets">${ico('map', 17)}</button>
          <button class="em-lrow" data-base="dark" title="Dark Mode">${ico('moon', 17)}</button>
          <button class="em-lrow" data-base="satellite" title="Satellite">${ico('satellite', 17)}</button>
          <button class="em-lrow" data-base="transit" title="Transit">${ico('bus', 17)}</button>
        </div>
        <h4>Overlays</h4>
        <div style="display:flex; gap:6px;">
          <button class="em-lrow" data-overlay="rail" title="Rail &amp; Metro">${ico('train', 17)}</button>
        </div>
      </div>
      <div class="em-dir em-glass">
        <div class="em-dir-head"><b>Directions</b><span class="em-x" title="Close">${ico('x', 14)}</span></div>
        <div class="em-modes">
          <div class="em-mode sel" data-mode="drive" title="Driving">${ico('car', 17)}</div>
          <div class="em-mode" data-mode="bike" title="Cycling">${ico('bike', 17)}</div>
          <div class="em-mode" data-mode="walk" title="Walking">${ico('walk', 17)}</div>
        </div>
        <div class="em-field"><span class="em-end a"></span><input class="em-from" placeholder="From — type or pick on map"><span class="em-pick" data-end="from" title="Pick start on map">${ico('crosshair', 14)}</span></div>
        <div class="em-field"><span class="em-end b"></span><input class="em-to" placeholder="To — type or pick on map"><span class="em-pick" data-end="to" title="Pick destination on map">${ico('crosshair', 14)}</span></div>
        <div class="em-dir-actions">
          <button class="em-btn em-iconbtn em-swap" title="Swap endpoints">${ico('swap', 14)}</button>
          <button class="em-btn em-go">Get route</button>
          <button class="em-btn em-iconbtn em-clear" title="Clear route">${ico('trash', 14)}</button>
        </div>
        <div class="em-summary"></div>
        <div class="em-alts"></div>
        <div class="em-steps"></div>
      </div>
      <div class="em-chip em-glass"></div>
    `;
    // body-level bits (survive outside the surface container)
    let barResults = document.querySelector('.em-bar-results');
    if (!barResults) {
      barResults = document.createElement('div');
      barResults.className = 'em-bar-results em-glass';
      document.body.appendChild(barResults);
    }
    let toastEl = document.querySelector('.em-toast');
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'em-toast em-glass';
      document.body.appendChild(toastEl);
    }
    els = {
      container,
      layersbtn: container.querySelector('.em-layersbtn'),
      layers: container.querySelector('.em-layers'),
      dirbtn: container.querySelector('.em-dirbtn'),
      locbtn: container.querySelector('.em-locbtn'),
      dir: container.querySelector('.em-dir'),
      from: container.querySelector('.em-from'),
      to: container.querySelector('.em-to'),
      summary: container.querySelector('.em-summary'),
      alts: container.querySelector('.em-alts'),
      steps: container.querySelector('.em-steps'),
      chip: container.querySelector('.em-chip'),
      toast: toastEl,
      barResults,
      baseRows: Array.from(container.querySelectorAll('[data-base]')),
      overlayRows: Array.from(container.querySelectorAll('[data-overlay]')),
      picks: Array.from(container.querySelectorAll('.em-pick')),
      modes: Array.from(container.querySelectorAll('.em-mode')),
    };

    els.layersbtn.addEventListener('click', () => {
      const on = els.layers.classList.toggle('on');
      els.layersbtn.classList.toggle('em-on', on);
      els.dir.classList.remove('on'); els.dirbtn.classList.remove('em-on');
    });
    els.baseRows.forEach((r) => r.addEventListener('click', () => setBase(r.dataset.base)));
    els.overlayRows.forEach((r) => r.addEventListener('click', () => toggleOverlay(r.dataset.overlay)));
    els.dirbtn.addEventListener('click', () => {
      const on = els.dir.classList.toggle('on');
      els.dirbtn.classList.toggle('em-on', on);
      els.layers.classList.remove('on'); els.layersbtn.classList.remove('em-on');
    });
    els.dir.querySelector('.em-x').addEventListener('click', () => { els.dir.classList.remove('on'); els.dirbtn.classList.remove('em-on'); });
    els.locbtn.addEventListener('click', locateMe);
    els.modes.forEach((m) => m.addEventListener('click', () => {
      els.modes.forEach((x) => x.classList.toggle('sel', x === m));
      if (route.from && route.to) fetchRoute();
    }));
    els.picks.forEach((p) => p.addEventListener('click', () => {
      route.picking = route.picking === p.dataset.end ? null : p.dataset.end;
      els.picks.forEach((x) => x.classList.toggle('arm', x.dataset.end === route.picking));
      els.container.classList.toggle('em-picking', !!route.picking);
      if (route.picking) toast(`Click the map to set the ${route.picking === 'from' ? 'start' : 'destination'} point`);
    }));
    container.querySelector('.em-go').addEventListener('click', routeFromInputs);
    container.querySelector('.em-swap').addEventListener('click', () => {
      const t = els.from.value; els.from.value = els.to.value; els.to.value = t;
      const r = route.from; route.from = route.to; route.to = r;
      drawRouteMarkers();
      if (route.from && route.to) fetchRoute();
    });
    container.querySelector('.em-clear').addEventListener('click', clearRoute);
    [els.from, els.to].forEach((inp) => inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') routeFromInputs();
    }));

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || !open) return;
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (els.barResults.classList.contains('on')) { els.barResults.classList.remove('on'); return; }
      close();
    });
    wireAgentBar();
  }

  function toast(msg, ms) {
    els.toast.textContent = msg;
    els.toast.classList.add('on');
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(() => els.toast.classList.remove('on'), ms || 2600);
  }

  // ════════════════════════ AGENTIC BAR AS MAP SEARCH ════════════════════════
  // While the surface map is open, the global bottom bar searches the map:
  // "Mysore" → fly there · "Bangalore to Mysore" → route. Capture-phase
  // listeners on the dock run before the renderer's own handlers.
  function wireAgentBar() {
    if (barWired) return;
    const dock = document.getElementById('global-agent-dock');
    const input = document.getElementById('nt-search-input');
    if (!dock || !input) { console.warn('[EarthMap] global agent dock not found — bar search disabled'); return; }
    barWired = true;

    dock.addEventListener('keydown', (e) => {
      // Only intercept when Leaflet map is ALREADY open
      if (!open || e.target !== input) return;

      if (e.key === 'Escape') { els.barResults.classList.remove('on'); return; }
      if (e.key !== 'Enter') return;
      const q = input.value.trim();
      if (!q) return;

      e.preventDefault();
      e.stopPropagation();
      els.barResults.classList.remove('on');

      // In-map search (map is already open)
      const m = q.match(/^(.+?)\s+to\s+(.+)$/i);
      if (m) {
        routeByNames(m[1].trim(), m[2].trim());
      } else {
        geocode(q, (r) => {
          if (r && r[0]) pickResult(r[0]);
          else toast('No places found for "' + q + '"');
        });
      }
      input.value = '';
    }, true);

    dock.addEventListener('input', (e) => {
      if (!open || e.target !== input) return;
      e.stopPropagation();
      clearTimeout(barDebounce);
      const q = input.value.trim();
      if (q.length < 3 || /\s+to\s+/i.test(q)) { els.barResults.classList.remove('on'); return; }
      barDebounce = setTimeout(() => geocode(q, showBarResults), 450);
    }, true);
  }
  function positionBarResults() {
    const dock = document.getElementById('global-agent-dock');
    if (!dock) return;
    const r = dock.getBoundingClientRect();
    els.barResults.style.bottom = Math.max(90, window.innerHeight - r.top + 10) + 'px';
  }
  function showBarResults(list) {
    els.barResults.innerHTML = '';
    list.forEach((p) => {
      const d = document.createElement('div');
      d.className = 'em-result';
      const name = p.display_name.split(',')[0];
      d.innerHTML = `<span class="em-ric">${ico(resultIcon(p), 15)}</span><div><b>${name}</b><s>${p.display_name.slice(name.length + 1).trim()}</s></div>`;
      d.addEventListener('click', () => { els.barResults.classList.remove('on'); pickResult(p); });
      els.barResults.appendChild(d);
    });
    positionBarResults();
    els.barResults.classList.toggle('on', list.length > 0);
  }
  async function routeByNames(fromQ, toQ) {
    toast(`Routing ${fromQ} → ${toQ}…`);
    els.dir.classList.add('on'); els.dirbtn.classList.add('em-on');
    els.layers.classList.remove('on'); els.layersbtn.classList.remove('em-on');
    route.from = route.to = null;
    await new Promise((res) => geocode(fromQ, (r) => { if (r[0]) setRouteEnd('from', +r[0].lat, +r[0].lon, r[0].display_name.split(',')[0]); res(); }));
    await new Promise((res) => geocode(toQ, (r) => { if (r[0]) setRouteEnd('to', +r[0].lat, +r[0].lon, r[0].display_name.split(',')[0]); res(); }));
    if (route.from && route.to) fetchRoute();
    else toast('Could not find both places');
  }

  // ════════════════════════ SEARCH (Nominatim) ════════════════════════
  async function geocode(q, cb) {
    if (!q) return;
    try {
      const r = await fetch(`${NOMINATIM}/search?format=jsonv2&limit=6&addressdetails=0&q=${encodeURIComponent(q)}`,
        { headers: { 'Accept-Language': navigator.language || 'en' } });
      cb(await r.json());
    } catch (err) {
      console.warn('[EarthMap] geocode failed:', err);
      toast('Search unavailable — check connection');
      cb([]);
    }
  }
  function resultIcon(p) {
    const c = (p.class || '') + '/' + (p.type || '');
    if (c.indexOf('railway') >= 0 || c.indexOf('station') >= 0 || c.indexOf('subway') >= 0) return 'train';
    if (c.indexOf('highway') >= 0 || c.indexOf('road') >= 0) return 'car';
    if (c.indexOf('bus') >= 0) return 'bus';
    if (c.indexOf('aeroway') >= 0) return 'nav';
    return 'pin';
  }
  function pickResult(p) {
    const lat = +p.lat, lon = +p.lon;
    if (searchMarker) map.removeLayer(searchMarker);
    searchMarker = L.marker([lat, lon], { icon: divIcon('') }).addTo(map);
    searchMarker.bindPopup(popupHTML(p.display_name.split(',')[0],
      p.display_name.split(',').slice(1).join(',').trim(), lat, lon, p.type));
    map.flyTo([lat, lon], Math.max(map.getZoom(), 14), { duration: 1.2 });
    setTimeout(() => { searchMarker.openPopup(); wirePopup(lat, lon); }, 1300);
  }

  function divIcon(cls) {
    return L.divIcon({
      className: '', iconSize: [14, 14], iconAnchor: [7, 7],
      html: `<div class="em-marker ${cls}"><div class="em-pulse"></div><div class="em-pin"></div></div>`,
    });
  }

  // ════════════════════════ INFO CHIP (coords · zoom · live weather) ════════════════════════
  const WMO = [
    [0, 'sun', 'Clear'], [2, 'cloud', 'Partly cloudy'], [3, 'cloud', 'Overcast'],
    [48, 'fog', 'Fog'], [57, 'rain', 'Drizzle'], [67, 'rain', 'Rain'], [77, 'snow', 'Snow'],
    [82, 'rain', 'Showers'], [86, 'snow', 'Snow showers'], [99, 'storm', 'Thunderstorm'],
  ];
  function wmo(code) { for (const [max, icon, label] of WMO) if (code <= max) return { icon, label }; return { icon: 'cloud', label: '—' }; }
  function chipHTML() {
    const c = map.getCenter();
    return `
      <span class="em-ch">${ico('pin', 12)}<b>${c.lat.toFixed(4)}, ${c.lng.toFixed(4)}</b></span>
      <span class="em-sep"></span>
      <span class="em-ch"><b>z${map.getZoom()}</b></span>` + (els.chip._wx || '');
  }
  function updateChip() {
    if (!map) return;
    els.chip.innerHTML = chipHTML();
    const c = map.getCenter();
    clearTimeout(weatherT);
    weatherT = setTimeout(async () => {
      const key = c.lat.toFixed(1) + ',' + c.lng.toFixed(1);
      if (key === weatherKey) return;
      try {
        const r = await fetch(`${METEO}?latitude=${c.lat.toFixed(3)}&longitude=${c.lng.toFixed(3)}&current=temperature_2m,weather_code,wind_speed_10m`);
        const j = await r.json();
        if (!j.current) return;
        weatherKey = key;
        const w = wmo(j.current.weather_code);
        els.chip._wx = `
          <span class="em-sep"></span>
          <span class="em-ch">${ico(w.icon, 12)}<b>${Math.round(j.current.temperature_2m)}°C</b> ${w.label}</span>
          <span class="em-ch">${ico('wind', 12)}<b>${Math.round(j.current.wind_speed_10m)} km/h</b></span>`;
        if (map) els.chip.innerHTML = chipHTML();
      } catch (_) { /* offline — chip just shows coords */ }
    }, 700);
  }

  // ════════════════════════ INSPECT (click → reverse geocode card) ════════════════════════
  // title/addr come from Nominatim's display_name (forward search + reverse
  // geocode) — network-sourced text, not literal-safe to drop into HTML.
  function _escPop(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function popupHTML(title, addr, lat, lon, type) {
    return `<div class="em-pop">
      <b class="em-pt">${_escPop(title) || 'Dropped pin'}</b>
      ${addr ? `<div class="em-pa">${_escPop(addr)}</div>` : ''}
      <div class="em-pc">${lat.toFixed(5)}, ${lon.toFixed(5)}${type ? ' · ' + type : ''}</div>
      <div class="em-pbtns">
        <button class="em-pbtn em-p-from">${ico('dot', 12)} From here</button>
        <button class="em-pbtn em-p-to">${ico('flag', 12)} To here</button>
      </div>
    </div>`;
  }
  function wirePopup(lat, lon) {
    const pane = els.container.querySelector('.leaflet-popup-pane') || els.container;
    const f = pane.querySelector('.em-p-from'), t = pane.querySelector('.em-p-to');
    const use = (end) => {
      map.closePopup();
      els.dir.classList.add('on');
      els.dirbtn.classList.add('em-on');
      setRouteEnd(end, lat, lon, `${lat.toFixed(4)}, ${lon.toFixed(4)}`);
      if (route.from && route.to) fetchRoute();
    };
    if (f) f.addEventListener('click', () => use('from'));
    if (t) t.addEventListener('click', () => use('to'));
  }
  async function inspectAt(latlng) {
    const { lat, lng } = latlng;
    let title = 'Dropped pin', addr = '', type = '';
    try {
      const r = await fetch(`${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=${Math.min(18, map.getZoom() + 2)}`,
        { headers: { 'Accept-Language': navigator.language || 'en' } });
      const j = await r.json();
      if (j && j.display_name) {
        title = j.name || j.display_name.split(',')[0];
        addr = j.display_name;
        type = (j.type || '').replace(/_/g, ' ');
      }
    } catch (_) { /* offline — show coords only */ }
    L.popup({ maxWidth: 320 }).setLatLng(latlng).setContent(popupHTML(title, addr, lat, lng, type)).openOn(map);
    wirePopup(lat, lng);
  }

  // ════════════════════════ ROUTING (OSRM) ════════════════════════
  function onMapClick(e) {
    if (route.picking) {
      setRouteEnd(route.picking, e.latlng.lat, e.latlng.lng, `${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`);
      route.picking = null;
      els.picks.forEach((x) => x.classList.remove('arm'));
      els.container.classList.remove('em-picking');
      if (route.from && route.to) fetchRoute();
      return;
    }
    inspectAt(e.latlng); // informative: click anywhere → who/what is here
  }
  function setRouteEnd(end, lat, lon, label) {
    route[end] = { lat, lon };
    els[end].value = label;
    drawRouteMarkers();
  }
  function drawRouteMarkers() {
    route.markers.forEach((m) => map.removeLayer(m));
    route.markers = [];
    if (route.from) route.markers.push(L.marker([route.from.lat, route.from.lon], { icon: divIcon('em-a') }).addTo(map));
    if (route.to) route.markers.push(L.marker([route.to.lat, route.to.lon], { icon: divIcon('em-b') }).addTo(map));
  }
  async function routeFromInputs() {
    // geocode any free-text endpoints that weren't picked on the map
    const need = [];
    if (!route.from && els.from.value.trim()) need.push(['from', els.from.value.trim()]);
    if (!route.to && els.to.value.trim()) need.push(['to', els.to.value.trim()]);
    for (const [end, q] of need) {
      await new Promise((res) => geocode(q, (r) => {
        if (r[0]) setRouteEnd(end, +r[0].lat, +r[0].lon, r[0].display_name.split(',')[0]);
        res();
      }));
    }
    if (route.from && route.to) fetchRoute();
    else toast('Set both start and destination first');
  }
  async function fetchRoute() {
    const mode = els.modes.find((m) => m.classList.contains('sel')).dataset.mode;
    const c = `${route.from.lon},${route.from.lat};${route.to.lon},${route.to.lat}`;
    const q = `/route/v1/driving/${c}?overview=full&geometries=geojson&steps=true&alternatives=true`;
    toast('Calculating route…');
    let data = null;
    for (const base of [OSRM[mode], mode === 'drive' ? OSRM_FALLBACK : null]) {
      if (!base) continue;
      try {
        const r = await fetch(base + q);
        data = await r.json();
        if (data.code === 'Ok') break;
      } catch (err) { console.warn('[EarthMap] OSRM failed on', base, err); data = null; }
    }
    if (!data || data.code !== 'Ok' || !data.routes || !data.routes[0]) {
      toast('No route found between these points');
      return;
    }
    route.routes = data.routes.slice(0, 3);
    route.selected = 0;
    renderRoutes();
  }
  function renderRoutes() {
    route.lines.forEach((l) => map.removeLayer(l));
    route.lines = [];
    // draw alternates first (dim), selected last (on top)
    route.routes.forEach((r, i) => {
      if (i === route.selected) return;
      route.lines.push(routeLine(r, false, i));
    });
    route.lines.push(routeLine(route.routes[route.selected], true, route.selected));
    const bounds = L.latLngBounds(route.routes[route.selected].geometry.coordinates.map((c) => [c[1], c[0]]));
    map.fitBounds(bounds, { padding: [70, 70] });
    renderSummary();
    renderAlts();
    renderSteps();
    const r = route.routes[route.selected];
    console.log('[EarthMap] route rendered —', (r.distance / 1000).toFixed(1), 'km,',
      (r.legs[0] ? r.legs[0].steps.length : 0), 'steps,', route.routes.length, 'route option(s)');
  }
  function routeLine(r, selected, idx) {
    const coords = r.geometry.coordinates.map((c) => [c[1], c[0]]);
    const g = L.layerGroup().addTo(map);
    if (selected) {
      g.addLayer(L.polyline(coords, { color: '#0b0e16', weight: 8, opacity: 0.8 }));
      g.addLayer(L.polyline(coords, { color: '#ffffff', weight: 4.5, opacity: 0.95 }));
    } else {
      const alt = L.polyline(coords, { color: '#7b8394', weight: 4.5, opacity: 0.5, dashArray: '1 8' });
      alt.on('click', () => { route.selected = idx; renderRoutes(); });
      alt.on('mouseover', () => alt.setStyle({ opacity: 0.85 }));
      alt.on('mouseout', () => alt.setStyle({ opacity: 0.5 }));
      g.addLayer(alt);
    }
    return g;
  }
  function renderSummary() {
    const r = route.routes[route.selected];
    const km = r.distance / 1000;
    const min = Math.round(r.duration / 60);
    const eta = min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`;
    const arrive = new Date(Date.now() + r.duration * 1000)
      .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const mode = els.modes.find((m) => m.classList.contains('sel'));
    els.summary.innerHTML = `
      <div class="em-sm-main"><b>${km >= 10 ? km.toFixed(0) : km.toFixed(1)} km</b><span class="em-sm-eta">${eta}</span></div>
      <div class="em-sm-sub">${ico('clock', 12)} arrive ~${arrive} · ${mode.title.toLowerCase()} · live OSM data</div>`;
    els.summary.classList.add('on');
  }
  function renderAlts() {
    els.alts.innerHTML = '';
    if (route.routes.length < 2) { els.alts.classList.remove('on'); return; }
    route.routes.forEach((r, i) => {
      const d = document.createElement('div');
      d.className = 'em-alt' + (i === route.selected ? ' sel' : '');
      const min = Math.round(r.duration / 60);
      d.innerHTML = `<b>${min >= 60 ? Math.floor(min / 60) + 'h' + (min % 60) : min + 'm'}</b>${(r.distance / 1000).toFixed(0)} km`;
      d.addEventListener('click', () => { route.selected = i; renderRoutes(); });
      els.alts.appendChild(d);
    });
    els.alts.classList.add('on');
  }
  function renderSteps() {
    const r = route.routes[route.selected];
    els.steps.innerHTML = '';
    (r.legs[0] ? r.legs[0].steps : []).forEach((s) => {
      const d = document.createElement('div');
      d.className = 'em-step';
      const dist = s.distance >= 1000 ? (s.distance / 1000).toFixed(1) + ' km' : Math.round(s.distance) + ' m';
      d.innerHTML = `<span class="em-si">${ico(maneuverIcon(s.maneuver), 14)}</span><div>${maneuverText(s)}<s>${dist}</s></div>`;
      const loc = [s.maneuver.location[1], s.maneuver.location[0]];
      d.addEventListener('click', () => map.flyTo(loc, 16, { duration: 0.8 }));
      d.addEventListener('mouseenter', () => {
        if (stepDot) map.removeLayer(stepDot);
        stepDot = L.circleMarker(loc, { radius: 8, color: '#fff', weight: 2, fillColor: '#ffffff', fillOpacity: 0.8 }).addTo(map);
      });
      d.addEventListener('mouseleave', () => { if (stepDot) { map.removeLayer(stepDot); stepDot = null; } });
      els.steps.appendChild(d);
    });
    els.steps.classList.add('on');
  }
  function maneuverIcon(m) {
    const mod = m.modifier || '';
    if (m.type === 'depart') return 'dot';
    if (m.type === 'arrive') return 'flag';
    if (m.type === 'roundabout' || m.type === 'rotary') return 'round';
    if (m.type === 'merge') return 'merge';
    if (mod.indexOf('uturn') >= 0) return 'uturn';
    if (mod.indexOf('sharp left') >= 0) return 'arrLeft';
    if (mod.indexOf('sharp right') >= 0) return 'arrRight';
    if (mod.indexOf('slight left') >= 0) return 'slLeft';
    if (mod.indexOf('slight right') >= 0) return 'slRight';
    if (mod.indexOf('left') >= 0) return 'upLeft';
    if (mod.indexOf('right') >= 0) return 'upRight';
    return 'up';
  }
  function maneuverText(s) {
    const t = s.maneuver.type, mod = s.maneuver.modifier || '', name = s.name ? ` onto <b>${s.name}</b>` : '';
    if (t === 'depart') return `Head ${mod || 'out'}${name}`;
    if (t === 'arrive') return 'You have arrived at your destination';
    if (t === 'roundabout' || t === 'rotary') return `At the roundabout take exit ${s.maneuver.exit || ''}${name}`;
    if (t === 'new name' || t === 'continue') return `Continue${name}`;
    if (t === 'merge') return `Merge ${mod}${name}`;
    if (t === 'on ramp') return `Take the ramp${name}`;
    if (t === 'off ramp') return `Take the exit${name}`;
    if (t === 'fork') return `Keep ${mod} at the fork${name}`;
    return `Turn ${mod}${name}`;
  }
  function clearRoute() {
    route.lines.forEach((l) => map.removeLayer(l));
    route.markers.forEach((m) => map.removeLayer(m));
    if (stepDot) { map.removeLayer(stepDot); stepDot = null; }
    route.lines = []; route.markers = []; route.routes = []; route.selected = 0;
    route.from = route.to = null; route.picking = null;
    els.from.value = els.to.value = '';
    els.summary.classList.remove('on'); els.alts.classList.remove('on'); els.steps.classList.remove('on');
    els.container.classList.remove('em-picking');
  }

  // ════════════════════════ GEOLOCATION ════════════════════════
  function _showLocation(lat, lon, accuracy, approx) {
    if (locateMarker) map.removeLayer(locateMarker);
    if (locateRing) map.removeLayer(locateRing);
    locateMarker = L.marker([lat, lon], {
      icon: L.divIcon({ className: '', iconSize: [13, 13], iconAnchor: [6, 6], html: '<div class="em-locate-dot"></div>' }),
    }).addTo(map);
    locateRing = L.circle([lat, lon], { radius: accuracy, color: '#fff', weight: 1, opacity: 0.4, fillOpacity: 0.06 }).addTo(map);
    map.flyTo([lat, lon], approx ? 11 : 16, { duration: 1.2 });
    if (approx) toast('Approximate location (network-based)');
  }

  // IP-based fallback: GPS-grade geolocation needs an OS location service that
  // unpackaged Electron rarely has, so "Could not get your location" was the
  // norm. City-level IP lookup keeps the Locate button useful everywhere.
  async function _ipLocate() {
    const providers = [
      { url: 'https://ipapi.co/json/', lat: 'latitude', lon: 'longitude' },
      { url: 'https://ipwho.is/', lat: 'latitude', lon: 'longitude' },
    ];
    for (const p of providers) {
      try {
        const r = await fetch(p.url, { signal: AbortSignal.timeout(5000) });
        const d = await r.json();
        const lat = Number(d[p.lat]), lon = Number(d[p.lon]);
        if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
      } catch (_) { /* try next provider */ }
    }
    return null;
  }

  function locateMe() {
    toast('Locating…');
    const fallback = async () => {
      const ip = await _ipLocate();
      if (ip) _showLocation(ip.lat, ip.lon, 3000, true);
      else toast('Could not get your location');
    };
    if (!navigator.geolocation) { fallback(); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      const { latitude: lat, longitude: lon, accuracy } = p.coords;
      _showLocation(lat, lon, accuracy, false);
    }, fallback, { enableHighAccuracy: true, timeout: 8000 });
  }

  // ════════════════════════ OPEN / CLOSE ════════════════════════
  // Full-bleed: #dashboard-window normally hugs its content at max-width 880px
  // and #main-content-wrapper reserves padding for the app chrome — while the
  // surface map owns the view both are expanded, the universe HUD (#umap-root)
  // fades out, and the left dock hides behind an edge handle.
  function expandChrome() {
    savedChrome = {};
    const dw = document.getElementById('dashboard-window');
    if (dw) {
      savedChrome.dw = dw.getAttribute('style');
      dw.style.maxWidth = 'none'; dw.style.width = '100%';
      dw.style.flex = '1'; dw.style.minHeight = '0'; dw.style.height = '100%';
    }
    const wrap = document.getElementById('main-content-wrapper');
    if (wrap) {
      savedChrome.wrap = wrap.getAttribute('style');
      wrap.style.padding = '0';
    }
    const input = document.getElementById('nt-search-input');
    if (input) {
      savedPlaceholder = input.placeholder;
      input.placeholder = 'Search the map — “Mysore” or “Bangalore to Mysore”';
    }
    document.body.classList.add('em-surface-open');
  }
  function restoreChrome() {
    if (savedChrome) {
      const dw = document.getElementById('dashboard-window');
      if (dw && savedChrome.dw != null) dw.setAttribute('style', savedChrome.dw);
      const wrap = document.getElementById('main-content-wrapper');
      if (wrap && savedChrome.wrap != null) wrap.setAttribute('style', savedChrome.wrap);
      savedChrome = null;
    }
    const input = document.getElementById('nt-search-input');
    if (input && savedPlaceholder !== null) { input.placeholder = savedPlaceholder; savedPlaceholder = null; }
    document.body.classList.remove('em-surface-open', 'em-dock-show');
    if (els.barResults) els.barResults.classList.remove('on');
  }
  function openAt(lat, lon, zoom) {
    try {
      if (open) return; // wheel bursts from the globe can fire this repeatedly
      const surface = document.getElementById('umap-surface');
      if (!surface) return;
      if (!map) buildMap(lat, lon, zoom || 5);
      else map.setView([lat, lon], zoom || 5, { animate: false });
      expandChrome();
      surface.classList.add('open');
      const nt = document.getElementById('view-newtab');
      if (nt) nt.classList.add('nt-surface-active');
      open = true;
      // Leaflet needs a size poke after the container becomes visible
      setTimeout(() => { map.invalidateSize(); updateChip(); }, 60);
      console.log('[EarthMap] open at', lat.toFixed(3) + ',', lon.toFixed(3), 'z' + (zoom || 5));
    } catch (err) {
      console.error('[EarthMap] failed to open:', err);
    }
  }
  function close() {
    const surface = document.getElementById('umap-surface');
    if (surface) surface.classList.remove('open');
    const nt = document.getElementById('view-newtab');
    if (nt) nt.classList.remove('nt-surface-active');
    restoreChrome();
    open = false;
    console.log('[EarthMap] closed — back to the Universal Map');
  }

  window.BucksEarthMap = { openAt, close, isOpen: () => open, routeByNames };
  console.log('[EarthMap] module loaded — waiting for globe handoff');
})();

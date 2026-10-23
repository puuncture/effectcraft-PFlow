// PFlow for EffectCraft: a Bezier easing-curve editor that saves curves and applies them to
// the selected keyframes.
//
// A dockable ScriptUI panel (install into "Scripts/ScriptUI Panels", then Window > PFlow.jsx).
// Works only with After Effects' documented scripting API, so it also runs in After Effects.
//
// How it works
//   * The curve is a CSS-style cubic Bezier (x1, y1, x2, y2) from (0,0) to (1,1).
//     Drag the two handles in the graph, type the four numbers, or pick a preset.
//   * "Apply" eases every pair of neighbouring selected keyframes (of any property) with the
//     curve: out side of the first key, in side of the second. Speeds are scaled to each
//     segment, so the same curve fits any distance and duration (one undo step).
//   * "From Keys" reads the curve of the first selected pair back into the editor.
//   * Your own presets are kept with app.settings (section "PFlow", key "presets") as JSON:
//     {"version": 1, "presets": [{"name": "...", "curve": [x1, y1, x2, y2]}]}
//
// Original work by Puuncture, MIT License. The built-in curves are the widely published standard
// easing values (easings.net / CSS), not taken from any third-party panel.

(function pflow(thisObj) {
  var SECTION = "PFlow";
  var KEY = "presets";
  var MAX_NAME = 64;
  var MIN_INFLUENCE = 0.1;   // percent, After Effects' minimum
  var MAX_SPEED = 1000;      // relative to the segment's average speed
  var X_MIN = 0, X_MAX = 1;
  var Y_MIN = -2, Y_MAX = 3;

  var BEZIER = KeyframeInterpolationType.BEZIER;
  var HOLD = KeyframeInterpolationType.HOLD;

  // ------------------------------------------------------------------ curves

  function finite(v) { return typeof v === "number" && isFinite(v); }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function C(x1, y1, x2, y2) { return [x1, y1, x2, y2]; }

  // A valid copy of a curve, or null.
  function sane(c) {
    if (!(c instanceof Array) || c.length !== 4) return null;
    for (var i = 0; i < 4; i++) if (!finite(c[i])) return null;
    return C(clamp(c[0], X_MIN, X_MAX), clamp(c[1], Y_MIN, Y_MAX), clamp(c[2], X_MIN, X_MAX), clamp(c[3], Y_MIN, Y_MAX));
  }

  function round(v, places) {
    var f = Math.pow(10, places);
    return Math.round(v * f) / f;
  }

  function curveText(c) {
    return round(c[0], 3) + ", " + round(c[1], 3) + ", " + round(c[2], 3) + ", " + round(c[3], 3);
  }

  // Four numbers anywhere in the text ("0.4, 0, 0.2, 1" or "cubic-bezier(.4,0,.2,1)").
  function parseCurve(text) {
    var m = String(text).match(/-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/gi);
    if (!m || m.length < 4) return null;
    return sane(C(parseFloat(m[0]), parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3])));
  }

  // The standard easing families (sine, quad … back) as In / Out / In-Out.
  var BUILT_IN = [
    { name: "Linear", curve: C(0.333, 0.333, 0.667, 0.667) },
    { name: "Ease In", curve: C(0.42, 0, 1, 1) },
    { name: "Ease Out", curve: C(0, 0, 0.58, 1) },
    { name: "Ease", curve: C(0.42, 0, 0.58, 1) },
    { name: "Ease (CSS)", curve: C(0.25, 0.1, 0.25, 1) },
    { name: "Standard (Material)", curve: C(0.4, 0, 0.2, 1) },
    { name: "Sine In", curve: C(0.12, 0, 0.39, 0) },
    { name: "Sine Out", curve: C(0.61, 1, 0.88, 1) },
    { name: "Sine In-Out", curve: C(0.37, 0, 0.63, 1) },
    { name: "Quad In", curve: C(0.11, 0, 0.5, 0) },
    { name: "Quad Out", curve: C(0.5, 1, 0.89, 1) },
    { name: "Quad In-Out", curve: C(0.45, 0, 0.55, 1) },
    { name: "Cubic In", curve: C(0.32, 0, 0.67, 0) },
    { name: "Cubic Out", curve: C(0.33, 1, 0.68, 1) },
    { name: "Cubic In-Out", curve: C(0.65, 0, 0.35, 1) },
    { name: "Quart In", curve: C(0.5, 0, 0.75, 0) },
    { name: "Quart Out", curve: C(0.25, 1, 0.5, 1) },
    { name: "Quart In-Out", curve: C(0.76, 0, 0.24, 1) },
    { name: "Quint In", curve: C(0.64, 0, 0.78, 0) },
    { name: "Quint Out", curve: C(0.22, 1, 0.36, 1) },
    { name: "Quint In-Out", curve: C(0.83, 0, 0.17, 1) },
    { name: "Expo In", curve: C(0.7, 0, 0.84, 0) },
    { name: "Expo Out", curve: C(0.16, 1, 0.3, 1) },
    { name: "Expo In-Out", curve: C(0.87, 0, 0.13, 1) },
    { name: "Circ In", curve: C(0.55, 0, 1, 0.45) },
    { name: "Circ Out", curve: C(0, 0.55, 0.45, 1) },
    { name: "Circ In-Out", curve: C(0.85, 0, 0.15, 1) },
    { name: "Back In", curve: C(0.36, 0, 0.66, -0.56) },
    { name: "Back Out", curve: C(0.34, 1.56, 0.64, 1) },
    { name: "Back In-Out", curve: C(0.68, -0.6, 0.32, 1.6) }
  ];

  // The curve as After Effects eases: influence (percent) and speed (relative to the segment's
  // average speed, 1 = a straight line) of the out side of the first key and the in side of the
  // second. The handles sit at (outInfluence, outSpeed * outInfluence) and
  // (1 - inInfluence, 1 - inSpeed * inInfluence).
  function toEases(c) {
    var ox = clamp(c[0], MIN_INFLUENCE / 100, 1);
    var ix = clamp(1 - c[2], MIN_INFLUENCE / 100, 1);
    return {
      outInfluence: ox * 100,
      outSpeed: clamp(c[1] / ox, -MAX_SPEED, MAX_SPEED),
      inInfluence: ix * 100,
      inSpeed: clamp((1 - c[3]) / ix, -MAX_SPEED, MAX_SPEED)
    };
  }

  function fromEases(e) {
    var ox = e.outInfluence / 100, ix = e.inInfluence / 100;
    return sane(C(ox, e.outSpeed * ox, 1 - ix, 1 - e.inSpeed * ix));
  }

  function mirrored(c) { return C(1 - c[2], 1 - c[3], 1 - c[0], 1 - c[1]); } // play it backwards

  // ------------------------------------------------------------------ presets

  function cleanName(name) {
    var n = String(name === undefined || name === null ? "" : name).replace(/^\s+|\s+$/g, "");
    return n.length > 0 && n.length <= MAX_NAME ? n : null;
  }

  function find(list, name) {
    var key = String(name).toLowerCase();
    for (var i = 0; i < list.length; i++) if (list[i].name.toLowerCase() === key) return i;
    return -1;
  }

  function parsePresets(text) {
    var out = [], doc;
    try { doc = JSON.parse(text); } catch (e) { return out; }
    var list = doc && doc.presets instanceof Array ? doc.presets : (doc instanceof Array ? doc : []);
    for (var i = 0; i < list.length; i++) {
      var name = cleanName(list[i] && list[i].name), c = sane(list[i] && list[i].curve);
      if (name && c && find(BUILT_IN, name) < 0 && find(out, name) < 0) out.push({ name: name, curve: c });
    }
    return out;
  }

  function loadUser() {
    try {
      if (!app.settings.haveSetting(SECTION, KEY)) return [];
      return parsePresets(app.settings.getSetting(SECTION, KEY));
    } catch (e) {
      return [];
    }
  }

  function saveUser(list) {
    app.settings.saveSetting(SECTION, KEY, JSON.stringify({ version: 1, presets: list }));
  }

  // ------------------------------------------------------------------ keyframes

  // Pairs of neighbouring selected keyframes in the active comp: {prop, key} (the earlier key).
  function selectedPairs() {
    var comp = app.project.activeItem, out = [];
    if (!(comp instanceof CompItem)) return out;
    var props = comp.selectedProperties;
    for (var i = 0; i < props.length; i++) {
      var p = props[i];
      if (p.propertyType !== PropertyType.PROPERTY || p.numKeys < 2 || !p.isInterpolationTypeValid(BEZIER)) continue;
      var keys = p.selectedKeys;
      for (var k = 0; k + 1 < keys.length; k++) if (keys[k + 1] === keys[k] + 1) out.push({ prop: p, key: keys[k] });
    }
    return out;
  }

  function pathLength(a, outT, inT, b) {
    var n = Math.max(a.length, b.length), len = 0, prev = null, pts = [];
    for (var d = 0; d < n; d++) pts.push([a[d] || 0, (a[d] || 0) + (outT[d] || 0), (b[d] || 0) + (inT[d] || 0), b[d] || 0]);
    for (var s = 0; s <= 128; s++) {
      var t = s / 128, u = 1 - t, pt = [], sq = 0;
      for (var e = 0; e < n; e++) pt.push(u * u * u * pts[e][0] + 3 * u * u * t * pts[e][1] + 3 * u * t * t * pts[e][2] + t * t * t * pts[e][3]);
      if (prev) {
        for (var f = 0; f < n; f++) sq += (pt[f] - prev[f]) * (pt[f] - prev[f]);
        len += Math.sqrt(sq);
      }
      prev = pt;
    }
    return len;
  }

  function layerOf(p) { return p.propertyGroup(p.propertyDepth); }

  // Average speed of the segment key a -> a+1, one entry per ease the property has (null when
  // the segment has no duration).
  function slopes(p, a) {
    var stretch = layerOf(p).stretch || 100;
    var dur = (p.keyTime(a + 1) - p.keyTime(a)) * 100 / stretch;
    if (!(dur > 0) || !isFinite(dur)) return null;
    var n = Math.max(1, p.keyOutTemporalEase(a).length), out = [], i;
    var v0 = p.keyValue(a), v1 = p.keyValue(a + 1), vt = p.propertyValueType;
    if (vt === PropertyValueType.TwoD_SPATIAL || vt === PropertyValueType.ThreeD_SPATIAL) {
      var speed = pathLength(v0, p.keyOutSpatialTangent(a), p.keyInSpatialTangent(a + 1), v1) / dur;
      for (i = 0; i < n; i++) out.push(speed);
    } else if (typeof v0 === "number" && typeof v1 === "number") {
      out.push((v1 - v0) / dur);
    } else if (v0 instanceof Array && v1 instanceof Array && v0.length === v1.length) {
      for (i = 0; i < n; i++) out.push(((v1[i] || 0) - (v0[i] || 0)) / dur);
    } else {
      for (i = 0; i < n; i++) out.push(1 / dur); // shapes etc.: overall progress
    }
    return out;
  }

  // Ease one side of key k, keeping the other side as it plays.
  function easeSide(p, k, isOut, eases) {
    var inType = p.keyInInterpolationType(k), outType = p.keyOutInterpolationType(k);
    var inEase = p.keyInTemporalEase(k), outEase = p.keyOutTemporalEase(k);
    if (p.keyTemporalContinuous(k)) p.setTemporalContinuousAtKey(k, false);
    if (isOut) {
      p.setTemporalEaseAtKey(k, inEase, eases);
      p.setInterpolationTypeAtKey(k, inType, BEZIER);
    } else {
      p.setTemporalEaseAtKey(k, eases, outEase);
      p.setInterpolationTypeAtKey(k, BEZIER, outType);
    }
  }

  // Ease the selected pairs. side: "both" | "out" | "in". Returns the number of pairs eased.
  function applyCurve(c, side) {
    var pairs = selectedPairs(), n = 0;
    if (!pairs.length) return 0;
    var e = toEases(c);
    app.beginUndoGroup("PFlow: Apply Curve");
    try {
      for (var i = 0; i < pairs.length; i++) {
        var p = pairs[i].prop, a = pairs[i].key;
        try {
          var s = slopes(p, a);
          if (!s) continue;
          var outE = [], inE = [];
          for (var d = 0; d < s.length; d++) {
            outE.push(new KeyframeEase(e.outSpeed * s[d], e.outInfluence));
            inE.push(new KeyframeEase(e.inSpeed * s[d], e.inInfluence));
          }
          if (side !== "in") easeSide(p, a, true, outE);
          if (side !== "out") easeSide(p, a + 1, false, inE);
          n++;
        } catch (err) {
          // a property that refuses (locked layer, ...) is skipped; the others still get eased
        }
      }
    } finally {
      app.endUndoGroup();
    }
    return n;
  }

  // The curve of the first selected pair (measured on the dimension that moves most).
  function captureCurve() {
    var pairs = selectedPairs();
    if (!pairs.length) return null;
    var p = pairs[0].prop, a = pairs[0].key;
    if (p.keyOutInterpolationType(a) === HOLD) return null;
    var s = slopes(p, a);
    if (!s) return null;
    var d = 0, i;
    for (i = 1; i < s.length; i++) if (Math.abs(s[i]) > Math.abs(s[d])) d = i;
    if (Math.abs(s[d]) < 1e-12) return null;
    var o = p.keyOutTemporalEase(a), n = p.keyInTemporalEase(a + 1);
    var oe = o[d] || o[0], ne = n[d] || n[0];
    if (!oe || !ne) return null;
    return fromEases({ outInfluence: oe.influence, outSpeed: oe.speed / s[d], inInfluence: ne.influence, inSpeed: ne.speed / s[d] });
  }

  // ------------------------------------------------------------------ panel

  var EFFECTCRAFT = ScriptUI.frameworkName === "EffectCraft" || /EffectCraft/i.test(String(app.version));
  var BG = [0.133, 0.133, 0.133, 1];
  var GRID = [0.19, 0.19, 0.19, 1];
  var HOVER = [0.21, 0.21, 0.21, 1];
  var PRESSED = [0.10, 0.10, 0.10, 1];
  var BLUE = [0.18, 0.55, 0.94, 1];
  var BLUE_DOWN = [0.12, 0.40, 0.72, 1];
  var WHITE = [0.94, 0.94, 0.93, 1];
  var MUTED = [0.57, 0.57, 0.57, 1];
  var YELLOW = [1, 0.75, 0.16, 1];
  var THUMBNAIL = [0.77, 0.77, 0.77, 1];
  var fontCache = {}, colorCache = {}, graphicsCaches = [], lastGraphics = null, lastResources = null;
  var galleryDrawing = null, graphDrawing = null;
  var ui = thisObj instanceof Panel ? thisObj : new Window("palette", "PFlow", undefined, { resizeable: true });
  ui.margins = 0;
  ui.spacing = 0;
  // EffectCraft currently does not send dock-resize events back to JavaScript.
  // A compact published root avoids forcing its outer scroll area to 744 x 458.
  var initialSize = EFFECTCRAFT && thisObj instanceof Panel ? [480, 340] : [744, 458];
  ui.preferredSize = initialSize;
  ui.size = initialSize;
  ui.minimumSize = [360, 260];

  var user = loadUser();
  var working = BUILT_IN[3].curve.slice(0);
  var selectedName = "Ease", dragging = -1, applySide = "both", live = false;
  var viewLo = 0, viewHi = 1, tiles = [], columns = 7, tileWidth = 49, pageRows = 5;
  var buttons = [], hoverTile = -1, pressedTile = -1, galleryGesture = null, scrollGesture = null;
  var ignoreGalleryClick = false, trackingPointer = false;
  var graph = ui.add("group", undefined, undefined, { name: "graph" });
  graph.helpTip = "Drag the yellow handles. Shift snaps to 0.05. Double-click resets to Linear.";
  var values = button("values", "", "Edit x1, y1, x2, y2 or paste a CSS cubic-bezier()", function () {
    var text = prompt("Curve coordinates (x1, y1, x2, y2):", working.join(", "), "PFlow - Edit curve");
    if (text === null) return;
    var c = parseCurve(text);
    if (c) setCurve(c); else message("Enter four curve coordinates");
  });
  var library = ui.add("dropdownlist", undefined, ["default", "custom", "all"], { name: "library" });
  library.selection = 0;
  library.helpTip = "Choose the built-in or your saved preset library";
  var gallery = ui.add("group", undefined, undefined, { name: "presets" });
  gallery.helpTip = "Click a curve to load it. Double-click to apply. Double-click a custom preset to rename it with Alt held.";
  // EffectCraft renders native scrollbars as horizontal sliders, even in a tall rectangle.
  var scroll = ui.add("group", undefined, undefined, { name: "presetScroll" });
  scroll.value = 0; scroll.maxvalue = 0;
  scroll.helpTip = "Drag to scroll presets; click the arrows to move one row";
  var status = ui.add("statictext", undefined, "", { name: "status" });
  status.graphics.foregroundColor = pen(status.graphics, MUTED);

  function drawingColor(color) {
    if (!EFFECTCRAFT) return color;
    // EffectCraft's egui renderer interprets drawing colors as linear RGB, unlike Adobe.
    var key = color.join(",");
    if (colorCache[key]) return colorCache[key];
    var out = [0, 0, 0, color.length > 3 ? color[3] : 1];
    for (var i = 0; i < 3; i++) out[i] = color[i] <= 0.04045 ? color[i] / 12.92 : Math.pow((color[i] + 0.055) / 1.055, 2.4);
    colorCache[key] = out;
    return out;
  }
  function resources(g) {
    if (g === lastGraphics) return lastResources;
    var entry = null;
    for (var i = 0; i < graphicsCaches.length; i++) if (graphicsCaches[i].graphics === g) { entry = graphicsCaches[i]; break; }
    if (!entry) { entry = { graphics: g, pens: {}, brushes: {} }; graphicsCaches.push(entry); }
    lastGraphics = g; lastResources = entry;
    return entry;
  }
  function font(size) {
    if (!fontCache[size]) fontCache[size] = ScriptUI.newFont("Arial", "REGULAR", size);
    return fontCache[size];
  }
  function brush(g, color) {
    var cache = resources(g).brushes, key = color.join(",");
    if (!cache[key]) cache[key] = g.newBrush(g.BrushType.SOLID_COLOR, drawingColor(color));
    return cache[key];
  }
  function pen(g, color, width) {
    width = width || 1;
    var cache = resources(g).pens, key = color.join(",") + ":" + width;
    if (!cache[key]) cache[key] = g.newPen(g.PenType.SOLID_COLOR, drawingColor(color), width);
    return cache[key];
  }
  function fill(g, color, x, y, w, h) {
    g.newPath(); g.rectPath(x, y, w, h);
    g.fillPath(brush(g, color));
  }
  function line(g, color, x1, y1, x2, y2, width) {
    g.newPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.strokePath(pen(g, color, width));
  }
  function dot(g, color, x, y, radius) {
    g.newPath(); g.ellipsePath(x - radius, y - radius, radius * 2, radius * 2);
    g.fillPath(brush(g, color));
  }
  function label(g, text, color, x, y, size) {
    g.drawString(text, pen(g, color), x, y, font(size || 10));
  }
  function repaint(control) {
    // EffectCraft snapshots every onDraw after dispatch. notify() would run the same
    // drawing code a second time with no recorder, adding latency but no visible frame.
    if (EFFECTCRAFT) return;
    try { control.notify("onDraw"); } catch (e) {}
  }
  function message(text) { status.text = text; status.helpTip = text; }

  function polygon(g, color, points) {
    g.newPath();
    for (var i = 0; i < points.length; i++) {
      if (!i) g.moveTo(points[i][0], points[i][1]); else g.lineTo(points[i][0], points[i][1]);
    }
    g.closePath(); g.fillPath(brush(g, color));
  }
  function drawIcon(g, icon, color, x, y) {
    var i, points = [];
    if (icon === "star") {
      for (i = 0; i < 10; i++) {
        var a = -Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? 3 : 7;
        points.push([x + Math.cos(a) * r, y + Math.sin(a) * r]);
      }
      polygon(g, color, points);
    } else if (icon === "out" || icon === "in") {
      var d = icon === "out" ? -1 : 1;
      polygon(g, color, [[x - 3 * d, y - 5], [x + 2 * d, y], [x - 3 * d, y + 5], [x + 1 * d, y + 5], [x + 6 * d, y], [x + 1 * d, y - 5]]);
    } else if (icon === "both") {
      polygon(g, color, [[x - 5, y - 5], [x + 5, y - 5], [x + 1, y], [x + 5, y + 5], [x - 5, y + 5], [x - 1, y]]);
    } else if (icon === "add") {
      line(g, color, x - 4, y, x + 4, y, 1.5); line(g, color, x, y - 4, x, y + 4, 1.5);
    } else if (icon === "capture") {
      line(g, color, x - 6, y, x + 1, y, 1.5);
      line(g, color, x - 2, y - 4, x + 2, y, 1.5); line(g, color, x - 2, y + 4, x + 2, y, 1.5);
      line(g, color, x + 5, y - 5, x + 5, y + 5, 1.5);
    } else if (icon === "rename") {
      polygon(g, color, [[x - 5, y + 5], [x - 4, y + 1], [x + 2, y - 5], [x + 5, y - 2], [x - 1, y + 4]]);
      line(g, BG, x, y - 3, x + 3, y, 1);
    } else if (icon === "flip") {
      line(g, color, x - 6, y - 3, x + 5, y - 3, 1.3);
      line(g, color, x + 2, y - 6, x + 5, y - 3, 1.3);
      line(g, color, x + 5, y - 3, x + 2, y, 1.3);
      line(g, color, x + 6, y + 3, x - 5, y + 3, 1.3);
      line(g, color, x - 2, y, x - 5, y + 3, 1.3);
      line(g, color, x - 5, y + 3, x - 2, y + 6, 1.3);
    } else if (icon === "live") {
      line(g, color, x, y - 6, x, y + 1, 1.5);
      g.newPath();
      for (i = 0; i <= 24; i++) {
        var angle = -Math.PI / 3 + i * (5 * Math.PI / 3) / 24;
        var px = x + Math.sin(angle) * 5, py = y - Math.cos(angle) * 5;
        if (!i) g.moveTo(px, py); else g.lineTo(px, py);
      }
      g.strokePath(pen(g, color, 1.3));
    } else if (icon === "delete") {
      line(g, color, x - 5, y - 3, x + 5, y - 3, 1.3);
      line(g, color, x - 2, y - 5, x + 2, y - 5, 1.3);
      line(g, color, x - 4, y - 2, x - 3, y + 6, 1.3);
      line(g, color, x - 3, y + 6, x + 3, y + 6, 1.3);
      line(g, color, x + 3, y + 6, x + 4, y - 2, 1.3);
      line(g, color, x - 1, y, x - 1, y + 4, 1);
      line(g, color, x + 1, y, x + 1, y + 4, 1);
    }
  }
  function displayCurve(c) {
    var out = [];
    for (var i = 0; i < 4; i++) out.push(c[i].toFixed(2));
    return out.join(", ");
  }
  function button(name, icon, tip, action) {
    var b = ui.add("group", undefined, undefined, { name: name });
    buttons.push(b);
    b.helpTip = tip; b.hovered = false; b.pressed = false; b.cancelClick = false;
    b.onDraw = function () {
      var g = this.graphics, w = this.size.width, h = this.size.height;
      if (name === "apply") fill(g, this.pressed ? BLUE_DOWN : BLUE, 0, 0, w, h);
      else if (this.pressed || this.hovered) fill(g, this.pressed ? PRESSED : HOVER, 1, 1, w - 2, h - 2);
      var color = this.activeState ? BLUE : WHITE, cx = w / 2, cy = h / 2 + (this.pressed ? 1 : 0);
      if (name === "apply" || name === "values") {
        var text = name === "values" ? displayCurve(working) : "APPLY";
        var textFont = font(name === "values" ? 10 : 12);
        if (!b.textMetrics || b.textMetrics.text !== text) b.textMetrics = { text: text, extent: g.measureString(text, textFont) };
        var extent = b.textMetrics.extent;
        g.drawString(text, pen(g, color), Math.max(0, (w - extent[0]) / 2), cy - extent[1] / 2, textFont);
      } else drawIcon(g, icon, color, cx, cy);
    };
    b.addEventListener("mouseover", function () { if (!b.hovered) { b.hovered = true; repaint(b); } });
    b.addEventListener("mousedown", function (e) {
      if (e.button && e.button !== 0) return;
      b.cancelClick = false; b.pressed = true; repaint(b);
    });
    b.addEventListener("mouseup", function () { if (b.pressed) { b.pressed = false; repaint(b); } });
    b.addEventListener("mouseout", function () {
      if (b.pressed) b.cancelClick = true;
      if (b.hovered || b.pressed) { b.hovered = false; b.pressed = false; repaint(b); }
    });
    b.addEventListener("click", function () { if (!b.cancelClick) action(); });
    return b;
  }

  var fromKeys = button("fromKeys", "capture", "Read the curve from selected keyframes", function () {
    var c = captureCurve();
    if (!c) { message("Select two neighbouring keyframes whose value changes"); return; }
    setCurve(c, true);
    message("Read the curve of the selected keyframes");
  });
  var saveButton = button("save", "star", "Save the current curve as a custom preset", saveCurrent);
  var outButton = button("out", "out", "Apply to the outgoing side of the first key", function () { chooseSide("out"); });
  var bothButton = button("both", "both", "Apply to both sides", function () { chooseSide("both"); });
  var inButton = button("in", "in", "Apply to the incoming side of the second key", function () { chooseSide("in"); });
  var applyButton = button("apply", "APPLY", "Apply the curve to selected neighbouring keyframes", applyNow);
  var addButton = button("add", "add", "Save a custom preset", saveCurrent);
  var renameButton = button("rename", "rename", "Rename the selected custom preset", renameCurrent);
  var flipButton = button("flip", "flip", "Reverse the curve", function () { setCurve(mirrored(working)); });
  var liveButton = button("live", "live", "Toggle Live: apply after editing a curve or choosing a preset", function () {
    live = !live; liveButton.activeState = live; repaint(liveButton);
    message(live ? "Live on: curve edits apply to selected keys" : "Live off: press APPLY to ease selected keys");
  });
  var deleteButton = button("delete", "delete", "Delete the selected custom preset", deleteCurrent);

  function chooseSide(side) {
    applySide = side;
    outButton.activeState = side === "out";
    bothButton.activeState = side === "both";
    inButton.activeState = side === "in";
    repaint(outButton); repaint(bothButton); repaint(inButton);
  }

  function toScreen(x, y) {
    return [4 + (graph.size.width - 8) * x, 19 + (graph.size.height - 38) * (viewHi - y) / (viewHi - viewLo)];
  }
  function fromScreen(x, y) {
    return [(x - 4) / (graph.size.width - 8), viewHi - (y - 19) * (viewHi - viewLo) / (graph.size.height - 38)];
  }
  function fitCurve() {
    viewLo = Math.min(0, working[1], working[3]);
    viewHi = Math.max(1, working[1], working[3]);
    if (viewLo < 0) viewLo -= 0.08;
    if (viewHi > 1) viewHi += 0.08;
  }
  function curvePath(g, c, x, y, w, h, lo, hi, samples) {
    var path = g.newPath();
    for (var i = 0; i <= samples; i++) {
      var t = i / samples, u = 1 - t;
      var px = 3 * u * u * t * c[0] + 3 * u * t * t * c[2] + t * t * t;
      var py = 3 * u * u * t * c[1] + 3 * u * t * t * c[3] + t * t * t;
      px = x + px * w; py = y + (hi - py) * h / (hi - lo);
      if (i === 0) g.moveTo(px, py); else g.lineTo(px, py);
    }
    return path;
  }

  graph.onDraw = function () {
    var g = this.graphics, w = this.size.width, h = this.size.height;
    for (var i = 0; i <= 5; i++) {
      var p = toScreen(i / 5, i / 5);
      line(g, GRID, p[0], 0, p[0], h);
      line(g, GRID, 0, p[1], w, p[1]);
    }
    var start = toScreen(0, 0), end = toScreen(1, 1);
    line(g, BLUE, start[0], end[1], start[0], start[1]);
    line(g, BLUE, start[0], start[1], end[0], start[1]);
    var h1 = toScreen(working[0], working[1]), h2 = toScreen(working[2], working[3]);
    line(g, YELLOW, start[0], start[1], h1[0], h1[1], 1.5);
    line(g, YELLOW, end[0], end[1], h2[0], h2[1], 1.5);
    var key = working.join(",") + ":" + w + ":" + h + ":" + viewLo + ":" + viewHi;
    if (!graphDrawing || graphDrawing.key !== key) {
      graphDrawing = { key: key, path: curvePath(g, working, 4, 19, w - 8, h - 38, viewLo, viewHi, 96) };
    }
    g.strokePath(pen(g, WHITE, 2.7), graphDrawing.path);
    dot(g, YELLOW, h1[0], h1[1], 4);
    dot(g, YELLOW, h2[0], h2[1], 4);
  };

  function matches(a, b) {
    for (var i = 0; i < 4; i++) if (Math.abs(a[i] - b[i]) > 0.0001) return false;
    return true;
  }
  function setCurve(c, silent) {
    working = c.slice(0);
    repaint(values);
    var all = BUILT_IN.concat(user), found = "";
    for (var i = 0; i < all.length; i++) {
      if (matches(all[i].curve, working)) {
        found = all[i].name;
        if (found === selectedName) break;
      }
    }
    selectedName = found;
    fitCurve(); repaint(graph); repaint(gallery);
    if (!silent && live) applyNow();
  }

  function moveHandle(e) {
    var p = fromScreen(e.clientX, e.clientY), c = working.slice(0);
    if (e.shiftKey) { p[0] = Math.round(p[0] * 20) / 20; p[1] = Math.round(p[1] * 20) / 20; }
    c[dragging * 2] = p[0]; c[dragging * 2 + 1] = p[1];
    c = sane(c);
    var changed = false;
    for (var i = 0; i < 4; i++) if (c[i] !== working[i]) { changed = true; break; }
    if (!changed) return;
    var hadSelection = selectedName !== "", oldText = displayCurve(working);
    working = c; selectedName = "";
    if (displayCurve(working) !== oldText) repaint(values);
    // Keep the viewport fixed until release so overshoot handles do not chase the pointer.
    repaint(graph);
    if (hadSelection) repaint(gallery);
  }
  graph.addEventListener("mousedown", function (e) {
    if (e.detail >= 2) { dragging = -1; setCurve(BUILT_IN[0].curve); return; }
    var a = toScreen(working[0], working[1]), b = toScreen(working[2], working[3]);
    var da = Math.pow(e.clientX - a[0], 2) + Math.pow(e.clientY - a[1], 2);
    var db = Math.pow(e.clientX - b[0], 2) + Math.pow(e.clientY - b[1], 2);
    if (Math.min(da, db) <= 22 * 22) {
      dragging = da <= db ? 0 : 1;
      graph.removeEventListener("mousemove", moveGraphPointer);
      graph.addEventListener("mousemove", moveGraphPointer);
      moveHandle(e);
    }
  });
  function moveGraphPointer(e) { if (dragging >= 0) moveHandle(e); }
  function startPointerTracking() {
    if (trackingPointer) return;
    trackingPointer = true;
    ui.addEventListener("mousemove", trackPointer);
  }
  // Ancestor mousemove subscriptions make EffectCraft dispatch and snapshot even
  // over idle toolbar buttons. Only subscribe while a scroll gesture needs them.
  function trackPointer(e) {
    if (scrollGesture && finite(e.screenY)) {
      var track = scrollMetrics();
      setScroll(scrollGesture.row + (e.screenY - scrollGesture.y) * scroll.maxvalue / Math.max(1, track.travel));
    }
    if (galleryGesture && finite(e.screenY)) dragGallery(e.screenY - galleryGesture.y);
  }
  function dragGallery(dy) {
    if (Math.abs(dy) <= 5) return;
    var clearHighlight = pressedTile !== -1 || hoverTile !== -1, oldRow = scroll.value;
    ignoreGalleryClick = true; pressedTile = -1; hoverTile = -1;
    setScroll(galleryGesture.row - dy / 63);
    if (clearHighlight && oldRow === scroll.value) repaint(gallery);
  }
  function releaseControls(cancel) {
    if (trackingPointer) { ui.removeEventListener("mousemove", trackPointer); trackingPointer = false; }
    graph.removeEventListener("mousemove", moveGraphPointer);
    for (var i = 0; i < buttons.length; i++) {
      if (buttons[i].pressed) {
        buttons[i].pressed = false;
        if (cancel) buttons[i].cancelClick = true;
        repaint(buttons[i]);
      }
    }
    var hadScrollGesture = scrollGesture !== null, hadPressedTile = pressedTile !== -1;
    scrollGesture = null; galleryGesture = null; pressedTile = -1;
    if (hadPressedTile) repaint(gallery);
    if (hadScrollGesture) repaint(scroll);
    if (dragging >= 0) { dragging = -1; setCurve(working, cancel); }
  }
  ui.addEventListener("mouseup", function () { releaseControls(false); });
  ui.onDeactivate = function () { releaseControls(true); };

  function shortName(name) {
    if (name === "Linear") return "linear";
    if (name === "Ease (CSS)") return "easeCSS";
    if (name === "Standard (Material)") return "material";
    if (name === "Ease In") return "easeIn";
    if (name === "Ease Out") return "easeOut";
    if (name === "Ease") return "ease";
    var m = name.match(/^(Sine|Quad|Cubic|Quart|Quint|Expo|Circ|Back) (In-Out|In|Out)$/);
    return m ? m[1].toLowerCase() + (m[2] === "In-Out" ? "" : m[2]) : name;
  }
  function visiblePresets() {
    var mode = library.selection ? library.selection.index : 0;
    if (mode === 1) return user.slice(0);
    // Put the familiar CSS and power families first, as in the compact preset palette.
    var ordered = [], extras = [], i;
    for (i = 0; i < BUILT_IN.length; i++) {
      var n = BUILT_IN[i].name;
      if (n === "Ease (CSS)" || n === "Standard (Material)" || n.indexOf("Sine ") === 0) extras.push(BUILT_IN[i]);
      else ordered.push(BUILT_IN[i]);
    }
    return mode === 2 ? ordered.concat(extras).concat(user) : ordered;
  }
  function setScroll(value) {
    var next = clamp(Math.round(value), 0, scroll.maxvalue);
    if (next === scroll.value) return;
    scroll.value = next;
    hoverTile = -1;
    repaint(gallery); repaint(scroll);
  }
  function updateGallery(reset) {
    galleryDrawing = null;
    tiles = visiblePresets();
    columns = Math.max(1, Math.floor(gallery.size.width / 49));
    tileWidth = gallery.size.width / columns;
    pageRows = Math.max(1, Math.floor(gallery.size.height / 63));
    scroll.maxvalue = Math.max(0, Math.ceil(tiles.length / columns) - pageRows);
    scroll.enabled = scroll.maxvalue > 0;
    scroll.visible = scroll.maxvalue > 0;
    pressedTile = -1; galleryGesture = null; scrollGesture = null;
    scroll.value = clamp(Math.round(reset ? 0 : scroll.value), 0, scroll.maxvalue);
    hoverTile = -1;
    repaint(gallery); repaint(scroll);
  }
  function scrollMetrics() {
    var height = Math.max(1, scroll.size.height - 28);
    var rows = Math.max(1, Math.ceil(tiles.length / columns));
    var thumb = Math.min(height, Math.max(20, height * pageRows / rows));
    return { top: 14, height: height, thumb: thumb, travel: height - thumb };
  }
  scroll.onDraw = function () {
    if (!scroll.maxvalue) return;
    var g = this.graphics, w = this.size.width, h = this.size.height, m = scrollMetrics();
    var cx = w / 2, y = m.top + m.travel * scroll.value / scroll.maxvalue;
    polygon(g, MUTED, [[cx - 3, 8], [cx, 4], [cx + 3, 8]]);
    polygon(g, MUTED, [[cx - 3, h - 8], [cx, h - 4], [cx + 3, h - 8]]);
    fill(g, GRID, cx - 1, m.top, 2, m.height);
    fill(g, scrollGesture ? BLUE : MUTED, cx - 2, y, 4, m.thumb);
  };
  scroll.addEventListener("mousedown", function (e) {
    if (e.button && e.button !== 0) return;
    if (!scroll.maxvalue) return;
    var m = scrollMetrics(), y = e.clientY;
    if (y < 14) { setScroll(scroll.value - 1); return; }
    if (y >= scroll.size.height - 14) { setScroll(scroll.value + 1); return; }
    var thumbTop = m.top + m.travel * scroll.value / scroll.maxvalue;
    if (y < thumbTop || y > thumbTop + m.thumb) setScroll((y - m.top - m.thumb / 2) * scroll.maxvalue / Math.max(1, m.travel));
    scrollGesture = { row: scroll.value, y: finite(e.screenY) ? e.screenY : e.clientY, local: e.clientY };
    startPointerTracking();
    repaint(scroll);
  });
  scroll.addEventListener("mousemove", function (e) {
    if (!scrollGesture || finite(e.screenY)) return;
    var m = scrollMetrics();
    setScroll(scrollGesture.row + (e.clientY - scrollGesture.local) * scroll.maxvalue / Math.max(1, m.travel));
  });
  scroll.addEventListener("mouseup", function () { if (scrollGesture) { scrollGesture = null; repaint(scroll); } });
  function galleryGeometry(g) {
    var first = scroll.value * columns;
    var key = first + ":" + gallery.size.width + ":" + gallery.size.height + ":" + columns + ":" + pageRows;
    if (galleryDrawing && galleryDrawing.key === key) return galleryDrawing.items;
    var items = [], textFont = font(9);
    for (var i = first; i < Math.min(tiles.length, first + pageRows * columns); i++) {
      var p = tiles[i], slot = i - first;
      var x = (slot % columns) * tileWidth, y = Math.floor(slot / columns) * 63;
      var c = p.curve, lo = Math.min(0, c[1], c[3]), hi = Math.max(1, c[1], c[3]);
      var pw = tileWidth - 14, ph = 36, gx = x + 7, gy = y + 5;
      var hx1 = gx + c[0] * pw, hy1 = gy + ph * (hi - c[1]) / (hi - lo);
      var hx2 = gx + c[2] * pw, hy2 = gy + ph * (hi - c[3]) / (hi - lo);
      var arms = g.newPath();
      g.moveTo(gx, gy + ph * hi / (hi - lo)); g.lineTo(hx1, hy1);
      g.moveTo(gx + pw, gy + ph * (hi - 1) / (hi - lo)); g.lineTo(hx2, hy2);
      var dots = g.newPath();
      g.ellipsePath(hx1 - 1.2, hy1 - 1.2, 2.4, 2.4);
      g.ellipsePath(hx2 - 1.2, hy2 - 1.2, 2.4, 2.4);
      var text = shortName(p.name);
      var extent = g.measureString(text, textFont);
      while (text.length > 1 && extent[0] > tileWidth - 4) {
        text = text.substring(0, text.length - 1); extent = g.measureString(text, textFont);
      }
      // A 36px thumbnail needs far fewer segments than the main editor. Keep paths
      // immutable and replay them each snapshot; skipping paint would erase the art.
      items.push({ index: i, name: p.name, x: x, y: y, arms: arms, dots: dots,
        curve: curvePath(g, c, gx, gy, pw, ph, lo, hi, 24),
        text: text, textX: x + (tileWidth - extent[0]) / 2 });
    }
    galleryDrawing = { key: key, items: items };
    return items;
  }
  gallery.onDraw = function () {
    var g = this.graphics, items = galleryGeometry(g), textFont = font(9);
    for (var i = 0; i < items.length; i++) {
      var item = items[i], selected = item.name === selectedName;
      if (selected || item.index === hoverTile || item.index === pressedTile) {
        var tileColor = item.index === pressedTile ? BLUE_DOWN : (selected ? BLUE : HOVER);
        fill(g, tileColor, item.x + 2, item.y + 1, tileWidth - 4, 45);
      }
      var color = selected ? WHITE : THUMBNAIL;
      g.strokePath(pen(g, MUTED), item.arms);
      g.strokePath(pen(g, color, 1.3), item.curve);
      g.fillPath(brush(g, color), item.dots);
      g.drawString(item.text, pen(g, selected ? WHITE : MUTED), item.textX, item.y + 47, textFont);
    }
    if (!tiles.length) label(g, "Use + or the star to save a curve", MUTED, 10, 16, 11);
  };
  function tileAt(e) {
    var col = Math.floor(e.clientX / tileWidth), row = Math.floor(e.clientY / 63);
    if (col < 0 || col >= columns || row < 0 || row >= pageRows) return -1;
    var index = (scroll.value + row) * columns + col;
    return index < tiles.length ? index : -1;
  }
  gallery.addEventListener("mousemove", function (e) {
    if (galleryGesture) {
      dragGallery(finite(e.screenY) ? e.screenY - galleryGesture.y : e.clientY - galleryGesture.local);
      if (ignoreGalleryClick) return;
    }
    var index = tileAt(e);
    if (hoverTile !== index) {
      hoverTile = index;
      if (index >= 0) gallery.helpTip = tiles[index].name + ": " + curveText(tiles[index].curve);
      repaint(gallery);
    }
  });
  gallery.addEventListener("mouseout", function () { if (hoverTile !== -1) { hoverTile = -1; repaint(gallery); } });
  gallery.addEventListener("mousedown", function (e) {
    if (e.button && e.button !== 0) return;
    ignoreGalleryClick = false; pressedTile = tileAt(e);
    galleryGesture = { row: scroll.value, y: finite(e.screenY) ? e.screenY : e.clientY, local: e.clientY };
    startPointerTracking();
    repaint(gallery);
  });
  gallery.addEventListener("mouseup", function () {
    galleryGesture = null;
    if (pressedTile !== -1) { pressedTile = -1; repaint(gallery); }
  });
  gallery.addEventListener("click", function (e) {
    if (ignoreGalleryClick) return;
    var index = tileAt(e), p = index < 0 ? null : tiles[index];
    if (!p) return;
    if (e.detail >= 2 && e.altKey && find(user, p.name) >= 0) {
      selectedName = p.name; setCurve(p.curve, true); renameCurrent(); return;
    }
    // The first click already loads a preset in Live mode; do not apply it again
    // when the host sends the second click of a double-click.
    var secondClick = e.detail >= 2 && selectedName === p.name;
    selectedName = p.name;
    setCurve(p.curve, secondClick);
    if (e.detail >= 2 && !live) applyNow();
    else if (!live) message(p.name + " - press APPLY to ease selected keys");
  });
  function wheelGallery(e) {
    var delta = finite(e.deltaY) ? e.deltaY : (finite(e.wheelDelta) ? -e.wheelDelta : 0);
    if (!delta || !scroll.maxvalue) return;
    var previous = scroll.value;
    setScroll(scroll.value + (delta > 0 ? 1 : -1));
    if (previous !== scroll.value && e.preventDefault) e.preventDefault();
    if (previous !== scroll.value && e.stopPropagation) e.stopPropagation();
  }
  // Current EffectCraft does not forward wheel events. Dragging and the track arrows
  // remain available there; hosts that dispatch wheel events can use them directly.
  try { gallery.addEventListener("mousewheel", wheelGallery); gallery.addEventListener("wheel", wheelGallery); } catch (e) {}
  library.onChange = function () { ignoreGalleryClick = false; updateGallery(true); };

  function applyNow() {
    var n = applyCurve(working, applySide);
    message(n ? "Eased " + n + " keyframe pair(s)" : "Select two or more neighbouring keyframes");
    return n;
  }
  function selectedUser() {
    var i = find(user, selectedName);
    return i < 0 ? null : user[i];
  }
  function persist(next) {
    try { saveUser(next); user = next; return true; }
    catch (e) { message("Could not save presets: " + e.message); return false; }
  }
  function saveCurrent() {
    var text = prompt("Save curve as:", selectedUser() ? selectedName : "My curve", "PFlow - Save preset");
    if (text === null) return;
    var name = cleanName(text);
    if (!name) { message("Use a preset name of 1 to " + MAX_NAME + " characters"); return; }
    if (find(BUILT_IN, name) >= 0) { message("That name belongs to a built-in preset"); return; }
    var next = user.slice(0), i = find(next, name);
    if (i >= 0 && !confirm("Replace the preset \"" + next[i].name + "\"?")) return;
    var entry = { name: name, curve: working.slice(0) };
    if (i >= 0) next[i] = entry; else next.push(entry);
    if (!persist(next)) return;
    selectedName = name; library.selection = 1; updateGallery(true);
    setScroll(Math.floor(find(user, name) / columns));
    message("Saved \"" + name + "\"");
  }
  function renameCurrent() {
    var p = selectedUser();
    if (!p) { message("Select a custom preset to rename"); return; }
    var text = prompt("New preset name:", p.name, "PFlow - Rename preset");
    if (text === null) return;
    var name = cleanName(text), other = name ? find(user, name) : -1;
    if (!name) { message("Use a preset name of 1 to " + MAX_NAME + " characters"); return; }
    if (find(BUILT_IN, name) >= 0 || (other >= 0 && user[other] !== p)) { message("A preset with that name already exists"); return; }
    var next = user.slice(0);
    next[find(user, p.name)] = { name: name, curve: p.curve.slice(0) };
    if (!persist(next)) return;
    selectedName = name; updateGallery(false); message("Renamed to \"" + name + "\"");
  }
  function deleteCurrent() {
    var p = selectedUser();
    if (!p) { message("Select a custom preset to delete"); return; }
    if (!confirm("Delete the preset \"" + p.name + "\"?")) return;
    var next = user.slice(0); next.splice(find(user, p.name), 1);
    if (!persist(next)) return;
    selectedName = ""; updateGallery(false); message("Deleted \"" + p.name + "\"");
  }

  function bounds(control, x, y, w, h) { control.bounds = [x, y, x + Math.max(1, w), y + Math.max(1, h)]; }
  function layoutPanel() {
    var w = Math.max(360, ui.size.width), h = Math.max(260, ui.size.height);
    var left = Math.floor(w / 2), right = w - left - 14, graphH = h - 56;
    bounds(graph, 0, 0, left, graphH);
    bounds(fromKeys, 4, graphH, 28, 26);
    bounds(values, 33, graphH, left - 66, 26);
    bounds(saveButton, left - 32, graphH, 28, 26);
    var modeW = Math.floor(left / 5.8), barY = h - 29;
    bounds(outButton, 0, barY, modeW, 29);
    bounds(bothButton, modeW, barY, modeW, 29);
    bounds(inButton, modeW * 2, barY, modeW, 29);
    bounds(applyButton, modeW * 3, barY, left - modeW * 3, 29);
    var x = left + 14, tools = [addButton, renameButton, flipButton, liveButton, deleteButton];
    bounds(library, x, 0, right - 110, 26);
    for (var i = 0; i < tools.length; i++) bounds(tools[i], w - 110 + i * 22, 0, 22, 26);
    bounds(gallery, x, 28, right - 12, h - 52);
    bounds(scroll, w - 10, 29, 9, h - 55);
    bounds(status, x + 3, h - 22, right - 8, 20);
    updateGallery(false); repaint(graph);
  }
  // An explicit layout manager keeps both docked and floating panels responsive without
  // native group margins or minimum button widths changing the reference's proportions.
  ui.layout = { layout: layoutPanel, resize: layoutPanel };
  ui.onResizing = ui.onResize = layoutPanel;
  chooseSide("both");
  setCurve(working, true);
  message("Select keyframes, choose a curve, press APPLY");
  if (ui instanceof Window) { layoutPanel(); ui.show(); }
  else layoutPanel();
})(this);

// "Assembly": the site background.
// Module tiles drift loose at the top of the landing page and settle into a
// lattice as the reader scrolls; circuit traces then connect them into flows and
// pulses of data run along the traces. Other pages open already assembled.
// A 2D canvas, no library. Reduced motion gets one still, assembled frame.
(function () {
  var canvas = document.getElementById('assembly');
  if (!canvas || !canvas.getContext) return;
  var ctx = canvas.getContext('2d');
  var scrollDriven = document.body.getAttribute('data-assembly') === 'scroll';
  var still = matchMedia('(prefers-reduced-motion: reduce)').matches;

  var CELL = 46, TILE = 14;
  var tiles = [], chains = [], W = 0, H = 0, dpr = 1;
  var ink = '#1d1d1f', accent = '#0071e3', dark = false;

  // A fixed seed keeps the pattern the same on every visit and every page.
  var seed;
  function rnd() { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }

  function readTheme() {
    var cs = getComputedStyle(document.documentElement);
    ink = cs.getPropertyValue('--ink').trim() || ink;
    accent = cs.getPropertyValue('--accent').trim() || accent;
    var surface = cs.getPropertyValue('--surface').trim();
    dark = /^#0|^#1/.test(surface);
  }

  function layout() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    seed = 20260925;
    var cols = Math.ceil(W / CELL) + 1, rows = Math.ceil(H / CELL) + 1;
    var ox = (W - (cols - 1) * CELL) / 2, oy = (H - (rows - 1) * CELL) / 2;
    var slots = {};
    tiles = []; chains = [];
    function slotXY(c, r) { return [ox + c * CELL, oy + r * CELL]; }
    function addTile(c, r, kind) {
      var key = c + ',' + r;
      if (slots[key]) { if (kind === 2) slots[key].kind = 2; return slots[key]; }
      var p = slotXY(c, r);
      var t = {
        gx: p[0], gy: p[1],
        sx: rnd() * W, sy: rnd() * H, sr: (rnd() - 0.5) * 2.4,
        delay: rnd(), phase: rnd() * 6.283, kind: kind
      };
      slots[key] = t; tiles.push(t); return t;
    }
    // Flows: orthogonal traces that run left to right across the lattice.
    var nChains = Math.max(4, Math.round(rows / 2.2));
    for (var k = 0; k < nChains; k++) {
      var c = Math.floor(rnd() * cols * 0.25), r = Math.floor(rnd() * rows);
      var pts = [slotXY(c, r)];
      addTile(c, r, 2);
      while (c < cols - 1) {
        c = Math.min(cols - 1, c + 2 + Math.floor(rnd() * 3));
        pts.push(slotXY(c, r));
        addTile(c, r, rnd() < 0.5 ? 2 : 1);
        if (rnd() < 0.6) {
          r = Math.max(0, Math.min(rows - 1, r + (rnd() < 0.5 ? -1 : 1) * (1 + Math.floor(rnd() * 2))));
          pts.push(slotXY(c, r));
          addTile(c, r, 1);
        }
      }
      var len = 0;
      for (var i = 1; i < pts.length; i++) len += Math.abs(pts[i][0] - pts[i - 1][0]) + Math.abs(pts[i][1] - pts[i - 1][1]);
      chains.push({ pts: pts, len: len, delay: rnd(), speed: 70 + rnd() * 60, offset: rnd() * len });
    }
    // Loose modules fill the rest of the lattice sparsely.
    for (var cc = 0; cc < cols; cc++) for (var rr = 0; rr < rows; rr++) if (rnd() < 0.2) addTile(cc, rr, rnd() < 0.08 ? 2 : 1);
  }

  function ease(t) { return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
  function progress() {
    if (!scrollDriven || still) return 1;
    return Math.min(1, window.scrollY / (window.innerHeight * 1.1));
  }
  function pointAt(ch, d) {
    for (var i = 1; i < ch.pts.length; i++) {
      var a = ch.pts[i - 1], b = ch.pts[i];
      var seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
      if (d <= seg) { var f = seg ? d / seg : 0; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]; }
      d -= seg;
    }
    return ch.pts[ch.pts.length - 1];
  }

  var shown = 0, last = performance.now(), clock = 0, visible = true;
  function draw(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now; clock += dt;
    // Ease toward the scroll target so the lattice glides rather than jumps.
    var goal = progress();
    shown += (goal - shown) * (still ? 1 : 1 - Math.exp(-dt * 5));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    // Traces draw in once the tiles have mostly settled.
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.strokeStyle = accent;
    for (var k = 0; k < chains.length; k++) {
      var ch = chains[k];
      var reveal = ease((shown - 0.55 - ch.delay * 0.25) / 0.2);
      if (reveal <= 0) continue;
      ctx.globalAlpha = dark ? 0.24 : 0.22;
      ctx.beginPath();
      var todo = ch.len * reveal;
      ctx.moveTo(ch.pts[0][0], ch.pts[0][1]);
      for (var i = 1; i < ch.pts.length && todo > 0; i++) {
        var a = ch.pts[i - 1], b = ch.pts[i];
        var seg = Math.abs(b[0] - a[0]) + Math.abs(b[1] - a[1]);
        var f = Math.min(1, todo / seg);
        ctx.lineTo(a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f);
        todo -= seg;
      }
      ctx.stroke();
      // A pulse of data runs the length of each finished trace.
      if (reveal >= 1 && !still) {
        var d = (ch.offset + clock * ch.speed) % (ch.len + 160);
        for (var s = 0; s < 6; s++) {
          var dd = d - s * 7;
          if (dd < 0 || dd > ch.len) continue;
          var p = pointAt(ch, dd);
          ctx.globalAlpha = (dark ? 0.9 : 0.75) * (1 - s / 6);
          ctx.fillStyle = accent;
          ctx.beginPath(); ctx.arc(p[0], p[1], 2.6 - s * 0.3, 0, 6.283); ctx.fill();
        }
      }
    }

    for (var t = 0; t < tiles.length; t++) {
      var tl = tiles[t];
      var e = ease((shown - tl.delay * 0.35) / 0.55);
      var wob = still ? 0 : (1 - e);
      var x = tl.sx + (tl.gx - tl.sx) * e + Math.sin(clock * 0.4 + tl.phase) * 10 * wob;
      var y = tl.sy + (tl.gy - tl.sy) * e + Math.cos(clock * 0.33 + tl.phase) * 10 * wob;
      var rot = tl.sr * (1 - e) + (still ? 0 : Math.sin(clock * 0.2 + tl.phase) * 0.2 * wob);
      ctx.save();
      ctx.translate(x, y); ctx.rotate(rot);
      if (tl.kind === 2) {
        ctx.globalAlpha = dark ? 0.55 : 0.4;
        ctx.fillStyle = accent;
      } else {
        ctx.globalAlpha = dark ? 0.12 : 0.08;
        ctx.fillStyle = ink;
      }
      var h = TILE / 2;
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(-h, -h, TILE, TILE, 3.5); else ctx.rect(-h, -h, TILE, TILE);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    if (!still && visible) requestAnimationFrame(draw);
  }

  readTheme();
  layout();
  shown = progress();
  var timer;
  window.addEventListener('resize', function () {
    clearTimeout(timer);
    timer = setTimeout(function () { layout(); if (still) draw(performance.now()); }, 150);
  });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () { readTheme(); if (still) draw(performance.now()); });
  window.addEventListener('sdn-theme', function () { readTheme(); if (still) draw(performance.now()); });
  document.addEventListener('visibilitychange', function () {
    visible = !document.hidden;
    if (visible && !still) { last = performance.now(); requestAnimationFrame(draw); }
  });
  requestAnimationFrame(draw);
})();

// Light / dark switcher. Follows the system until the reader picks.
(function () {
  function current() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'light' || t === 'dark') return t;
    return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  document.querySelectorAll('.theme-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      try { localStorage.setItem('sdn-theme', next); } catch (e) {}
      window.dispatchEvent(new Event('sdn-theme'));
    });
  });
})();

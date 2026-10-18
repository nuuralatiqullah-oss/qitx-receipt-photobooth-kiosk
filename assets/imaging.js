/* ============================================================
   IMAGING v2 — compose the frame, then turn it into 1-bit
   raster bytes the thermal printer understands.

   v2 changes (why prints were muddy):
   - Tone correction now runs PER PHOTO, not across the whole
     sheet. White paper + black text already span 0-255, so a
     sheet-wide stretch did nothing for the photo itself.
   - Atkinson dithering by default. It propagates only 6/8 of
     the error, so highlights stay white and shadows stay black
     instead of filling with grey mush.
   - Dot size: photos are dithered at reduced resolution and the
     1-bit result is scaled up with hard edges, so one "pixel"
     becomes a 2x2 or 3x3 block of dots. Thermal heat spreads
     into neighbouring dots, so single-dot detail bleeds into
     grey; fat dots survive. Text still prints at full 203 dpi.
   ============================================================ */
(function () {
  "use strict";

  const Imaging = {};

  /* ---------- small helpers ---------- */

  function drawCover(ctx, img, x, y, w, h) {
    const sw = img.width || img.videoWidth;
    const sh = img.height || img.videoHeight;
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  function toGray(imageData) {
    const d = imageData.data;
    const n = imageData.width * imageData.height;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      const a = d[p + 3] / 255;
      const r = d[p] * a + 255 * (1 - a);
      const gr = d[p + 1] * a + 255 * (1 - a);
      const b = d[p + 2] * a + 255 * (1 - a);
      g[i] = 0.299 * r + 0.587 * gr + 0.114 * b;
    }
    return g;
  }

  /* Percentile stretch. Run on ONE photo, never the whole sheet. */
  function autoLevels(g, loPct, hiPct) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) {
      hist[Math.max(0, Math.min(255, g[i] | 0))]++;
    }
    const total = g.length;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * loPct) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= total * hiPct) { hi = v; break; } }
    if (hi - lo < 8) return g;
    const scale = 255 / (hi - lo);
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      out[i] = Math.max(0, Math.min(255, (g[i] - lo) * scale));
    }
    return out;
  }

  /* gamma < 1 lightens midtones (counteracts thermal over-darkening) */
  function applyGamma(g, gamma) {
    if (!gamma || gamma === 1) return g;
    const lut = new Float32Array(256);
    for (let v = 0; v < 256; v++) lut[v] = 255 * Math.pow(v / 255, gamma);
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      out[i] = lut[Math.max(0, Math.min(255, g[i] | 0))];
    }
    return out;
  }

  function boxBlur(g, w, h, passes) {
    let src = g;
    for (let p = 0; p < passes; p++) {
      const tmp = new Float32Array(src.length);
      const out = new Float32Array(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          tmp[i] = ((x > 0 ? src[i - 1] : src[i]) + src[i] + (x < w - 1 ? src[i + 1] : src[i])) / 3;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          out[i] = ((y > 0 ? tmp[i - w] : tmp[i]) + tmp[i] + (y < h - 1 ? tmp[i + w] : tmp[i])) / 3;
        }
      }
      src = out;
    }
    return src;
  }

  /* Unsharp mask — puts back the edge definition that downsampling
     and blurring take away. This is what keeps faces readable. */
  function sharpen(g, w, h, amount) {
    if (!amount) return g;
    const blurred = boxBlur(g, w, h, 1);
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      out[i] = Math.max(0, Math.min(255, g[i] + amount * (g[i] - blurred[i])));
    }
    return out;
  }

  /* Local contrast. A face is mostly midtones, and midtones are where
     dither noise lives. This re-centres each region around its own
     local average, so a cheek and a beard separate into light and dark
     instead of both becoming 50% grey speckle. Biggest single win for
     perceived sharpness on thermal. */
  function localContrast(g, w, h, amount, radius) {
    if (!amount) return g;
    let base = g;
    const passes = Math.max(1, Math.round((radius || 12) / 4));
    for (let i = 0; i < passes; i++) base = boxBlur(base, w, h, 1);
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      // push each pixel away from its neighbourhood average
      out[i] = Math.max(0, Math.min(255, base[i] + (g[i] - base[i]) * (1 + amount)));
    }
    return out;
  }

  /* ---------- dithering ---------- */

  function ditherFloyd(g, w, h) {
    const bits = new Uint8Array(w * h);
    const buf = Float32Array.from(g);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const old = buf[i];
        const nw = old < 128 ? 0 : 255;
        bits[i] = nw === 0 ? 1 : 0;
        const err = old - nw;
        if (x + 1 < w) buf[i + 1] += err * 7 / 16;
        if (y + 1 < h) {
          if (x > 0) buf[i + w - 1] += err * 3 / 16;
          buf[i + w] += err * 5 / 16;
          if (x + 1 < w) buf[i + w + 1] += err * 1 / 16;
        }
      }
    }
    return bits;
  }

  /* Atkinson: only 6/8 of the error is passed on, so clean whites
     stay clean. Much better than Floyd-Steinberg on thermal paper. */
  function ditherAtkinson(g, w, h) {
    const bits = new Uint8Array(w * h);
    const buf = Float32Array.from(g);
    const put = (x, y, e) => {
      if (x < 0 || x >= w || y >= h) return;
      buf[y * w + x] += e;
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const old = buf[i];
        const nw = old < 128 ? 0 : 255;
        bits[i] = nw === 0 ? 1 : 0;
        const e = (old - nw) / 8;
        put(x + 1, y, e); put(x + 2, y, e);
        put(x - 1, y + 1, e); put(x, y + 1, e); put(x + 1, y + 1, e);
        put(x, y + 2, e);
      }
    }
    return bits;
  }

  function ditherOf(name) {
    return name === "floyd" ? ditherFloyd : ditherAtkinson;
  }

  /* ---------- photo -> hard black/white canvas ---------- */

  /**
   * Process one captured photo into a pure 1-bit canvas sized w x h.
   * o = { dotSize, gamma, autoLevels, sharpen, blurPasses, dither }
   */
  Imaging.processPhoto = function (img, w, h, o) {
    o = o || {};
    const dot = Math.max(1, Math.min(4, o.dotSize || 1));
    const lw = Math.max(1, Math.round(w / dot));
    const lh = Math.max(1, Math.round(h / dot));

    // Downsample first — the browser area-averages, which is exactly
    // the noise reduction a thermal head needs.
    const small = document.createElement("canvas");
    small.width = lw;
    small.height = lh;
    const sctx = small.getContext("2d");
    sctx.fillStyle = "#fff";
    sctx.fillRect(0, 0, lw, lh);
    drawCover(sctx, img, 0, 0, lw, lh);

    let g = toGray(sctx.getImageData(0, 0, lw, lh));
    if (o.blurPasses) g = boxBlur(g, lw, lh, o.blurPasses);
    if (o.autoLevels !== false) g = autoLevels(g, 0.02, 0.98);
    if (o.localContrast) g = localContrast(g, lw, lh, o.localContrast, o.localRadius || 12);
    if (o.sharpen) g = sharpen(g, lw, lh, o.sharpen);
    g = applyGamma(g, o.gamma == null ? 0.8 : o.gamma);

    const bits = ditherOf(o.dither)(g, lw, lh);

    // paint the 1-bit result
    const low = document.createElement("canvas");
    low.width = lw;
    low.height = lh;
    const lctx = low.getContext("2d");
    const id = lctx.createImageData(lw, lh);
    for (let i = 0; i < bits.length; i++) {
      const v = bits[i] ? 0 : 255;
      const p = i * 4;
      id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
      id.data[p + 3] = 255;
    }
    lctx.putImageData(id, 0, 0);

    if (dot === 1) return low;

    // scale up with hard edges: one pixel becomes a dot x dot block
    const big = document.createElement("canvas");
    big.width = w;
    big.height = h;
    const bctx = big.getContext("2d");
    bctx.imageSmoothingEnabled = false;
    bctx.drawImage(low, 0, 0, w, h);
    return big;
  };

  /* ---------- compose the printable sheet ---------- */

  Imaging.compose = function (frame, images, opts) {
    opts = opts || {};
    const targetW = opts.width || 576;
    const k = targetW / frame.width;
    const W = Math.round(frame.width * k);
    const H = Math.round(frame.height * k);
    const photoOpts = opts.photo || {};

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    frame.slots.forEach(function (s, i) {
      const img = images[i];
      if (!img) return;
      const x = Math.round(s.x * k), y = Math.round(s.y * k);
      const w = Math.round(s.w * k), h = Math.round(s.h * k);
      if (photoOpts.mode === "display") {
        // The keepsake copy: the photo as the camera saw it, in colour.
        // Only the print path gets turned into dots.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        drawCover(ctx, img, x, y, w, h);
      } else {
        const done = Imaging.processPhoto(img, w, h, photoOpts);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(done, x, y);
      }
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, Math.round(2 * k));
      ctx.strokeRect(x, y, w, h);
    });

    if (opts.overlay) ctx.drawImage(opts.overlay, 0, 0, W, H);

    if (frame.header && !opts.overlay) {
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";

      ctx.font = "bold " + Math.round(46 * k) + "px Georgia, serif";
      ctx.fillText(opts.header || "", W / 2, Math.round(70 * k));

      ctx.font = Math.round(26 * k) + "px Georgia, serif";
      ctx.fillText(opts.subheader || "", W / 2, Math.round(110 * k));

      const last = frame.slots[frame.slots.length - 1];
      const fy = (last.y + last.h) * k + Math.round(60 * k);
      ctx.font = Math.round(28 * k) + "px Georgia, serif";
      ctx.fillText(opts.footer || "", W / 2, fy);

      ctx.font = Math.round(22 * k) + "px monospace";
      ctx.fillText(opts.stamp || "", W / 2, fy + Math.round(40 * k));
    }

    return canvas;
  };

  /* ---------- sheet -> printer bitmap ---------- */

  /**
   * Photos are already 1-bit by this point, so this only has to
   * threshold the text and borders. No sheet-wide tone work —
   * that was what flattened the photos in v1.
   */
  Imaging.prepareForPrint = function (canvas, cfg) {
    cfg = cfg || {};
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const g = toGray(ctx.getImageData(0, 0, w, h));
    const cut = cfg.threshold == null ? 128 : cfg.threshold;

    let bits;
    if (cfg.ditherSheet) {
      bits = ditherOf(cfg.dither)(g, w, h);
    } else {
      bits = new Uint8Array(w * h);
      for (let i = 0; i < g.length; i++) bits[i] = g[i] < cut ? 1 : 0;
    }
    return { width: w, height: h, bits: bits };
  };

  /* ---------- settings test card ----------
     Prints the same shot at several settings on one strip so you can
     pick what looks best on real paper instead of guessing. */

  Imaging.TEST_VARIANTS = [
    { tag: "A", label: "dot 1  contrast 0.6", opts: { dotSize: 1, localContrast: 0.6, sharpen: 0.8 } },
    { tag: "B", label: "dot 2  contrast 0.6", opts: { dotSize: 2, localContrast: 0.6, sharpen: 0.8 } },
    { tag: "C", label: "dot 2  contrast 1.0", opts: { dotSize: 2, localContrast: 1.0, sharpen: 1.0 } },
    { tag: "D", label: "dot 3  contrast 0.8", opts: { dotSize: 3, localContrast: 0.8, sharpen: 1.0 } }
  ];

  Imaging.buildTestCard = function (img, width, base) {
    base = base || {};
    const W = width || 576;
    const m = Math.round(W * 0.035);          // side margin
    const tw = W - m * 2;                     // tile width
    const th = Math.round(tw * 0.75);         // 4:3 tiles
    const labelH = Math.round(W * 0.055);
    const headH = Math.round(W * 0.15);
    const vars = Imaging.TEST_VARIANTS;

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = headH + vars.length * (th + labelH + m) + m * 2;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#000";
    ctx.textAlign = "center";
    ctx.font = "bold " + Math.round(W * 0.062) + "px Georgia, serif";
    ctx.fillText("SETTINGS TEST", W / 2, Math.round(headH * 0.45));
    ctx.font = Math.round(W * 0.038) + "px monospace";
    ctx.fillText("pick the clearest one", W / 2, Math.round(headH * 0.72));

    let y = headH;
    vars.forEach(function (v) {
      ctx.fillStyle = "#000";
      ctx.textAlign = "left";
      ctx.font = "bold " + Math.round(W * 0.042) + "px monospace";
      ctx.fillText(v.tag + "  " + v.label, m, y + Math.round(labelH * 0.75));
      y += labelH;

      const opts = {
        dotSize: v.opts.dotSize,
        dither: base.dither || "atkinson",
        gamma: base.gamma == null ? 0.8 : base.gamma,
        autoLevels: base.autoLevels !== false,
        localContrast: v.opts.localContrast,
        sharpen: v.opts.sharpen,
        blurPasses: 0
      };
      const tile = Imaging.processPhoto(img, tw, th, opts);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(tile, m, y);
      ctx.strokeStyle = "#000";
      ctx.lineWidth = 2;
      ctx.strokeRect(m, y, tw, th);
      y += th + m;
    });

    return canvas;
  };

  /* ---------- printer diagnostic ----------
     Prints known patterns so a printer fault can be told apart from an
     image-processing problem. Read the result like this:

       - White streaks running DOWN the solid black bar, always in the
         same columns        -> dirty or failing print head elements
       - Solid bar fades or goes patchy TOWARDS THE BOTTOM
                             -> head overheating, or density too high
                                for the print speed
       - Dark patches (75-100%) look broken but light ones are fine
                             -> not enough energy per dot: raise density
                                and/or lower speed
       - Thin vertical lines with gaps
                             -> specific dead dots on the head
       - Everything clean    -> the printer is fine; it is the image
                                pipeline or the photo itself
  ---------------------------------------------------------------- */
  Imaging.buildDiagnostic = function (width) {
    const W = width || 576;
    const m = Math.round(W * 0.03);
    const canvas = document.createElement("canvas");
    const labelH = Math.round(W * 0.05);
    const barH = Math.round(W * 0.22);
    const patchH = Math.round(W * 0.09);
    const levels = [12, 25, 37, 50, 62, 75, 87, 100];
    canvas.width = W;
    canvas.height = Math.round(W * 0.17)            // title
      + labelH + barH + m                            // solid bar
      + labelH + levels.length * patchH + m          // density ladder
      + labelH + barH + m                            // fine lines
      + labelH + Math.round(W * 0.9) + m * 2;        // long fade bar
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#000";

    ctx.textAlign = "center";
    ctx.font = "bold " + Math.round(W * 0.058) + "px Georgia, serif";
    ctx.fillText("PRINTER DIAGNOSTIC", W / 2, Math.round(W * 0.085));
    ctx.font = Math.round(W * 0.032) + "px monospace";
    ctx.fillText("look for white streaks + fading", W / 2, Math.round(W * 0.13));

    ctx.textAlign = "left";
    const label = (t, y) => {
      ctx.font = "bold " + Math.round(W * 0.036) + "px monospace";
      ctx.fillText(t, m, y + Math.round(labelH * 0.7));
      return y + labelH;
    };

    let y = Math.round(W * 0.17);

    // 1. solid black — shows dirty head elements as white streaks
    y = label("1  SOLID BLACK  (streaks = dirty head)", y);
    ctx.fillRect(m, y, W - m * 2, barH);
    y += barH + m;

    // 2. density ladder — shows where dark tones break down
    y = label("2  DENSITY LADDER  12% -> 100%", y);
    const pw = W - m * 2;
    levels.forEach(function (pct) {
      const id = ctx.createImageData(pw, patchH);
      // ordered 4x4 pattern: exact, repeatable dot coverage
      const bayer = [0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5];
      for (let yy = 0; yy < patchH; yy++) {
        for (let xx = 0; xx < pw; xx++) {
          const t = bayer[(yy % 4) * 4 + (xx % 4)] / 16 * 100;
          const black = pct > t;
          const p = (yy * pw + xx) * 4;
          const v = black ? 0 : 255;
          id.data[p] = id.data[p + 1] = id.data[p + 2] = v;
          id.data[p + 3] = 255;
        }
      }
      ctx.putImageData(id, m, y);
      ctx.font = Math.round(W * 0.03) + "px monospace";
      ctx.fillStyle = "#fff";
      ctx.fillRect(m, y, Math.round(W * 0.12), Math.round(W * 0.045));
      ctx.fillStyle = "#000";
      ctx.fillText(pct + "%", m + 4, y + Math.round(W * 0.036));
      y += patchH;
    });
    y += m;

    // 3. single-dot lines — finds individual dead elements
    y = label("3  1-DOT LINES  (gaps = dead dots)", y);
    const id2 = ctx.createImageData(pw, barH);
    for (let yy = 0; yy < barH; yy++) {
      for (let xx = 0; xx < pw; xx++) {
        const vline = xx % 4 === 0;
        const hline = yy % 4 === 0;
        const black = yy < barH / 2 ? vline : hline;
        const p = (yy * pw + xx) * 4;
        const v = black ? 0 : 255;
        id2.data[p] = id2.data[p + 1] = id2.data[p + 2] = v;
        id2.data[p + 3] = 255;
      }
    }
    ctx.putImageData(id2, m, y);
    y += barH + m;

    // 4. long solid bar — reveals thermal fade down the length
    y = label("4  LONG BLACK  (fade = head too hot)", y);
    ctx.fillRect(m, y, pw, Math.round(W * 0.9));

    return canvas;
  };

  Imaging.bitsToCanvas = function (prepared) {
    const c = document.createElement("canvas");
    c.width = prepared.width;
    c.height = prepared.height;
    const ctx = c.getContext("2d");
    const img = ctx.createImageData(prepared.width, prepared.height);
    for (let i = 0; i < prepared.bits.length; i++) {
      const v = prepared.bits[i] ? 0 : 255;
      const p = i * 4;
      img.data[p] = img.data[p + 1] = img.data[p + 2] = v;
      img.data[p + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  };

  window.Imaging = Imaging;
})();

/* ============================================================
   TEMPLATE SLOT DETECTION
   A photobooth template is a PNG with holes punched where the
   photos go. This finds those holes by looking for connected
   see-through regions, so an operator can upload artwork without
   typing any coordinates.
   ============================================================ */
(function () {
  "use strict";

  /**
   * @param {HTMLImageElement|ImageBitmap} img  the template
   * @param {number} targetW  print width in dots (576 or 384)
   * @returns {{width,height,slots,coverage}} slots in print dots,
   *          ordered top to bottom then left to right
   */
  window.Imaging.detectSlots = function (img, targetW) {
    const W = targetW || 576;
    // Work small: detection doesn't need full resolution and a big
    // template would otherwise take seconds to flood fill.
    const dw = 320;
    const dh = Math.max(1, Math.round(img.height / img.width * dw));

    const c = document.createElement("canvas");
    c.width = dw;
    c.height = dh;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.clearRect(0, 0, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);
    const data = ctx.getImageData(0, 0, dw, dh).data;

    const clear = new Uint8Array(dw * dh);
    let clearCount = 0;
    for (let i = 0; i < dw * dh; i++) {
      if (data[i * 4 + 3] < 40) { clear[i] = 1; clearCount++; }
    }

    const out = { width: W, height: Math.round(img.height / img.width * W), slots: [],
                  coverage: clearCount / (dw * dh) };
    if (!clearCount) return out;

    // flood fill each see-through region, keep its bounding box
    const seen = new Uint8Array(dw * dh);
    const stack = new Int32Array(dw * dh);
    const boxes = [];
    const minArea = dw * dh * 0.012;

    for (let start = 0; start < dw * dh; start++) {
      if (!clear[start] || seen[start]) continue;
      let sp = 0;
      stack[sp++] = start;
      seen[start] = 1;
      let x0 = dw, y0 = dh, x1 = -1, y1 = -1, area = 0;

      while (sp > 0) {
        const p = stack[--sp];
        const x = p % dw, y = (p / dw) | 0;
        area++;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        if (x > 0 && clear[p - 1] && !seen[p - 1]) { seen[p - 1] = 1; stack[sp++] = p - 1; }
        if (x < dw - 1 && clear[p + 1] && !seen[p + 1]) { seen[p + 1] = 1; stack[sp++] = p + 1; }
        if (y > 0 && clear[p - dw] && !seen[p - dw]) { seen[p - dw] = 1; stack[sp++] = p - dw; }
        if (y < dh - 1 && clear[p + dw] && !seen[p + dw]) { seen[p + dw] = 1; stack[sp++] = p + dw; }
      }

      const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
      // Ignore specks, hairline gaps, and any region that is mostly
      // empty space inside its own box (a ragged cut-out, not a slot).
      if (area < minArea || bw < 16 || bh < 16) continue;
      if (area / (bw * bh) < 0.6) continue;
      boxes.push({ x: x0, y: y0, w: bw, h: bh });
    }

    boxes.sort((a, b) => (Math.abs(a.y - b.y) > 8 ? a.y - b.y : a.x - b.x));

    const k = W / dw;
    out.slots = boxes.map(b => ({
      x: Math.round(b.x * k),
      y: Math.round(b.y * k),
      w: Math.round(b.w * k),
      h: Math.round(b.h * k)
    }));
    return out;
  };
})();

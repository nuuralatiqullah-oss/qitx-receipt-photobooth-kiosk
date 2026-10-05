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
      const done = Imaging.processPhoto(img, w, h, photoOpts);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(done, x, y);
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

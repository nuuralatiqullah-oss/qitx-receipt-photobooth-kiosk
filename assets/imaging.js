/* ============================================================
   IMAGING — compose the frame, then turn it into 1-bit raster
   bytes the thermal printer understands.

   Pipeline: compose -> grayscale -> brightness -> blur ->
             contrast stretch -> Floyd-Steinberg dither -> pack bits
   ============================================================ */
(function () {
  "use strict";

  const Imaging = {};

  /* ---------- compose the printable sheet ---------- */

  // Draw one captured photo into a slot, cropped to fill (object-cover).
  function drawCover(ctx, img, x, y, w, h) {
    const sw = img.width, sh = img.height;
    const scale = Math.max(w / sw, h / sh);
    const dw = sw * scale, dh = sh * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    ctx.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
    ctx.restore();
  }

  /**
   * Build the full sheet canvas.
   * @param {object} frame   layout from frames.js (576-dot space)
   * @param {Array}  images  HTMLImageElement/Canvas per slot
   * @param {object} opts    { width, header, footer, overlay }
   */
  Imaging.compose = function (frame, images, opts) {
    opts = opts || {};
    const targetW = opts.width || 576;
    const k = targetW / frame.width;          // 58mm paper scales everything
    const W = Math.round(frame.width * k);
    const H = Math.round(frame.height * k);

    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, W, H);

    // photos
    frame.slots.forEach(function (s, i) {
      const img = images[i];
      if (!img) return;
      drawCover(ctx, img, s.x * k, s.y * k, s.w * k, s.h * k);
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = Math.max(1, Math.round(2 * k));
      ctx.strokeRect(s.x * k, s.y * k, s.w * k, s.h * k);
    });

    // optional PNG overlay on top (transparent where photos show)
    if (opts.overlay) {
      ctx.drawImage(opts.overlay, 0, 0, W, H);
    }

    // header / footer text, drawn only when no overlay supplies its own
    if (frame.header && !opts.overlay) {
      ctx.fillStyle = "#000000";
      ctx.textAlign = "center";

      ctx.font = "bold " + Math.round(46 * k) + "px Georgia, serif";
      ctx.fillText(opts.header || "", W / 2, Math.round(70 * k));

      ctx.font = Math.round(26 * k) + "px Georgia, serif";
      ctx.fillText(opts.subheader || "", W / 2, Math.round(110 * k));

      const lastSlot = frame.slots[frame.slots.length - 1];
      let fy = (lastSlot.y + lastSlot.h) * k + Math.round(60 * k);
      ctx.font = Math.round(28 * k) + "px Georgia, serif";
      ctx.fillText(opts.footer || "", W / 2, fy);

      ctx.font = Math.round(22 * k) + "px monospace";
      ctx.fillText(opts.stamp || "", W / 2, fy + Math.round(40 * k));
    }

    return canvas;
  };

  /* ---------- 1-bit conversion ---------- */

  function toGray(imageData, brightness) {
    const d = imageData.data;
    const n = imageData.width * imageData.height;
    const g = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const p = i * 4;
      // white-composite any transparency so it prints as blank paper
      const a = d[p + 3] / 255;
      const r = d[p] * a + 255 * (1 - a);
      const gr = d[p + 1] * a + 255 * (1 - a);
      const b = d[p + 2] * a + 255 * (1 - a);
      g[i] = Math.min(255, (0.299 * r + 0.587 * gr + 0.114 * b) * brightness);
    }
    return g;
  }

  // 3x3 separable box blur — kills the high-frequency detail that
  // dithers into TV static on busy photos.
  function boxBlur(g, w, h, passes) {
    let src = g;
    for (let p = 0; p < passes; p++) {
      const tmp = new Float32Array(src.length);
      const out = new Float32Array(src.length);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const l = x > 0 ? src[i - 1] : src[i];
          const r = x < w - 1 ? src[i + 1] : src[i];
          tmp[i] = (l + src[i] + r) / 3;
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const u = y > 0 ? tmp[i - w] : tmp[i];
          const dn = y < h - 1 ? tmp[i + w] : tmp[i];
          out[i] = (u + tmp[i] + dn) / 3;
        }
      }
      src = out;
    }
    return src;
  }

  // 1st/99th percentile linear stretch — stops the blur turning
  // everything into mid grey.
  function stretchContrast(g) {
    const hist = new Uint32Array(256);
    for (let i = 0; i < g.length; i++) hist[Math.max(0, Math.min(255, g[i] | 0))]++;
    const total = g.length;
    const loTarget = total * 0.01, hiTarget = total * 0.99;
    let acc = 0, lo = 0, hi = 255;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= loTarget) { lo = v; break; } }
    acc = 0;
    for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= hiTarget) { hi = v; break; } }
    if (hi - lo < 16) return g;
    const scale = 255 / (hi - lo);
    const out = new Float32Array(g.length);
    for (let i = 0; i < g.length; i++) {
      out[i] = Math.max(0, Math.min(255, (g[i] - lo) * scale));
    }
    return out;
  }

  function floydSteinberg(g, w, h) {
    const bits = new Uint8Array(w * h); // 1 = black dot
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

  /**
   * Canvas -> { width, height, bits } ready for ESC/POS raster.
   * Width is padded to a multiple of 8 (one bit per dot, packed MSB first).
   */
  Imaging.prepareForPrint = function (canvas, cfg) {
    cfg = cfg || {};
    const ctx = canvas.getContext("2d");
    const w = canvas.width, h = canvas.height;
    const data = ctx.getImageData(0, 0, w, h);

    let g = toGray(data, cfg.brightness || 1);
    if (cfg.blurPasses > 0) g = boxBlur(g, w, h, cfg.blurPasses);
    if (cfg.contrastStretch) g = stretchContrast(g);
    const bits = floydSteinberg(g, w, h);

    return { width: w, height: h, bits: bits };
  };

  /** Preview of exactly what will be printed (for the on-screen check). */
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

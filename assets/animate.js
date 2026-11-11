/* ============================================================
   ANIMATED STRIP
   Turns the composed colour strips — one per burst frame — into a
   looping GIF.

   Three frames, played 1-2-3-2. Three is not a compromise: it is the
   photobooth look, and it keeps the file under half a megabyte, which
   is what decides whether a guest on venue wifi actually gets their
   photo.

   One palette for the whole file. The frames are 180 ms apart so
   their colours are near identical; a palette per frame would cost
   size and make the loop shimmer.
   ============================================================ */
(function () {
  "use strict";

  const Animate = {};

  Animate.isSupported = function () {
    return !!(window.GIFENC && window.GIFENC.GIFEncoder);
  };

  /* Ping-pong. A straight 1-2-3 repeat jumps on the wrap, and with
     only three frames that jump is the thing the eye lands on. */
  Animate.loopOrder = function (n) {
    const seq = [];
    for (let i = 0; i < n; i++) seq.push(i);
    for (let i = n - 2; i > 0; i--) seq.push(i);
    return seq;
  };

  function downscale(src, width) {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(src.height * (w / src.width)));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(src, 0, 0, w, h);
    return ctx.getImageData(0, 0, w, h);
  }

  /**
   * frames: composed colour strips, one per burst index.
   * Returns a Blob, or null if the encoder is unavailable.
   */
  Animate.encode = async function (frames, opts) {
    if (!Animate.isSupported()) return null;
    if (!frames || frames.length < 2) return null;
    opts = opts || {};

    const width   = opts.width || 360;
    const colors  = opts.maxColors || 128;
    const perMs   = opts.frameMs == null ? 160 : opts.frameMs;
    const holdMs  = opts.holdMs == null ? 400 : opts.holdMs;

    const G = window.GIFENC;
    const imgs = frames.map(f => downscale(f, width));
    const w = imgs[0].width, h = imgs[0].height;

    /* The middle frame is the posed one, so build the palette from it:
       it is the frame the eye spends most of the loop looking at. */
    const hero = imgs[Math.floor(imgs.length / 2)];
    const palette = G.quantize(hero.data, colors, { format: "rgb565" });

    const indexed = imgs.map(im => G.applyPalette(im.data, palette, "rgb565"));

    const gif = G.GIFEncoder();
    const order = Animate.loopOrder(imgs.length);

    order.forEach(function (idx, step) {
      const last = step === order.length - 1;
      const frameOpts = { delay: last ? holdMs : perMs };
      // Palette goes out once, as the global colour table; later
      // frames inherit it instead of carrying their own copy.
      if (step === 0) frameOpts.palette = palette;
      gif.writeFrame(indexed[idx], w, h, frameOpts);
    });

    gif.finish();
    return new Blob([gif.bytes()], { type: "image/gif" });
  };

  window.Animate = Animate;
})();

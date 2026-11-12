/* ============================================================
   PHOTOBOOTH KIOSK — flow controller
   welcome -> frames -> capture -> review -> print -> done
   ============================================================ */
(function () {
  "use strict";

  /* Defaults from config.js with this tablet's Admin overrides on top. */
  const CFG = window.Settings ? window.Settings.load() : window.CONFIG;
  const $ = id => document.getElementById(id);

  const state = {
    frames: [],
    frame: null,
    shots: [],          // canvas per slot (the frame that prints)
    bursts: [],         // [before, shutter, after] per slot, when the layout animates
    sheetFrames: null,  // one composed colour strip per burst index
    loopTimer: null,
    gifBlob: null,      // encoded animated strip
    gifJob: null,       // the encode, started while the guest reviews
    sheet: null,        // composed canvas, print resolution
    sheetDisplay: null, // colour keepsake shown, saved and shared
    prepared: null,     // 1-bit bitmap
    stream: null,
    facing: (window.CONFIG && window.CONFIG.CAMERA_FACING) || "user",
    sessionId: null,
    guestUrl: null,
    idleTimer: null,
    shooting: false
  };

  let supabase = null;

  /* ---------------- helpers ---------------- */

  function show(id) {
    // The review loop redraws a canvas on a timer. Leaving the screen
    // without stopping it burns battery and, on a reprint, paints the
    // old session's frames over the new strip.
    if (id !== "scrReview") stopLoop();
    document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
    $(id).classList.add("active");
    resetIdle();
  }

  function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isError ? " err" : "");
    clearTimeout(t._timer);
    t._timer = setTimeout(() => { t.className = "toast"; }, isError ? 9000 : 4000);
  }

  function uid(n) {
    return Math.random().toString(36).slice(2, 2 + (n || 6));
  }

  function stamp(d) {
    const p = v => String(v).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) +
           " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  function resetIdle() {
    clearTimeout(state.idleTimer);
    if (!CFG.IDLE_RESET_SECONDS) return;
    state.idleTimer = setTimeout(function () {
      if (!$("scrWelcome").classList.contains("active") &&
          !$("scrPrinting").classList.contains("active")) {
        hardReset();
      }
    }, CFG.IDLE_RESET_SECONDS * 1000);
  }
  ["touchstart", "click", "keydown"].forEach(ev =>
    document.addEventListener(ev, resetIdle, { passive: true })
  );

  /* ---------------- printer status ---------------- */

  function paintPrinter() {
    const connected = window.Printer.isConnected();
    ["printerDot", "printerDot2", "printerDot3"].forEach(id => {
      const el = $(id);
      if (el) el.className = "dot" + (connected ? " on" : "");
    });
    const label = $("printerLabel");
    if (label) label.textContent = connected ? "Ready" : "Connect";
  }

  window.Printer.onStatus = function (st, msg) {
    paintPrinter();
    if (st === "disconnected" && msg) toast(msg, true);
  };

  async function connectPrinter() {
    if (window.Printer.isConnected()) {
      try {
        await window.Printer.printTest({
          cutMode: CFG.CUT_MODE,
          chunkBytes: CFG.USB_CHUNK_BYTES
        });
        toast("Test slip sent");
      } catch (e) {
        toast(e.message, true);
      }
      return;
    }
    try {
      await window.Printer.connect();
      toast("Printer connected");
    } catch (e) {
      toast(e.message || "Could not connect to the printer", true);
    }
  }

  /* ---------------- frames ---------------- */

  function drawFramePreview(canvas, frame) {
    const scale = 240 / frame.width;
    canvas.width = Math.round(frame.width * scale);
    canvas.height = Math.round(frame.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#111";
    ctx.textAlign = "center";
    ctx.font = "bold " + Math.round(46 * scale) + "px Georgia, serif";
    ctx.fillText(CFG.BOOTH_NAME, canvas.width / 2, Math.round(70 * scale));
    ctx.fillStyle = "#d8d8d8";
    frame.slots.forEach(s => {
      ctx.fillRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale);
      ctx.strokeStyle = "#111";
      ctx.lineWidth = 1;
      ctx.strokeRect(s.x * scale, s.y * scale, s.w * scale, s.h * scale);
    });
  }

  function renderFrameGrid() {
    const grid = $("frameGrid");
    grid.innerHTML = "";
    state.frames.forEach(frame => {
      const card = document.createElement("button");
      card.className = "card";
      const cv = document.createElement("canvas");
      drawFramePreview(cv, frame);
      const label = document.createElement("div");
      label.className = "tag";
      label.textContent = frame.name + " · " + frame.shots + " shot" + (frame.shots > 1 ? "s" : "");
      card.appendChild(cv);
      card.appendChild(label);
      card.onclick = function () {
        state.frame = frame;
        grid.querySelectorAll(".card").forEach(c => c.classList.remove("sel"));
        card.classList.add("sel");
        $("btnUseFrame").disabled = false;
      };
      grid.appendChild(card);
    });
  }

  // Optional: frames defined in Supabase override/extend the built-ins.
  /* Built-in and locally-uploaded layouts are set synchronously so the
     picker can render at once. Anything stored in Supabase is merged in
     afterwards and triggers a re-render.

     The booth must never wait on the network to show a layout: an event
     venue's wifi can leave a Supabase query hanging for a long time
     (supabase-js sets no timeout of its own), and the guest would be
     staring at an empty "choose a layout" screen the whole time. */
  function loadFrames() {
    state.frames = window.Settings
      ? window.Settings.allFrames()
      : window.BUILTIN_FRAMES.slice();
    if (!supabase) return Promise.resolve();
    return mergeRemoteFrames();
  }

  async function mergeRemoteFrames() {
    try {
      const res = await withTimeout(supabase
        .from("frames")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true }), FRAME_FETCH_MS);
      if (res.error) throw res.error;
      if (res.data && res.data.length) {
        const remote = res.data.map(r => ({
          id: r.id,
          name: r.name,
          width: r.width,
          height: r.height,
          shots: r.shots,
          header: !r.overlay_path,
          slots: r.slots,
          overlayPath: r.overlay_path
        }));
        state.frames = remote.concat(state.frames);
        // The picker is already on screen by now, so redraw it.
        renderFrameGrid();
      }
    } catch (e) {
      console.warn("Frame fetch failed, using built-ins:", e && e.message);
    }
  }

  /* supabase-js has no request timeout, so give it one. */
  const FRAME_FETCH_MS = 6000;
  function withTimeout(promise, ms) {
    return new Promise(function (resolve, reject) {
      const t = setTimeout(() => reject(new Error("timed out after " + ms + "ms")), ms);
      Promise.resolve(promise).then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); }
      );
    });
  }

  async function loadOverlay(frame) {
    // artwork uploaded through Admin and kept on this tablet
    if (frame.overlayLocal && window.Settings) {
      try {
        const blob = await window.Settings.getTemplate(frame.overlayLocal);
        if (blob) return await createImageBitmap(blob);
      } catch (e) {
        console.warn("Local template failed:", e.message);
      }
    }
    if (!frame.overlayPath || !supabase) return null;
    try {
      const { data } = supabase.storage.from(CFG.FRAME_BUCKET).getPublicUrl(frame.overlayPath);
      return await new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("overlay load failed"));
        img.src = data.publicUrl;
      });
    } catch (e) {
      console.warn("Overlay failed:", e.message);
      return null;
    }
  }

  /* ---------------- camera ---------------- */

  async function startCamera() {
    stopCamera();
    const constraints = {
      audio: false,
      video: {
        facingMode: state.facing,
        width: { ideal: CFG.CAMERA_IDEAL_WIDTH || 3840 },
        height: { ideal: Math.round((CFG.CAMERA_IDEAL_WIDTH || 3840) * 9 / 16) },
        advanced: [{ width: 3840 }, { width: 2560 }, { width: 1920 }]
      }
    };
    state.stream = await navigator.mediaDevices.getUserMedia(constraints);
    const v = $("video");
    v.addEventListener("loadedmetadata", applySlotShape, { once: true });
    v.srcObject = state.stream;
    v.classList.toggle("mirror", CFG.MIRROR_PREVIEW && state.facing === "user");
    await v.play();
  }

  function stopCamera() {
    if (state.stream) {
      state.stream.getTracks().forEach(t => t.stop());
      state.stream = null;
    }
  }

  /** Aspect ratio (w/h) of the slot the next photo goes into. */
  function slotAspect(i) {
    if (!state.frame || !state.frame.slots.length) return 4 / 3;
    const s = state.frame.slots[Math.min(i, state.frame.slots.length - 1)];
    return s.w / s.h;
  }

  /**
   * Centre-crop a frame to the slot's shape. The preview box is set to
   * the same shape, so the guest is framing the real thing instead of a
   * wider view that gets trimmed at print time.
   */
  function toCanvas(source, sw, sh, aspect) {
    let cw = sw, ch = sh;
    if (aspect) {
      if (sw / sh > aspect) cw = Math.round(sh * aspect);
      else ch = Math.round(sw / aspect);
    }
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    const ctx = c.getContext("2d");
    if (CFG.MIRROR_PREVIEW && state.facing === "user") {
      ctx.translate(cw, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(source, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, cw, ch);
    return c;
  }

  function grabFrame() {
    const v = $("video");
    return toCanvas(v, v.videoWidth, v.videoHeight, slotAspect(state.shots.length));
  }

  /* The video preview is often capped well below the sensor's real
     resolution. ImageCapture.takePhoto() asks for a full still, which
     is noticeably more detail to dither from. Falls back silently. */
  async function capturePhoto() {
    const track = state.stream && state.stream.getVideoTracks()[0];
    if (track && typeof window.ImageCapture === "function") {
      try {
        const shot = await new window.ImageCapture(track).takePhoto();
        const bmp = await createImageBitmap(shot);
        if (bmp.width >= $("video").videoWidth) {
          return toCanvas(bmp, bmp.width, bmp.height, slotAspect(state.shots.length));
        }
      } catch (e) {
        /* not supported on this device — use the preview frame */
      }
    }
    return grabFrame();
  }

  function waitMs(ms) {
    return new Promise(r => setTimeout(r, Math.max(0, ms)));
  }

  /** Does this layout produce an animated strip as well as a print?
      Layouts are animated unless switched off, either globally or for
      that one layout in Admin. An uploaded template behaves like a
      built-in: on until you say otherwise. */
  function gifOn() {
    if (CFG.GIF_ENABLED === false) return false;
    const f = state.frame;
    if (!f || f.gif === false) return false;
    const off = CFG.NO_GIF_FRAMES || [];
    return off.indexOf(f.id) === -1;
  }

  function fireFlash() {
    const flash = $("flash");
    flash.classList.remove("fire");
    void flash.offsetWidth;
    flash.classList.add("fire");
  }

  /**
   * Three frames around one shutter press: before, at, after.
   *
   * The flash fires first rather than on the middle frame, because it
   * is a white overlay across the preview and lights the subject off
   * the screen. Firing it mid-burst would brighten only frame two and
   * the loop would pulse.
   *
   * All three come off the same preview stream by default so their
   * exposure matches. CFG.GIF_STILL_SOURCE = "photo" swaps the middle
   * one for a full ImageCapture still, which is cleaner in a dim room
   * but stalls the burst and shifts the exposure.
   */
  async function captureBurst() {
    const gap = CFG.GIF_FRAME_GAP_MS == null ? 180 : CFG.GIF_FRAME_GAP_MS;
    fireFlash();
    const before = grabFrame();
    await waitMs(gap);
    const hero = CFG.GIF_STILL_SOURCE === "photo" ? await capturePhoto() : grabFrame();
    await waitMs(gap);
    const after = grabFrame();
    return [before, hero, after];
  }

  /**
   * Size the preview box to the exact shape of the slot being filled,
   * as large as the space allows. Done in pixels rather than CSS
   * because a flex column resolves max-width/max-height before the
   * aspect ratio, which quietly changes the shape — and then the guest
   * would be framing something different from what gets printed.
   */
  function applySlotShape() {
    if (!state.frame || !state.frame.slots.length) return;
    if (!$("scrCapture").classList.contains("active")) return;
    const i = Math.min(state.shots.length, state.frame.slots.length - 1);
    const ar = slotAspect(i);
    const stage = $("stage");
    const wrap = $("stageWrap");
    stage.style.setProperty("--slot-ar", String(ar));

    const availW = wrap.clientWidth;
    const availH = wrap.clientHeight;
    if (!availW || !availH) return;

    let w = availW, h = w / ar;
    if (h > availH) { h = availH; w = h * ar; }
    stage.style.width = Math.floor(w) + "px";
    stage.style.height = Math.floor(h) + "px";
  }

  // keep it correct through rotation and the phone's URL bar appearing
  let shapeTimer = null;
  function reshapeSoon() {
    clearTimeout(shapeTimer);
    shapeTimer = setTimeout(function () {
      if ($("scrCapture").classList.contains("active")) applySlotShape();
    }, 80);
  }
  window.addEventListener("resize", reshapeSoon);
  window.addEventListener("orientationchange", reshapeSoon);

  function paintShots() {
    const wrap = $("shots");
    wrap.innerHTML = "";
    for (let i = 0; i < state.frame.shots; i++) {
      const d = document.createElement("div");
      if (state.shots[i]) {
        d.className = "thumb done";
        const img = new Image();
        img.src = state.shots[i].toDataURL("image/jpeg", 0.6);
        d.appendChild(img);
      } else {
        // the one being taken right now, so guests can see where they are
        d.className = "thumb" + (i === state.shots.length ? " now" : "");
      }
      wrap.appendChild(d);
    }
    $("captureCount").textContent =
      Math.min(state.shots.length + 1, state.frame.shots) + " / " + state.frame.shots;
    applySlotShape();
  }

  function countdown(seconds) {
    return new Promise(resolve => {
      const el = $("countdown");
      let n = seconds;
      if (n <= 0) return resolve();
      el.textContent = n;
      el.classList.add("show");
      const tick = setInterval(() => {
        n--;
        if (n <= 0) {
          clearInterval(tick);
          el.classList.remove("show");
          resolve();
        } else {
          el.textContent = n;
        }
      }, 1000);
    });
  }

  function wait(sec) {
    return new Promise(r => setTimeout(r, Math.max(0, sec) * 1000));
  }

  /** One shot: countdown, flash, capture. */
  async function oneShot() {
    await countdown(CFG.COUNTDOWN_SECONDS);
    if (gifOn()) {
      const burst = await captureBurst();
      state.bursts.push(burst);
      state.shots.push(burst[1]);      // the middle frame is the one that prints
    } else {
      fireFlash();
      state.bursts.push(null);
      state.shots.push(await capturePhoto());
    }
    paintShots();
  }

  async function takeShot() {
    if (state.shooting) return;
    state.shooting = true;
    $("btnShoot").disabled = true;
    $("captureHint").textContent = "Get ready";
    try {
      // One press takes the lot, so nobody has to reach back to the
      // tablet between poses.
      const runAll = CFG.AUTO_SEQUENCE === true;
      do {
        await oneShot();
        if (state.shots.length >= state.frame.shots) break;
        if (runAll) {
          $("captureHint").textContent = "Next pose…";
          await wait(CFG.AUTO_SEQUENCE_GAP == null ? 2 : CFG.AUTO_SEQUENCE_GAP);
        }
      } while (runAll && state.shots.length < state.frame.shots);

      if (state.shots.length >= state.frame.shots) {
        stopCamera();
        await buildSheet();
        show("scrReview");
      } else {
        $("captureHint").textContent = "Tap the button when ready";
      }
    } catch (e) {
      toast(e.message, true);
    } finally {
      state.shooting = false;
      $("btnShoot").disabled = false;
    }
  }

  /* ---------------- compose & print ---------------- */

  async function buildSheet() {
    const overlay = await loadOverlay(state.frame);
    // The chrome measures strings to decide how big to set them, so
    // the faces have to be in memory first or it measures a fallback
    // and lays the strip out to the wrong widths.
    if (window.Imaging.fontsReady) await window.Imaging.fontsReady();
    const text = {
      overlay: overlay,
      // per-layout newspaper wording, for the built-in block stacks
      text: window.Settings.frameText(state.frame),
      // plain caption, for uploaded layouts that have no block stack
      header: CFG.BOOTH_NAME,
      subheader: CFG.EVENT_NAME,
      footer: CFG.FOOTER_LINE,
      stamp: stamp(new Date())
    };

    /* Two versions of the same strip.
       - display: full colour at a few times print size. This is what
         the guest sees, saves and shares.
       - print: black and white dots, because that is all a thermal
         head can put on paper. */
    const scale = Math.max(1, CFG.DISPLAY_SCALE || 2);
    state.sheetDisplay = window.Imaging.compose(state.frame, state.shots, Object.assign({}, text, {
      width: CFG.PRINT_WIDTH_DOTS * scale,
      photo: { mode: "display" }
    }));

    state.sheet = window.Imaging.compose(state.frame, state.shots, Object.assign({}, text, {
      width: CFG.PRINT_WIDTH_DOTS,
      photo: {
        dotSize: CFG.PHOTO_DOT_SIZE,
        dither: CFG.DITHER,
        gamma: CFG.PHOTO_GAMMA,
        autoLevels: CFG.PHOTO_AUTO_LEVELS,
        sharpen: CFG.PHOTO_SHARPEN,
        localContrast: CFG.PHOTO_LOCAL_CONTRAST,
        blurPasses: CFG.PHOTO_BLUR
      }
    }));
    state.prepared = window.Imaging.prepareForPrint(state.sheet, { dither: CFG.DITHER });

    /* The animated version: the same compose() run once per burst
       index, so the header, footer, borders and any uploaded template
       overlay are identical in every frame and only the photos move. */
    state.sheetFrames = null;
    if (gifOn() && state.bursts.length === state.shots.length &&
        state.bursts.every(Boolean)) {
      const n = state.bursts[0].length;
      state.sheetFrames = [];
      for (let f = 0; f < n; f++) {
        const picks = state.bursts.map(b => b[f]);
        state.sheetFrames.push(window.Imaging.compose(state.frame, picks,
          Object.assign({}, text, {
            width: CFG.PRINT_WIDTH_DOTS * scale,
            photo: { mode: "display" }
          })));
      }
    }

    showPreview(state.sheetDisplay);
    playLoop();
    startEncode();
  }

  /* Encoding takes a second or so on a tablet. Start it the moment
     the review screen appears rather than when Print is pressed: the
     guest spends longer looking at their strip than the encoder needs,
     so by the time anything wants the GIF it is already sitting there. */
  function startEncode() {
    state.gifBlob = null;
    state.gifJob = null;
    if (!gifOn() || !state.sheetFrames || !window.Animate) return;
    if (!window.Animate.isSupported()) return;
    state.gifJob = window.Animate.encode(state.sheetFrames, {
      width: CFG.GIF_WIDTH,
      maxColors: CFG.GIF_MAX_COLORS,
      frameMs: CFG.GIF_FRAME_MS,
      holdMs: CFG.GIF_HOLD_MS
    }).then(function (blob) {
      state.gifBlob = blob;
      return blob;
    }).catch(function (e) {
      console.warn("GIF encode failed:", e && e.message);
      return null;
    });
  }

  /** The animated strip, once the encode that started at review ends. */
  async function gifBlob() {
    if (state.gifBlob) return state.gifBlob;
    if (state.gifJob) return await state.gifJob;
    return null;
  }

  /* Ping-pong: 1-2-3-2. A straight 1-2-3 repeat jumps on the wrap,
     and with only three frames that jump is the thing you notice. */
  function loopOrder(n) {
    const seq = [];
    for (let i = 0; i < n; i++) seq.push(i);
    for (let i = n - 2; i > 0; i--) seq.push(i);
    return seq;
  }

  function stopLoop() {
    if (state.loopTimer) { clearTimeout(state.loopTimer); state.loopTimer = null; }
  }

  function playLoop() {
    stopLoop();
    const frames = state.sheetFrames;
    if (!frames || frames.length < 2) return;
    const order = loopOrder(frames.length);
    const per = CFG.GIF_FRAME_MS == null ? 160 : CFG.GIF_FRAME_MS;
    const hold = CFG.GIF_HOLD_MS == null ? 400 : CFG.GIF_HOLD_MS;
    let i = 0;
    (function step() {
      showPreview(frames[order[i]]);
      const last = i === order.length - 1;
      i = (i + 1) % order.length;
      state.loopTimer = setTimeout(step, last ? hold : per);
    })();
  }

  function showPreview(src) {
    const t = $("previewCanvas");
    t.width = src.width;
    t.height = src.height;
    t.getContext("2d").drawImage(src, 0, 0);
  }

  function stripFilename(ext) {
    const d = new Date();
    const p = v => String(v).padStart(2, "0");
    const base = (CFG.BOOTH_NAME || "photobooth").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return base + "-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
           "-" + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + "." + ext;
  }

  function keepsake() {
    return state.sheetDisplay || state.sheet;
  }

  /* When the layout animates, the animated strip IS the keepsake —
     a guest who posed for a moving photo does not want a still. The
     print is unaffected either way. */
  async function keepsakeBlob() {
    if (gifOn()) {
      const g = await gifBlob();
      if (g) return { blob: g, ext: "gif", type: "image/gif" };
    }
    const src = keepsake();
    if (!src) return null;
    return { blob: await canvasToBlob(src, "image/jpeg", 0.92), ext: "jpg", type: "image/jpeg" };
  }

  async function saveStrip() {
    try {
      const k = await keepsakeBlob();
      if (!k) return;
      const url = URL.createObjectURL(k.blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = stripFilename(k.ext);
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(k.ext === "gif" ? "Animated strip saved" : "Saved to this tablet");
    } catch (e) {
      toast("Couldn't save: " + e.message, true);
    }
  }

  async function shareStrip() {
    let k;
    try {
      k = await keepsakeBlob();
    } catch (e) {
      toast("Couldn't prepare the photo", true);
      return;
    }
    if (!k) return;
    const file = new File([k.blob], stripFilename(k.ext), { type: k.type });

    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: CFG.BOOTH_NAME || "Photobooth" });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (state.guestUrl) {
      window.open(state.guestUrl, "_blank", "noopener");
      return;
    }
    await saveStrip();
  }

  /**
   * Ask how many copies. Resolves with a number, or 0 if cancelled.
   * Skipped entirely when ASK_COPIES is off.
   */
  function askCopies() {
    const max = Math.max(1, Math.min(9, CFG.MAX_COPIES || 5));
    if (CFG.ASK_COPIES === false || max === 1) {
      return Promise.resolve(Math.max(1, CFG.AUTO_PRINT_COPIES || 1));
    }
    return new Promise(function (resolve) {
      const modal = $("copyModal");
      const nums = $("copyNums");
      nums.innerHTML = "";

      const close = function (n) {
        modal.hidden = true;
        nums.innerHTML = "";
        $("copyCancel").onclick = null;
        resolve(n);
      };

      for (let i = 1; i <= max; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.textContent = String(i);
        b.setAttribute("aria-label", i + (i === 1 ? " copy" : " copies"));
        b.onclick = () => close(i);
        nums.appendChild(b);
      }
      $("copyCancel").onclick = () => close(0);
      modal.hidden = false;
    });
  }

  async function doPrint() {
    if (!window.Printer.isConnected()) {
      toast("Connect the printer first — tap the Printer button", true);
      return;
    }
    const copies = await askCopies();
    if (!copies) return;          // cancelled, stay on the review screen

    show("scrPrinting");
    try {
      for (let i = 0; i < copies; i++) {
        $("printingMsg").textContent =
          copies > 1 ? "Printing " + (i + 1) + " of " + copies : "Printing…";
        await window.Printer.print(state.prepared, {
          bandRows: CFG.RASTER_BAND_ROWS,
          chunkBytes: CFG.USB_CHUNK_BYTES,
          cutMode: CFG.CUT_MODE,
          feedBeforeCut: CFG.FEED_BEFORE_CUT,
          density: CFG.PRINT_DENSITY,
          speed: CFG.PRINT_SPEED
        });
      }
      await finishSession(copies);
      show("scrDone");
    } catch (e) {
      toast("Print failed: " + e.message, true);
      show("scrReview");
    }
  }

  /* ---------------- supabase upload ---------------- */

  function canvasToBlob(canvas, type, quality) {
    return new Promise(resolve => canvas.toBlob(resolve, type, quality));
  }

  async function blobToCanvas(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement("canvas");
    c.width = bmp.width;
    c.height = bmp.height;
    c.getContext("2d").drawImage(bmp, 0, 0);
    return c;
  }

  /* Keep a copy on the tablet so Admin can reprint or share it later,
     with or without internet. Trimmed to KEEP_LOCAL_COPIES. */
  async function saveLocalCopy(remoteUrl, copies) {
    if (!window.Settings || !state.sheet) return;
    if (!state.shots.length) return;   // a reprint is already saved
    try {
      const blob = await canvasToBlob(keepsake(), "image/jpeg", 0.9);
      if (!blob) return;
      // keep the dot-for-dot version too, so a reprint is identical
      const printBlob = await canvasToBlob(
        window.Imaging.bitsToCanvas(state.prepared), "image/png");
      // Keep the animated version too, so Admin can re-share a moving
      // strip later rather than only the frozen frame.
      const gif = gifOn() ? await gifBlob() : null;
      await window.Settings.addPrint(blob, {
        printBlob: printBlob,
        gifBlob: gif,
        copies: Math.max(1, copies || 1),
        frameId: String(state.frame.id),
        frameName: state.frame.name,
        remoteUrl: remoteUrl || ""
      });
    } catch (e) {
      console.warn("Local copy failed:", e.message);
    }
  }

  /* Say why there is no QR. Every branch below used to fall back to
     the same cheerful line, so a broken bucket, a missing library and
     a deliberately offline booth all looked identical. */
  function hideNote() {
    const note = $("qrNote");
    if (note) { note.style.display = "none"; note.textContent = ""; }
  }

  /* No QR this time. An empty reason means that was expected — the
     feature is off, or no project is configured — so the guest just
     gets the plain line with no alarming note under it. */
  function noQr(reason) {
    $("doneLead").textContent = "Collect your print from the printer";
    hideNote();
    if (!reason) return;
    const note = $("qrNote");
    if (!note) return;
    note.textContent = "No digital copy: " + reason;
    note.style.display = "block";
  }

  async function finishSession(copies) {
    $("qrBox").style.display = "none";
    noQr("");
    state.guestUrl = null;

    if (!CFG.UPLOAD_PHOTOS) {
      await saveLocalCopy("", copies);
      noQr("");                       // switched off on purpose
      return;
    }
    if (!window.supabase) {
      await saveLocalCopy("", copies);
      noQr("the Supabase library didn't load");
      return;
    }
    if (!supabase) {
      await saveLocalCopy("", copies);
      noQr("no Supabase project is configured");
      return;
    }

    try {
      /* Upload whichever one the guest is actually being given. On an
         animating layout that is the GIF, so the QR leads to something
         that moves; otherwise the still. Only one file goes up — venue
         wifi is the slowest part of this whole machine. */
      const k = await keepsakeBlob();
      if (!k) throw new Error("nothing to upload");

      const d = new Date();
      const path = d.toISOString().slice(0, 10) + "/" +
                   d.toISOString().slice(11, 19).replace(/:/g, "") + "-" + uid(4) + "." + k.ext;

      const up = await supabase.storage
        .from(CFG.PHOTO_BUCKET)
        .upload(path, k.blob, { contentType: k.type, upsert: false });
      if (up.error) throw up.error;

      const { data: pub } = supabase.storage.from(CFG.PHOTO_BUCKET).getPublicUrl(path);
      state.guestUrl = pub.publicUrl;

      const ins = await supabase.from("prints").insert({
        session_id: state.sessionId,
        frame_id: String(state.frame.id),
        storage_path: path,
        copies: Math.max(1, copies || 1)
      });
      if (ins.error) console.warn("prints insert:", ins.error.message);

      await saveLocalCopy(state.guestUrl, copies);

      if (!CFG.SHOW_QR) { noQr(""); return; }
      if (!window.QRCode) { noQr("the QR library didn't load"); return; }

      await window.QRCode.toCanvas($("qrCanvas"), state.guestUrl, { width: 200, margin: 1 });
      $("qrBox").style.display = "block";
      $("doneLead").textContent = "Scan the code to keep a digital copy";
      hideNote();          // NOT noQr(""), which resets the lead text
    } catch (e) {
      console.warn("Upload failed:", e && e.message);
      await saveLocalCopy("", copies);
      noQr(shortReason(e));
    }
  }

  /* Turn a Supabase error into something an operator can act on,
     using the same wording as the Admin connection test. */
  function shortReason(e) {
    const m = String((e && e.message) || e || "unknown error");
    if (/bucket.*not.*found|not.*found.*bucket/i.test(m)) return 'the "' + CFG.PHOTO_BUCKET + '" bucket is missing';
    if (/row-level security|policy|unauthor|permission/i.test(m)) return "the upload policy is missing";
    if (/invalid path/i.test(m)) return "the project URL looks wrong";
    if (/failed to fetch|networkerror|load failed/i.test(m)) return "the tablet is offline";
    return m;
  }

  /* ---------------- navigation ---------------- */

  /* Leaving the review screen throws the photos away, so make sure
     that is what they meant. */
  function confirmHome() {
    if (state.shots.length && !confirm("Go back to the start? This strip won't be saved.")) return;
    hardReset();
  }

  function hardReset() {
    stopCamera();
    stopLoop();
    state.shots = [];
    state.bursts = [];
    state.sheetFrames = null;
    state.gifBlob = null;
    state.gifJob = null;
    state.frame = null;
    state.sheet = null;
    state.sheetDisplay = null;
    state.prepared = null;
    state.sessionId = uid(10);
    $("btnUseFrame").disabled = true;
    document.querySelectorAll(".card").forEach(c => c.classList.remove("sel"));
    show("scrWelcome");
  }

  async function goCapture() {
    state.shots = [];
    paintShots();
    $("captureHint").textContent = "Tap the button when ready";
    show("scrCapture");
    // The screen must be on-screen before the preview can be sized: a
    // hidden element measures zero and the sizing silently gives up.
    requestAnimationFrame(applySlotShape);
    try {
      await startCamera();
      applySlotShape();
    } catch (e) {
      toast("Camera blocked: " + e.message, true);
      show("scrFrames");
    }
  }

  /* ---------------- wiring ---------------- */

  /* A remote press should do whatever the screen's main button does,
     so one button can run a whole session hands-free. */
  function remoteFire() {
    if ($("scrCapture").classList.contains("active")) {
      if (!state.shooting) takeShot();
    } else if ($("scrWelcome").classList.contains("active")) {
      show("scrFrames");
    } else if ($("scrFrames").classList.contains("active")) {
      if (state.frame) goCapture();
    } else if ($("scrReview").classList.contains("active")) {
      if (CFG.ALLOW_GUEST_PRINT !== false) doPrint();
    } else if ($("scrDone").classList.contains("active")) {
      hardReset();
    }
  }

  function startRemote() {
    if (!window.Remote || CFG.REMOTE_SHUTTER === false) return;
    window.Remote.onFire = remoteFire;
    window.Remote.start({
      keys: CFG.SHUTTER_KEYS || ["Enter", "Space"],
      acceptAnyKey: CFG.SHUTTER_ANY_KEY === true
    });
    // Media keys need playback, which needs a user gesture — the first
    // tap on Start is the earliest one we get.
    if (CFG.SHUTTER_MEDIA_KEYS !== false) {
      const arm = function () {
        window.Remote.startMediaSession();
        document.removeEventListener("pointerdown", arm);
      };
      document.addEventListener("pointerdown", arm, { once: true });
    }
  }

  function wire() {
    $("brandName").firstChild.textContent = CFG.BOOTH_NAME;
    $("btnStart").textContent = CFG.START_LABEL || "Start";
    $("btnAdmin").onclick = function () { location.href = "admin.html"; };
    $("brandEvent").textContent = CFG.EVENT_NAME;
    $("welcomeTitle").textContent = CFG.BOOTH_NAME;
    $("welcomeLead").textContent = CFG.TAGLINE;

    $("btnPrinter").onclick = connectPrinter;
    $("btnPrinter2").onclick = connectPrinter;
    $("btnPrinter3").onclick = connectPrinter;

    $("btnStart").onclick = () => show("scrFrames");
    $("btnFramesBack").onclick = () => show("scrWelcome");
    $("btnUseFrame").onclick = goCapture;

    $("btnCaptureBack").onclick = () => { stopCamera(); show("scrFrames"); };
    $("btnShoot").onclick = takeShot;
    $("btnFlip").onclick = async () => {
      state.facing = state.facing === "user" ? "environment" : "user";
      try { await startCamera(); } catch (e) { toast(e.message, true); }
    };

    if (CFG.ALLOW_GUEST_PRINT === false) {
      $("btnPrint").style.display = "none";
    }
    $("btnRetake").onclick = goCapture;
    $("btnSave").onclick = saveStrip;
    $("btnShare").onclick = shareStrip;
    // The same two on the done screen. keepsake() is still valid there
    // — state is only cleared by hardReset() on "Start over".
    $("btnDoneSave").onclick = saveStrip;
    $("btnDoneShare").onclick = shareStrip;
    $("btnPrint").onclick = doPrint;
    $("btnPrintAgain").onclick = doPrint;
    $("btnFinish").onclick = hardReset;
    $("btnReviewHome").onclick = confirmHome;
    $("btnDoneHome").onclick = hardReset;

    // Keep the screen awake while the booth is running.
    if ("wakeLock" in navigator) {
      const lock = () => navigator.wakeLock.request("screen").catch(() => {});
      lock();
      document.addEventListener("visibilitychange", () => {
        if (document.visibilityState === "visible") lock();
      });
    }
  }

  /* ---------------- boot ---------------- */

  /* Admin sends us here with ?reprint=<id> because the printer code
     lives on this page. Load that saved sheet and print it as-is. */
  async function handleReprint() {
    const id = new URLSearchParams(location.search).get("reprint");
    if (!id || !window.Settings) return false;
    history.replaceState(null, "", location.pathname);
    let rec;
    try {
      rec = await window.Settings.getPrint(id);
    } catch (e) {
      toast("Couldn't read that saved strip", true);
      return false;
    }
    if (!rec) { toast("That strip is no longer saved", true); return false; }

    try {
      // the dot-for-dot copy when we have it, else the colour one
      const bmp = await createImageBitmap(rec.printBlob || rec.blob);
      const c = document.createElement("canvas");
      c.width = bmp.width;
      c.height = bmp.height;
      c.getContext("2d").drawImage(bmp, 0, 0);
      state.sheet = c;
      state.sheetDisplay = null;
      state.bursts = [];
      state.sheetFrames = null;
      state.gifBlob = null;
      state.gifJob = null;
      state.prepared = window.Imaging.prepareForPrint(c, {
        dither: CFG.DITHER,
        ditherSheet: !rec.printBlob   // a colour fallback still needs dithering
      });
      state.frame = { id: rec.frameId || "reprint", name: rec.frameName || "Reprint", shots: 0, slots: [] };

      showPreview(rec.blob ? await blobToCanvas(rec.blob) : window.Imaging.bitsToCanvas(state.prepared));
      show("scrReview");
      toast("Reprint ready — tap Print it");
      return true;
    } catch (e) {
      toast("Couldn't prepare that strip: " + e.message, true);
      return false;
    }
  }

  async function boot() {
    state.sessionId = uid(10);
    if (window.Settings) window.Settings.applyOrientation();
    wire();
    startRemote();

    // Trim a REST/storage endpoint down to the project origin — the
    // dashboard makes that URL easy to copy, and supabase-js needs the
    // bare origin or every request 404s on an invalid path.
    const sbUrl = String(CFG.SUPABASE_URL || "").trim()
      .replace(/\/+$/, "")
      .replace(/\/(rest|auth|storage|realtime)\/v\d.*$/i, "")
      .replace(/\/+$/, "");

    if (sbUrl && CFG.SUPABASE_ANON_KEY && window.supabase) {
      supabase = window.supabase.createClient(sbUrl, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }

    loadFrames();        // built-ins are set synchronously
    renderFrameGrid();   // …so the picker is usable immediately

    if (!window.Printer.isSupported()) {
      toast("This browser can't talk to USB printers. Use Chrome or Edge over HTTPS.", true);
    } else {
      window.Printer.reconnect().then(paintPrinter);
    }
    paintPrinter();

    await handleReprint();
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

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
    shots: [],          // canvas per slot
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
  async function loadFrames() {
    state.frames = window.Settings
      ? window.Settings.allFrames()
      : window.BUILTIN_FRAMES.slice();
    if (!supabase) return;
    try {
      const res = await supabase
        .from("frames")
        .select("*")
        .eq("active", true)
        .order("sort_order", { ascending: true });
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
      }
    } catch (e) {
      console.warn("Frame fetch failed, using built-ins:", e.message);
    }
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

  /** Point the preview box at the slot being filled right now. */
  function applySlotShape() {
    const i = Math.min(state.shots.length, state.frame.slots.length - 1);
    $("stage").style.setProperty("--slot-ar", String(slotAspect(i)));
  }

  /** Little strip showing filled slots and the one being shot. */
  function paintMiniStrip() {
    const el = $("miniStrip");
    const f = state.frame;
    if (!f || !f.slots.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = "";

    const head = document.createElement("b");
    head.textContent = CFG.BOOTH_NAME || "";
    el.appendChild(head);

    const inner = 74 - 12 - 5;   // box width minus padding and borders
    const k = inner / f.width;
    f.slots.forEach(function (s, i) {
      const cell = document.createElement("s");
      cell.style.width = Math.round(s.w * k) + "px";
      cell.style.height = Math.round(s.h * k) + "px";
      cell.style.alignSelf = "center";
      if (state.shots[i]) {
        const img = document.createElement("img");
        img.src = state.shots[i].toDataURL("image/jpeg", 0.5);
        cell.appendChild(img);
      } else if (i === state.shots.length) {
        cell.className = "now";
      }
      el.appendChild(cell);
    });
  }

  function paintShots() {
    const wrap = $("shots");
    wrap.innerHTML = "";
    for (let i = 0; i < state.frame.shots; i++) {
      const d = document.createElement("div");
      d.className = "thumb" + (state.shots[i] ? " done" : "");
      if (state.shots[i]) {
        const img = new Image();
        img.src = state.shots[i].toDataURL("image/jpeg", 0.6);
        d.appendChild(img);
      }
      wrap.appendChild(d);
    }
    $("captureCount").textContent =
      Math.min(state.shots.length + 1, state.frame.shots) + " / " + state.frame.shots;
    applySlotShape();
    paintMiniStrip();
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

  async function takeShot() {
    if (state.shooting) return;
    state.shooting = true;
    $("btnShoot").disabled = true;
    $("captureHint").textContent = "Get ready";
    try {
      await countdown(CFG.COUNTDOWN_SECONDS);
      const flash = $("flash");
      flash.classList.remove("fire");
      void flash.offsetWidth;
      flash.classList.add("fire");
      state.shots.push(await capturePhoto());
      paintShots();
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
    const text = {
      overlay: overlay,
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

    showPreview(state.sheetDisplay);
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

  async function saveStrip() {
    const src = keepsake();
    if (!src) return;
    try {
      const blob = await canvasToBlob(src, "image/jpeg", 0.92);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = stripFilename("jpg");
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast("Saved to this tablet");
    } catch (e) {
      toast("Couldn't save: " + e.message, true);
    }
  }

  async function shareStrip() {
    const src = keepsake();
    if (!src) return;
    let blob;
    try {
      blob = await canvasToBlob(src, "image/jpeg", 0.92);
    } catch (e) {
      toast("Couldn't prepare the photo", true);
      return;
    }
    const file = new File([blob], stripFilename("jpg"), { type: "image/jpeg" });

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

  async function doPrint() {
    if (!window.Printer.isConnected()) {
      toast("Connect the printer first — tap the Printer button", true);
      return;
    }
    show("scrPrinting");
    try {
      for (let i = 0; i < Math.max(1, CFG.AUTO_PRINT_COPIES); i++) {
        $("printingMsg").textContent =
          CFG.AUTO_PRINT_COPIES > 1 ? "PRINTING " + (i + 1) + " / " + CFG.AUTO_PRINT_COPIES : "PRINTING…";
        await window.Printer.print(state.prepared, {
          bandRows: CFG.RASTER_BAND_ROWS,
          chunkBytes: CFG.USB_CHUNK_BYTES,
          cutMode: CFG.CUT_MODE,
          feedBeforeCut: CFG.FEED_BEFORE_CUT,
          density: CFG.PRINT_DENSITY,
          speed: CFG.PRINT_SPEED
        });
      }
      await finishSession();
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
  async function saveLocalCopy(remoteUrl) {
    if (!window.Settings || !state.sheet) return;
    if (!state.shots.length) return;   // a reprint is already saved
    try {
      const blob = await canvasToBlob(keepsake(), "image/jpeg", 0.9);
      if (!blob) return;
      // keep the dot-for-dot version too, so a reprint is identical
      const printBlob = await canvasToBlob(
        window.Imaging.bitsToCanvas(state.prepared), "image/png");
      await window.Settings.addPrint(blob, {
        printBlob: printBlob,
        frameId: String(state.frame.id),
        frameName: state.frame.name,
        remoteUrl: remoteUrl || ""
      });
    } catch (e) {
      console.warn("Local copy failed:", e.message);
    }
  }

  async function finishSession() {
    $("qrBox").style.display = "none";
    state.guestUrl = null;

    if (!supabase || !CFG.UPLOAD_PHOTOS) {
      await saveLocalCopy("");
      $("doneLead").textContent = "Collect your print from the printer";
      return;
    }

    try {
      const d = new Date();
      const path = d.toISOString().slice(0, 10) + "/" +
                   d.toISOString().slice(11, 19).replace(/:/g, "") + "-" + uid(4) + ".jpg";
      const blob = await canvasToBlob(keepsake(), "image/jpeg", 0.92);

      const up = await supabase.storage
        .from(CFG.PHOTO_BUCKET)
        .upload(path, blob, { contentType: "image/jpeg", upsert: false });
      if (up.error) throw up.error;

      const { data: pub } = supabase.storage.from(CFG.PHOTO_BUCKET).getPublicUrl(path);
      state.guestUrl = pub.publicUrl;

      const ins = await supabase.from("prints").insert({
        session_id: state.sessionId,
        frame_id: String(state.frame.id),
        storage_path: path,
        copies: Math.max(1, CFG.AUTO_PRINT_COPIES)
      });
      if (ins.error) console.warn("prints insert:", ins.error.message);

      await saveLocalCopy(state.guestUrl);

      if (CFG.SHOW_QR && state.guestUrl && window.QRCode) {
        await window.QRCode.toCanvas($("qrCanvas"), state.guestUrl, { width: 200, margin: 1 });
        $("qrBox").style.display = "block";
        $("doneLead").textContent = "Scan the code to keep a digital copy";
      } else {
        $("doneLead").textContent = "Collect your print from the printer";
      }
    } catch (e) {
      console.warn("Upload failed:", e.message);
      await saveLocalCopy("");
      $("doneLead").textContent = "Collect your print from the printer";
    }
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
    state.shots = [];
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
    try {
      await startCamera();
    } catch (e) {
      toast("Camera blocked: " + e.message, true);
      show("scrFrames");
    }
  }

  /* ---------------- wiring ---------------- */

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
    wire();

    if (CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY && window.supabase) {
      supabase = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY, {
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }
      });
    }

    await loadFrames();
    renderFrameGrid();

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

/* ============================================================
   PHOTOBOOTH KIOSK — flow controller
   welcome -> frames -> capture -> review -> print -> done
   ============================================================ */
(function () {
  "use strict";

  const CFG = window.CONFIG;
  const $ = id => document.getElementById(id);

  const state = {
    frames: [],
    frame: null,
    shots: [],          // canvas per slot
    sheet: null,        // composed canvas
    prepared: null,     // 1-bit bitmap
    stream: null,
    facing: "user",
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
      card.className = "frame-card";
      const cv = document.createElement("canvas");
      drawFramePreview(cv, frame);
      const label = document.createElement("div");
      label.className = "label";
      label.textContent = frame.name + " · " + frame.shots + " shot" + (frame.shots > 1 ? "s" : "");
      card.appendChild(cv);
      card.appendChild(label);
      card.onclick = function () {
        state.frame = frame;
        grid.querySelectorAll(".frame-card").forEach(c => c.classList.remove("sel"));
        card.classList.add("sel");
        $("btnUseFrame").disabled = false;
      };
      grid.appendChild(card);
    });
  }

  // Optional: frames defined in Supabase override/extend the built-ins.
  async function loadFrames() {
    state.frames = window.BUILTIN_FRAMES.slice();
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
        width: { ideal: 1920 },
        height: { ideal: 1080 }
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

  function grabFrame() {
    const v = $("video");
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d");
    if (CFG.MIRROR_PREVIEW && state.facing === "user") {
      ctx.translate(c.width, 0);
      ctx.scale(-1, 1);
    }
    ctx.drawImage(v, 0, 0, c.width, c.height);
    return c;
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
      state.shots.push(grabFrame());
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
    state.sheet = window.Imaging.compose(state.frame, state.shots, {
      width: CFG.PRINT_WIDTH_DOTS,
      overlay: overlay,
      header: CFG.BOOTH_NAME,
      subheader: CFG.EVENT_NAME,
      footer: CFG.FOOTER_LINE,
      stamp: stamp(new Date())
    });

    state.prepared = window.Imaging.prepareForPrint(state.sheet, {
      brightness: CFG.BRIGHTNESS,
      blurPasses: CFG.BLUR_PASSES,
      contrastStretch: CFG.CONTRAST_STRETCH
    });

    // Preview shows the real 1-bit result, so what you see is what prints.
    const preview = window.Imaging.bitsToCanvas(state.prepared);
    const target = $("previewCanvas");
    target.width = preview.width;
    target.height = preview.height;
    target.getContext("2d").drawImage(preview, 0, 0);
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
          feedBeforeCut: CFG.FEED_BEFORE_CUT
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

  async function finishSession() {
    $("qrBox").style.display = "none";
    state.guestUrl = null;

    if (!supabase || !CFG.UPLOAD_PHOTOS) {
      $("doneLead").textContent = "Collect your print from the printer";
      return;
    }

    try {
      const d = new Date();
      const path = d.toISOString().slice(0, 10) + "/" +
                   d.toISOString().slice(11, 19).replace(/:/g, "") + "-" + uid(4) + ".jpg";
      const blob = await canvasToBlob(state.sheet, "image/jpeg", 0.92);

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

      if (CFG.SHOW_QR && state.guestUrl && window.QRCode) {
        await window.QRCode.toCanvas($("qrCanvas"), state.guestUrl, { width: 200, margin: 1 });
        $("qrBox").style.display = "block";
        $("doneLead").textContent = "Scan the code to keep a digital copy";
      } else {
        $("doneLead").textContent = "Collect your print from the printer";
      }
    } catch (e) {
      console.warn("Upload failed:", e.message);
      $("doneLead").textContent = "Collect your print from the printer";
    }
  }

  /* ---------------- navigation ---------------- */

  function hardReset() {
    stopCamera();
    state.shots = [];
    state.frame = null;
    state.sheet = null;
    state.prepared = null;
    state.sessionId = uid(10);
    $("btnUseFrame").disabled = true;
    document.querySelectorAll(".frame-card").forEach(c => c.classList.remove("sel"));
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

    $("btnRetake").onclick = goCapture;
    $("btnPrint").onclick = doPrint;
    $("btnPrintAgain").onclick = doPrint;
    $("btnFinish").onclick = hardReset;

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
  }

  document.addEventListener("DOMContentLoaded", boot);
})();

/* ============================================================
   ADMIN
   Everything saved here lives on this tablet (localStorage +
   IndexedDB) and overrides the defaults in config.js. Nothing is
   written back to the code, so a reset always gets you home.
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);

  /* Which settings each form field maps to, and how to read it. */
  const FIELDS = {
    BOOTH_NAME: "text", EVENT_NAME: "text", TAGLINE: "text",
    START_LABEL: "text", FOOTER_LINE: "text", ADMIN_PIN: "text",
    SUPABASE_URL: "text", SUPABASE_ANON_KEY: "text",
    CAMERA_FACING: "text", DITHER: "text", CUT_MODE: "text",
    PRINT_WIDTH_DOTS: "int", FEED_BEFORE_CUT: "int",
    PHOTO_DOT_SIZE: "int", COUNTDOWN_SECONDS: "int",
    AUTO_PRINT_COPIES: "int", IDLE_RESET_SECONDS: "int",
    KEEP_LOCAL_COPIES: "int", CAMERA_IDEAL_WIDTH: "int",
    PRINT_SPEED: "intOrNull", PRINT_DENSITY: "intOrNull",
    PHOTO_GAMMA: "float", PHOTO_LOCAL_CONTRAST: "float", PHOTO_SHARPEN: "float",
    MIRROR_PREVIEW: "bool", PHOTO_AUTO_LEVELS: "bool",
    ALLOW_GUEST_PRINT: "bool", UPLOAD_PHOTOS: "bool", SHOW_QR: "bool"
  };

  function toast(msg, isError) {
    const t = $("toast");
    t.textContent = msg;
    t.className = "toast show" + (isError ? " err" : "");
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.className = "toast"; }, isError ? 7000 : 3000);
  }

  /* ---------- PIN gate ---------- */

  function unlock() {
    const cfg = window.Settings.load();
    const want = String(cfg.ADMIN_PIN == null ? "" : cfg.ADMIN_PIN);
    if (!want || $("pin").value === want) {
      $("gate").hidden = true;
      $("admin").hidden = false;
      start();
    } else {
      toast("That PIN doesn't match", true);
      $("pin").value = "";
      $("pin").focus();
    }
  }

  /* ---------- form <-> settings ---------- */

  function fill() {
    const cfg = window.Settings.load();
    Object.keys(FIELDS).forEach(function (k) {
      const el = $("f_" + k);
      if (!el) return;
      const v = cfg[k];
      if (FIELDS[k] === "bool") el.checked = !!v;
      else if (v === null || v === undefined) el.value = "";
      else el.value = String(v);
    });
  }

  function collect() {
    const out = {};
    let bad = null;
    Object.keys(FIELDS).forEach(function (k) {
      const el = $("f_" + k);
      if (!el) return;
      const kind = FIELDS[k];
      if (kind === "bool") { out[k] = el.checked; return; }
      const raw = el.value.trim();
      if (kind === "intOrNull") {
        out[k] = raw === "" ? null : parseInt(raw, 10);
        if (raw !== "" && isNaN(out[k])) bad = bad || k;
        return;
      }
      if (kind === "int") {
        const n = parseInt(raw, 10);
        if (isNaN(n)) { bad = bad || k; return; }
        out[k] = n;
        return;
      }
      if (kind === "float") {
        const n = parseFloat(raw);
        if (isNaN(n)) { bad = bad || k; return; }
        out[k] = n;
        return;
      }
      out[k] = raw;
    });
    return { values: out, bad: bad };
  }

  function save() {
    const got = collect();
    if (got.bad) {
      toast("Check the " + got.bad.toLowerCase().replace(/_/g, " ") + " field — that isn't a number", true);
      return;
    }
    if (!String(got.values.BOOTH_NAME || "").trim()) {
      toast("The booth needs a name", true);
      return;
    }
    if (window.Settings.save(got.values)) {
      toast("Saved. The booth picks this up on its next load.");
    } else {
      toast("Couldn't save — the tablet may be blocking storage", true);
    }
  }

  /* ---------- layouts ---------- */

  function drawThumb(canvas, frame) {
    const sc = 70 / frame.width;
    canvas.width = Math.round(frame.width * sc);
    canvas.height = Math.round(frame.height * sc);
    const c = canvas.getContext("2d");
    c.fillStyle = "#fff";
    c.fillRect(0, 0, canvas.width, canvas.height);
    c.fillStyle = "#cfc8e8";
    c.strokeStyle = "#1a1626";
    c.lineWidth = 1;
    frame.slots.forEach(function (s) {
      c.fillRect(s.x * sc, s.y * sc, s.w * sc, s.h * sc);
      c.strokeRect(s.x * sc, s.y * sc, s.w * sc, s.h * sc);
    });
  }

  function renderTemplates() {
    const wrap = $("tplList");
    wrap.innerHTML = "";
    const cfg = window.Settings.load();
    const hidden = cfg.HIDDEN_FRAMES || [];
    const custom = window.Settings.customFrames();
    const all = (window.BUILTIN_FRAMES || []).concat(custom);

    all.forEach(function (f) {
      const isCustom = custom.some(c => c.id === f.id);
      const row = document.createElement("div");
      row.className = "tpl";

      const cv = document.createElement("canvas");
      drawThumb(cv, f);

      const meta = document.createElement("div");
      meta.className = "meta";
      const mm = Math.round(Math.max.apply(null, f.slots.map(s => s.w)) / 203 * 25.4);
      meta.innerHTML = '<div class="nm"></div><div class="sub">' +
        f.shots + ' photo' + (f.shots > 1 ? 's' : '') + ' · ' + mm + 'mm wide' +
        (isCustom ? ' · <span class="pill">yours</span>' : '') + '</div>';
      meta.querySelector(".nm").textContent = f.name;

      const acts = document.createElement("div");
      acts.style.cssText = "display:flex;flex-direction:column;gap:6px";

      const off = hidden.indexOf(f.id) !== -1;
      const tog = document.createElement("button");
      tog.className = "btn sm " + (off ? "alt" : "go");
      tog.textContent = off ? "Off" : "On";
      tog.onclick = function () {
        const h = (window.Settings.load().HIDDEN_FRAMES || []).slice();
        const i = h.indexOf(f.id);
        if (i === -1) h.push(f.id); else h.splice(i, 1);
        window.Settings.save({ HIDDEN_FRAMES: h });
        renderTemplates();
      };
      acts.appendChild(tog);

      if (isCustom) {
        const del = document.createElement("button");
        del.className = "btn sm warn";
        del.textContent = "Delete";
        del.onclick = function () {
          if (!confirm('Delete the layout "' + f.name + '"?')) return;
          window.Settings.saveCustomFrames(custom.filter(c => c.id !== f.id));
          renderTemplates();
          toast("Layout deleted");
        };
        acts.appendChild(del);
      }

      row.appendChild(cv);
      row.appendChild(meta);
      row.appendChild(acts);
      wrap.appendChild(row);
    });
  }

  /* Lay slots out across the full printable width. One column for
     1-3 photos, two columns for 4 or more. */
  function buildLayout(name, shots, ratio) {
    const W = 576, M = 16, GAP = 16, TOP = 140, BOTTOM = 130;
    const cols = shots >= 4 ? 2 : 1;
    const rows = Math.ceil(shots / cols);
    const sw = Math.floor((W - M * 2 - (cols - 1) * (cols > 1 ? 8 : 0)) / cols);
    const sh = Math.round(sw / ratio);
    const slots = [];
    for (let i = 0; i < shots; i++) {
      const r = Math.floor(i / cols), c = i % cols;
      slots.push({
        x: M + c * (sw + 8),
        y: TOP + r * (sh + GAP),
        w: sw,
        h: sh
      });
    }
    const height = TOP + rows * sh + (rows - 1) * GAP + BOTTOM;
    return {
      id: "c" + Date.now().toString(36),
      name: name,
      width: W,
      height: height,
      shots: shots,
      header: true,
      slots: slots
    };
  }

  function addTemplate() {
    const name = $("t_name").value.trim();
    if (!name) { toast("Give the layout a name", true); return; }
    const shots = parseInt($("t_shots").value, 10);
    const ratio = parseFloat($("t_ratio").value);
    const f = buildLayout(name, shots, ratio);
    const list = window.Settings.customFrames();
    list.push(f);
    if (window.Settings.saveCustomFrames(list)) {
      $("t_name").value = "";
      renderTemplates();
      toast('Added "' + name + '"');
    } else {
      toast("Couldn't save the layout", true);
    }
  }

  /* ---------- photos ---------- */

  let urls = [];
  function freeUrls() {
    urls.forEach(u => URL.revokeObjectURL(u));
    urls = [];
  }

  function renderPhotos() {
    const wrap = $("shotList");
    freeUrls();
    wrap.innerHTML = "";
    $("photoNote").textContent = "Loading…";

    window.Settings.listPrints().then(function (rows) {
      const cfg = window.Settings.load();
      $("photoNote").textContent = rows.length
        ? "Kept on this tablet, newest first. The last " + (cfg.KEEP_LOCAL_COPIES || 40) + " are stored."
        : "";
      if (!rows.length) {
        wrap.innerHTML = '<div class="empty">No strips yet.<br>They appear here after the booth prints one.</div>';
        return;
      }
      rows.forEach(function (r) {
        const url = URL.createObjectURL(r.blob);
        urls.push(url);

        const card = document.createElement("div");
        card.className = "shot";

        const img = document.createElement("img");
        img.src = url;
        img.alt = "";
        card.appendChild(img);

        const when = document.createElement("div");
        when.className = "when";
        when.textContent = new Date(r.at).toLocaleString();
        card.appendChild(when);

        const act = document.createElement("div");
        act.className = "act";

        const pr = document.createElement("button");
        pr.className = "btn sm go";
        pr.textContent = "Print";
        pr.onclick = () => reprint(r, pr);
        act.appendChild(pr);

        const sh = document.createElement("button");
        sh.className = "btn sm alt";
        sh.textContent = "Share";
        sh.onclick = () => share(r, url);
        act.appendChild(sh);

        const del = document.createElement("button");
        del.className = "btn sm warn";
        del.textContent = "Delete";
        del.onclick = function () {
          if (!confirm("Delete this strip?")) return;
          window.Settings.deletePrint(r.id).then(renderPhotos);
        };
        act.appendChild(del);

        card.appendChild(act);
        wrap.appendChild(card);
      });
    }).catch(function (e) {
      $("photoNote").textContent = "";
      wrap.innerHTML = '<div class="empty">Can\'t read saved strips on this device.<br>' +
        (e.message || "Storage is unavailable.") + "</div>";
    });
  }

  /* Reprinting needs the printer libraries, which the booth page
     owns. Rather than duplicate them, hand the job to the booth. */
  function reprint(rec, btn) {
    btn.disabled = true;
    try {
      sessionStorage.setItem("kiosk.reprint", rec.id);
      toast("Opening the booth to print this…");
      setTimeout(function () { location.href = "index.html?reprint=" + encodeURIComponent(rec.id); }, 500);
    } catch (e) {
      btn.disabled = false;
      toast("Couldn't start the reprint", true);
    }
  }

  async function share(rec, url) {
    const file = new File([rec.blob], "photobooth.jpg", { type: rec.blob.type || "image/jpeg" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: "Photobooth" });
        window.Settings.updatePrint(rec.id, { shared: true });
        return;
      } catch (e) {
        if (e && e.name === "AbortError") return;
      }
    }
    if (rec.remoteUrl) {
      window.open(rec.remoteUrl, "_blank", "noopener");
      return;
    }
    const a = document.createElement("a");
    a.href = url;
    a.download = "photobooth-" + rec.id + ".jpg";
    a.click();
    toast("Downloaded — share it from your gallery");
  }

  /* ---------- printer tools ---------- */

  function paintPrinter() {
    const el = $("connState");
    if (!el) return;
    if (!window.Printer || !window.Printer.isSupported()) {
      el.textContent = "This browser can't reach USB printers";
      return;
    }
    const on = window.Printer.isConnected();
    el.textContent = on ? "Connected" : "Not connected";
    el.style.color = on ? "var(--jade)" : "var(--ink-soft)";
    $("btnConnect").textContent = on ? "Reconnect" : "Connect printer";
  }

  function printOpts() {
    const c = window.Settings.load();
    return {
      bandRows: c.RASTER_BAND_ROWS,
      chunkBytes: c.USB_CHUNK_BYTES,
      cutMode: c.CUT_MODE,
      feedBeforeCut: c.FEED_BEFORE_CUT,
      density: c.PRINT_DENSITY,
      speed: c.PRINT_SPEED
    };
  }

  function needPrinter() {
    if (window.Printer && window.Printer.isConnected()) return true;
    toast("Connect the printer first", true);
    return false;
  }

  /* The settings test needs a real face, so pull one out of the newest
     saved strip rather than making the operator shoot again here. */
  async function newestPhoto() {
    const rows = await window.Settings.listPrints();
    if (!rows.length) return null;
    const rec = rows[0];
    const bmp = await createImageBitmap(rec.blob);

    const frames = (window.BUILTIN_FRAMES || []).concat(window.Settings.customFrames());
    const f = frames.filter(x => String(x.id) === String(rec.frameId))[0];
    if (!f || !f.slots.length) return bmp;

    const k = bmp.width / f.width;
    const s = f.slots[0];
    const c = document.createElement("canvas");
    c.width = Math.round(s.w * k);
    c.height = Math.round(s.h * k);
    c.getContext("2d").drawImage(
      bmp, s.x * k, s.y * k, s.w * k, s.h * k, 0, 0, c.width, c.height);
    return c;
  }

  async function runSettingsTest(btn) {
    if (!needPrinter()) return;
    const cfg = window.Settings.load();
    btn.disabled = true;
    try {
      const photo = await newestPhoto();
      if (!photo) {
        toast("Take a photo in the booth first — the test needs a real one", true);
        return;
      }
      const card = window.Imaging.buildTestCard(photo, cfg.PRINT_WIDTH_DOTS, {
        dither: cfg.DITHER, gamma: cfg.PHOTO_GAMMA, autoLevels: cfg.PHOTO_AUTO_LEVELS
      });
      await window.Printer.print(
        window.Imaging.prepareForPrint(card, { dither: cfg.DITHER }), printOpts());
      toast("Compare A to D, then set Dot size to match the best one");
    } catch (e) {
      toast("Test print failed: " + e.message, true);
    } finally {
      btn.disabled = false;
      paintPrinter();
    }
  }

  async function runDiagnostic(btn) {
    if (!needPrinter()) return;
    const cfg = window.Settings.load();
    btn.disabled = true;
    try {
      const card = window.Imaging.buildDiagnostic(cfg.PRINT_WIDTH_DOTS);
      await window.Printer.print(
        window.Imaging.prepareForPrint(card, {}), printOpts());
      toast("Check the black bars for streaks or fading");
    } catch (e) {
      toast("Diagnostic failed: " + e.message, true);
    } finally {
      btn.disabled = false;
      paintPrinter();
    }
  }

  /* ---------- tabs ---------- */

  function showPanel(name) {
    document.querySelectorAll(".tab").forEach(t => t.classList.toggle("on", t.dataset.p === name));
    document.querySelectorAll(".panel").forEach(p => p.classList.toggle("on", p.dataset.p === name));
    if (name === "photos") renderPhotos();
    if (name === "tpl") renderTemplates();
  }

  /* ---------- boot ---------- */

  function start() {
    fill();
    renderTemplates();

    document.querySelectorAll(".tab").forEach(function (t) {
      t.onclick = () => showPanel(t.dataset.p);
    });

    $("btnSave").onclick = save;
    $("btnKiosk").onclick = () => { location.href = "index.html"; };
    $("btnAddTpl").onclick = addTemplate;
    $("btnRefresh").onclick = renderPhotos;
    $("btnClearPhotos").onclick = function () {
      if (!confirm("Delete every strip saved on this tablet?")) return;
      window.Settings.clearPrints().then(function () {
        renderPhotos();
        toast("All strips deleted");
      });
    };
    $("btnConnect").onclick = async function () {
      try {
        await window.Printer.connect();
        toast("Printer connected");
      } catch (e) {
        toast(e.message || "Couldn't connect", true);
      }
      paintPrinter();
    };
    $("btnTestCard").onclick = function () { runSettingsTest(this); };
    $("btnDiag").onclick = function () { runDiagnostic(this); };
    $("btnTestSlip").onclick = async function () {
      if (!needPrinter()) return;
      try {
        await window.Printer.printTest(printOpts());
        toast("Test slip sent");
      } catch (e) {
        toast(e.message, true);
      }
    };
    if (window.Printer) {
      window.Printer.onStatus = paintPrinter;
      window.Printer.reconnect().then(paintPrinter);
    }
    paintPrinter();

    $("btnResetAll").onclick = function () {
      if (!confirm("Put every setting back to its default?")) return;
      window.Settings.reset();
      fill();
      renderTemplates();
      toast("Settings reset");
    };
  }

  window.addEventListener("pagehide", freeUrls);

  document.addEventListener("DOMContentLoaded", function () {
    $("btnUnlock").onclick = unlock;
    $("btnLeave").onclick = () => { location.href = "index.html"; };
    $("pin").addEventListener("keydown", e => { if (e.key === "Enter") unlock(); });

    // No PIN set means no gate.
    const cfg = window.Settings.load();
    if (!String(cfg.ADMIN_PIN == null ? "" : cfg.ADMIN_PIN)) {
      $("gate").hidden = true;
      $("admin").hidden = false;
      start();
    } else {
      $("pin").focus();
    }
  });
})();

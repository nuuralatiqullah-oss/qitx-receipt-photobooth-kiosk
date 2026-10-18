/* ============================================================
   SETTINGS + LOCAL PHOTO STORE
   Shared by the kiosk (index.html) and Admin (admin.html).

   Settings: CONFIG defaults with an overlay saved on this tablet.
   Admin writes the overlay; the kiosk reads the merged result, so
   changes apply on the next reload without touching any code.

   Photos: recent printed sheets kept in IndexedDB on the tablet so
   Admin can reprint or share them even with no internet. Supabase,
   when configured, is the off-device copy on top of this.
   ============================================================ */
(function () {
  "use strict";

  const KEY = "kiosk.settings.v1";
  const DB_NAME = "kiosk-photos";
  const STORE = "prints";
  const TPL = "templates";

  const Settings = {};

  /* ---------- settings ---------- */

  Settings.overlay = function () {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
    } catch (e) {
      return {};
    }
  };

  /** Defaults with the tablet's saved overrides on top. */
  Settings.load = function () {
    const base = window.CONFIG || {};
    const over = Settings.overlay();
    const out = {};
    Object.keys(base).forEach(k => { out[k] = base[k]; });
    Object.keys(over).forEach(k => {
      if (over[k] !== undefined && over[k] !== null) out[k] = over[k];
    });
    return out;
  };

  /** Merge a partial change into the overlay. Returns true on success. */
  Settings.save = function (partial) {
    try {
      const over = Settings.overlay();
      Object.keys(partial).forEach(k => { over[k] = partial[k]; });
      localStorage.setItem(KEY, JSON.stringify(over));
      return true;
    } catch (e) {
      return false;
    }
  };

  /** Drop every override and go back to the values in config.js. */
  Settings.reset = function () {
    try { localStorage.removeItem(KEY); return true; } catch (e) { return false; }
  };

  Settings.isOverridden = function (k) {
    return Object.prototype.hasOwnProperty.call(Settings.overlay(), k);
  };

  /* ---------- custom frames saved on this tablet ---------- */

  const FRAME_KEY = "kiosk.frames.v1";

  Settings.customFrames = function () {
    try {
      const v = JSON.parse(localStorage.getItem(FRAME_KEY) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };

  Settings.saveCustomFrames = function (list) {
    try { localStorage.setItem(FRAME_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  };

  /** Built-in frames plus any added in Admin, with hidden ones removed. */
  Settings.allFrames = function () {
    const cfg = Settings.load();
    const hidden = cfg.HIDDEN_FRAMES || [];
    const builtin = (window.BUILTIN_FRAMES || []).slice();
    const custom = Settings.customFrames();
    return builtin.concat(custom).filter(f => hidden.indexOf(f.id) === -1);
  };

  /* ---------- uploaded template artwork ---------- */

  /** Store a template PNG. Kept in IndexedDB — far too big for localStorage. */
  Settings.saveTemplate = function (id, blob) {
    return tx("readwrite", s => { s.put({ id: id, blob: blob }); }, TPL);
  };

  Settings.getTemplate = function (id) {
    return tx("readonly", s => ({ __req: s.get(id) }), TPL)
      .then(rec => (rec ? rec.blob : null));
  };

  Settings.deleteTemplate = function (id) {
    return tx("readwrite", s => { s.delete(id); }, TPL);
  };

  /* ---------- recent prints (IndexedDB) ---------- */

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("No IndexedDB"));
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = function () {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(TPL)) {
          db.createObjectStore(TPL, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB blocked"));
    });
  }

  function tx(mode, fn, which) {
    const name = which || STORE;
    return openDb().then(db => new Promise(function (resolve, reject) {
      const t = db.transaction(name, mode);
      const store = t.objectStore(name);
      let result;
      try { result = fn(store); } catch (e) { return reject(e); }
      t.oncomplete = () => resolve(result && result.__req ? result.__req.result : result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error("aborted"));
    }));
  }

  /**
   * Save one printed sheet.
   * @param {Blob} blob   the colour keepsake, for showing and sharing
   * @param {object} meta { printBlob, frameId, frameName, remoteUrl }
   */
  Settings.addPrint = function (blob, meta) {
    const rec = {
      id: String(Date.now()) + "-" + Math.random().toString(36).slice(2, 7),
      at: Date.now(),
      blob: blob,                               // colour keepsake
      printBlob: (meta && meta.printBlob) || null,  // exact 1-bit print
      frameId: (meta && meta.frameId) || "",
      frameName: (meta && meta.frameName) || "",
      remoteUrl: (meta && meta.remoteUrl) || "",
      printed: true,
      shared: false
    };
    return tx("readwrite", s => { s.put(rec); }).then(function () {
      return Settings.trimPrints().then(() => rec);
    });
  };

  Settings.listPrints = function () {
    return tx("readonly", s => ({ __req: s.getAll() })).then(function (rows) {
      return (rows || []).sort((a, b) => b.at - a.at);
    });
  };

  Settings.getPrint = function (id) {
    return tx("readonly", s => ({ __req: s.get(id) }));
  };

  Settings.updatePrint = function (id, patch) {
    return Settings.getPrint(id).then(function (rec) {
      if (!rec) throw new Error("Print not found");
      Object.keys(patch).forEach(k => { rec[k] = patch[k]; });
      return tx("readwrite", s => { s.put(rec); }).then(() => rec);
    });
  };

  Settings.deletePrint = function (id) {
    return tx("readwrite", s => { s.delete(id); });
  };

  Settings.clearPrints = function () {
    return tx("readwrite", s => { s.clear(); });
  };

  /** Keep only the newest KEEP_LOCAL_COPIES so storage can't fill up. */
  Settings.trimPrints = function () {
    const keep = Settings.load().KEEP_LOCAL_COPIES || 40;
    return Settings.listPrints().then(function (rows) {
      const extra = rows.slice(keep);
      if (!extra.length) return;
      return tx("readwrite", function (s) {
        extra.forEach(r => s.delete(r.id));
      });
    });
  };

  /**
   * Pin or release the screen rotation. The manifest only sets a
   * default at install time, so an installed app keeps whatever it was
   * installed with — doing it here means a change in Admin applies
   * straight away, with no reinstall.
   * Quietly does nothing where the browser won't allow it (a normal
   * tab, or desktop).
   */
  Settings.applyOrientation = function () {
    const want = Settings.load().ORIENTATION || "any";
    const so = window.screen && window.screen.orientation;
    if (!so) return;
    try {
      if (want === "any") {
        if (so.unlock) so.unlock();
      } else if (so.lock) {
        const p = so.lock(want);
        if (p && p.catch) p.catch(function () {});
      }
    } catch (e) {
      /* not permitted outside an installed app — fine */
    }
  };

  window.Settings = Settings;
})();

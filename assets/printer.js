/* ============================================================
   THERMAL PRINTER — Citizen CT-S310II over WebUSB (ESC/POS)
   Works with any ESC/POS printer that supports GS v 0 raster.

   Requires: HTTPS (GitHub Pages is fine) + Chrome/Edge.
   Android: USB-C OTG cable, tablet must grant the USB prompt.
   ============================================================ */
(function () {
  "use strict";

  const ESC = 0x1b, GS = 0x1d;

  // Known USB vendor IDs worth offering in the picker. Citizen = 0x1d90.
  // The filter list only pre-sorts the chooser; the user can still pick
  // "show all devices" if their unit reports something unexpected.
  const VENDOR_FILTERS = [
    { vendorId: 0x1d90 }, // Citizen Systems
    { vendorId: 0x04b8 }, // Epson
    { vendorId: 0x0519 }, // Star
    { vendorId: 0x0416 }, // Winbond (generic POS clones)
    { vendorId: 0x0483 }, // STMicro (generic POS clones)
    { vendorId: 0x6868 }, // common no-name 58mm
    { vendorId: 0x0fe6 }  // ICS Advent / generic
  ];

  const Printer = {
    device: null,
    iface: null,
    endpoint: null,
    busy: false,
    onStatus: function () {}
  };

  Printer.isSupported = function () {
    return typeof navigator !== "undefined" && !!navigator.usb;
  };

  Printer.isConnected = function () {
    return !!(Printer.device && Printer.device.opened && Printer.endpoint !== null);
  };

  function status(state, msg) {
    try { Printer.onStatus(state, msg); } catch (e) {}
  }

  async function claim(device) {
    await device.open();
    if (device.configuration === null) await device.selectConfiguration(1);

    // Find the interface that exposes a bulk OUT endpoint.
    // Printer class is 0x07, but plenty of units report vendor-specific.
    let chosen = null, endpointNumber = null;
    for (const cfg of device.configurations) {
      for (const iface of cfg.interfaces) {
        for (const alt of iface.alternates) {
          const out = alt.endpoints.find(
            e => e.direction === "out" && e.type === "bulk"
          );
          if (out && (chosen === null || alt.interfaceClass === 0x07)) {
            chosen = iface.interfaceNumber;
            endpointNumber = out.endpointNumber;
            if (alt.interfaceClass === 0x07) break;
          }
        }
      }
    }
    if (chosen === null) throw new Error("No bulk OUT endpoint on this device");

    try {
      await device.claimInterface(chosen);
    } catch (e) {
      // Some Android builds need the interface released by the OS first.
      throw new Error("Could not claim the printer: " + e.message);
    }

    Printer.device = device;
    Printer.iface = chosen;
    Printer.endpoint = endpointNumber;
  }

  /** Show the USB chooser. Must be called from a real user tap. */
  Printer.connect = async function () {
    if (!Printer.isSupported()) throw new Error("This browser has no WebUSB. Use Chrome or Edge.");
    const device = await navigator.usb.requestDevice({ filters: VENDOR_FILTERS });
    await claim(device);
    status("connected", device.productName || "Printer");
    return Printer.device;
  };

  /** Silent reconnect for devices already permitted (page reload, kiosk restart). */
  Printer.reconnect = async function () {
    if (!Printer.isSupported()) return false;
    const devices = await navigator.usb.getDevices();
    if (!devices.length) return false;
    try {
      await claim(devices[0]);
      status("connected", devices[0].productName || "Printer");
      return true;
    } catch (e) {
      status("error", e.message);
      return false;
    }
  };

  Printer.disconnect = async function () {
    if (!Printer.device) return;
    try { await Printer.device.close(); } catch (e) {}
    Printer.device = null;
    Printer.endpoint = null;
    status("disconnected", "");
  };

  async function send(bytes, chunkSize) {
    const size = chunkSize || 4096;
    for (let i = 0; i < bytes.length; i += size) {
      await Printer.device.transferOut(
        Printer.endpoint,
        bytes.subarray(i, Math.min(i + size, bytes.length))
      );
    }
  }

  /* ---------- ESC/POS builders ---------- */

  function packBand(prepared, yStart, rows) {
    const w = prepared.width;
    const bytesPerRow = Math.ceil(w / 8);
    const out = new Uint8Array(bytesPerRow * rows);
    for (let y = 0; y < rows; y++) {
      const srcRow = (yStart + y) * w;
      const dstRow = y * bytesPerRow;
      for (let x = 0; x < w; x++) {
        if (prepared.bits[srcRow + x]) {
          out[dstRow + (x >> 3)] |= 0x80 >> (x & 7);
        }
      }
    }
    return { bytesPerRow: bytesPerRow, data: out };
  }

  /**
   * Build the whole job: init, raster bands, feed, cut.
   * GS v 0 m xL xH yL yH [data]  — m=0 normal density.
   */
  Printer.buildJob = function (prepared, cfg) {
    cfg = cfg || {};
    const bandRows = Math.min(255, cfg.bandRows || 128);
    const parts = [];

    parts.push(new Uint8Array([ESC, 0x40]));           // ESC @  initialise
    parts.push(new Uint8Array([ESC, 0x61, 0x01]));     // ESC a 1  centre

    for (let y = 0; y < prepared.height; y += bandRows) {
      const rows = Math.min(bandRows, prepared.height - y);
      const band = packBand(prepared, y, rows);
      const header = new Uint8Array([
        GS, 0x76, 0x30, 0x00,
        band.bytesPerRow & 0xff, (band.bytesPerRow >> 8) & 0xff,
        rows & 0xff, (rows >> 8) & 0xff
      ]);
      parts.push(header, band.data);
    }

    const feed = Math.max(0, Math.min(255, cfg.feedBeforeCut == null ? 4 : cfg.feedBeforeCut));
    parts.push(new Uint8Array([ESC, 0x64, feed]));     // ESC d n  feed n lines

    // GS V m n : 66 = partial cut after feeding n dots, 65 = full cut
    const mode = cfg.cutMode === "full" ? 65 : 66;
    parts.push(new Uint8Array([GS, 0x56, mode, 0x00]));

    let total = 0;
    parts.forEach(p => { total += p.length; });
    const job = new Uint8Array(total);
    let off = 0;
    parts.forEach(p => { job.set(p, off); off += p.length; });
    return job;
  };

  /** Print one prepared bitmap. Serialised — never two jobs at once. */
  Printer.print = async function (prepared, cfg) {
    if (!Printer.isConnected()) throw new Error("Printer is not connected");
    if (Printer.busy) throw new Error("A print is already running");
    Printer.busy = true;
    status("printing", "");
    try {
      const job = Printer.buildJob(prepared, cfg);
      await send(job, cfg && cfg.chunkBytes);
      status("connected", "");
    } finally {
      Printer.busy = false;
    }
  };

  /** Short test slip, for checking paper width and the cutter. */
  Printer.printTest = async function (cfg) {
    if (!Printer.isConnected()) throw new Error("Printer is not connected");
    const enc = new TextEncoder();
    const text = "\n  PRINTER TEST OK\n  " + new Date().toLocaleString() + "\n\n";
    const head = new Uint8Array([ESC, 0x40, ESC, 0x61, 0x01]);
    const body = enc.encode(text);
    const feed = new Uint8Array([ESC, 0x64, 3]);
    const cut = new Uint8Array([GS, 0x56, cfg && cfg.cutMode === "full" ? 65 : 66, 0x00]);
    const job = new Uint8Array(head.length + body.length + feed.length + cut.length);
    job.set(head, 0);
    job.set(body, head.length);
    job.set(feed, head.length + body.length);
    job.set(cut, head.length + body.length + feed.length);
    await send(job, cfg && cfg.chunkBytes);
  };

  if (typeof navigator !== "undefined" && navigator.usb) {
    navigator.usb.addEventListener("disconnect", function (e) {
      if (Printer.device && e.device === Printer.device) {
        Printer.device = null;
        Printer.endpoint = null;
        status("disconnected", "Printer unplugged");
      }
    });
  }

  window.Printer = Printer;
})();

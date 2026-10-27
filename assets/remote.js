/* ============================================================
   REMOTE SHUTTER
   Lets something other than a finger on the screen fire the
   shutter. Three input routes, all optional:

   1. Keyboard. Bluetooth selfie remotes, keyboards and foot
      pedals are all HID keyboards underneath. Whatever key they
      send arrives as a normal keydown.

   2. Media keys. A remote in "media" mode sends play/pause or
      next-track. Android only routes those to a page that is
      actually playing something, so we loop a silent clip and
      register Media Session handlers against it.

   3. Gamepad. Some clicker-style remotes enumerate as gamepads.

   WHAT WILL NOT WORK: the volume keys. Android handles those in
   the OS and never passes them to a web page — there is no API
   for it, in any browser. A remote stuck in volume mode cannot
   be read here. Admin > Remote shows what yours actually sends.
   ============================================================ */
(function () {
  "use strict";

  const SILENCE = "data:audio/wav;base64,UklGRoQJAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YWAJAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIA=";

  const Remote = {
    onFire: null,     // called when the shutter should go
    onEvent: null,    // called for every input seen (diagnostic)
    enabled: true,
    keys: [],         // e.g. ["Enter"," ","MediaPlayPause"]
    acceptAnyKey: false,
    /* Swallow every key instead of only the shutter keys. The
       diagnostic needs this: a remote sending Enter would otherwise
       re-activate whichever button has focus — including the one that
       started the diagnostic. */
    swallow: false
  };

  let audio = null;
  let gamepadTimer = null;
  let lastGamepad = {};
  let lastFire = 0;

  function report(kind, detail) {
    if (typeof Remote.onEvent === "function") {
      try { Remote.onEvent(kind, detail); } catch (e) {}
    }
  }

  /** Fire, ignoring repeats inside 600ms — these remotes bounce. */
  function fire(source) {
    const now = Date.now();
    if (now - lastFire < 600) { report("ignored", source + " (too soon)"); return; }
    lastFire = now;
    report("fire", source);
    if (Remote.enabled && typeof Remote.onFire === "function") {
      try { Remote.onFire(source); } catch (e) {}
    }
  }

  /* ---------- 1. keyboard ---------- */

  function onKeyDown(e) {
    // Never hijack typing.
    const t = e.target;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;

    const label = e.key === " " ? "Space" : e.key;
    report("key", label + "  (code " + e.code + ", keyCode " + e.keyCode + ")");

    if (Remote.swallow) {
      e.preventDefault();
      e.stopPropagation();
    }
    if (!Remote.enabled) return;
    const match = Remote.acceptAnyKey ||
      Remote.keys.some(k => k === e.key || k === e.code ||
                            (k === "Space" && (e.key === " " || e.code === "Space")));
    if (match) {
      e.preventDefault();
      fire("key " + label);
    }
  }

  /* ---------- 2. media keys ---------- */

  /**
   * Android only delivers media-button presses to a page that owns an
   * active media session, which means something has to be playing. A
   * looping silent clip is the usual way to hold one open.
   * Must be called from a user gesture or playback is blocked.
   */
  Remote.startMediaSession = function () {
    if (!("mediaSession" in navigator)) {
      report("info", "This browser has no Media Session support");
      return Promise.resolve(false);
    }
    if (!audio) {
      audio = new Audio(SILENCE);
      audio.loop = true;
      audio.volume = 0;              // silent, but still "playing"
      audio.setAttribute("playsinline", "");
    }
    return audio.play().then(function () {
      try {
        navigator.mediaSession.metadata = new window.MediaMetadata({
          title: "Photobooth", artist: "Remote shutter ready"
        });
      } catch (e) {}
      navigator.mediaSession.playbackState = "playing";

      [["play", "play"], ["pause", "pause"], ["nexttrack", "next"],
       ["previoustrack", "previous"], ["stop", "stop"],
       ["seekforward", "seek forward"], ["seekbackward", "seek backward"]
      ].forEach(function (pair) {
        try {
          navigator.mediaSession.setActionHandler(pair[0], function () {
            // keep the session alive — pause would hand it back to the OS
            if (audio.paused) audio.play().catch(() => {});
            navigator.mediaSession.playbackState = "playing";
            report("media", pair[1]);
            fire("media " + pair[1]);
          });
        } catch (e) {
          /* this browser doesn't support that action */
        }
      });
      report("info", "Media keys armed");
      return true;
    }).catch(function (e) {
      report("info", "Couldn't start silent audio: " + (e.message || e.name));
      return false;
    });
  };

  Remote.stopMediaSession = function () {
    if (audio) { try { audio.pause(); } catch (e) {} }
    if ("mediaSession" in navigator) {
      try { navigator.mediaSession.playbackState = "none"; } catch (e) {}
    }
  };

  /* ---------- 3. gamepad ---------- */

  function pollGamepads() {
    if (!navigator.getGamepads) return;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) {
      const p = pads[i];
      if (!p) continue;
      const prev = lastGamepad[p.index] || [];
      p.buttons.forEach(function (b, n) {
        const down = !!(b && b.pressed);
        if (down && !prev[n]) {
          report("gamepad", "button " + n + " on " + (p.id || "pad"));
          fire("gamepad button " + n);
        }
      });
      lastGamepad[p.index] = p.buttons.map(b => !!(b && b.pressed));
    }
  }

  /* ---------- lifecycle ---------- */

  Remote.start = function (opts) {
    opts = opts || {};
    Remote.keys = opts.keys || [];
    Remote.acceptAnyKey = !!opts.acceptAnyKey;
    Remote.swallow = !!opts.swallow;
    // Nothing should keep focus: a remote sending Enter or Space would
    // otherwise just press whatever button was last tapped.
    try {
      if (document.activeElement && document.activeElement.blur) {
        document.activeElement.blur();
      }
    } catch (e) {}
    window.addEventListener("keydown", onKeyDown, true);
    if (!gamepadTimer) gamepadTimer = setInterval(pollGamepads, 120);
  };

  Remote.stop = function () {
    window.removeEventListener("keydown", onKeyDown, true);
    clearInterval(gamepadTimer);
    gamepadTimer = null;
    Remote.stopMediaSession();
  };

  window.Remote = Remote;
})();

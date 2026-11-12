/* ============================================================
   FRAME LAYOUTS
   Coordinates are PRINT DOTS on a 576-dot roll (80mm at 203 dpi).
   The app rescales for 58mm (384 dots) on its own.

   Each layout is a STACK OF BLOCKS rather than a list of hardcoded
   rectangles. The builder walks the stack, gives every block a y and
   a height, and the strip ends where the last block ends. Nothing is
   padded to a round number, so no layout wastes paper, and changing
   a headline from one line to two cannot silently leave a gap or
   overlap the photo below it.

   Every visible string is a named key with a default. Admin edits
   them per layout, so the four strips can read differently.
   ============================================================ */
(function () {
  "use strict";

  /* Heights, in dots, for a block of a given size. Thermal paper is
     the scarce resource here: these are as tight as 203 dpi allows
     while leaving reversed text room not to bleed shut. */
  const RULE_H = { double: 7, thick: 4, thin: 2 };

  function blockHeight(b) {
    switch (b.t) {
      case "gap":      return b.h;
      case "rule":     return RULE_H[b.style] || RULE_H.thin;
      case "masthead": return Math.round(b.size * 1.28);
      case "ears":     return Math.round(b.size * 1.15) + 12;
      case "headline": return Math.round(b.size * 1.12);
      case "bar":      return Math.round(b.size * 1.95);
      case "kicker":   return Math.round(b.size * 1.75);
      case "stamp":    return Math.round(b.size * 1.6);
      case "photo":    return b.h;
      case "grid":     return b.rows * b.h + (b.rows - 1) * b.gap;
      default:         return 0;
    }
  }

  const MARGIN = 16;              // side margin; slots run 544 wide

  /**
   * Turn a definition into the frame shape the rest of the app
   * expects: absolute slots, a total height, and the same block list
   * annotated with where each one landed.
   */
  function build(def) {
    const W = 576;
    const inner = W - 2 * MARGIN;
    const slots = [];
    let y = 0;

    const chrome = def.blocks.map(function (b) {
      const h = blockHeight(b);
      const out = Object.assign({}, b, { y: y, h: h });

      if (b.t === "photo") {
        slots.push({ x: MARGIN, y: y, w: inner, h: h });
      } else if (b.t === "grid") {
        const cw = Math.floor((inner - (b.cols - 1) * b.gap) / b.cols);
        for (let r = 0; r < b.rows; r++) {
          for (let c = 0; c < b.cols; c++) {
            slots.push({
              x: MARGIN + c * (cw + b.gap),
              y: y + r * (b.h + b.gap),
              w: cw,
              h: b.h
            });
          }
        }
      }
      y += h;
      return out;
    });

    return {
      id: def.id,
      name: def.name,
      width: W,
      height: y,
      shots: slots.length,
      slots: slots,
      chrome: chrome,
      text: def.text,
      header: true,
      gif: true          // three-frame animated strip as well as the print
    };
  }

  /* ---------------------------------------------------------- */

  const DEFS = [
    {
      id: "strip3",
      name: "Classic Strip",
      text: {
        masthead: "The Snap News",
        h1: "MEMORY REPORT",
        bar1: "MOMENTS WORTH KEEPING",
        bar2: "MORE MEMORIES AHEAD"
      },
      blocks: [
        { t: "gap", h: 10 },
        { t: "rule", style: "double" },
        { t: "masthead", key: "masthead", size: 30 },
        { t: "rule", style: "thin" },
        { t: "headline", key: "h1", size: 46 },
        { t: "bar", key: "bar1", size: 20 },
        { t: "gap", h: 6 },
        { t: "photo", h: 408 },
        { t: "gap", h: 10 },
        { t: "photo", h: 408 },
        { t: "gap", h: 10 },
        { t: "photo", h: 408 },
        { t: "gap", h: 8 },
        { t: "bar", key: "bar2", size: 20 },
        { t: "stamp", size: 16 },
        { t: "gap", h: 10 }
      ]
    },

    {
      id: "duo",
      name: "Big Duo",
      text: {
        masthead: "The Good Times",
        earL: "EST. 2026",
        earC: "NEW MEMORIES",
        earR: "FOREVER US",
        h1: "CAPTURE THE MOMENT",
        k1: "GOOD TIMES",
        bar2: "GOOD TIMES TOGETHER"
      },
      blocks: [
        { t: "gap", h: 10 },
        { t: "rule", style: "double" },
        { t: "masthead", key: "masthead", size: 30 },
        { t: "ears", keys: ["earL", "earC", "earR"], size: 14 },
        { t: "headline", key: "h1", size: 42 },
        { t: "gap", h: 6 },
        { t: "photo", h: 544 },
        { t: "kicker", key: "k1", size: 17 },
        { t: "photo", h: 408 },
        { t: "gap", h: 6 },
        { t: "bar", key: "bar2", size: 20 },
        { t: "stamp", size: 16 },
        { t: "gap", h: 10 }
      ]
    },

    {
      id: "polaroid",
      name: "Single Shot",
      text: {
        masthead: "The Good Times Post",
        earL: "SPECIAL EDITION",
        earC: "VOL. 01",
        earR: "NO. 01",
        h1: "CAPTURE THE MOMENT",
        bar2: "GOOD VIBES ONLY"
      },
      blocks: [
        { t: "gap", h: 10 },
        { t: "rule", style: "double" },
        { t: "masthead", key: "masthead", size: 28 },
        { t: "ears", keys: ["earL", "earC", "earR"], size: 13 },
        { t: "headline", key: "h1", size: 40 },
        { t: "gap", h: 6 },
        { t: "photo", h: 544 },
        { t: "gap", h: 6 },
        { t: "bar", key: "bar2", size: 20 },
        { t: "stamp", size: 16 },
        { t: "gap", h: 10 }
      ]
    },

    {
      id: "grid4",
      name: "Quad Grid",
      text: {
        masthead: "The Snap News",
        h1: "FOUR OF A KIND",
        bar2: "MOMENTS WORTH KEEPING"
      },
      blocks: [
        { t: "gap", h: 10 },
        { t: "rule", style: "double" },
        { t: "masthead", key: "masthead", size: 28 },
        { t: "rule", style: "thin" },
        { t: "headline", key: "h1", size: 40 },
        { t: "gap", h: 6 },
        { t: "grid", rows: 2, cols: 2, h: 336, gap: 12 },
        { t: "gap", h: 6 },
        { t: "bar", key: "bar2", size: 20 },
        { t: "stamp", size: 16 },
        { t: "gap", h: 10 }
      ]
    }
  ];

  window.BUILTIN_FRAMES = DEFS.map(build);
  window.BUILD_FRAME = build;          // Admin uses this to re-measure
})();

/* ============================================================
   FRAME LAYOUTS
   Coordinates are PRINT DOTS on a 576-dot wide roll (80mm at
   203 dpi). The app rescales automatically for 58mm (384 dots).

   Slots run nearly edge to edge (16-dot margins) because the only
   way to gain real photo detail on a thermal printer is to give
   the image more dots. 544 dots = 68mm across.
   ============================================================ */
window.BUILTIN_FRAMES = [
  {
    id: "strip3",
    name: "Classic Strip",
    width: 576,
    height: 1520,
    shots: 3,
    header: true,
    slots: [
      { x: 16, y: 140, w: 544, h: 408 },
      { x: 16, y: 564, w: 544, h: 408 },
      { x: 16, y: 988, w: 544, h: 408 }
    ]
  },
  {
    id: "duo",
    name: "Big Duo",
    width: 576,
    height: 1240,
    shots: 2,
    header: true,
    slots: [
      { x: 16, y: 140, w: 544, h: 544 },
      { x: 16, y: 700, w: 544, h: 408 }
    ]
  },
  {
    id: "polaroid",
    name: "Single Shot",
    width: 576,
    height: 820,
    shots: 1,
    header: true,
    slots: [{ x: 16, y: 140, w: 544, h: 544 }]
  },
  {
    id: "grid4",
    name: "Quad Grid",
    width: 576,
    height: 950,
    shots: 4,
    header: true,
    slots: [
      { x: 16, y: 140, w: 268, h: 336 },
      { x: 292, y: 140, w: 268, h: 336 },
      { x: 16, y: 492, w: 268, h: 336 },
      { x: 292, y: 492, w: 268, h: 336 }
    ]
  }
];

/* ============================================================
   FRAME LAYOUTS
   Every layout is defined in PRINT DOTS at 576 wide (80mm paper).
   The app rescales automatically if PRINT_WIDTH_DOTS is 384 (58mm).

   slots: where the photos go, in the same coordinate space.
   overlay: optional PNG laid on top (transparent where photos show).
            Put the file in assets/frames/ or in the Supabase
            booth-frames bucket and reference it by file name.
   ============================================================ */
window.BUILTIN_FRAMES = [
  {
    id: "strip3",
    name: "Classic Strip",
    width: 576,
    height: 1500,
    shots: 3,
    header: true,
    slots: [
      { x: 48, y: 150, w: 480, h: 360 },
      { x: 48, y: 530, w: 480, h: 360 },
      { x: 48, y: 910, w: 480, h: 360 }
    ]
  },
  {
    id: "duo",
    name: "Big Duo",
    width: 576,
    height: 1320,
    shots: 2,
    header: true,
    slots: [
      { x: 40, y: 150, w: 496, h: 496 },
      { x: 40, y: 666, w: 496, h: 372 }
    ]
  },
  {
    id: "polaroid",
    name: "Polaroid",
    width: 576,
    height: 820,
    shots: 1,
    header: true,
    slots: [{ x: 48, y: 150, w: 480, h: 480 }]
  },
  {
    id: "grid4",
    name: "Quad Grid",
    width: 576,
    height: 1180,
    shots: 4,
    header: true,
    slots: [
      { x: 40, y: 150, w: 240, h: 320 },
      { x: 296, y: 150, w: 240, h: 320 },
      { x: 40, y: 486, w: 240, h: 320 },
      { x: 296, y: 486, w: 240, h: 320 }
    ]
  }
];

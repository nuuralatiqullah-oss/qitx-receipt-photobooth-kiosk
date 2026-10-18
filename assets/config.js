/* ============================================================
   KIOSK DEFAULTS
   These are the built-in defaults. Anything you change on the
   Admin page is saved on the tablet and overrides what is here,
   so for day-to-day use edit the Admin page, not this file.
   Safe to commit: the Supabase publishable key is a public key.
   ============================================================ */
window.CONFIG = {
  /* ---- Branding (editable in Admin) ---- */
  BOOTH_NAME: "NUURAL BOOTH",
  EVENT_NAME: "Walimatul Urus",
  TAGLINE: "Snap it. Print it. Keep it.",
  START_LABEL: "Start",
  FOOTER_LINE: "Terima kasih kerana hadir",

  /* ---- Admin ----
     Client-side only. It keeps guests out of the settings at an
     event; it is not real security, so don't reuse a password. */
  ADMIN_PIN: "1234",

  /* ---- Supabase (leave blank to run fully offline) ----
     Project Settings -> Data API for the URL,
     Project Settings -> API Keys for the PUBLISHABLE key. */
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  PHOTO_BUCKET: "booth-photos",
  FRAME_BUCKET: "booth-frames",

  /* ---- Printer ----
     Both the Citizen CT-S310II and the Gainscha/Gprinter GA-C180I
     are 203 dpi ESC/POS with 72mm (576 dot) print width.
     58mm paper -> 384 dots. */
  PRINT_WIDTH_DOTS: 576,

  /* "partial" leaves a tab to tear. The GA-C180I is partial-cut
     only and ignores "full"; the CT-S310II does both. */
  CUT_MODE: "partial",
  FEED_BEFORE_CUT: 4,
  USB_CHUNK_BYTES: 4096,
  RASTER_BAND_ROWS: 128,

  /* Dark areas breaking up or streaking is almost always one of
     these. null = leave the printer on its own setting.
     DENSITY: 0 standard, 1..127 darker, 128..255 paler.
     SPEED:   lower = slower = more heat per dot = solid blacks.
     Try PRINT_SPEED 2 before touching density. */
  PRINT_DENSITY: null,
  PRINT_SPEED: null,

  /* ---- Photo look on thermal paper ----
     There is no grey and no colour — every dot is on or off, at
     203 dpi. These decide how a photo becomes dots. */

  /* Dot size is the biggest lever. 1 = finest, but thermal heat
     bleeds between dots and faces turn to mush. 2 is the sweet
     spot. 3 is chunky retro. Text always prints at full 203 dpi.
     Use Admin -> Print test to compare on real paper. */
  PHOTO_DOT_SIZE: 2,

  /* "atkinson" keeps whites clean (recommended).
     "floyd" is finer grained but muddier on dark photos. */
  DITHER: "atkinson",

  PHOTO_GAMMA: 0.8,          // <1 lightens midtones
  PHOTO_AUTO_LEVELS: true,   // rescue dim / backlit shots
  PHOTO_LOCAL_CONTRAST: 0.6, // separates face from hair from shirt
  PHOTO_SHARPEN: 0.8,
  PHOTO_BLUR: 0,

  /* The saved/shared copy is rendered this many times bigger than the
     print, in colour. 2 gives a strip about 1150px wide, which looks
     right on a phone without being a huge file. */
  DISPLAY_SCALE: 2,

  /* ---- Camera (editable in Admin) ---- */
  CAMERA_FACING: "user",     // "user" (selfie) or "environment"
  MIRROR_PREVIEW: true,
  CAMERA_IDEAL_WIDTH: 3840,  // asks for the best still the sensor has
  COUNTDOWN_SECONDS: 3,

  /* ---- Booth behaviour (editable in Admin) ---- */
  DEFAULT_FRAME: "",         // frame id to preselect, "" = let guests choose
  AUTO_PRINT_COPIES: 1,
  IDLE_RESET_SECONDS: 90,
  ALLOW_GUEST_PRINT: true,   // false = staff prints from Admin instead
  UPLOAD_PHOTOS: true,       // needs Supabase
  SHOW_QR: true,             // QR download (needs upload on)
  KEEP_LOCAL_COPIES: 40      // recent prints kept on the tablet for Admin
};

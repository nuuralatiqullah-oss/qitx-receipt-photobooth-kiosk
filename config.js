/* ============================================================
   KIOSK CONFIG — edit this file, nothing else, for a new event.
   Safe to commit: the Supabase anon key is a public key.
   ============================================================ */
window.CONFIG = {
  /* ---- Branding ---- */
  BOOTH_NAME: "NUURAL BOOTH",
  EVENT_NAME: "Walimatul Urus",
  TAGLINE: "Ambil gambar, terus cetak",
  FOOTER_LINE: "Terima kasih kerana hadir",

  /* ---- Supabase (leave blank to run fully offline) ----
     Get these from Supabase Dashboard -> Project Settings -> API  */
  SUPABASE_URL: "",
  SUPABASE_ANON_KEY: "",
  PHOTO_BUCKET: "booth-photos",
  FRAME_BUCKET: "booth-frames",

  /* ---- Printer: Citizen CT-S310II (ESC/POS, 203 dpi) ----
     80mm paper -> 576 dots printable
     58mm paper -> 384 dots printable
     If prints come out cropped on the right, you are on 58mm paper. */
  PRINT_WIDTH_DOTS: 576,

  /* Auto cutter. The CT-S310II has a guillotine cutter.
     "partial" leaves a small tab (easier to tear off a strip neatly)
     "full"    cuts right through */
  CUT_MODE: "partial",
  FEED_BEFORE_CUT: 4,       // blank lines fed before the cut
  USB_CHUNK_BYTES: 4096,    // WebUSB transferOut chunk size
  RASTER_BAND_ROWS: 128,    // rows per GS v 0 band (keep <= 255)

  /* ---- Photo look on thermal paper ----
     The printer is only black or white — there is no grey. These
     control how a photo is turned into dots. Start here if prints
     look muddy or noisy. */

  /* Dot size is the biggest lever. 1 = finest detail but thermal
     heat bleeds between dots and faces turn to mush. 2 is the sweet
     spot for portraits. 3 is a chunky, very legible retro look.
     Text always prints at full resolution regardless.
     Tap "Print settings test" on the review screen to compare these
     on real paper before committing. */
  PHOTO_DOT_SIZE: 2,

  /* "atkinson" keeps whites clean and faces readable (recommended).
     "floyd"  is finer grained but goes muddy on dark photos. */
  DITHER: "atkinson",

  /* <1 lightens midtones. Thermal printing always comes out darker
     than it looks on screen, so 0.8 compensates. Lower = lighter. */
  PHOTO_GAMMA: 0.8,

  /* Rescue backlit or dim photos by stretching each photo's own
     tonal range to full black-to-white. Leave this on. */
  PHOTO_AUTO_LEVELS: true,

  /* Local contrast — the biggest win for a face looking "sharp".
     Separates cheek from beard from shirt instead of letting them all
     dither into the same grey speckle. 0 = off, 0.5 = recommended,
     1.0 = dramatic/graphic. */
  PHOTO_LOCAL_CONTRAST: 0.6,

  /* Edge definition put back after downsampling. 0 = off,
     0.6 = natural, 1.2 = punchy. Too high looks like a woodcut. */
  PHOTO_SHARPEN: 0.8,

  /* Noise reduction before dithering. 0 is usually right once
     PHOTO_DOT_SIZE is 2 or more. Raise to 1 for grainy cameras. */
  PHOTO_BLUR: 0,

  /* ---- Booth behaviour ---- */
  COUNTDOWN_SECONDS: 3,
  MIRROR_PREVIEW: true,     // selfie-style preview
  AUTO_PRINT_COPIES: 1,
  IDLE_RESET_SECONDS: 90,   // back to welcome screen if nobody touches it
  UPLOAD_PHOTOS: true,      // needs Supabase configured
  SHOW_QR: true             // QR to download the photo (needs upload on)
};

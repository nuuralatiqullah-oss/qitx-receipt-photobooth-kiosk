/* ============================================================
   KIOSK CONFIG — edit this file, nothing else, for a new event.
   Safe to commit: the Supabase anon key is a public key.
   ============================================================ */
window.CONFIG = {
  /* ---- Branding ---- */
  BOOTH_NAME: "RECIEPT PHOTOBOOTH",
  EVENT_NAME: "by @qitx_exclusive",
  TAGLINE: "SNAP IT & PRINT IT",
  FOOTER_LINE: "Follow us on instagram @qitx_exclusive",

  /* ---- Supabase (leave blank to run fully offline) ----
     Get these from Supabase Dashboard -> Project Settings -> API  */
  SUPABASE_URL: "https://wudqimkxqsylvakiuwuz.supabase.co/rest/v1/",
  SUPABASE_ANON_KEY: "sb_publishable__BGdeh4R0ZJDhGAAX84fAg_c43DgV4v",
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

  /* ---- Image tuning ----
     Thermal printing is 1-bit. These control how the photo is
     converted before dithering. Raise BLUR if prints look like
     TV static; raise CONTRAST if they look flat and grey. */
  BLUR_PASSES: 1,
  CONTRAST_STRETCH: true,
  BRIGHTNESS: 1.05,         // >1 = lighter print (saves ink burn, less mud)

  /* ---- Booth behaviour ---- */
  COUNTDOWN_SECONDS: 3,
  MIRROR_PREVIEW: true,     // selfie-style preview
  AUTO_PRINT_COPIES: 1,
  IDLE_RESET_SECONDS: 90,   // back to welcome screen if nobody touches it
  UPLOAD_PHOTOS: true,      // needs Supabase configured
  SHOW_QR: true             // QR to download the photo (needs upload on)
};

/* ============================================================
   KIOSK DEFAULTS
   These are the built-in defaults. Anything you change on the
   Admin page is saved on the tablet and overrides what is here,
   so for day-to-day use edit the Admin page, not this file.
   Safe to commit: the Supabase publishable key is a public key.
   ============================================================ */
window.CONFIG = {
  /* ---- Build stamp ----
     Shown at the bottom of Admin. If this does not match what you
     just deployed, the tablet is running an old copy: tap
     "Force update" there. Bump it with every deploy. ---- */
  APP_VERSION: "v20",

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
  SUPABASE_URL: "https://wudqimkxqsylvakiuwuz.supabase.co",
  SUPABASE_ANON_KEY: "sb_publishable__BGdeh4R0ZJDhGAAX84fAg_c43DgV4v",
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

  /* Screen orientation once installed as an app.
     "any" follows the tablet. "landscape" or "portrait" pin it, which
     is what you want on a kiosk so guests can't rotate it mid-session.
     Applied at runtime, so it takes effect without reinstalling. */
  ORIENTATION: "any",

  /* ---- Camera (editable in Admin) ---- */
  CAMERA_FACING: "user",     // "user" (selfie) or "environment"
  MIRROR_PREVIEW: true,
  CAMERA_IDEAL_WIDTH: 3840,  // asks for the best still the sensor has

  /* ---- Animated strip ----
     Three preview frames per pose, about GIF_FRAME_GAP_MS apart: one
     just before the shutter, the shutter frame itself, one just after.
     The middle frame is what gets printed and saved; all three make
     the GIF, played 1-2-3-2 so the loop has no seam.

     Three frames rather than eight is deliberate. It is the classic
     photobooth GIF look and it keeps the file under half a megabyte,
     which matters on venue wifi. ---- */
  GIF_ENABLED: true,         // master switch; each layout opts in too
  GIF_FRAME_GAP_MS: 180,     // spacing between the three frames
  GIF_FRAME_MS: 160,         // on-screen time per frame in the loop
  GIF_HOLD_MS: 400,          // dwell on the last frame, so it breathes
  GIF_WIDTH: 360,            // encoded width; the rest follows the strip
  GIF_MAX_COLORS: 128,

  /* "preview" takes all three frames from the live stream, so the
     middle one matches its neighbours exactly and the loop does not
     pop. "photo" uses ImageCapture.takePhoto() for the middle frame:
     better noise handling in a dim room, but a different exposure and
     a few hundred ms stall in the middle of the burst. */
  GIF_STILL_SOURCE: "preview",

  // Layout ids with the animation switched off, set in Admin.
  NO_GIF_FRAMES: [],
  COUNTDOWN_SECONDS: 3,

  /* ---- Remote shutter (editable in Admin) ----
     A Bluetooth selfie remote, keyboard or foot pedal is just a
     keyboard: whatever key it sends can fire the shutter.

     NOTE: the volume keys cannot be used. Android handles those in
     the OS and never passes them to a web page, in any browser. If
     your remote only sends Volume Up, look for an iOS/Android switch
     on it — iOS mode usually sends Enter instead. Admin > Remote
     shows exactly what yours sends. */
  REMOTE_SHUTTER: true,

  /* Keys that fire the shutter. Admin can learn one from the remote. */
  SHUTTER_KEYS: ["Enter", "Space", "NumpadEnter"],

  /* Fire on ANY key. Handy with an odd remote, but then a stray
     keyboard press also takes a photo. */
  SHUTTER_ANY_KEY: false,

  /* Also listen for media keys (play/pause/next). Needs a silent
     clip looping to hold the media session open. */
  SHUTTER_MEDIA_KEYS: true,

  /* ---- Booth behaviour (editable in Admin) ---- */
  DEFAULT_FRAME: "",         // frame id to preselect, "" = let guests choose
  /* Ask the guest how many copies when they tap Print.
     Off = print AUTO_PRINT_COPIES straight away. */
  /* Take every shot in one go after a single press, with a countdown
     between each. Removes most of the need to reach the tablet. */
  AUTO_SEQUENCE: false,
  AUTO_SEQUENCE_GAP: 2,      // seconds to pose between shots

  ASK_COPIES: true,
  MAX_COPIES: 5,
  AUTO_PRINT_COPIES: 1,
  IDLE_RESET_SECONDS: 90,
  ALLOW_GUEST_PRINT: true,   // false = staff prints from Admin instead
  UPLOAD_PHOTOS: true,       // needs Supabase
  SHOW_QR: true,             // QR download (needs upload on)
  KEEP_LOCAL_COPIES: 40,     // recent prints kept on the tablet for Admin

  // Hard ceiling on what those strips may occupy. Reached before the
  // count once layouts are animating, because a record is then a
  // keepsake, a print bitmap and a GIF rather than one JPEG.
  MAX_LOCAL_BYTES: 60 * 1024 * 1024
};

# QITX Receipt Photobooth

A photobooth that runs entirely in a browser tab. Guests pose, the strip
prints on thermal receipt paper, and they scan a QR to take home a colour
copy, a black and white one, and a four-frame boomerang GIF.

No server, no app, no print driver. A static site on GitHub Pages talking
to a USB printer through WebUSB, with Supabase holding the photos guests
scan for.

**Flow:** Welcome → pick a layout → four-frame capture → review →
**Print** *or* **Skip** → three QR codes.

---

## What you need

| | |
|---|---|
| **Tablet** | Redmi Pad 2 (11", 254.6 × 166 mm) running Chrome for Android. Anything with Chrome, a camera and USB-C OTG works. |
| **Printer** | Gainscha GA-C180I, 80 mm thermal, auto-cutter. Any ESC/POS receipt printer should work — it speaks raster bytes, not a driver. |
| **Cable** | USB-C OTG adapter plus the printer's USB-B lead. |
| **Paper** | 80 mm thermal rolls. Good ones — see *Broken blacks* below. |
| **Hosting** | GitHub Pages. WebUSB and the camera both require HTTPS. |
| **Backend** | A Supabase project, for the QR downloads. Optional; without it the booth still prints. |

The one thing to test before anything else is **OTG**: plug the printer
into the tablet and see whether Chrome shows a device chooser. If the
tablet can't power the printer, you need a powered hub — see
*Troubleshooting*.

---

## What a guest walks away with

**On paper:** a newspaper-style strip, 1-bit black and white at 203 dpi,
auto-cut.

**On their phone**, three QR codes on the last screen:

| | |
|---|---|
| **Colour** | The full-colour strip at twice print size. |
| **Black & white** | A clean desaturated copy. Set `BW_STYLE: "print"` to hand over the exact dithered bitmap that went to the printer instead — the digital twin of the paper, grain and all. |
| **Animated** | A looping GIF, around 80 KB. |

Each is uploaded as its own file and gets its own labelled code, so a
guest scans the one they want and walks away. Drop any of them from
`DOWNLOADS` in config to stop offering it.

**Skip** on the review screen goes straight to the codes without
printing. It's also the graceful way out when the printer is unplugged
or out of paper — it deliberately doesn't check for a connection, so the
guest still leaves with their photos. It hides itself when there's no
Supabase, because then there'd be nothing to skip to.

---

## The boomerang

Every pose captures **four frames** about 180 ms apart rather than one
still. The frame at `GIF_SHUTTER_INDEX` (the second, by default) is the
one that prints and saves, so the paper strip is unaffected. All four
compose into complete strips and encode as a GIF played 1‑2‑3‑4‑3‑2 —
ping-pong, so the loop has no seam.

Four frames is not a compromise. It's the photobooth look, and it keeps
the file under 100 KB, which is what decides whether a guest on venue
wifi actually receives it.

The preview says **"Tap the button when ready, it's a boomerang"** on a
layout that animates, and the plain line on one that doesn't. After the
countdown, four dots fill one by one and the preview flashes once per
frame, so four snaps read as four frames rather than as the camera
misfiring.

That flash is deliberately a short, soft pulse rather than the single
full-strength one used for stills. It's a white overlay that lights the
subject off the screen: four full flashes would strobe, and one flash at
the start would leave the later frames darker than the first. Every
frame is grabbed the same delay after its own pulse, so all four are lit
alike.

Animation is **per layout** — Admin → Layouts → *GIF on / GIF off* — so
a busy queue can run a still-only strip while the premium one moves.

---

## Quick start

### 1. Deploy

```bash
git clone https://github.com/<you>/<repo>.git
cd <repo>
# edit assets/config.js for your Supabase project
git commit -am "Configure" && git push
```

**Settings → Pages → Deploy from a branch → main / (root)**. Your booth
lands at `https://<you>.github.io/<repo>/`. Nothing to build — it's plain
HTML and JavaScript.

### 2. Supabase

Credentials live in `assets/config.js` and are **deliberately not
editable from Admin** — a value saved on one tablet kept overriding
later fixes, so the tablet copy is ignored and purged on load. To point
at a different project, edit config.js and redeploy.

1. **SQL Editor** → paste all of `supabase-setup.sql` → Run. Safe to
   re-run.
2. **Project Settings → Data API** → copy the Project URL.
   **Project Settings → API Keys** → copy the **publishable** key
   (`sb_publishable_…`). Never the secret one — this is a public repo.
3. Put both in `assets/config.js` and push.
4. **Admin → Printer → Test connection.** The fields are read-only;
   they show what the booth is actually using.

A publishable key is designed to sit in public client code — **but only
because Row Level Security is on**, which is what step 1 sets up. It is
not optional.

The test walks the same path the booth takes when it prints: uploads a
file, reads it back over the public URL, writes a row to `prints`, then
cleans up after itself. If a step fails it names that step, so you know
whether to re-run the SQL or make the bucket public.

> The `booth-photos` bucket is **public**, because a QR has to open
> without a login. Anyone with the link can see that photo. If you'd
> rather not, make the bucket private and switch to signed URLs, or turn
> `SHOW_QR` off and keep the prints paper-only.

### 3. Printer

1. Open the booth in **Chrome** on the tablet.
2. Tap **Printer** → pick your printer from the USB chooser. It lists
   every USB device, so you don't need to know its vendor ID.
3. Once connected, the Printer tab shows the name and USB IDs, e.g.
   `GA-C180I (0x1a86:0x7584)`.
4. **Admin → Printer → Test slip** to check the width and the cutter.

Chrome remembers the permission, so the booth reconnects silently after
a reload. After a full tablet restart you may need to tap once more.

### 4. Lock it down for the event

- Chrome menu → **Add to Home screen**. It installs fullscreen with no
  address bar.
- Turn on Android **screen pinning** so guests can't leave the page.
- Keep the tablet on the charger; it holds a wake lock while running.
- **Open it once while online before the event** so the fonts and
  libraries are cached.

---

## Updating a tablet

The service worker is **network-first** for the booth's own files with a
3-second timeout, falling back to cache. An online tablet always runs
current code; an offline one still opens.

After you push:

1. Bump `VERSION` in `sw.js` and `APP_VERSION` in `assets/config.js`.
   Keep them the same.
2. On the tablet, open **Admin**. The bottom bar shows the build, e.g.
   `Build v24`. If it doesn't match what you deployed, tap **Force
   update** — it clears every cache, unregisters the worker and reloads
   cache-busted.

The build stamp compares the config the page loaded against the version
the service worker reports, so a stale copy is visible rather than
guessed at.

---

## The four layouts

Vintage newspaper styling: masthead with ornaments, dateline ears, heavy
display headline, reversed section banners, ornamented kickers between
photos, date stamp.

| Layout | Photos | Length |
|---|---|---|
| **Classic Strip** | 3 | 185 mm |
| **Big Duo** | 2 | 150 mm |
| **Quad Grid** | 4 | 109 mm |
| **Single Shot** | 1 | 95 mm |

Layouts are a **stack of blocks**, not hardcoded rectangles. A builder
walks the stack, gives every block a y and a height, and the strip ends
where the last block ends. That's what keeps them short: nothing is
padded to a round number, so there's no dead paper anywhere, and a
longer headline can't silently overlap the photo below it.

### Editing the wording

**Admin → Layouts → Words.** Every visible string on a strip is a named
key with a default — masthead, headline, banners, the bits between
photos, the dateline ears — stored per layout, so the four can read
differently. Type something too long and it shrinks to fit rather than
running off the roll.

The date stamp stays automatic; that's data, not copy.

### Typography, and why it looks like this

The faces are chosen for the medium, not copied from a reference. Pinterest
photobooth strips are laser prints at 300 dpi or better; this is a 203 dpi
thermal head printing pure black or white. Blackletter mastheads and
fine-hairline serifs turn to lace — the thin strokes drop out under the
threshold while the thick ones bleed together.

So: **Playfair Display at 900**, far heavier than a real newspaper would
set, so every stem survives; and **Oswald 600** for small caps and
reversed bars, because condensed fits more characters at a size the head
can resolve and its even weight reverses out of black without the
counters filling in. Both vendored in `assets/vendor/fonts/` — no CDN at
event time.

---

## Uploading your own template

**Admin → Layouts → Add template.** Pick a PNG with see-through holes
where the photos go. The holes are found automatically — no coordinates
to type — and the preview outlines each one so you can check before
saving.

- **576 px wide** matches the paper exactly (any width is scaled to fit).
- Punch the photo areas out to **full transparency**. A flat JPEG has no
  holes, and the uploader says so rather than failing quietly.
- Each hole should be a clean rectangle. Specks and hairline gaps are
  ignored; a ragged cut-out may not be recognised.
- Put your wording in the artwork. An uploaded template has no block
  stack, so the newspaper chrome and the Words editor don't apply to it.
- Design for the printer: **no grey, no colour, 203 dpi.** Bold shapes,
  heavy type, plenty of white.

Templates are stored on the tablet, so they work offline.

---

## Admin

Tap **Admin** on the welcome screen. Default PIN is `1234`; change it on
the Text tab. It's stored in the browser in plain text — it keeps guests
out during an event, it is not real security, so don't reuse a password
you care about.

| Tab | What it does |
|---|---|
| **Text** | Booth name, event name, welcome line, start button, PIN. Screen wording only — strip wording lives per layout. |
| **Layouts** | Show/hide layouts, **Words** (per-layout strip text), **GIF on/off** per layout, upload and delete your own. |
| **Photos** | Recent strips kept on the tablet — reprint, share, delete. |
| **Camera** | Orientation, front/rear, mirror, capture width, countdown, copies, idle reset, uploads, QR. |
| **Remote** | What your remote sends, shutter keys, hands-free mode. |
| **Printer** | Connect, test slip, **Settings test**, **Printer diagnostic**, paper width, cut, dot size, dithering, speed and density, Supabase test, reset all. |

Settings save to the tablet and override `assets/config.js`. The booth
picks them up on its next load.

Recent strips are stored locally so Photos works offline, bounded by
**both** a count (`KEEP_LOCAL_COPIES`) and a byte budget
(`MAX_LOCAL_BYTES`, 60 MB). A record used to be one JPEG; with a GIF
beside it, "keep 40" stopped describing how much disk that is.

---

## Framing: what you see is what prints

The camera preview is set to the exact shape of the slot being filled,
and the capture is cropped to that same shape. A guest framing
themselves in the preview gets precisely that on paper.

Because slots in one layout can differ, the preview changes shape
between shots. The thumbnail row shows the shots taken so far with the
current one outlined.

---

## Remote shutter

A Bluetooth selfie remote, keyboard or foot pedal can fire the shutter —
they're all HID keyboards underneath. Defaults are Enter, Space and
numpad Enter. **Admin → Remote** shows what yours actually sends and can
learn it with one press.

A remote press does whatever the current screen's main button does, so
one button runs a whole session.

**The volume keys cannot be used.** Android handles them in the OS and
never passes them to a web page — no API, no browser, no workaround from
a website. If your remote only sends Volume Up:

1. **Look for an iOS/Android switch on it.** Most have one. Android mode
   sends Volume Up; iOS mode usually sends Enter, which works. Flip it,
   re-pair, press again.
2. Otherwise use a small Bluetooth keyboard, numeric keypad or USB foot
   pedal.
3. Or skip the remote: turn on **Take all photos in one go** under
   Admin → Remote, and one tap runs the whole session.

Media keys are also accepted. Android only routes those to a page that's
playing something, so the booth loops a silent clip to hold a media
session open. Presses within 600 ms count once — these remotes bounce.

---

## Config reference

`assets/config.js` holds the defaults. Admin overrides them per tablet.

### Print

| Setting | For |
|---|---|
| `PRINT_WIDTH_DOTS` | `576` for 80 mm paper, `384` for 58 mm. Wrong value = cropped prints. |
| `CUT_MODE` | `"partial"` leaves a tab to tear; `"full"` cuts through. |
| `FEED_BEFORE_CUT` | Raise if artwork hasn't cleared the blade. |
| `PHOTO_DOT_SIZE` | **The main dial for photo quality.** `1` finest, `2` recommended, `3` chunky retro. |
| `DITHER` | `"atkinson"` (clean, recommended) or `"floyd"`. |
| `PHOTO_GAMMA` | Lower (`0.7`) if prints are too dark. |
| `PHOTO_LOCAL_CONTRAST` | Separates face from hair from clothing. `0.6` default. |
| `PHOTO_SHARPEN` | Toward `1.2` for punchier edges. |
| `PRINT_SPEED` | Lower number = slower = more heat per dot. Fixes broken blacks. |
| `PRINT_DENSITY` | `0` standard, `1–127` darker, `128–255` paler. |

### Boomerang and downloads

| Setting | For |
|---|---|
| `GIF_ENABLED` | Master switch. Each layout opts in separately. |
| `GIF_FRAMES` | Frames per pose. Default `4`. |
| `GIF_SHUTTER_INDEX` | Which frame prints. Default `1`. |
| `GIF_FRAME_GAP_MS` | Spacing between frames. Default `180`. |
| `GIF_FRAME_MS` / `GIF_HOLD_MS` | Playback timing and the dwell on the last frame. |
| `GIF_WIDTH` / `GIF_MAX_COLORS` | Encoded size and palette. |
| `GIF_STILL_SOURCE` | `"preview"` (default) takes every frame off the live stream so exposure matches. `"photo"` uses a full `ImageCapture` still for the shutter frame — cleaner in a dim room, but it stalls the burst and shifts that frame's exposure. Judge it in your own venue lighting. |
| `NO_GIF_FRAMES` | Layout ids with animation off. Set from Admin. |
| `DOWNLOADS` | Which kinds to offer: `["color","bw","gif"]`. |
| `BW_STYLE` | `"grayscale"` or `"print"`. |
| `HINT_READY` / `HINT_BOOMERANG` / `HINT_MOVING` | Preview wording. |

### Session

| Setting | For |
|---|---|
| `COUNTDOWN_SECONDS` | Seconds before each pose. |
| `ASK_COPIES` / `MAX_COPIES` | Ask how many to print, up to 5. |
| `AUTO_PRINT_COPIES` | Fixed number instead of asking. |
| `AUTO_SEQUENCE` | One tap runs the whole session. |
| `IDLE_RESET_SECONDS` | Return to welcome between guests. |
| `ALLOW_GUEST_PRINT` | `false` hides the guest Print button. |
| `UPLOAD_PHOTOS` / `SHOW_QR` | Turn the digital half off. |
| `KEEP_LOCAL_COPIES` / `MAX_LOCAL_BYTES` | Local storage bounds. |
| `ADMIN_PIN` | Change it. |

---

## Troubleshooting

**"This browser can't talk to USB printers"** — You're on Safari, Firefox
or plain `http://`. Use Chrome or Edge over HTTPS.

**Nothing in the USB chooser** — The tablet isn't powering the printer
over OTG. Use a powered USB hub between tablet and printer, or an OTG
cable with its own power input. (The chooser lists every USB device, so
an unrecognised vendor ID is not the cause.)

**"Could not claim the printer"** — Something else grabbed the interface.
Unplug and replug, and close any printer utility app.

**Right side of the print is cut off** — You're on 58 mm paper. Set
`PRINT_WIDTH_DOTS: 384`.

**A fix you pushed isn't showing up** — Admin → check the build stamp →
**Force update**. If that fails, Chrome → the site → padlock → Cookies
and site data → Delete site data, then reinstall.

**Dark areas break up, streak or fade (light areas fine)** —
**Admin → Printer → Printer diagnostic.** It prints solid black bars, a
density ladder and 1-dot lines.

| What you see | Cause | Fix |
|---|---|---|
| White streaks down the black bar, same columns every time | Dirt on the print head | Clean it (below) |
| Black bar fades toward the bottom | Head overheating | Lower `PRINT_DENSITY`, raise `PRINT_SPEED`, shorter prints |
| Only 75–100% patches look broken | Not enough energy per dot | `PRINT_SPEED: 2`, then `PRINT_DENSITY: 4` |
| Gaps in the 1-dot lines, same spots | Dead head elements | Head is worn — needs replacing |
| All four look clean | Printer is fine | It's the photo or the pipeline |

**Cleaning the print head** — fixes most streaking, takes two minutes.
Power off, open the paper cover. The head is the thin dark strip the
paper slides under. Wipe along its length with a cotton bud dampened
with **isopropyl alcohol (90%+)**. Never water, never scrape. Let it dry
fully before closing. Every few thousand prints, or any time streaks
appear.

**Other causes of broken blacks**

- **Paper quality.** Cheap or old rolls have low sensitivity and simply
  won't go properly black. Try a fresh good roll before blaming the
  printer.
- **Paper loaded wrong side up.** Thermal paper prints on one side only.
  Faint everywhere? Flip the roll.
- **Heat.** A head that's been printing dense images continuously
  throttles itself. Space out test prints.

**Photos print dark and muddy, but text is sharp** — This is not the
printer. A thermal head spreads heat into neighbouring dots, so
single-dot detail merges into solid black. In order of impact:

1. **Light the subject's face.** A backlit guest is the single biggest
   cause. A cheap ring light fixes more than any setting here.
2. **Raise `PHOTO_DOT_SIZE` to `2` or `3`.** Printing each photo pixel
   as a block survives the bleed. Text is unaffected.
3. **Lower `PHOTO_GAMMA`** to `0.7`.
4. **Turn the printer's density down.** Less heat, less spread.
5. Keep `DITHER: "atkinson"`. Floyd–Steinberg pushes error into the
   highlights and greys out clean whites.

**Photos aren't sharp enough** — **Admin → Printer → Settings test**
prints the same shot four times at different settings so you can compare
on real paper.

Know the ceiling: a 544-dot slot at `PHOTO_DOT_SIZE: 2` gives a face
about 130 × 170 pixels. Counter-intuitively **dot 2 usually looks
sharper than dot 1** — at dot 1 the dithering scatters detail into fine
noise the eye averages back into grey, while chunkier dots survive. To
genuinely gain detail, make the slot bigger rather than the dots
smaller.

**Nothing cuts** — Try `CUT_MODE: "full"` and raise `FEED_BEFORE_CUT`.

**Photos upload but the QR doesn't open** — The `booth-photos` bucket
isn't public. Re-run `supabase-setup.sql`.

**No QR at all** — The done screen now says why: missing bucket, missing
policy, offline, library didn't load. **Admin → Printer → Test
connection** names the broken step.

**Stuck in portrait** — The manifest sets orientation at install time,
so an app installed from an older build keeps what it had. Set it in
**Admin → Camera → Screen**, which applies immediately. To clear it
properly, uninstall from the home screen and add it again.

---

## Files

```
index.html               booth screens + styling
admin.html               settings, layouts, photos
sw.js                    network-first cache + installability
manifest.webmanifest     install metadata
supabase-setup.sql       tables, RLS, storage buckets

assets/config.js         defaults (Admin overrides per tablet)
assets/settings.js       settings overlay, saved strips, per-layout wording
assets/frames.js         the four layouts as block stacks
assets/imaging.js        tone, dither, compose, newspaper chrome
assets/animate.js        GIF encoding
assets/printer.js        WebUSB + ESC/POS raster and cut
assets/app.js            kiosk flow
assets/admin.js          admin page
assets/remote.js         remote shutter input
assets/press.css         the two vendored faces

assets/vendor/           supabase-js, qrcode, gifenc, fonts
```

Everything third-party is vendored. A booth on venue wifi should not
need a CDN to hand a guest their photo.

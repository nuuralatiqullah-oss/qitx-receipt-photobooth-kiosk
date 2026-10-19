# Photobooth Kiosk

A browser photobooth for a tablet: pick a frame, take photos, print on a
Citizen CT-S310II thermal printer over USB. Static site — hosts on GitHub
Pages, stores photos in Supabase.

Flow: **Welcome → Select Frame → Capture → Review → Print → QR / Done**

---

## Can this actually work? Yes

| Requirement | Why it works |
|---|---|
| Printing from a web page | The printer speaks **ESC/POS**, so WebUSB can send it raster bytes directly. No driver, no print dialog. |
| Hosting on GitHub Pages | WebUSB and the camera need **HTTPS**. Pages is HTTPS by default. |
| Supabase from a static site | The anon key is public by design. RLS limits it to "read frames, insert prints, upload photos". |
| Running on the Redmi Pad 2 9.7 | Chrome for Android supports WebUSB + `getUserMedia`. Printer connects by **USB-C OTG**. |

The one thing to test early is **OTG**: plug the printer into the tablet
with a USB-C OTG cable and see whether Chrome shows the device chooser. If
the tablet won't power or enumerate the printer, see *Troubleshooting*.

---

## Install it on the tablet

Open the booth in Chrome, then **menu → Add to Home screen**. It installs
as a fullscreen app with no address bar. Turn on Android **screen
pinning** as well so guests can't leave the page.

**Stuck in portrait?** The manifest sets the orientation at install
time, so an app installed from an older build keeps whatever it had.
Set it in **Admin → Camera → Screen** — that applies immediately with
no reinstall. To clear it properly, uninstall the app from the home
screen and add it again.

Once installed it keeps working with no internet: the app shell is
cached by a service worker. **Open it once while online before the
event** so the fonts and libraries are cached too.

After you push a change, bump `CACHE` in `sw.js` — otherwise tablets
keep serving the version they already have.

## Two versions of every strip

The booth makes each strip twice:

- **The keepsake** — full colour, twice print size (~1150px wide). This
  is what guests see on the review screen, and what Save, Share, the QR
  download and the Admin photo list all use.
- **The print** — black and white dots at 203 dpi, because that is all
  a thermal head can put on paper.

So the screen looks like a normal photo while the paper looks like a
receipt. Both are kept on the tablet, so a reprint comes out identical
to the original rather than being re-processed.

To see exactly how a print will land before committing paper, use
**Admin → Printer → Settings test**.

## Uploading your own template

**Admin → Layouts → Upload a template.** Pick a PNG with see-through
holes where the photos go. The holes are found automatically — there
are no coordinates to type — and the preview outlines each one in pink
so you can check before saving.

Designing one:

- **576 px wide** matches the paper exactly (any width is scaled to fit).
- Punch the photo areas out to **full transparency**. A flat JPEG has no
  holes, and the uploader will say so rather than failing quietly.
- Each hole should be a clean rectangle. Specks and hairline gaps are
  ignored; a ragged cut-out may not be recognised.
- Put your own wording in the artwork — an uploaded template replaces
  the built-in booth name and footer.
- Design for the printer: **no grey, no colour, 203 dpi.** Bold shapes,
  heavy type and plenty of white. Fine detail and dark fills turn to mush.

Templates are stored on the tablet, so they work offline, and they are
deleted along with the layout.

## Getting photos to guests

| Way | Good for | Needs |
|---|---|---|
| **QR code** | Guests, hands down — they scan and it opens on their own phone, no app, no typing | Supabase |
| **Share** | Sending one strip from the tablet via WhatsApp or similar | Nothing |
| **Save** | Keeping a copy on the tablet for later | Nothing |
| **Admin → Photos** | Staff reprinting or sending a strip someone came back for | Nothing |

The QR is the one worth setting up. Without Supabase the booth still
captures, prints, saves and shares — guests just can't self-serve a
digital copy.

### Turning the QR on

Credentials for the `wudqimkxqsylvakiuwuz` project are already in
`assets/config.js`. A publishable key is designed to sit in public
client code — **but only because Row Level Security is on**, so step 1
is not optional.

1. In your Supabase project, **SQL Editor** → paste all of
   `supabase-setup.sql` → Run. Safe to re-run.
2. **Project Settings → Data API** → copy the Project URL.
   **Project Settings → API Keys** → copy the **publishable** key
   (`sb_publishable_…`). Never the secret one — this is a public repo.
3. **Admin → Printer → Supabase** → **Test connection**. (The keys are
   already filled in; paste over them to use a different project. A
   REST endpoint ending `/rest/v1/` is trimmed for you.)

The test walks the same path the booth takes when it prints: it uploads
a file, reads it back over the public URL, writes a row to `prints`,
then cleans up after itself. If a step fails it names that step, so you
know whether to re-run the SQL or make the bucket public.

Then on the **Camera** tab make sure **Upload to Supabase** and
**Show a QR code** are both on.

## Framing: what you see is what prints

The camera preview is set to the exact shape of the photo slot being
filled, and the capture is cropped to that same shape. A guest framing
themselves in the preview gets precisely that on paper — nothing is
trimmed afterwards.

Because slots in one layout can differ (Big Duo has a square and a
4:3), the preview changes shape between shots. The little strip beside
it shows which slot is being filled and what is already in the others.

In landscape the strip sits to the left of the preview with the button
on the right; in portrait they stack. Both are tested at the Redmi Pad
2's resolution.

## Admin

Tap **Admin** on the welcome screen. Default PIN is `1234`; change it on
the Text tab. The PIN is stored in the browser in plain text — it keeps
guests out during an event, it is not real security, so don't reuse a
password you care about.

| Tab | What it does |
|---|---|
| Text | Booth name, event name, welcome line, printed footer, PIN |
| Layouts | Turn layouts on or off, add your own, delete yours |
| Photos | Recent strips kept on the tablet — reprint, share, delete |
| Camera | Screen orientation, front/rear, mirror, capture width, countdown, copies, idle reset |

Guests are asked how many copies when they tap Print, up to 5. Turn
that off under **Camera** to print a fixed number instead.
| Printer | Test prints, paper width, cut, dot size, dithering, speed and density, Supabase |

Everything saves to the tablet and overrides `assets/config.js`. The
booth picks changes up on its next load. **Reset all settings** on the
Printer tab puts everything back.

Recent strips are stored on the tablet, so Photos works offline. Supabase
is the off-device copy on top of that. **Share** uses the Android share
sheet where available and falls back to a download.

## 1. Deploy to GitHub Pages

```bash
git init
git add .
git commit -m "Photobooth kiosk"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then **Settings → Pages → Source: Deploy from a branch → main / (root)**.
Your kiosk lands at `https://<you>.github.io/<repo>/`.

Nothing to build — it's plain HTML/JS.

## 2. Supabase (optional, for photo backup + QR download)

1. Create a project at supabase.com.
2. **SQL Editor** → paste all of `supabase-setup.sql` → Run. Safe to re-run.
3. **Project Settings → API** → copy the Project URL and the **anon public** key.
4. Put them in `assets/config.js`, push again.

Leave `SUPABASE_URL` blank and the booth still works — it just won't
upload or show a QR code.

> The `booth-photos` bucket is **public**, because the QR has to open
> without a login. Anyone with the link can view that photo. If you'd
> rather not, set the bucket private and switch to signed URLs, or turn
> `SHOW_QR` off and keep the prints paper-only.

## 3. Set up the printer

1. Open the kiosk in **Chrome** on the tablet.
2. Tap **Printer** (top right) → pick the Citizen in the USB chooser.
3. Tap **Printer** again — it now prints a short test slip. Check that
   the text isn't cut off on the right and that the cutter fires.

Chrome remembers the permission, so after a reload the kiosk reconnects
silently. After a full tablet restart you may need to tap once more.

## 4. Lock it down for the event

- Install as an app: Chrome menu → **Add to Home screen** (runs fullscreen).
- Turn on Android **screen pinning** so guests can't leave the page.
- Keep the tablet on the charger; it holds a wake lock while running.

---

## Tuning `assets/config.js`

| Setting | What to change it for |
|---|---|
| `PRINT_WIDTH_DOTS` | `576` for 80mm paper, `384` for 58mm. Wrong value = cropped prints. |
| `CUT_MODE` | `"partial"` leaves a tab to tear; `"full"` cuts clean through. |
| `PHOTO_DOT_SIZE` | **The main dial for photo quality.** `1` finest, `2` recommended, `3` chunky retro. |
| `ADMIN_PIN` | PIN for the Admin page. |
| `ALLOW_GUEST_PRINT` | `false` hides the guest Print button — staff print from Admin instead. |
| `DITHER` | `"atkinson"` (clean, recommended) or `"floyd"` (finer but muddier). |
| `PHOTO_GAMMA` | Lower (e.g. `0.7`) if prints are too dark. |
| `PRINT_SPEED` | Lower number = slower = more heat per dot. Fixes broken blacks. |
| `PRINT_DENSITY` | `0` standard, `1-127` darker, `128-255` paler. |
| `PHOTO_LOCAL_CONTRAST` | Separates face from hair from clothing. `0.6` default, `1.0` graphic. |
| `PHOTO_SHARPEN` | Raise toward `1.2` for punchier edges. |
| `COUNTDOWN_SECONDS` | Seconds before each shot. |
| `AUTO_PRINT_COPIES` | Print 2 copies per session (one for the guest, one for the guestbook). |
| `IDLE_RESET_SECONDS` | Auto-return to the welcome screen between guests. |

## Custom frames

Built-in layouts live in `assets/frames.js` (Classic Strip, Big Duo,
Polaroid, Quad Grid). All coordinates are in **print dots at 576 wide**;
the app rescales for 58mm paper automatically.

For a designed frame like the ZarenBooth templates:

1. Export a **576-px-wide transparent PNG** — transparent where the photos
   go, artwork everywhere else.
2. Upload it to the `booth-frames` bucket in Supabase.
3. Insert a row in the `frames` table:

```sql
insert into public.frames (name, width, height, shots, slots, overlay_path, sort_order)
values (
  'Wedding Strip', 576, 1500, 3,
  '[{"x":48,"y":150,"w":480,"h":360},
    {"x":48,"y":530,"w":480,"h":360},
    {"x":48,"y":910,"w":480,"h":360}]'::jsonb,
  'wedding-strip.png', 1
);
```

It appears in the picker on the next page load — no redeploy.

Note that thermal output is **1-bit black and white**. Bold line art and
big type survive; fine gradients and dark backgrounds turn to mush.
Design frames with lots of white space.

---

## Troubleshooting

**"This browser can't talk to USB printers"** — You're on Safari, Firefox,
or plain `http://`. Use Chrome or Edge over HTTPS.

**Nothing in the USB chooser** — First, tap **Printer** a second time:
the first tap filters by known vendor IDs, and if nothing matched, the
second shows every USB device so you can pick the printer yourself. Many
Gainscha/Gprinter units report an unpublished vendor ID and need this.

If the list is still empty, the tablet isn't powering the printer over
OTG. Use a powered USB hub between tablet and printer, or an OTG cable
with its own power input.

**"Could not claim the printer"** — Something else grabbed the interface.
Unplug and replug, and close any Citizen utility app.

**Right side of the print is cut off** — You're on 58mm paper. Set
`PRINT_WIDTH_DOTS: 384`.

**Dark areas break up, streak or fade (but light areas are fine)** —
Tap **Printer diagnostic** on the review screen. It prints solid black
bars, a density ladder and 1-dot lines. Read it like this:

| What you see | Cause | Fix |
|---|---|---|
| White streaks running down the black bar, same columns every time | Dirt or residue on the print head | Clean it (below) |
| Black bar fades toward the bottom | Head overheating | Lower `PRINT_DENSITY`, raise `PRINT_SPEED` number, shorter prints |
| Only 75–100% patches look broken | Not enough energy per dot | Set `PRINT_SPEED: 2` (slower), then `PRINT_DENSITY: 4` |
| Gaps in the 1-dot lines, same spots | Dead head elements | Head is worn — needs replacing |
| All four look clean | Printer is fine | It's the photo or the pipeline |

**Cleaning the print head** — this fixes most streaking and takes two
minutes. Power the printer off and open the paper cover. The print head
is the thin dark strip the paper slides under. Wipe it along its length
with a cotton bud dampened with **isopropyl alcohol (90%+)**. Never use
water, and never scrape it. Let it dry fully before closing. Do this
every few thousand prints, or any time streaks appear.

**Other things that cause broken blacks**

- **Paper quality.** Cheap or old thermal rolls have low sensitivity and
  simply won't go properly black. Try a fresh, good-quality 80mm roll
  before blaming the printer.
- **Paper loaded with the wrong side up.** Thermal paper only prints on
  one side. If prints are faint everywhere, flip the roll.
- **Heat.** A head that has been printing dense images continuously will
  throttle itself. Space out test prints.

**Photos aren't sharp enough** — Take a photo, then tap **Print settings
test** on the review screen. It prints the same shot four times (A-D) at
different settings so you can compare on real paper, then set
`PHOTO_DOT_SIZE` and `PHOTO_LOCAL_CONTRAST` to match the one you like.

Be aware of the ceiling: a 480-dot photo slot at `PHOTO_DOT_SIZE: 2` gives
the face about 130x170 pixels. Counter-intuitively **dot 2 usually looks
sharper than dot 1** — at dot 1 the dithering scatters detail into fine
noise that your eye averages back into grey, while chunkier dots survive.
To genuinely gain detail, make the photo slot bigger (up to 576 dots wide)
rather than reducing the dot size.

**Photos print dark and muddy, but text is sharp** — This is not the
printer. A thermal head spreads heat into neighbouring dots, so
single-dot detail merges into solid black. Fixes, in order of impact:

1. **Light the subject's face.** A backlit guest (window or bright wall
   behind them) is the single biggest cause. A cheap ring light on the
   tablet fixes more than any setting here.
2. **Raise `PHOTO_DOT_SIZE` to `2` or `3`.** Printing each photo pixel as
   a 2x2 or 3x3 block of dots survives the bleed. Text is unaffected.
3. **Lower `PHOTO_GAMMA`** to `0.7` or `0.65` to lighten midtones.
4. **Turn the printer's print density down** in the Citizen utility or
   DIP switches. Less heat means less spread.
5. Keep `DITHER: "atkinson"`. Floyd-Steinberg pushes error into the
   highlights and greys out clean white areas.

**Nothing cuts** — Try `CUT_MODE: "full"`, and raise `FEED_BEFORE_CUT` so
the artwork clears the cutter blade before it fires.

**Photos upload but the QR doesn't open** — The `booth-photos` bucket isn't
public. Re-run `supabase-setup.sql`.

---

## Files

```
index.html              booth screens + styling
admin.html              settings, layouts, photos
sw.js                   offline cache + installability
manifest.webmanifest    install metadata
assets/config.js        defaults (Admin overrides these per tablet)
assets/settings.js      settings overlay + saved strips (IndexedDB)
assets/admin.js         admin page logic
assets/frames.js        built-in frame layouts
assets/imaging.js       per-photo levels, gamma, dot size, Atkinson dither
assets/printer.js       WebUSB + ESC/POS (raster, auto-cut)
assets/app.js           kiosk flow
supabase-setup.sql      tables, RLS, storage buckets
```

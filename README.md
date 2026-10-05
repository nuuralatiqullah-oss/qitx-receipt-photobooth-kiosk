# Photobooth Kiosk

A browser photobooth for a tablet: pick a frame, take photos, print on a
Citizen CT-S310II thermal printer over USB. Static site — hosts on GitHub
Pages, stores photos in Supabase.

Flow: **Welcome → Select Frame → Capture → Review → Print → QR / Done**

---

## Can this actually work? Yes

| Requirement | Why it works |
|---|---|
| Printing from a web page | The CT-S310II speaks **ESC/POS**, so WebUSB can send it raster bytes directly. No driver, no print dialog. |
| Hosting on GitHub Pages | WebUSB and the camera need **HTTPS**. Pages is HTTPS by default. |
| Supabase from a static site | The anon key is public by design. RLS limits it to "read frames, insert prints, upload photos". |
| Running on the Redmi Pad 2 9.7 | Chrome for Android supports WebUSB + `getUserMedia`. Printer connects by **USB-C OTG**. |

The one thing to test early is **OTG**: plug the printer into the tablet
with a USB-C OTG cable and see whether Chrome shows the device chooser. If
the tablet won't power or enumerate the printer, see *Troubleshooting*.

---

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
| `DITHER` | `"atkinson"` (clean, recommended) or `"floyd"` (finer but muddier). |
| `PHOTO_GAMMA` | Lower (e.g. `0.7`) if prints are too dark. |
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

**Nothing in the USB chooser** — The tablet isn't powering the printer over
OTG. Use a powered USB hub between tablet and printer, or an OTG cable
with its own power input.

**"Could not claim the printer"** — Something else grabbed the interface.
Unplug and replug, and close any Citizen utility app.

**Right side of the print is cut off** — You're on 58mm paper. Set
`PRINT_WIDTH_DOTS: 384`.

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
index.html              screens + styling
assets/config.js        everything you edit per event
assets/frames.js        built-in frame layouts
assets/imaging.js       per-photo levels, gamma, dot size, Atkinson dither
assets/printer.js       WebUSB + ESC/POS (raster, auto-cut)
assets/app.js           kiosk flow
supabase-setup.sql      tables, RLS, storage buckets
```

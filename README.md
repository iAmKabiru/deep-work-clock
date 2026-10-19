# Deep Work Countdown Clock

A minimalist, LED-style countdown clock (HH:MM) for focused work. Installable, offline-capable, no dependencies or build step.

## Run it

Service workers and installation need `http://localhost` or HTTPS (opening `index.html` directly works, but without offline/install support).

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

To deploy, upload the folder to any static host (Netlify, GitHub Pages, Cloudflare Pages, etc.) over HTTPS, then use your browser's **Install** / **Add to Home Screen** option.

## Use it

- Set hours (0–99) and minutes (0–59), then **Start**.
- **Pause / Resume** continues from the remaining time. **Reset** restores the selected duration.
- At zero the display shows `00:00` and pulses slowly (and vibrates briefly where supported). **Start** runs it again.
- The top-right corner holds the theme swatches (amber, white, green) and fullscreen.
- Keyboard: `Space` start/pause/resume, `R` reset, `F` fullscreen.

## How it works

- **Accurate timing:** the end time is stored as a timestamp; the display is recomputed from `Date.now()`, so throttled background tabs never drift. The display shows the minute in progress and updates exactly when it changes.
- **Persistence:** theme, duration and countdown state live in `localStorage`. A countdown running during a reload (or while the tab was closed) is recovered from its end time, or shown as complete if it has passed.
- **Screen Wake Lock:** requested while running, released on pause/reset/completion, and re-acquired when the page becomes visible again. Browsers without support simply skip it.
- **Fullscreen:** the button appears only where the Fullscreen API exists (not on iPhone Safari; install to the Home Screen for a chrome-free view there).
- **Offline:** `sw.js` precaches the app shell. Bump `CACHE` in `sw.js` when you change any file.

## Files

`index.html` · `style.css` · `app.js` · `manifest.webmanifest` · `sw.js` · `icons/` (SVG + PNG; `make_icons.py` regenerates the PNGs)

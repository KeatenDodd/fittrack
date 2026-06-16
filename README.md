# FitTrack

A self-hosted workout + nutrition tracker you run on your own network. Log
workouts with sets/reps and a rest timer, save templates, track body weight and
measurements, log food (search, barcode scan, or custom entries) with macro and
micronutrient totals against daily goals, and watch progress charts over time.

**Node.js / Express** backend with an **embedded SQLite** database (no separate
database server) and a **vanilla JS** single-page front end (no build step). Runs
as a normal Node app, a Docker container, or a single self-contained `.exe`.

---

## Easiest: the Windows app (FitTrack.exe)

One file, nothing to install — not even Node or a database.

1. Get **`FitTrack.exe`** (build it with `npm run build:exe`, or use a copy
   someone shares with you).
2. Double-click it. Your browser opens at **http://localhost:8080** and the app
   then runs **quietly in the background** — no window — with a **FitTrack icon
   in your system tray** (bottom-right).
3. Create a profile and start logging.

Because it runs in the background, the server stays up so you can reach it from
your **phone** anytime (`http://<your-computer-IP>:8080`) without keeping a
window open on your PC.

- **Reopen the app:** double-click the tray icon (or `FitTrack.exe` again), or
  just visit the URL.
- **Stop it:** right-click the tray icon → **Quit FitTrack**.

Everything lives in a **`fittrack-data`** folder created next to the `.exe` (the
SQLite database + your uploaded photos/videos). To move or back up your data,
copy that folder.

> The camera / barcode scanner works because `localhost` is a secure context.
> Profiles have no passwords — fine on your own PC.

### Auto-updates (GitHub Releases)

Installed copies of `FitTrack.exe` update themselves from your GitHub releases.
On launch the app checks your repo's latest release; if it's newer it downloads
the new exe in the background and **swaps it in the next time the app is closed
and reopened**. Data in `fittrack-data` is never touched.

One-time setup:

1. Put this project in a GitHub repo and set **`"repository"`** in
   `package.json` to it, e.g. `"github:yourname/fittrack"`.
2. Install the **[GitHub CLI](https://cli.github.com/)** and run `gh auth login`.

To ship an update after making changes:

```bash
npm version patch      # bump 1.0.0 -> 1.0.1 (or `minor` / `major`)
npm run release        # builds the exe and publishes it to GitHub Releases
```

Everyone's installed app picks it up on its next launch. (The exe isn't
code-signed, so the *first* download a friend does may show a Windows SmartScreen
prompt — "More info → Run anyway". Auto-updates after that are silent.)

---

## Run with Docker (also one command)

Keep all data on your machine with no Node or database to install.

1. Install **[Docker Desktop](https://www.docker.com/products/docker-desktop/)**
   and start it.
2. From this project folder, run:

   ```bash
   docker compose up -d
   ```

   The first run builds the image and initializes the database automatically
   (takes a minute).
3. Open **http://localhost:1308** and create a profile.

That's it. The camera / barcode scanner works because `localhost` counts as a
secure context. Everything (database + uploaded photos/videos) lives in local
Docker volumes on your machine.

```bash
docker compose logs -f app   # watch the server logs
docker compose down          # stop it (keeps your data)
docker compose down -v       # stop AND erase all data
```

> Before sharing, change `JWT_SECRET` in `docker-compose.yml` to any random
> string. Profiles have no passwords, so anyone who can reach the URL can use
> the app — fine on your own machine / home network.

To reach it from your **phone** on the same Wi-Fi, browse to
`http://<your-computer-IP>:1308`. The camera needs HTTPS off `localhost`, so for
phone camera use either skip the scanner or follow the mkcert steps below.

---

## Run with Node (for development)

You need **Node.js 22 or newer** (it uses the built-in `node:sqlite` module).

```bash
npm install
npm start
```

That's it — **there's no database to set up**. On first run the app creates an
embedded **SQLite** database and loads the starter data (~35 exercises, the
nutrient catalog, body-measurement types) automatically. Your data lives in
`data/fittrack.db`.

Optional configuration (a `.env` file or environment variables):

- `JWT_SECRET` — a long random string (e.g. `openssl rand -hex 32`)
- `HOST=0.0.0.0` so other devices on your Wi-Fi can reach it
- `PORT=8443` (or whatever you like)
- `DATA_DIR` / `DB_FILE` — where the SQLite db + uploads are stored
- `OFF_BASE` — Open Food Facts base URL (for the barcode lookup)

To build the standalone `FitTrack.exe`: `npm run build:exe` (output in `dist/`).

## Trusted HTTPS for the camera (optional)

The barcode scanner needs a secure context. `mkcert` makes a locally-trusted
certificate so phones don't show scary warnings.

```bash
# install mkcert (see https://github.com/FiloSottile/mkcert), then:
mkcert -install

# find your computer's LAN IP first (see below), then issue a cert for it:
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 192.168.1.50 localhost
```

Put the resulting `key.pem` and `cert.pem` in the `certs/` folder. On startup
the server uses them automatically. **No certs?** It still runs over plain HTTP
— everything works except the camera/barcode scanner.

To trust the cert on your phone, install mkcert's root CA on the device
(`mkcert -CAROOT` shows where `rootCA.pem` lives; email/AirDrop it to the phone
and install it in settings).

## Open it from your phone and PC

Find your computer's LAN IP:

- **macOS/Linux:** `ipconfig getifaddr en0` or `hostname -I`
- **Windows:** `ipconfig` → IPv4 Address

Then on any device on the same WiFi, open:

```
https://YOUR-LAN-IP:8443      (or http:// if you skipped certs)
```

The first person to open it taps **Create an account**. Make one for yourself
and one for Melissa — each account's data is separate.

**Tip:** give the host computer a static IP or a DHCP reservation in your router
so the address doesn't change.

---

## Using it

- **Workout** — start empty or from a template. Add exercises, punch in
  weight × reps, and the rest timer starts automatically (tap +30 or Skip).
  Finish to save it to history.
- **Templates** — build reusable routines with target sets/reps/rest, then start
  a workout from one in a tap.
- **Food** — pick a day, then add foods to breakfast/lunch/dinner/snack by
  searching (local foods + Open Food Facts), scanning a barcode, or entering a
  custom food. Set daily goals and watch totals + micronutrients fill in.
- **Body** — log body weight and measurements; both chart over time.
- **Progress** — estimated 1‑rep‑max and top set per exercise, body-weight
  trend, and a 30‑day calorie chart.

---

## Notes & seams for later

- **Food data:** barcode + search use Open Food Facts (free, no key). Macros are
  reliable; some micronutrients are approximate. A clean seam exists to add
  **USDA FoodData Central** later for gold-standard micros (needs a free
  api.data.gov key) — the food/nutrient model already stores everything
  per‑100‑units, source-tagged.
- **Offline:** Chart.js and the barcode library load from a CDN
  (`public/index.html`). To run fully offline, download those two files into
  `public/vendor/` and point the two `<script>` tags there.
- **Importing your old data:** the schema tags foods and (optionally) other rows
  with `source` + `source_ref`, so an importer can map a previous app's export
  onto it without collisions. Send a sample export (CSV/JSON) and the mapping is
  straightforward to add.
- **Backups:** it's just Postgres — `pg_dump fittrack > backup.sql`.

## Project layout

```
src/            Express server, auth, routes (one file per resource)
db/             schema.sql + seed.sql
scripts/        db-init.js
public/         the SPA — index.html, css/app.css, js/ (views/ per screen)
certs/          drop cert.pem + key.pem here for HTTPS
```

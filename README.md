# FitTrack

A self-hosted workout + nutrition tracker you run on your own network. Log
workouts with sets/reps and a rest timer, save templates, track body weight and
measurements, log food (search, barcode scan, or custom entries) with macro and
micronutrient totals against daily goals, and watch progress charts over time.

Built to match the TableFlow stack: **Node.js / Express / PostgreSQL** backend
with a **vanilla JS** single-page front end (no build step).

---

## What you need

- **Node.js 18 or newer** (uses the built-in `fetch`).
- **PostgreSQL 14+** running somewhere this app can reach.
- **mkcert** (optional but recommended) so the phone camera / barcode scanner
  works — browsers only allow the camera over HTTPS or `localhost`.

---

## 1. Install and create the database

```bash
# from the project folder
npm install
```

Create the database and a role (adjust names/passwords to taste):

```bash
# as a postgres superuser
createuser fittrack --pwprompt        # set a password when asked
createdb fittrack --owner fittrack
```

## 2. Configure

```bash
cp .env.example .env
```

Open `.env` and set at least:

- `DATABASE_URL` — e.g. `postgres://fittrack:YOURPASSWORD@localhost:5432/fittrack`
- `JWT_SECRET` — paste a long random string (e.g. `openssl rand -hex 32`)
- `HOST=0.0.0.0` so other devices on your WiFi can reach it
- `PORT=8443` (or whatever you like)

## 3. Load the schema + starter data

```bash
npm run db:init
```

This applies `db/schema.sql` then `db/seed.sql` (≈35 starter exercises, the
nutrient catalog, and body-measurement types). Run it once on a fresh database.
To start over: drop and recreate the database, then run it again.

## 4. (Recommended) Trusted HTTPS for the camera

The barcode scanner needs a secure context. `mkcert` makes a locally-trusted
certificate so phones don't show scary warnings.

```bash
# install mkcert (see https://github.com/FiloSottile/mkcert), then:
mkcert -install

# find your computer's LAN IP first (see step 6), then issue a cert for it:
mkcert -key-file certs/key.pem -cert-file certs/cert.pem 192.168.1.50 localhost
```

Put the resulting `key.pem` and `cert.pem` in the `certs/` folder. On startup
the server uses them automatically. **No certs?** It still runs over plain HTTP
— everything works except the camera/barcode scanner.

To trust the cert on your phone, install mkcert's root CA on the device
(`mkcert -CAROOT` shows where `rootCA.pem` lives; email/AirDrop it to the phone
and install it in settings).

## 5. Start it

```bash
npm start
```

You'll see either `FitTrack (HTTPS) on https://0.0.0.0:8443` or an HTTP notice.

## 6. Open it from your phone and PC

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

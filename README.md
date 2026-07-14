# CAL — Personal Calorie Tracker

A local-only calorie balance tracker. No accounts, no server, no cost. All data
is stored in your browser's `localStorage` on the device you use it on. Installs
to your iPhone home screen as a PWA and works fully offline.

## Features
- **Adjustable daily baseline** (maintenance calories) in Settings.
- **Quick intake logging** — enter calories, optionally save as a reusable meal
  with a base *proportion*.
- **Add from saved meals** — pick a meal, enter a proportion, calories scale
  automatically (`saved kcal ÷ base proportion × your proportion`).
- **Burn logging** — same system for activities, scaled by *duration (min)*.
- **Home = today's balance** → `Intake − Burnt − Baseline`, with two big buttons.
- **History** — net-balance bars, intake/burn/baseline lines, cumulative-net
  trend, per-day list, and stats (avg balance, days logged, cumulative net,
  estimated weight change at ~7700 kcal/kg).
- **Backup/restore** — export or import all data as a JSON file (Settings tab).

## Run locally (optional)
Just open `index.html` in a browser, or serve the folder:
```
npx serve .
```
> The service worker / "Add to Home Screen" only fully works over `https://`
> (i.e. GitHub Pages) or `http://localhost`, not `file://`.

## Deploy to GitHub Pages (free)
1. Create a new repository on GitHub, e.g. `cal`.
2. From this folder:
   ```
   git init
   git add .
   git commit -m "CAL calorie tracker"
   git branch -M main
   git remote add origin https://github.com/<your-username>/cal.git
   git push -u origin main
   ```
3. On GitHub: **Settings → Pages → Build and deployment → Source: "Deploy from a
   branch"**, select **branch `main` / folder `/ (root)`**, Save.
4. Wait ~1 minute. Your app is live at
   `https://<your-username>.github.io/cal/`.

## Install on iPhone
1. Open the GitHub Pages URL in **Safari**.
2. Tap **Share → Add to Home Screen**.
3. Launch it from the new icon — full screen, offline, no 7-day expiry.

## Updating the app
Edit files, commit, and push. GitHub Pages redeploys automatically. When you
change a cached file, bump `CACHE = "cal-cache-v1"` in `sw.js` (e.g. `-v2`) so
the phone picks up the new version.

## ⚠️ Data lives only on this device
Clearing Safari data or deleting the app erases everything. Use
**Settings → Export backup** periodically to save a JSON copy.

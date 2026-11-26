# Focus 2.0 🌲

A study break app that helps you stay focused, take mindful breaks, and avoid burnout.
This is version 2. Version 1 lives at https://lamichhaneanish26-s.github.io/focus-app/

## What's new in 2.0
- 🍅 **Pomodoro cycle**: focus → short break → focus …, with a long break every 4 sessions and a session counter
- 🔔 **Pop-up alerts** when a session or break ends (turn on in ⚙️ Settings)
- 💡 **Keeps the screen on** while the timer runs
- 📊 **Progress**: minutes today and this week, day streak and a 7-day chart (saved on your device)
- 📝 **Session to-do list** you can tick off
- 🌬️ **Breathing guide** with an animated circle (box, 4-7-8 and calm patterns), works offline
- 🎧 **Calm sounds**: rain, waves, forest and brown noise, made in the browser, work offline
- 🧍 **Break ideas** like "stand up and stretch" during breaks
- 📲 **Home-screen shortcuts**: press and hold the app icon to start focusing or take a break
- 🌙 **Dark mode** and a ⚙️ **Settings** panel for your own timer lengths

Plus everything from 1.0: study timer, breathing and stretching videos, Snake mini game, background music, installable app that opens offline.

## Install it
- **Android / Chrome / Edge:** tap **⬇ Install App** (or the install icon in the address bar).
- **iPhone / iPad:** in Safari tap **Share → Add to Home Screen**. (Pop-up alerts on iPhone need the app installed to the home screen.)

## Updating
After changing any file, bump `CACHE_VERSION` at the top of `sw.js` (e.g. `focus2-v1` → `focus2-v2`) so installed copies pick up the update.

## Downloadable apps
Get Focus for every device at **download.html** (the "⬇ Get the app" button in the menu):

| Device | How |
| --- | --- |
| Windows | `Focus-Setup.exe` installer |
| Mac | `Focus.dmg` (Intel and Apple chips) |
| Android phones and tablets | `Focus.apk` |
| Linux | `Focus.AppImage` |
| iPhone and iPad | Safari → Share → Add to Home Screen |

The files are built automatically by GitHub Actions (`.github/workflows/build-apps.yml`) and published on the Releases page.
To make a new release: push a tag such as `v2.0.1`.

- `apps/desktop` — the Windows/Mac/Linux app (Electron). It opens the live website, so it always has the latest version, and falls back to a copy inside the app when offline.
- `apps/android` — the Android app (Capacitor). The website is bundled inside, so it works fully offline, and timer alerts use Android notifications.

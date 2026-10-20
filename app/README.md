# Tabletop Towers for Android

The Android app is the web game from the repository root, packed into a native app with
[Capacitor](https://capacitorjs.com/) 8, the same way as Tabletop Turbo's. There is one game codebase:
anything that changes in `js/`, `css/`, `index.html`, `fonts/` and `vendor/` reaches the website and the app
alike.

- **App ID:** `lu.andreasbraun.tabletoptowers` (cannot change once the app is on Google Play)
- **Version:** `version` in `app/package.json` is the version name. The version code is the GitHub Actions run
  number, so every build counts up.

## What the app adds

- Full screen and always sideways (the castles face each other across the table): system bars hidden (a swipe
  from the edge shows them briefly), screen kept on, drawing extends into the camera cutout
  (`MainActivity.java`, `android:screenOrientation="sensorLandscape"` in the manifest). The castle cards, the
  shop and the aiming bar keep clear of the cutout (`--sal` / `--sar` in `css/game.css`).
- Back button: pauses during a game, goes one step back in the menus, and from the results to the title; on the
  title screen the app goes to the background (`window.__ttBack` in `js/main.js`).
- Going to the background (home button, a call) pauses the game and silences the sound.
- In the app the game hides its fullscreen button and the link back to the website (`.in-app` in
  `css/game.css`).
- Icon, round icon, adaptive icon, splash screens and the 512 px store icon (`app/store/icon-512.png`), all
  drawn by `_dev/tools/app_icons.py` from the favicon design. Run it again after changing the design.

## Getting the app onto a phone

Every push to `main` or `android` that touches the game or `app/` builds the app on GitHub
(`.github/workflows/android.yml`) and replaces the **android-preview** pre-release:
https://github.com/DrAndiB/TabletopTowers/releases/tag/android-preview

Open that page on the phone, tap the `.apk` file and allow the browser to install apps when Android asks.
Preview builds are signed with a fixed preview key (`android/preview.keystore`, password in
`android/app/build.gradle`), so a new preview installs over the previous one and keeps the settings. That key is
public on purpose: it is only for previews, never for Google Play.

## Building on a Windows PC (optional)

Needs Node.js and Android Studio (which brings the Android SDK and a JDK). In PowerShell, from `app\`:

```powershell
npm ci
npm run sync          # copies the game into app\www and from there into the Android project
npx cap open android  # opens Android Studio; Run ▶ installs on a connected phone
```

## Google Play: what is still to do

Same as for Tabletop Turbo: a Google Play developer account (a new personal account needs a closed test with
12 testers for 14 days first), an upload key kept outside GitHub and given to the build as the repository
secrets `TT_UPLOAD_KEYSTORE`, `TT_UPLOAD_STORE_PASSWORD`, `TT_UPLOAD_KEY_ALIAS` and `TT_UPLOAD_KEY_PASSWORD`
(the build script already reads them; the workflow then needs a `bundleRelease` step for the `.aab`), and the
store listing: the 512 px icon is in `app/store/`; also needed are a 1024×500 feature graphic, screenshots, a
privacy policy URL (the game collects nothing: its settings stay on the device), the content rating
questionnaire and the target age group.

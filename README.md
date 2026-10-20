# TempoTapp 1.5.0

Click-track creator, beat analyzer, and audio warp tool. Single-page web app. Runs in two modes:
**device-only** (no backend, everything stays on the device) or **cloud accounts** (Firebase; the
library follows the user across devices). The mode is chosen by `vendor/cloud-config.js`.

## Layout

```
index.html                  the whole app (markup, styles, script)
vendor/pdf.min.mjs          pdf.js 4.10.38 — sheet-music rendering
vendor/pdf.worker.min.mjs   pdf.js worker
vendor/standard_fonts/      pdf.js fallback fonts for PDFs without embedded fonts
vendor/SignalsmithStretch.js  Signalsmith Stretch 1.3.2 — "Studio Quality" time-stretch (WASM)
vendor/beatnet.js             AI beat tracker (BeatNet network + HMM decoder, plain JS)
vendor/beatnet-worker.js      Web Worker that runs it off the UI thread
vendor/beatnet_weights.f32    1.6 MB model weights (+ .json layout, beatnet_frontend.json filterbank)
vendor/fonts/                 Libre Caslon Text + Source Sans 3 (woff2, OFL)
design/engraved.css           the visual layer (also embedded in index.html as #engraved-theme)
design/retheme.py             the color-family remap that produced the base palette
vendor/cloud-config.js        null = device-only; a Firebase web config = cloud accounts
vendor/firebase-bundle.js     Firebase JS SDK 13 (Auth, Firestore, Storage), bundled with esbuild
firebase/                     Firestore + Storage security rules for the cloud mode
tests/                        Playwright suites: e2e_full.py (device-only), cloud_e2e.py (cloud)
THIRD-PARTY-LICENSES.txt
```

Keep the `vendor/` folder next to `index.html`. If it is missing, the app falls back to the same
pinned versions on jsdelivr (network required). For an App Store build, ship `vendor/` so the
app is self-contained and works offline.

## Cloud accounts (sync across devices)

Set `window.TEMPOTAPP_CLOUD = { firebase: { ...web config... } }` in `vendor/cloud-config.js`.
The app then uses Firebase Auth (email/password + Google, email verification, password reset),
Firestore for the library metadata and Storage for saved warped audio, all under `users/{uid}/…`
and protected by the rules in `firebase/`. IDs stay numeric, so the UI is identical in both modes.

One-time Firebase setup: create a project; enable Authentication → Email/Password and Google;
create a Firestore database and a Storage bucket (Blaze plan with a budget alert); paste the
rules from `firebase/` into the console (Firestore → Rules, Storage → Rules) or run
`firebase deploy --only firestore:rules,storage` from that folder; add the site's domain under
Authentication → Settings → Authorized domains.

First sign-in on a device that already has a device-only library offers to upload it (once).
Audio is cached in IndexedDB after the first download. `Delete account` removes the Auth user,
every document and every file.

Test it without a project: `python3 tests/cloud_e2e.py` swaps the SDK for `tests/fake-fb.js`,
a same-surface stand-in. `--real` runs against the Firebase emulators instead.

## Data & privacy (device-only mode)

- Account list and encrypted per-user "vaults": `localStorage` (`tempotap-web-data-v1`, format 2).
- Rendered audio, encrypted: IndexedDB (`tempotap-web-audio-v1`).
- Encryption: AES-256-GCM per user. The data key is random and wrapped with a key derived from
  the password (PBKDF2-SHA-256, 150k iterations). The same derivation yields the sign-in verifier.
- While signed in, the unwrapped key is kept in storage so the session survives reloads; signing
  out removes it. A signed-out user's library is unreadable without the password.
- **No password reset exists** — nobody but the user holds the key. The sign-up form says so.
- Accounts from the previous (unencrypted) format are upgraded automatically at next sign-in.
  A remembered pre-upgrade session is signed out once so that upgrade can happen.
- No network requests except the vendor fallback above. No analytics, no tracking.
- Account → Delete account wipes everything for that user, including audio.

What this does and doesn't protect: a signed-OUT account is protected against anyone who copies
or inspects the device's storage. A signed-IN session is protected only by the device lock, like
any other app. Requires WebCrypto (https, localhost, file://, or an app WebView).

## Optional feature: sharing click tracks by file

"Share" on a saved click track exports a `.tempotap.json` file (timings and settings only — no
audio, no PDF). "Import shared track" in My Click Tracks loads one into the current account.
Imported files are treated as untrusted and rebuilt field-by-field with type checks and caps.

The feature is fully fenced for easy removal: delete the script block between
`BEGIN/END OPTIONAL FEATURE: CLICK TRACK SHARING`, the two HTML fragments marked
`OPTIONAL FEATURE: SHARING`, and the `[sharing]` branch in the trackList click handler.

## Optional feature: AI beat tracker (Analyze)

Analyze → Detector offers "AI beat tracker" (default) or "Classic detector". The AI engine is
BeatNet (a CRNN, 1.6 MB) running in a dedicated Web Worker on the device, decoded with a port of
madmom's DBN beat tracker, then meter/downbeat phase selection. It is converted into the same
result object the classic detector produces, so editing, meter maps, MIDI and Warp are unchanged.
If the engine cannot load, the classic detector runs and the status line says so.

Benchmark (8 real recordings, no server): the classic detector reported 4/4 on every file and
chose half tempo on two steady 4/4 tracks; the AI engine found 3/4 on the waltz, 2/4 on Brahms
Hungarian Dance 5 with its rubato, and the correct tempo everywhere. Full details in
`docs/ai-beat-tracker-benchmark.md`. The JS decoder reproduces madmom frame-for-frame.

Speed: ~2.6 s per minute of audio in desktop Chromium; expect roughly 2–3× that on a phone.

Fenced for removal: the script block `BEGIN/END OPTIONAL FEATURE: AI BEAT TRACKER`, two HTML
fragments with the same marker, the `[ai-beat-tracker]` branch in `runAudioAnalysis`, the
`analysisEngine` default, and the `vendor/beatnet*` files.

Attribution (CC BY 4.0) is in Help and THIRD-PARTY-LICENSES.txt and must ship with the app.

## Packaging for iOS (Capacitor / WKWebView)

- Load `index.html` from the app bundle; keep relative paths intact.
- All dialogs are in-page (no native alert/confirm/prompt), so a bare `WKWebView` works too.
- Web Audio needs a user gesture on iOS; the app already handles the unlock.
- App Store Connect needs a privacy policy URL and a privacy "nutrition label". For this app:
  no data collected, no data linked to the user, no tracking. The in-app Help page states this too.
- No third-party sign-in is used, so "Sign in with Apple" is not required.

## Testing

Serve the folder over HTTP (dynamic `import()` of the pdf.js module is blocked on `file://`):

```
python3 -m http.server 8765
open http://127.0.0.1:8765/index.html
```

Verified under the shipped Content-Security-Policy: sign-up / sign-in / delete-account; v1→v2
account migration including re-encryption of stored audio; save click track; storage contains no
plaintext library data after sign-out; tampering with `currentUserId` without the key yields a
signed-out state; share export → import into a second account; malformed share file rejected;
PDF load + render from `vendor/`; Signalsmith WASM instantiation; beat analysis through the DSP
worker. Zero CSP violations, zero console errors.

## Visual system — "Engraved"

Score paper and ink: white ground, black type, one red-pencil accent for the tap and for
destructive actions, green for "ready", slate blue for guides. Libre Caslon Text for headings and
the tempo readout; Source Sans 3 for everything else. Square corners, rules instead of cards, no
gradients, glows or shadows. Light-only by choice (sheet-music apps are light because half the
screen is a white PDF). To change a color, edit the tokens at the top of `#engraved-theme`.

## Changelog

### 1.5.0 — cloud accounts
- Optional Firebase-backed accounts: same email/password on every device, Google sign-in,
  email verification, password reset; library and saved audio sync. Device-only mode unchanged.
- One-time upload of a pre-existing device library on first cloud sign-in.
- Help/privacy text is mode-aware; CSP extended for Firebase hosts.

### 1.4.4 — name
- App is now spelled "TempoTapp" in all user-facing text. Storage keys and the `.tempotap.json` share format are unchanged.

### 1.4.1 — phone tapping + iOS sound
- Phone: TAP pad pinned above the tab bar, timeline scrolls into view on Start, conductor hidden, inline target box hidden.
- Taps fire on touch-down (lower latency); audio unlocked inside the tap gesture.
- iOS: silent looped media element keeps the audio session in playback mode so clicks sound with the ringer switch on.

### 1.4.0 — redesign
- New visual system (see above). No functional changes; full suite passes on desktop and phone.

### 1.3.1 — in-page dialogs, hosted downloads
- Replaced every native alert/confirm/prompt with in-page dialogs (bare WKWebView and hosted viewers suppress native ones).
- Download adapter for hosts that provide a save API (claude.ai artifact viewer); .mid/.wav wrapped in .zip there.
- Weights also shipped as base64 JSON for hosts that cannot serve binary files.

### 1.3.0 — AI beat tracker, UX merge, layout fixes
- On-device AI beat/downbeat/meter tracker for Analyze (BeatNet + HMM decoder), with automatic
  fallback to the classic detector; engine choice persists.
- Merged the Create-hub / tutorial / navigation work from the parallel build; tutorial now shows
  once per account by default instead of on every launch.
- Fixed: 76 px dead band above the sticky header on every screen; phone bottom tab bar was pinned
  to the header (backdrop-filter containing block) and covered Account/Log out; floating Track
  Settings button overlapped the mode card on phones.
- Fixed: a recording with no taps could be saved/exported.
- Verified end-to-end in Chromium (desktop + iPhone viewport): auth, tutorial, create hub, tap-along,
  engraved-PDF score detection + practice, library/share/import, MIDI, analyze (AI + classic),
  warp standard + Studio Quality (Signalsmith WASM), cleanup, versions, encryption, delete account.

### 1.2.0 — encryption at rest + sharing
- Per-user AES-256-GCM encryption of library metadata and saved audio; password-derived key.
- Legacy accounts migrate on sign-in (rows and audio re-encrypted; plain-text fields removed).
- Sign-up form states that there is no password reset.
- Optional, fenced feature: export/import click tracks as `.tempotap.json` files.

### 1.1.0 — security review build
- Passwords hashed (PBKDF2-SHA-256, salted); legacy plain-text accounts migrate on next sign-in.
- Storage layer validates/normalizes its own data; corrupted storage no longer crashes the app.
- Readable error when browser storage is full.
- Content-Security-Policy and `referrer: no-referrer`.
- pdf.js and Signalsmith bundled locally; CDN kept as fallback only. `isEvalSupported:false` for pdf.js.
- Size limit on PDF uploads (120 MB), length limits on sign-up fields.
- Privacy and data-deletion answers added to Help; "Mac"-specific wording made device-neutral.

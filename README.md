# Steppe Hawk: UAV Strike Simulator

A browser game about flying a military drone over the Ukrainian steppe. You fly as a Ukrainian UAV operator and see the battlefield through the drone's gimballed thermal/TV camera. You find enemy armour, air defences and artillery, confirm what each target is, and guide your weapons onto them by laser. The rules of engagement penalize civilian casualties.

It has no dependencies and no build step. It's plain HTML5 canvas and JavaScript. It runs in any modern browser, ships as an Android APK, and adapts to foldables.

## Missions

| # | Mission | Setting | Objective |
|---|---------|---------|-----------|
| 1 | **Steppe Shield** | Summer, day | Destroy a SAM battery: its search radar and two launchers. You'll have to dodge its missiles with flares. |
| 2 | **Iron River** | Winter, day | Stop an armoured column (tanks, IFVs and a fuel tanker) before it reaches the river bridge. Evacuating civilians share the road. |
| 3 | **Night Harvest** | Summer, night | Counter-battery fire: find three howitzers by their muzzle flashes. A hidden mobile SAM wakes up once you strike. |
| 4 | **Command Post** | Summer, dusk | Follow an enemy commander's vehicle through an occupied village and strike it on open ground. |

The world is generated procedurally for each mission. It includes wheat, sunflower and black-soil fields, tree windbreaks, a village with gabled houses and Soviet-era apartment blocks, a market and a church, collective farms, a river with a bridge, and civilian traffic, pedestrians and tractors.

## How it plays

- **The laser is live.** Your missile or bomb flies to wherever the crosshair is until it hits. Lock a track and keep it on the target.
- **PID before you shoot.** Lock a target and zoom in (FOV 150 m or tighter) to get positive identification. Hostiles get a red diamond and civilians a blue circle.
- **CDE readout.** The collateral damage estimate shows how many civilians are inside the blast radius of the selected weapon.
- **Weapons.** The LGM-L light missile is precise and has a small blast. The LGB-H heavy bomb has a large blast and a long time of flight.
- **SAMs.** Release flares (**FLR** / `C`) *just before* impact. The warning counts down the time to impact. The standoff orbit keeps you farther away.
- **Thermal modes.** White-hot, black-hot and daylight TV. Engines, people and fires glow on thermal, which matters most at night.
- You get a grade from S to F, based on effectiveness, accuracy and civilian casualties. Your best grades are saved on the device.

## Controls

| Action | Touch (Android) | Keyboard / mouse |
|---|---|---|
| Slew camera | Drag | Drag, WASD or arrows |
| Zoom | Pinch, or the **+ / −** buttons | Mouse wheel, Q / E |
| Lock a track | Tap a target, or press **TRK** | Click, or Space |
| Fire | **FIRE** | F or Enter |
| Switch weapon | **WPN** | 1 / 2 |
| Flares | **FLR** | C |
| Thermal mode | **MODE** | T |
| Orbit (tight / standoff) | **ORBIT** | O |
| Jump camera | Tap the minimap | Click the minimap |
| Pause | **II** | Esc or P |

## Android app (APK)

Each push builds a signed APK on GitHub Actions and publishes it as a GitHub Release:

**Download:** https://github.com/phoenixholmes7-hub/Dronesim/releases/latest/download/SteppeHawk.apk

1. Open the link on your phone and download the file.
2. Open **SteppeHawk.apk**. If Android asks, allow your browser or file manager to install unknown apps.
3. Launch **Steppe Hawk**. It runs full screen and offline, and needs no permissions apart from vibration.

The app lives in `android/`. It's a small native wrapper (Java and an Android WebView) that bundles the web game from the repository root. To build it yourself with the Android SDK installed, run `gradle -p android assembleRelease`.

The release build is signed with a public sideload key (`android/app/steppehawk-debug.keystore`), so new builds install over old ones. Before publishing on Google Play, sign with your own private key stored in GitHub secrets.

## Foldables

The game adapts to the shape and posture of the screen:

| Device state | Layout |
|---|---|
| Folded (tall cover screen) | Camera view on top; minimap and controls in a deck below |
| Unfolded flat | Full-screen view in either orientation, with floating controls |
| Half-folded, **tabletop** (hinge horizontal) | Camera view on the upper half; control deck and large minimap on the lower half |
| Half-folded, **book** (hinge vertical) | Camera view on the left page; minimap and controls on the right page |
| Ordinary phone, landscape | Full screen with floating controls |

- In the app, the fold's position and posture come from Jetpack WindowManager. In Chrome, they come from the Viewport Segments API.
- Folding or unfolding mid-mission keeps the game running; the activity handles configuration changes itself.
- The renderer lowers its resolution when frames get heavy on the large inner screens, and raises it again when there's headroom.

## Playing in the browser / as a PWA

The game is a Progressive Web App, so it installs like a native app. It runs fullscreen and works offline after the first load.

1. Host the folder on any HTTPS static host. GitHub Pages is the easiest: go to repo **Settings → Pages**, deploy from this branch, root `/`.
2. Open the URL in Chrome on your Android phone.
3. Tap **⋮ → Install app** (or **Add to Home screen**).
4. Launch **Steppe Hawk** from your home screen.

If you want a real `.apk` / Play Store build, wrap the hosted PWA with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap) (Trusted Web Activity) or [PWABuilder](https://www.pwabuilder.com/). Alternatively, drop the files into a [Capacitor](https://capacitorjs.com/) project's `www/` folder.

## Running locally

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk also works. The service worker (offline mode) only registers when the page is served over http(s).

## Files

- `index.html`: page shell, menus and touch controls
- `style.css`: UI styling
- `js/game.js`: the whole game (world generation, simulation, rendering, HUD, input)
- `manifest.webmanifest`, `sw.js`, `icons/`: PWA install and offline support
- `android/`: native Android app wrapper (APK)
- `.github/workflows/android.yml`: builds the APK and publishes it to Releases

---

*A work of fiction. Units, places and events are invented.*

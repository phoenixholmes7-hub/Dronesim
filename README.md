# Steppe Hawk: UAV & FPV Drone Simulator

A browser game about flying military drones over the Ukrainian steppe. A tabbed menu opens three ways to play the same procedurally-generated world:

- **UAV Strike** — the original top-down sim. You fly a reconnaissance-strike UAV and see the battlefield through a gimballed thermal/TV camera, finding and identifying armour, air defences and artillery and guiding weapons onto them by laser. The rules of engagement penalize civilian casualties.
- **FPV Stunts** — a 3D first-person view quad flown over the same village, fields and river. Freestyle trick scoring (flips, rolls, power loops, dives and gaps under the bridge, the power lines and between buildings) with combos, plus timed **gate-race** courses.
- **FPV Strike** — first-person attack sorties: one-way diving strikes on armour, and a reusable **FPV bomber** that releases ballistic munitions. Analog goggle feed, motor sound, flak, cool explosions and tumbling wreckage. A work of fiction.

The UAV mode is plain HTML5 canvas and needs nothing. The FPV modes use [three.js](https://threejs.org), vendored locally in `js/vendor/` (see its README), so they load with no network and work offline in the app. There is no build step for the web game. It runs in any modern browser, ships as an Android APK, and adapts to foldables.

## UAV missions

| # | Mission | Setting | Objective |
|---|---------|---------|-----------|
| 1 | **Flight Training** | Summer, day | A guided tutorial on a safe range: slew the camera, zoom, lock a track, get positive ID and take a laser-guided shot. Nothing shoots back. |
| 2 | **Steppe Shield** | Summer, day | Destroy a SAM battery: its search radar and two launchers. You'll have to dodge its missiles with flares. |
| 3 | **Iron River** | Winter, day | Stop an armoured column (tanks, IFVs and a fuel tanker) before it reaches the river bridge. Evacuating civilians share the road. |
| 4 | **Night Harvest** | Summer, night | Counter-battery fire: find three howitzers by their muzzle flashes. A hidden mobile SAM wakes up once you strike. |
| 5 | **Command Post** | Summer, dusk | Follow an enemy commander's vehicle through an occupied village and strike it on open ground. |
| 6 | **Bridge Denial** | Summer, rain | Destroy an engineer team laying a pontoon crossing by the bridge, under a short-range SAM and reduced visibility. |
| 7 | **Night Convoy** | Summer, night | Interdict a resupply convoy on the highway before it clears the sector. A mobile SAM wakes on your first strike. |
| 8 | **Blind Eye** | Summer, fog | Hunt an electronic-warfare jammer and its launcher in thick fog that cuts your sensor range. |
| 9 | **Steel Rain** | Summer, cloud | A big, hard target-rich area: two radar-guided SAM sites, massed armour, artillery and a fuel park. |
| — | **Survival** | Endless | Wave after wave of armour and escalating SAMs attack the village. Effectively unlimited weapons and flares — see how many waves you hold. |

The world is generated procedurally for each mission. It includes wheat, sunflower and black-soil fields, tree windbreaks, a village with gabled houses and Soviet-era apartment blocks, a market and a church, collective farms, a river with a bridge, power lines, and civilian traffic, pedestrians and tractors. Each mission has its own weather — clear, cloud, rain, snow or fog — with drifting cloud shadows, and hot targets bloom on the thermal sensor.

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

## FPV modes (3D)

Pick **FPV Stunts** or **FPV Strike** from the menu tabs. The 3D view runs through a cinematic pipeline — PBR materials with sky reflections, soft shadows, bloom, filmic (ACES) tone mapping and a colour grade — rendered as a goggle feed with a vignette, scanlines, prop-blur in the corners, and analog static that breaks up on hits. A **lens** button (`T`) cycles the camera through **normal, white-hot, black-hot and night-vision**. A full OSD gives you an artificial horizon, a flight-path marker, heading, speed, altitude, battery and throttle — plus direction arrows with range to the next gate or the nearest target, so you can always find the action. Motor sound scales with throttle. The heavy effects are tiered and shed automatically on weaker phones.

| Sortie | Tab | What it is |
|---|---|---|
| **Free Fly / Golden Hour** | FPV Stunts | Open freestyle. Score tricks and find the gaps, no clock. |
| **Trick Park** | FPV Stunts | Score attack against the clock; the bridge, wires and alley gaps pay big in combos. |
| **Gate Race — River Run / Village Sprint / Field Slalom** | FPV Stunts | Fly the gates in order against the clock. |
| **Column Hunt / Defence Suppression / Depot Raid / Night Hunters** | FPV Strike | One-way diving FPV strikes on armour, dodging flak, by day and night. |
| **FPV Bomber — Trench Line / Night Drops** | FPV Strike | A reusable bomber quad: fly over the target and release munitions that fall with your speed. |

- **Flight modes.** *Self-levelling* holds the horizon for you; *acro* gives full rate control for flips, rolls and loops but will not catch you. Switch with **MODE** / `M`.
- **Controls.** Touch: left stick throttle + yaw, right stick pitch + roll, plus on-screen buttons. Keyboard: `W`/`S` throttle, `A`/`D` yaw, arrows (or `I`/`K`/`J`/`L`) pitch + roll, `Shift` boost, `Space` strike / drop, `R` new drone, `M` flight mode. A twin-stick **gamepad** (Mode 2) is supported.
- **Scoring.** Tricks and gaps chain into combos for a score multiplier; strike and bomb sorties score per vehicle destroyed. Hitting civilian traffic ends a strike sortie. Best scores and race times are saved on the device.

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

- `index.html`: page shell, tabbed menu and touch controls
- `style.css`: UI styling
- `js/game.js`: the 2D UAV game (world generation, simulation, rendering, HUD, input) and the shared world/audio API
- `js/fpv.js`: the 3D FPV modes (stunt, race, strike, bomber) built on three.js
- `js/vendor/three.min.js`: three.js, vendored locally so the FPV modes run offline (see `js/vendor/README.md`)
- `manifest.webmanifest`, `sw.js`, `icons/`: PWA install and offline support
- `android/`: native Android app wrapper (APK)
- `.github/workflows/android.yml`: builds the APK and publishes it to Releases

---

*A work of fiction. Units, places and events are invented.*

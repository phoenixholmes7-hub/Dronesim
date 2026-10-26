# Vendored libraries

`three.min.js` is three.js r182 (MIT, see `three.LICENSE`), bundled as a classic script that defines the global `THREE`. It ships with the game, so the APK and the installed PWA run the 3D FPV modes offline, and opening `index.html` from disk still works.

It's tree-shaken to the classes listed in `three-entry.js`. To rebuild it, or to add a class the FPV code needs:

```sh
npm install three@0.182.0 esbuild
npx esbuild js/vendor/three-entry.js --bundle --minify --format=iife --global-name=THREE \
  --target=es2019 --legal-comments=none --outfile=three.min.js
```

Then put the two-line licence header back at the top of the output.

The game loads it only when an FPV mode starts (`js/fpv.js` injects the script tag), so the UAV mode doesn't pay for it.

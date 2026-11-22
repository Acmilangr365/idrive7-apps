# M Cluster (mcluster) 0.9.52

A custom iDrive 7 (MGU) app for plug-in hybrid G-series cars (built on a 330e G20) with the **M cluster layout**.
It puts back on the cluster what the M layout leaves out, and adds a few widgets:

- **Charge gauge** of the HV battery (Classic / Ring / Cell / M Stripes styles, colour per drive mode)
- **Drive mode** label (HYBRID, ELECTRIC, SPORT, XTRABOOST ...)
- **Electric range**
- **Consumption** (kWh/100km in electric, l/100km with the engine on), Classic or OEM style
- **Trip**: electric km since the last charge
- **Song** from Android Auto / CarPlay / Bluetooth / USB: cover, title, artist, album, time bar coloured by the drive mode
- **Total km** with the trip chosen in the iDrive ("values from": factory, charging, trip start, refuelling or its date)
- UK units (miles, mpg, mi/kWh) and English or Greek text on the cluster

**iDrive knob tilted down** (on the cluster) switches the pages:
consumption + trip -> song -> song + consumption -> total km.

Everything is set in the app's own settings (tabs on top): position, size, style, colours, and 5 profiles
(profile 1 is "Default").

## Needs
- **The M cluster layout must be enabled on the instrument cluster** (e.g. coded with BimmerCode). The app is made for
  that layout: its widgets go where the M layout leaves room, and on the stock PHEV layout they overlap the car's own.
  
- A rooted MGU (ID7) with custom apps from [idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
- The cluster renderer (cluster-render) that the idrive7-apps kit installs: the widgets are layers on the cluster
- For the song: the car's media sources (works with Android Auto / CarPlay as the car shows them)

## Install

1. Put this folder in the repository as `apps/mcluster` (next to the other apps).
2. Build and install it the way you install the other custom apps of the repository
   (`python3 kit/tools/build.py mcluster`, then the deploy scripts in `deploy/`).
3. Open **M Cluster** in the iDrive once; it starts by itself with the car from then on.

## Notes

- Read-only: the app only reads car signals, it changes nothing in the car.
- It keeps a small diagnostic file (`mcluster_diag.txt`, at most 400 KB) in its data folder.
- The total km come from the iDrive's "values from: factory" trip: select it once, and the app counts on from there.

## Credits and licences

- `cluster_render_client.js`: MPL-2.0, Robert Nisipeanu (cluster-render)
- `nowplaying.js`: MIT, M850i-amn and Aref (HUD Lyrics / CarLyrics), source pick changed for this app
- `coverjpeg.js`: jpeg-js (BSD-3-Clause / Apache-2.0 parts), via M850i-amn
- `coverpng.js`: MIT, Leopold Pöchinger / IbexData GmbH, via M850i-amn
- `grfont_data.js`: Ubuntu font, Ubuntu Font Licence 1.0, Copyright 2010-2011 Canonical Ltd.
- The rest: this app's own code, built on the idrive7-apps kit (MIT).

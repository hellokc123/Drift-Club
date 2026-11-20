# Drift Club

A 3D browser drifting game: relax and cruise on your own, or compete with friends in real-time multiplayer rooms.

**▶ Play now: [drift-club-qvkk.onrender.com](https://drift-club-qvkk.onrender.com)** (free server — the first load can take ~30 s while it wakes up)

- 28 cars across 7 categories (Basic, Sports, Supercars, Drift, Muscle, Pickups, SUVs), four per category, each with its own acceleration, top speed, handling, drift behaviour, engine sound and body shape
- Customisation: paint (16 presets plus any custom colour), wheel colour, 6 rim styles, 3 spoilers, racing stripes in any colour, body kit, lowered suspension, underglow
- 5 maps with their own atmosphere: **Apex Circuit** (race track, sunny), **Dune Valley** (desert, golden hour), **Kurogane Pass** (mountain touge, dusk), **Pinewood Trails** (forest and lake, misty morning) and **City Nights** (city, night)
- 4 modes: **Endless**, **Standard** (with timed drift challenges), **Chill** and **Competitive** (timed rounds, leaderboard, round winners)
- Room-based multiplayer: create, join by code, public room list, private rooms, host controls, live positions, name tags, synced scores and rounds, lobby and in-game chat, leaving and rejoining
- No downloads, no external libraries and no asset files. The renderer, models, terrain, engine sounds and music are all generated in code.

## Run it

**Solo (no install, no server, no admin):** double-click **`DriftClub.html`** and it opens in Edge or Chrome. This one file contains the whole game. On Windows, extract the zip first. Step-by-step instructions for school/locked-down Windows PCs are in **`HOW TO PLAY.txt`**.

**Multiplayer** needs the small room server (`server.js`), which runs on [Node.js](https://nodejs.org) 18+ and needs nothing else installed:

- **Windows without admin:** download the *Windows Binary (.zip)* of Node (not the .msi installer), extract it into this folder, then double-click **`Start-Multiplayer-Server.bat`**. It finds the portable `node.exe`, starts the server and opens http://localhost:3000.
- **Anywhere Node is installed:** `node server.js`, then open http://localhost:3000. Use another port with `PORT=8080 node server.js`.

The page served at http://localhost:3000 is the same game (`public/index.html`, loading the separate modules). `DriftClub.html` is generated from those sources. After editing anything in `public/`, rebuild it with `node build-standalone.js`. It's needed because browsers refuse to load `<script type="module">` imports from a double-clicked `file://` page; the build inlines everything so the file works on its own.

## Put multiplayer online (so friends on other computers can join)

Multiplayer needs the room server (`server.js`) running somewhere that **everyone** can reach. A school PC can't host it, so put it on a free cloud host. No API keys or paid services are needed. This takes about 10 minutes, all in the browser:

1. **Create a GitHub repository**
   - Sign up at https://github.com (free).
   - Click **+ → New repository**, name it `drift-club`, choose **Public**, and click **Create repository**.
   - On the next page click **uploading an existing file**.
   - Drag in **everything inside the `drift-game` folder** (`server.js`, `package.json`, `render.yaml`, the `public` folder, …). Don't drag the `drift-game` folder itself.
   - Click **Commit changes**.
2. **Deploy it on Render**
   - Sign up at https://render.com using **GitHub** (free, no card needed for the free tier).
   - Click **New + → Blueprint** and pick your `drift-club` repository. Render reads `render.yaml` and fills in the settings. If you get a manual form instead, choose **Web Service**, Runtime **Node**, Start command `node server.js`, Instance **Free**.
   - Click **Apply / Create**. After a minute or two you'll get an address like `https://drift-club-ab12.onrender.com`.
3. **Play**
   - Open that address in Edge or Chrome on any computer. It is the full game, already connected to the server.
   - Go to **Multiplayer → Create a room** and send friends the address plus the 5-letter room code.
   - If you'd rather keep using `DriftClub.html`, go to **Multiplayer → Server**, paste the address once (it's remembered), or put it in `public/js/config.js` and run `node build-standalone.js`.

Free-tier notes: the server **sleeps after 15 minutes without players**. The first visit then takes up to a minute while it wakes (the game shows "Waking up…" and keeps retrying). Rooms live in memory, so a server restart or redeploy clears them. If your school blocks `onrender.com`, use the game from home, or try another host (Railway, Fly.io, Koyeb, a VPS: anything that runs `node server.js` and allows WebSockets).

**Other options**
- Same network (home/LAN): run `node server.js` (or `Start-Multiplayer-Server.bat` with portable Node on Windows). Friends open `http://<your-IP>:3000`.
- Temporary internet link from a home computer: `cloudflared tunnel --url http://localhost:3000` (download the single `cloudflared.exe`, no install needed) gives a `https://….trycloudflare.com` address to share.

### What the multiplayer handles
- Rooms: create, public list, private (code-only) rooms, join by code, host controls (map, mode, max players, rounds), host migration when the host leaves.
- Cars and positions are synced 20× per second. Remote cars are interpolated with a buffer that adapts to each player's network jitter (100–400 ms).
- **Disconnects:** a player who drops (Wi-Fi blip, refresh, closed laptop) keeps their slot, score and car for **30 seconds**. They reconnect automatically, or get put straight back into the running game after a page refresh. Others see "(reconnecting…)" on their name tag. After 30 s they're removed.

## Controls

| Action | Keyboard | Gamepad (Xbox / PlayStation) |
|---|---|---|
| Accelerate | W / ↑ | RT / R2 |
| Brake / Reverse | S / ↓ | LT / L2 |
| Steer | A D / ← → | Left stick (or D-pad) |
| Handbrake | Space | A / ✕ or RB / R1 |
| Boost | Shift | X / □ or B / ○ |
| Change camera | C | Y / △ |
| Reset vehicle | R | View / Share |
| Pause menu | Esc / P | Menu / Options |
| Hide HUD / music toggle | H / M | (M: R3) |
| Minimap on/off | N | |
| Chat (multiplayer) | T or Enter | |

Every keyboard action can be rebound in **Settings → Controls**, with two keys per action.

## Driving styles & drifting

Choose a **driving style** in the Garage (or switch any time from the pause menu). The two styles use genuinely different physics:

| | Drift style | Race style |
|---|---|---|
| Grip / cornering | a bit looser | +30% grip, about 1.6–2.1 g cornering, quicker steering, stability assist that only catches real slides |
| Steering range | each car's normal lock | 15% more lock (about 31–39° at the front wheels) for tight turns, reducing smoothly with speed (see below) |
| Starting a drift | handbrake from 16 km/h, throttle + full lock on most cars, easy slide entry | handbrake from 32 km/h, no throttle slides, slides need bigger angles to start |
| Drift angle | up to your **Max drift angle** setting (35–80°, Garage) | capped at 43° |
| Leaving a slide | holds the slide | straightens quickly |
| Transitions | hold opposite lock → swings to the other side | handbrake tap + opposite lock |

**How to drift:** tap **Space** while steering into a corner. While sliding:
- **Throttle sets the angle:** more throttle means more angle.
- **Steering into the slide** adds angle; **countersteer** reduces it.
- **Lift off** to straighten up and grip again.
- Boost recharges while you drift.

**Advanced techniques** (all done with real physics and normal controls):
- **Transition:** swap sides mid-drift (Drift: hold the opposite direction; Race: handbrake tap + opposite lock).
- **360:** while drifting, hold **Space + steer into the slide**. The car keeps rotating past the angle limit. Let go after a full turn and drive away.
- **Reverse drift:** keep rotating past 180° and release. You'll slide backwards; steer to hold it and use **S** to keep the speed up. (Handbrake + steer while reversing fast also works.)
- **Donuts:** at low speed, **Space + full lock + full throttle**, then keep throttle and lock held.
- **Extended drifts:** chain corners with throttle and steering; the chain survives as long as you keep sliding under control.
- **Tandem:** in multiplayer, drift within 15 m of another drifting player going the same way.

**Race-style steering:** the front wheels can turn about 15% further than before, so low-speed hairpins and tight city corners are much easier. As speed rises, the maximum wheel angle shrinks smoothly towards the angle the tyres can actually use at that speed, never below about 8–9°. Full lock therefore always means "turn as hard as the grip allows", with no wasted lock and no twitchiness at top speed. Measured turning circles are about 35–40% tighter than before at every speed, and the car still never spins in grip driving (tested with full lock at 60–180 km/h, braking + full lock, throttle + full lock, fast lane changes and lifting off mid-corner). Drift-style physics is unchanged.

**Visible steering:** the front wheels on screen show the real steering angle (and other players see yours). They use Ackermann geometry, so the inside wheel turns more than the outside one, as on a real car.

**Hills:** each wheel has its own spring and damper, so the car follows hills, crests and bumps with pitch, roll and weight transfer. Aero downforce keeps fast cars planted over crests.

## Scoring

Points are earned continuously while sliding **under control**, based on **drift angle × speed × duration**. Nothing is earned while the handbrake is held, while spinning, or during uncontrolled rotation. Losing all speed mid-spin is a **SPIN OUT** and costs the chain. Trick bonuses: **360** (+1,800 scaled by speed), **reverse drift** (points ×1.6, plus a bonus when you come out of it), **donuts** (+900 each, smaller for repeats), **transitions** (+300 plus a speed bonus), **tandem** (points ×1.5, plus a bonus when the tandem ends). A drift chain stays alive for 2 seconds after a slide ends:

- **Consecutive drifts** within that window raise the combo.
- **Transitions** (switching drift direction without straightening) give a bonus and raise the combo.
- The **multiplier** grows with the combo and with chain length, up to ×8.
- When the chain ends, it is banked into your total. Crashing (in every mode except Chill) loses the chain you haven't banked.
- The HUD shows the current drift, multiplier, combo timer, angle, total and best drift.

## Modes

- **Endless**: free roam, no timer, drift points only. Your best total per map is saved.
- **Standard**: like Endless, plus 3 glowing challenge rings per map. Drive into one to start a timed target (for example "18,000 in 30 s"). Completing it gives a +5,000 bonus. The rings are optional.
- **Chill**: no score, no timers, no crash penalties, relaxed music. H hides the HUD for a clean view.
- **Competitive**: 3-second countdown, then a timed round (30–300 s, 1–5 rounds, set by the host). The leaderboard updates live, each round ends with results and a winner, and the match ends with final standings by rounds won, then total points. Rounds are timed by the server. In single-player it becomes a 3-round score attack.

## Competitive modes

Open **Play**: the top row holds the three competitive modes. Each card opens a setup screen with its own options, your personal bests, **Start solo** and **Play online** (which opens a room pre-filled with those settings). **Records** on the main menu shows personal bests and the online leaderboard.

| Mode | Solo | Online |
|---|---|---|
| **Drift Challenge** (Timed: highest total in the time limit, default 2:00. Score Attack: your single best drift chain counts, default 3:00) | Against your own records | Every player in the room competes, with a live leaderboard |
| **Speed Race** (1–10 laps, default 3; Track, Desert, Forest, City circuits) | Against 0–7 **CPU** cars (Easy/Medium/Hard), always labelled CPU | 2–8 real players, grid, server-timed countdown |
| **Drift Race** (same circuits, laps and checkpoints as Speed Race; score = (drift points × position factor + position bonus) × gap factor) | Against 0–7 **CPU** cars, whose drift points are estimated from how hard they corner | 2–8 real players; the server judges everyone's drifting and positions |
| **Drift Battle** (2 runs on a fixed battle course: lead, then chase, roles swap) | You lead first, then chase a **ghost** of your own lead run | 1 v 1; extra people in the room watch |

- **Drift Challenge scoring** uses the normal drift scorer (angle × speed × duration, transitions, combos, multiplier, tricks, tandem) plus distance and smoothness. Collisions (−250) and leaving the track (−150) are penalised; stationary/handbrake spinning scores nothing. Results show final score, highest combo, longest drift, best angle, position and winner.
- **Speed Race**: checkpoint gates every ~48 m must be passed in order. Skipping gates, driving backwards through the line, cutting across the infield, or using reset/teleporting does not count. Lap times, best lap, total time, positions and gaps are shown live and in the results. A jump start (moving before GO) adds 3 s.
- **Drift Race**: drift points count from GO until you cross the finish line (Drift Challenge judge with race tuning: combo multiplier capped at ×4, the combo banks at every lap line, points scale with speed so slow drifting earns almost nothing, crashes and leaving the track cost only the live combo). Total = (drift points × position factor + position bonus) × gap factor. Position factor P1 1.0, P2 0.9, P3 0.8, P4 0.68, P5 0.56, P6+ 0.45; gap factor = 1 − seconds behind the winner / 60, min 0.35 (DNF 0.35). Position bonus per lap: P1 60,000 · P2 45,000 · P3 33,000 · P4 24,000 · P5 17,000 · … (× laps); no bonus if you don't finish (solo: 60 s after the first CPU finishes; online: the Speed Race finish window). Online drift points are clamped to at most 3,500 per second of racing. Results show drift pts + position bonus = total.
- **Drift Battle judging**: Lead is judged on angle, speed, line, consistency and transitions. Chase is judged on proximity, speed match, angle match, line and control. Penalties for spinning or stalling, leaving the course and hitting the other car. Both runs are added together; the higher total wins. Rematch from the results screen.

### How online competition stays fair
- The **server runs the match**: it schedules the countdown and timer (clients sync their clocks to it), decides start, finish and results, and holds everyone at the line until GO.
- Clients send raw driving samples (position, velocity, heading, drift flags) 20× per second. The server feeds these into the **same judges** the browser uses (`judge.js`, `scoring.js`, `tracks.js`), so official scores, lap times and battle points are calculated on the server, not taken from the browser. The browser's own copy is only used for the live HUD.
- Implausible jumps, teleports and resets are rejected by the server's checkpoint tracker.
- Players who join during a match **spectate** (press C to switch who you're watching) and join the next one. If a competitor disconnects they have 30 s to come back and continue. If they don't, they are marked DNF (race) or forfeit (battle).
- The host can **Rematch** or go **Back to lobby** from the results.

### Records
- **Personal records** are stored in the browser (same storage as your settings and car), only for completed competitions: challenge high score / longest drift / highest combo per map, race total and best lap per track and lap count, battle wins / losses / win % / points.
- **Online leaderboards** are stored by the server in `data/records.json` (set `DATA_DIR` to move it). Each match is recorded once, and only if it was completed. Forfeits are not counted. **On Render's free plan the disk is wiped on every redeploy/restart**, so online records reset then (a paid persistent disk keeps them).

## Garage: customization, tuning and presets

Open **Garage**, pick a car, then use the four tabs. You can drag the car to rotate it.

The stat panel on top compares **Stock** (faded bar) with **Your setup**: top speed, 0–100 km/h, handling (cornering g), grip (how quickly a slide is caught), steering (turning circle + turn-in time), braking (100–0 km/h distance), weight and a drift score. These numbers are **measured**: the garage drives the tuned car in the game's own physics on a flat test pad (`carstats.js`), in your chosen driving style. They are not estimates.

- **Looks:** paint, wheel design, rim size, wheel colour, front bumper, rear bumper, side skirts, body kit (street or widebody), bonnet (vented, scoop, carbon), spoiler, exhaust, window tint, headlight colour, livery (two-tone roof, side stripe, racer roundels) with its own colour, racing stripes, lowered stance, underglow. Parts that don't suit a car are greyed out (bull bars and tow bars only fit pickups and SUVs; pickups don't take big wings). The 3D model updates immediately.
- **Performance:** Engine (Street/Sport/Race), Gearbox (Quick-shift/Sequential), Tyres (Street/Sport/Racing/Drift, plus Off-road on pickups, SUVs and basic cars), Suspension, Brakes, Weight reduction.
- **Tuning:** final drive, ride height, spring stiffness, weight transfer, handling balance, steering angle, steering response, steering stability, brake balance, handbrake, tyre grip, front grip, rear grip, drift initiation, drift stability.
- **Presets:** Stock, Street, Sport, Racing, Drift, Grip and Speed, each a set of compatible mods built for that car. You can also save your own presets per car (looks + performance + tuning), then load, rename, duplicate or delete them. Use "Return to stock setup" or "Restore original vehicle" to go back.

Every change has a downside, so no setup is best at everything:

| Change | Gains | Costs |
|---|---|---|
| More engine power | acceleration, top speed, throttle response | wheelspin and power oversteer once the tyres can't put it down (most on muscle cars) |
| Racing tyres | most grip and cornering | poor on grass/dirt, harder to drift, lose speed in slides |
| Drift tyres | long, smooth, speed-holding slides | less grip and cornering |
| Stiffer suspension / lower ride | less body roll, more grip on smooth tarmac | skips over bumps and rough ground, bottoms out sooner |
| Weight reduction | acceleration, quicker direction changes | drifts lose speed sooner, twitchier at speed, loses in collisions |
| Short / long final drive | acceleration / top speed | top speed / acceleration |
| Sequential gearbox | less drive lost between gears | each upshift briefly unsettles the rear tyres |
| Race brakes | shortest stops | bite hard enough to unsettle the car mid-corner |
| Rear brake bias | rotates the car on corner entry | longer stops, less stable |
| Oversteer balance / loose rear | agile, easy to rotate and drift | less stable, catches slides later |

Tunes scale each car's own numbers, so cars keep their character: a tuned Hauler is still a heavy truck, and a tuned Kitsune is still a nimble drift car. A stock car drives exactly as before (all the old physics tests give identical results).

Everything is saved in the browser with your other settings: the selected car, each car's own setup (looks + performance + tuning), your presets and your minimap preferences. Each car remembers its setup when you switch cars.

### Room rules for performance mods

When creating a room (or later, in its lobby) the host picks **Open modifications**, **Equalized performance** (every car gets the same power, top speed, grip and weight; each keeps its own steering and drift character) or **Stock only**. Looks are always kept. The rule is shown in the public room list and the lobby. If you join a restricted room by code, a dialog shows its rules before you join, and if your car is tuned it tells you how the rule affects it. In-game a message says when your performance mods are not used. Your own saved setup is never changed.

Other players see your car's looks, and in open rooms the lobby shows a short summary of everyone's setup.

**Server checks:** every car config from a browser is cleaned by the server using the same `tuning.js` / `cars.js` rules as the game. Impossible part levels, unknown tyres and parts that don't fit the car are dropped. In competitive matches each car is locked in at the start, and the server knows the top speed that car's validated setup can reach. Faster samples are not counted, and about 3 s of impossible speed means that driver stops counting in the match (they're told why).

## Minimap

A round minimap shows the real map. It is drawn from the same height, road, surface, water and collision data the physics uses, so it matches the world exactly. It shows:

- **Your car** as an arrow pointing where the car faces.
- **Other players** in different colours with their initial. A player who disconnects disappears at once.
- **CPU racers** numbered 1–7.
- **Speed Race:** the whole circuit, the racing line with direction arrows, the start line, and the next checkpoint (the same one the glowing pillars mark).
- **Drift Challenge:** the judged drift-area boundary in yellow (tarmac plus the 4 m allowance).
- **Drift Battle:** the course with start and finish gates. The lead and chase cars are marked L and C, and they swap after round 1. In solo battles the ghost is shown.
- **Free roam:** the map zooms out as you speed up.

**Settings → Minimap:** on/off, size (S/M/L), corner, rotating (car points up) or fixed north-up, and zoom (Auto, Near, Far, Whole map). Press **N** while driving to toggle it. It reuses the normal position sync, so it adds no network traffic. It costs about 0.01 ms of script time per frame, plus a one-off 0.1–0.3 s build when a map loads.

## Settings

Graphics quality (Low is meant for Chromebooks and is picked automatically on low-memory devices), render resolution, FPS counter, fullscreen; master, effects and music volume; camera view, distance, follow sensitivity, FOV, crash shake; steering sensitivity, gamepad on/off, stick deadzone, key rebinding; minimap on/off, size, position, orientation, zoom; player name, km/h or mph, server address.

## Project structure

```
DriftClub.html         The whole game in one file (generated) - double-click to play solo
render.yaml            One-click Render.com deployment of the multiplayer server
public/js/config.js    Optional default multiplayer server address
HOW TO PLAY.txt        Windows / no-admin instructions
Start-Multiplayer-Server.bat   Windows launcher for the multiplayer server (portable Node)
build-standalone.js    Regenerates DriftClub.html from public/
server.js              Static file server + WebSocket room server (no npm deps)
public/
  index.html           Menus, HUD and overlays
  css/style.css
  js/main.js           App bootstrap, main loop, multiplayer event routing
  js/game.js           A driving session: physics loop, effects, modes, rounds, HUD, remote cars
  js/physics.js        Arcade drift physics (grip/drift state machine, collisions)
  js/cars.js           Car catalogue + procedural car models   ← add cars here
  js/maps.js           Map specs + world builder (terrain, roads, scenery) ← add maps here
  js/scoring.js        Drift scoring + mode definitions
  js/tracks.js         Shared road geometry, race circuits + checkpoints, battle courses (client & server)
  js/judge.js          Shared competition judges: drift challenge, drift battle (client & server)
  js/compmodes.js      Competitive mode controllers: countdowns, HUDs, results, solo/online
  js/ai.js             CPU racers for solo Speed Race
  js/tuning.js         Performance parts, setup sliders, presets, room rules (client & server)
  js/carstats.js       Garage stats measured by driving the car in the physics
  js/minimap.js        Real-time minimap built from the world's own data
  js/effects.js        Smoke, dust, skid marks, shadows, headlight beams, underglow
  js/camera.js         Chase / close / hood cameras
  js/audio.js          Synthesized engine, tyres, impacts + generative music
  js/input.js          Keyboard (rebindable) + gamepad
  js/net.js            WebSocket client
  js/ui.js             Menus, garage, rooms, settings, pause
  js/showroom.js       3D menu background
  js/engine/           Small WebGL renderer, geometry builder, math
```

**Add a car:** append an entry to `CARS` in `cars.js`. Pick a body `style` (hatch, sedan, coupe, wedge, muscle, pickup or suv) and tune the numbers, then add a design to `LOOKS` in the same file. A design sets proportions (length, height, cabin position, roofline, plan-view taper) and picks headlights, tail lights, grille, bonnet, wheel arches, factory aero, exhaust layout, mirrors and extras (roll bar, spare wheel, snorkel, roof rack, bull bar, marker lights and more). The car appears in the garage automatically.

**Car designs:** all 14 cars have their own 3D model, generated from their `LOOKS` design. Same-category cars differ in body shape and proportions, not just paint. All designs are original and fictional, with no real brands or logos.

**Add a map:** write a spec function in `SPECS` in `maps.js` (terrain function, road control points, pads, scenery, sky/fog/sun), add it to `MAP_LIST`, and add its id to `MAPS` in `server.js`.

**Add a mode:** add it to `MODES` in `scoring.js` (flags for score, timer, challenges, crash penalty) and to `MODES` in `server.js`.

## Technical notes

- **Rendering:** the game uses a purpose-built WebGL renderer (`js/engine/`) instead of Three.js. It needs no CDN or network at runtime (useful on school networks that block CDNs), works on WebGL 1 and 2, and its small, flat-shaded pipeline is fast on integrated GPUs. It covers vertex-coloured low-poly meshes, sun and hemisphere lighting, fog, specular car paint, a headlight spotlight, sky dome with stars, and blended/additive effect passes. Static scenery is batched into chunks and frustum-culled.
- **Networking:** clients send their car state 20× per second. The server relays room snapshots at 20 Hz, and clients interpolate remote cars about 110 ms behind real time. The server owns rooms, hosts (with host migration), settings, round timing and results.
- **Physics** runs at a fixed 120 Hz. Maps are built deterministically from seeds, so every client builds identical worlds.

## Tested

- Server integration test with two clients: create, sanitise inputs, public list, join by code, host-only settings, settings sync, game start, position and score sync, rounds and winner, leave, mid-game rejoin, host migration, room cleanup, no path traversal.
- Two browsers driving through the real UI: private room hidden from the list, join by code, host controls, car and chat sync, both players see each other at matching positions with name tags, leave and rejoin mid-round, round results.
- Suspension: a hill test at 60–230 km/h (the old code launched the car 1.2 m at every speed; now the wheels stay down up to 120 km/h, with only a short hop over a deliberately sharp crest at 180+) and full-boost runs up to 247 km/h on the real mountain, forest and desert roads (0 s with all wheels off the ground).
- Both driving styles: throttle/steer angle control, 12 s extended drifts, transitions, 360s, reverse drifts, donuts, slide recovery, grip limits, and scoring of each technique. Farming tests: holding the handbrake, spinning to a stop and stationary burnouts all score 0.
- Multiplayer over simulated internet links (80 ± 40 ms lag): create, public list, join by code, car/map/mode sync, live driving, Wi-Fi drop with auto-reconnect, page refresh resuming the game, removal after the grace period. **Not tested across the real internet from here**, because that needs your deployed server.
- Competitive modes: shared judges give the same score in the browser and on the server from the same samples. 9 checkpoint anti-cheat cases (skipping, reversing, teleporting, cutting, jump start). Battle judging. CPU racers complete every circuit on all difficulties. End-to-end server test of all three modes with spectators, forfeits and records. All 5 maps verified byte-identical to before the update.
- Two real browsers through the UI on a local server with a simulated network: Speed Race with synced countdown (0 ms difference), mid-race Wi-Fi drop + auto-reconnect and still finishing, identical results on both screens, late joiner spectating, rematch. Drift Challenge with live leaderboard and identical results. Drift Battle with roles swapping, a third player spectating and the same winner on both screens. Online records saved. **Still not tested on a real deployed server across the internet.**
- Tuning: stock cars give bit-identical results in every physics test (drifts, tricks, scoring, hills, steering, handling). Every part, tyre and slider was measured alone, each preset was measured on 4 cars, and all 616 car × visual-part × option combinations build. Browser test of the garage: parts, sliders, presets (save / rename / duplicate / delete / load), per-car setups, reload persistence, and the in-game car really using the tuned physics. Server test: a hacked config (engine 99, "rocket" tyres, a bull bar on a sports car) is cleaned, and a client claiming 2.2× its car's speed gets no race progress and is stopped after 3 s. Browsers: a tuned car in an open room (others see its parts), and a Stock-only room with the rules dialog before joining, everyone on factory setups and an on-screen notice.
- Minimap: all 5 maps, solo Speed Race / Drift Challenge / Drift Battle, rotating and north-up. Three browsers: markers for every player at their real position, smooth movement, removed on disconnect, exact after a reset. Online Drift Battle: lead/chase markers for players and spectators, swapping in round 2.
- Single-player flows: all 4 modes, pause, settings, key rebinding, camera views, reset, challenges, solo competitive rounds.

## Known limitations

- **Remote cars make no engine sound.** You only hear your own car.
- **Rooms live in the server's memory**, so a server restart clears them.
- **Car-to-car collisions are resolved on each player's own machine.** Bumps feel right, but they are not physically exact across clients.
- **Free-play scores are reported by clients** (Endless/Standard/old Competitive rounds). The three new competitive modes are judged by the server from driving samples. That stops edited scores, teleports and shortcuts, but someone determined could still fake the samples themselves.
- **CPU opponents only exist in solo Speed Race.** Solo Drift Battle uses a ghost of your own run. There are no touch/mobile controls. Gamepads drive the car, but menus need a mouse.
- **Equalized and Stock rooms use the rule only for performance.** Looks always stay.
- **The server's speed check is a plausibility limit.** It uses the car's validated setup plus a margin for boost, downhill and lag. It catches big speed hacks, not small ones.
- **Springs, weight transfer and brake balance** mostly show on bumps and under braking, which the flat-pad garage stats can't measure. Their effect is real but appears there only partly.
- **Leaderboard names are not accounts.** Anyone can type any name.
- **Tandem bonus in online Drift Challenge**: the server works it out from both players' samples, so the live HUD can differ slightly from the official result.
- The **hood camera** is a bumper-style view: the car's own body isn't drawn.
- Very old GPUs without WebGL show an error screen.

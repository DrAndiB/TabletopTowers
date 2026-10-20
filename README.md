# Tabletop Towers

A kitchen-table siege game for the browser, after the old Atari ST classic Ballerburg: two kids build
block castles at either end of the table, put a teddy on each throne and take turns firing spoon
catapults. Between shots there is pocket money to earn, a swap shop to trade at, piggy banks to fill and
toy soldiers to keep happy. Sibling of [Tabletop Turbo](https://github.com/DrAndiB/TabletopTurbo) and
[Tabletop Trials](https://github.com/DrAndiB/TabletopTrials).

## Play
- **Win** by knocking the other teddy off his throne. He sits in a throne room closed in by **cardboard
  boxes** (the front and the roof of the keep). A box swallows a shot and takes dents instead: a paper ball
  dents it once, an eraser twice, a marble three times (less for a slow shot). After five dents it tears
  open and the shot goes on through, so a siege means wearing the boxes down first. Knock your own teddy
  off and you lose.
- **A turn:** pocket money and morale, then the shop, then one shot. Two players take turns on one screen
  (mouse, touch or keyboard), or play against a computer kid: a *Hoarder* (fills piggy banks and shoots at
  yours), a *Warmonger* (works its toys hard and buys marbles) or a *Sweetheart* (keeps its toys happy so
  yours walk over), each with easy, normal or hard aim.
- **Aim** by dragging on the table (pull back and down to throw up and forward) or with the arrow keys, then
  Fire. The dotted line shows how the shot starts; the faint one shows your last shot. The **draft** from
  the window blows the shot off course, more for light ammo.
- **Ammo:** paper balls (1 coin, blow about), erasers (3, bounce), marbles (6, go straight through walls).
- **Money:** every turn brings 5 coins of pocket money. **Chores** earn 0 to 3 coins per toy not working a
  catapult but cost morale. **Piggy banks** pay 2 coins a turn plus 10% interest on what they hold, and
  coins you don't spend go into them, so a smashed piggy spills your savings (half roll over to the other
  side). The **swap shop** in the middle sells ammo, snacks and blocks; prices rise when you buy and
  settle back each round, and you can sell surplus back at 60%.
- **Toy soldiers** need snacks (one per five toys a turn) and lose heart when their castle is hit, but
  cheer when your own shots land. Happy toys bring a friend now and then; sulky
  toys skip every other shot; unhappy toys walk over to the other castle. If they mutiny, or nobody is left
  to work the catapult, you lose.
- **Build:** rebuild knocked-down blocks and the flag (boxes that were pushed off their place go back
  too), put one strip of tape on each dented box a turn (mends one dent), put up a new box where one was
  torn or in the gap on top of your wall, add up to three piggy banks, or a back catapult that lobs over
  your keep.
- **The kitchen joins in** now and then: the cat walks across the table, Grandma doubles everyone's pocket
  money, it's dinner time (no shooting), the tooth fairy comes, a little sister steals a block, chores are
  set to Light for everyone, or somebody opens the window.

Keys: ↑ ↓ angle, ← → strength (hold Shift for fine steps), Tab or Q/E ammo, C catapult, B back to the shop,
Space or Enter fires, Esc or P pauses, F fullscreen, F3 performance overlay.

## Run it locally
No build step. Serve the folder and open it in a browser:

```powershell
python -m http.server 8150
# then open http://localhost:8150/
```

Useful URL parameters: `?quality=low|medium|high`, `?autostart=1&p=human,cpu&pers=hoarder,warmonger&skill=hard&seed=5`,
`?event=cat` (that kitchen event in round 2), `?noevents=1`, `?debug=1`, `?fps=max`, `?test=1` (no render
loop; the tools drive the clock).

## Under the hood
- three.js r186 as one local ES module bundle and [cannon-es](https://github.com/pmndrs/cannon-es) 0.20 for
  the block physics (both in `vendor/`), plain ES modules, no framework.
- The castles are one block deep, like a castle drawn on paper and built in wood (`js/layout.js`). Every
  block is a rigid body on a fixed 120 Hz step with 20 solver iterations; everything sleeps between shots,
  the first touch of a projectile wakes the table, and a shot is over when it has all gone back to sleep.
- Cardboard boxes are where the game turns from Angry Birds into Ballerburg: a projectile that touches
  a box is slowed to a tenth of its speed in the contact event, before the solver passes the push on, so
  the box takes dents instead of the castle toppling; a shot that tears a box has the box's contacts taken
  out of that step and goes on through it.
- One small integrator (`js/ballistics.js`) drives the aiming preview, the computer kids' aim and the
  draft and drag on a projectile in flight, so all three agree. The computer kids try a grid of angles and
  strengths against the boxes of everything on the table and pick the shot whose first touch is closest to
  what they want to hit, then shake a little (`js/ai.js`).
- The rules (`js/economy.js`), castle state (`js/castle.js`) and physics have no three.js in them, so the
  checks run them in Node.
- Renderer, tilt-shift, frame pacing and procedural textures come from Tabletop Turbo via Tabletop Trials;
  sound is synthesised with Web Audio (`js/audio.js`), including two original chip tunes.

## Checks
- `node --experimental-default-type=module _dev/tools/checks/battle_sim.mjs [shots] [skill] [seed]`: the
  castles stand still while awake, and computer kids' shots (paper, eraser, marble in turn) do what they
  should; prints the damage of every shot.
- `python _dev/tools/tt.py "<query>" "<steps>"`: drives the game headlessly in Chromium (Playwright) and
  takes screenshots, for example
  `python _dev/tools/tt.py "autostart=1&p=cpu,cpu&quality=low&event=cat" "sim:22;;shot:cat"`.

## Credits and licences
- [three.js](https://threejs.org/) r186, MIT licence (`vendor/LICENSE-three.txt`).
- [cannon-es](https://github.com/pmndrs/cannon-es) 0.20, MIT licence (`vendor/LICENSE-cannon-es.txt`).
- Fonts [Lilita One](https://fonts.google.com/specimen/Lilita+One) and [Rubik](https://fonts.google.com/specimen/Rubik),
  SIL Open Font License (`fonts/LICENSE-*.txt`).
- Inspired by Ballerburg (Eckhard Kruse, 1987). Everything else (code, models, textures, sounds, music)
  is procedural and original to this project.

## Publishing to the website
Like the siblings: run the checks, commit and push, then copy the game into the website repo without the
developer files (PowerShell, with `DrAndiB.github.io` checked out next to this repo):

```powershell
robocopy . ..\DrAndiB.github.io\demos\tabletop-towers /MIR /XD .git _dev node_modules out /XF README.md .gitignore
```

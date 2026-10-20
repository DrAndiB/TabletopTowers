"""Drive Tabletop Towers headlessly in test mode (no render loop; the script advances the clock).

usage:  python tt.py "<query>" "<step>;;<step>..." [WIDTHxHEIGHT]
steps:  sim:<seconds>   advance the simulation and render one frame (prints draw calls/triangles)
        shot:<name>     save a screenshot to $TT_OUT/<name>.png (default ./out)
        js:<code>       evaluate JavaScript in the page (window.__tt exposes game, R, input, settings(), run(), screen(), show(name), step())
env:    TT_BASE  game URL (default http://localhost:8150/, i.e. this repo served from its root)
        TT_OUT   screenshot folder (default ./out)
example: python tt.py "autostart=1&p=cpu,cpu&quality=low" "sim:4;;shot:battle_a"
"""
import asyncio, sys, json, time, os
from playwright.async_api import async_playwright

BASE = os.environ.get('TT_BASE', 'http://localhost:8150/')
OUT = os.environ.get('TT_OUT', 'out')

async def main():
    q = sys.argv[1]; steps = sys.argv[2].split(';;')
    w, h = 1280, 720
    if len(sys.argv) > 3: w, h = map(int, sys.argv[3].split('x'))
    os.makedirs(OUT, exist_ok=True)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        pg = await b.new_page(viewport={'width': w, 'height': h})
        pg.set_default_timeout(180000)
        logs = []
        pg.on('console', lambda m: logs.append(f'{m.type}: {m.text}'))
        pg.on('pageerror', lambda e: logs.append(f'PAGEERROR: {e}'))
        t0 = time.time()
        await pg.goto(f'{BASE}?test=1&{q}')
        await pg.wait_for_function('window.__tt && window.__tt.ready', timeout=180000)
        print('ready', round(time.time() - t0, 1))
        for st in steps:
            kind, _, arg = st.partition(':')
            if kind == 'sim':
                r = await pg.evaluate(f'__tt.step({arg})')
                print('sim', arg, json.dumps(r))
            elif kind == 'shot':
                await pg.screenshot(path=os.path.join(OUT, f'{arg}.png'))
                print('shot', arg, round(time.time() - t0, 1))
            elif kind == 'js':
                r = await pg.evaluate(arg)
                print('js', json.dumps(r)[:4000])
        for l in logs[:30]: print(l)
        await b.close()

asyncio.run(main())

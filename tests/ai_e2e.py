import asyncio, subprocess, time, re, os, shutil
from playwright.async_api import async_playwright
ROOT="/home/claude/TempoTap-app"; PORT=8797; URL=f"http://127.0.0.1:{PORT}/index.html"
async def analyze(pg, js, path, engine="ai", meter="auto"):
    await pg.select_option("#analysisEngine", engine); await pg.select_option("#analysisMeter", meter)
    await pg.set_input_files("#analyzeAudioFile", path); await pg.wait_for_timeout(2500)
    t0=time.time(); await js("runAudioAnalysisButton"); st=""
    for _ in range(360):
        await pg.wait_for_timeout(500); st=(await pg.text_content("#analyzeStatus") or "").strip()
        if st and not re.search(r"(Analyzing|Listening|listening|tracking|analyzing|…)", st): break
    summ=(await pg.inner_text("#analysisSummary")).replace("\n"," · ")
    bpm=await pg.evaluate("() => (document.querySelector('#analysisSummary')||{}).textContent||''")
    return time.time()-t0, st, summ
async def main():
    srv=subprocess.Popen(["python3","-m","http.server",str(PORT),"--bind","127.0.0.1"],cwd=ROOT,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL); time.sleep(1)
    try:
        async with async_playwright() as p:
            b=await p.chromium.launch(); pg=await b.new_page(viewport={"width":1280,"height":900}); errs=[]; csp=[]
            pg.on("pageerror",lambda e:errs.append(str(e))); pg.on("console",lambda m:errs.append(m.text) if m.type=="error" else None); pg.on("dialog",lambda d:asyncio.ensure_future(d.accept()))
            js=lambda id: pg.evaluate(f"() => document.getElementById('{id}').click()")
            await pg.goto(URL); await pg.evaluate("() => { window.__csp=[]; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective+' '+e.blockedURI)); }"); await pg.wait_for_timeout(500)
            await pg.evaluate("() => document.querySelector('[data-main-nav=\"analyze\"]').click()"); await pg.wait_for_timeout(400)
            print("engine default:", await pg.evaluate("() => document.getElementById('analysisEngine').value"))
            for path,eng,meter in [("/home/claude/testdata/clicks120.wav","ai","auto"),("/home/claude/testdata/Kevin_MacLeod_-_Vibe_Ace.ogg","ai","auto"),("/home/claude/testdata/Kevin_MacLeod_-_Vibe_Ace.ogg","classic","auto"),("/home/claude/ml/audio/147793__setuniman__sweet-waltz-0i-22mi.ogg","ai","auto"),("/home/claude/ml/audio/147793__setuniman__sweet-waltz-0i-22mi.ogg","ai","3/4")]:
                dt,st,summ=await analyze(pg,js,path,eng,meter)
                print(f"{os.path.basename(path)[:28]:28s} {eng:7s} meter={meter:4s} {dt:5.1f}s | {summ[:120]} | {st[:70]}")
            # warp bridge got the AI map?
            await pg.evaluate("() => document.querySelector('[data-main-nav=\"warp\"]').click()"); await pg.wait_for_timeout(500)
            print("warp bridge:", (await pg.text_content("#warpAnalysisBridge") or "").strip()[:120])
            # persistence of the engine choice
            await pg.evaluate("() => document.querySelector('[data-main-nav=\"analyze\"]').click()"); await pg.wait_for_timeout(300)
            await pg.select_option("#analysisEngine","classic"); await pg.wait_for_timeout(200); await pg.reload(); await pg.wait_for_timeout(1000)
            await pg.evaluate("() => { const o=document.getElementById('tutorialOverlay'); if(o) o.classList.add('hidden'); document.querySelector('[data-main-nav=\"analyze\"]').click(); }"); await pg.wait_for_timeout(300)
            print("engine after reload:", await pg.evaluate("() => document.getElementById('analysisEngine').value"))
            await pg.select_option("#analysisEngine","ai")
            print("CSP:", await pg.evaluate("() => window.__csp"), "| errors:", errs or "none")
            await b.close()
        # fallback: remove weights and confirm the classic detector takes over with a notice
        shutil.move(ROOT+"/vendor/beatnet_weights.f32", ROOT+"/vendor/beatnet_weights.f32.bak")
        async with async_playwright() as p:
            b=await p.chromium.launch(); pg=await b.new_page(); pg.on("dialog",lambda d:asyncio.ensure_future(d.accept()))
            js=lambda id: pg.evaluate(f"() => document.getElementById('{id}').click()")
            await pg.goto(URL); await pg.wait_for_timeout(500); await pg.evaluate("() => document.querySelector('[data-main-nav=\"analyze\"]').click()"); await pg.wait_for_timeout(300)
            dt,st,summ=await analyze(pg,js,"/home/claude/testdata/clicks120.wav","ai","auto")
            print(f"FALLBACK (weights removed): {dt:4.1f}s | {summ[:60]} | {st[:160]}")
            await b.close()
    finally:
        srv.terminate()
        if os.path.exists(ROOT+"/vendor/beatnet_weights.f32.bak"): shutil.move(ROOT+"/vendor/beatnet_weights.f32.bak", ROOT+"/vendor/beatnet_weights.f32")
asyncio.run(main())

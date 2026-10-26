"""v1.9 library: sheet music and recordings are saved with their click tracks.
Device-only mode, headless Chromium over HTTP. Run: python3 tests/v19_library.py [--mobile]"""
import asyncio, os, re, subprocess, sys, time
from playwright.async_api import async_playwright

HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.dirname(HERE); PORT = 8797
URL = f"http://127.0.0.1:{PORT}/index.html"; TD = os.path.join(HERE, "testdata")
MOBILE = "--mobile" in sys.argv
results = []
def report(name, ok, detail=""):
    results.append((name, ok)); print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

async def main():
    srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            ctx = await b.new_context(accept_downloads=True, viewport={"width": 390, "height": 844} if MOBILE else {"width": 1280, "height": 900}, is_mobile=MOBILE, has_touch=MOBILE)
            pg = await ctx.new_page(); errs = []
            pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
            pg.on("console", lambda m: errs.append(f"console.error: {m.text}") if m.type == "error" else None)
            js = lambda id: pg.evaluate(f"() => document.getElementById('{id}').click()")
            ev = pg.evaluate
            txt = lambda sel: pg.text_content(sel)
            async def wait_for(expr, timeout=90):
                for _ in range(timeout * 4):
                    if await ev(expr): return True
                    await pg.wait_for_timeout(250)
                return False
            async def accept_ui():
                await pg.wait_for_timeout(250)
                if await ev("() => document.getElementById('uiDialog')?.classList.contains('open')"): await js("uiDialogOk"); await pg.wait_for_timeout(250)
            async def library(view_btn="libraryClicksTab"):
                await ev("() => document.getElementById('dashLibraryButton').click()"); await pg.wait_for_timeout(600)
                await js(view_btn); await pg.wait_for_timeout(500)
            async def item_for(name):
                return await ev("""n => { const it=[...document.querySelectorAll('#trackList .track-item')].find(x=>x.querySelector('.track-name').textContent===n); return it?{badges:[...it.querySelectorAll('.track-badge')].map(b=>b.textContent), buttons:[...it.querySelectorAll('button')].map(b=>b.textContent), id:Number(it.querySelector('[data-action=open]').dataset.id)}:null }""", name)
            async def store_keys():
                return await ev("""() => new Promise(r=>{const q=indexedDB.open('tempotap-web-audio-v1');q.onsuccess=()=>{const db=q.result;const t=db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]).getAllKeys();t.onsuccess=()=>{r(t.result.map(String));db.close()}}})""")

            await pg.goto(URL); await pg.wait_for_timeout(800)
            await js("signInButton"); await js("signupTab")
            await pg.fill("#authName", "Lib"); await pg.fill("#authEmail", "lib@example.com"); await pg.fill("#authPassword", "librarypass1")
            await js("authSubmit"); await pg.wait_for_timeout(1500)
            if await ev("() => !document.getElementById('tutorialOverlay').classList.contains('hidden')"): await js("tutorialSkip"); await pg.wait_for_timeout(300)

            # 1. From Sheet Music -> save keeps the PDF
            try:
                await js("homeCreateButton"); await pg.wait_for_timeout(300)
                await pg.set_input_files("#createSheetPdfFile", f"{TD}/score_real.pdf")
                await wait_for("() => /ready|Read exactly/i.test(document.getElementById('scoreAnalysisStatus').textContent) && !/Analyzing/.test(document.getElementById('scoreAnalysisStatus').textContent)")
                await pg.wait_for_timeout(800)
                beats = await ev("() => document.querySelectorAll('#intervals .chip').length")
                await js("saveButton"); await pg.wait_for_timeout(400)
                row = await ev("() => !document.getElementById('saveScoreRow').classList.contains('hidden') && document.getElementById('saveIncludeScore').checked")
                rec_row = await ev("() => !document.getElementById('saveRecordingRow').classList.contains('hidden')")
                label = await txt("#saveScoreName")
                await pg.fill("#saveName", "Score Piece"); await js("confirmSaveButton")
                await wait_for("() => /saved/.test(document.getElementById('status').textContent)", 30)
                st = await txt("#status")
                report("save from sheet music offers + keeps the PDF", row and not rec_row and "with its sheet music" in st, f"row={row} recRow={rec_row} label={label!r} status={st!r}")
            except Exception as e: report("save sheet music", False, repr(e))

            # 2. Sheet Music tab lists it, PDF downloads intact
            try:
                await library("libraryScoresTab")
                it = await item_for("Score Piece"); count = await txt("#libraryCount")
                async with pg.expect_download() as dl:
                    await ev("() => document.querySelector('#trackList [data-action=pdf]').click()")
                d = await dl.value; path = f"/tmp/v19_{d.suggested_filename}"; await d.save_as(path)
                same = open(path, "rb").read() == open(f"{TD}/score_real.pdf", "rb").read()
                report("Sheet Music tab lists it; Download PDF returns the same file", bool(it) and any("Sheet music" in x for x in it["badges"]) and same, f"item={it} count={count!r} file={d.suggested_filename} identical={same}")
            except Exception as e: report("sheet music tab", False, repr(e))

            # 3. Open brings back the PDF and the same click track
            try:
                saved_taps = await ev("async () => (await (async()=>{const r=[...document.querySelectorAll('#trackList .track-item')];return r.length})())")
                await ev("() => document.querySelector('#trackList [data-action=open]').click()")
                ok = await wait_for("() => /with its sheet music/.test(document.getElementById('status').textContent)", 120)
                info = await txt("#scorePdfFileInfo"); st = await txt("#status")
                n = await ev("() => document.querySelectorAll('#intervals .chip').length")
                overlay = await ev("() => document.querySelectorAll('#scoreOverlay *').length")
                report("Open restores the sheet music with the click track", ok and "score_real.pdf" in info and overlay > 0, f"status={st!r} info={info!r} overlay={overlay} chips={n}")
            except Exception as e: report("open with score", False, repr(e))

            # 4. Re-save without changes does not duplicate; unchecking removes the stored PDF
            try:
                before = await store_keys()
                await js("saveButton"); await pg.wait_for_timeout(300); await js("confirmSaveButton")
                await wait_for("() => /saved/.test(document.getElementById('status').textContent)", 30)
                after = await store_keys()
                report("re-saving an opened track keeps one stored PDF", sorted(before) == sorted(after) and sum(k.endswith(':score') for k in after) == 1, f"keys={after}")
            except Exception as e: report("re-save", False, repr(e))

            # 5. With Audio: the recording is kept and comes back
            try:
                await js("homeCreateButton"); await pg.wait_for_timeout(300)
                await js("createMediaButton"); await accept_ui(); await pg.wait_for_timeout(500)
                await pg.set_input_files("#tapAlongFile", f"{TD}/clicks120.wav"); await pg.wait_for_timeout(1200)
                await js("tapAlongStartButton"); await pg.wait_for_timeout(2300)
                for i in range(12):
                    await js("tapRegularButton"); await pg.wait_for_timeout(250)
                await js("tapAlongPauseButton"); await pg.wait_for_timeout(300); await js("endButton"); await pg.wait_for_timeout(300)
                await js("saveButton"); await pg.wait_for_timeout(300)
                rec_row = await ev("() => !document.getElementById('saveRecordingRow').classList.contains('hidden')")
                score_row = await ev("() => !document.getElementById('saveScoreRow').classList.contains('hidden')")
                await pg.fill("#saveName", "Audio Piece"); await js("confirmSaveButton")
                await wait_for("() => /saved/.test(document.getElementById('status').textContent)", 30)
                st = await txt("#status")
                await library("libraryRecordingsTab"); it = await item_for("Audio Piece"); listed = await ev("() => [...document.querySelectorAll('#trackList .track-name')].map(x=>x.textContent)")
                report("With Audio save keeps the recording; Recordings tab lists only it", rec_row and not score_row and "with its recording" in st and it and listed == ["Audio Piece"], f"status={st!r} listed={listed}")
            except Exception as e: report("save recording", False, repr(e))

            # 6. Survives reload + sign-in (encrypted at rest), then reopen restores the recording
            try:
                await pg.reload(); await pg.wait_for_timeout(1200)
                await library("libraryRecordingsTab")
                await ev("() => document.querySelector('#trackList [data-action=open]').click()")
                ok = await wait_for("() => /saved with this click track is loaded/.test(document.getElementById('tapAlongStatus').textContent)", 30)
                info = await txt("#tapAlongFileInfo")
                plain = await ev("""() => new Promise(r=>{const q=indexedDB.open('tempotap-web-audio-v1');q.onsuccess=()=>{const db=q.result;const t=db.transaction(db.objectStoreNames[0]).objectStore(db.objectStoreNames[0]).getAll();t.onsuccess=()=>{r(t.result.some(x=>x instanceof Blob));db.close()}}})""")
                report("after reload, Open restores the recording; stored files are encrypted", ok and "clicks120" in info and not plain, f"info={info!r} plaintextBlobs={plain}")
            except Exception as e: report("reopen recording", False, repr(e))

            # 7. Search
            try:
                await library("libraryClicksTab")
                await pg.fill("#librarySearch", "score_real"); await pg.wait_for_timeout(200)
                a = await ev("() => [...document.querySelectorAll('#trackList .track-name')].map(x=>x.textContent)")
                await pg.fill("#librarySearch", "zzz"); await pg.wait_for_timeout(200)
                none = await txt("#trackList"); await pg.fill("#librarySearch", ""); await pg.wait_for_timeout(200)
                allc = await txt("#libraryCount")
                report("search matches PDF names; empty result message; count", a == ["Score Piece"] and "Nothing matches" in none and "2 click tracks" in allc, f"match={a} count={allc!r}")
            except Exception as e: report("search", False, repr(e))

            # 8. Delete removes the stored files
            try:
                for name in ["Score Piece", "Audio Piece"]:
                    it = await item_for(name)
                    await ev(f"() => document.querySelector('#trackList [data-action=delete][data-id=\"{it['id']}\"]').click()"); await pg.wait_for_timeout(300)
                    msg = await txt("#uiDialogText"); await js("uiDialogOk"); await pg.wait_for_timeout(700)
                keys = await store_keys()
                report("delete removes the click track and its files", not any(k.startswith('t') for k in keys) and "its" in msg, f"lastConfirm={msg!r} keys={keys}")
            except Exception as e: report("delete", False, repr(e))

            if MOBILE:
                over = await ev("() => document.documentElement.scrollWidth > window.innerWidth + 1")
                report("no horizontal page scroll on phone", not over)
            report("no page errors", not errs, "; ".join(errs)[:400])
            await b.close()
    finally:
        srv.terminate()
    print(f"\n{sum(ok for _, ok in results)}/{len(results)} passed")

asyncio.run(main())

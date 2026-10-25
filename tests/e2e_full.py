"""TempoTap full end-to-end suite (headless Chromium over HTTP, CSP enforced).
Covers: auth, tutorial, create hub (scratch/media), tap-along, PDF score analysis + practice,
library/share/import, MIDI export, analyze, warp (standard + studio), cleanup, save/version/open
warped audio, delete account, mobile viewport. Prints PASS/FAIL per section with details."""
import asyncio, json, os, re, subprocess, sys, time, traceback
from playwright.async_api import async_playwright

ROOT = "/home/claude/TempoTap-app"; PORT = 8790
URL = f"http://127.0.0.1:{PORT}/index.html"
TD = "/home/claude/testdata"
OUT = "/home/claude/tests/out"; os.makedirs(OUT, exist_ok=True)
MOBILE = "--mobile" in sys.argv

results = []
def report(name, ok, detail=""):
    results.append((name, ok, detail)); print(f"{'PASS' if ok else 'FAIL'}  {name}  {detail}")

async def main():
    srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            ctx = await b.new_context(accept_downloads=True, viewport={"width": 390, "height": 844} if MOBILE else {"width": 1280, "height": 900},
                                      is_mobile=MOBILE, has_touch=MOBILE)
            pg = await ctx.new_page()
            errs, dialogs, csp = [], [], []
            pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
            pg.on("console", lambda m: errs.append(f"console.error: {m.text}") if m.type == "error" else None)
            async def on_dialog(d):
                dialogs.append(d.message[:100])
                if d.type == "prompt": await d.accept("Renamed Track")
                else: await d.accept()
            pg.on("dialog", lambda d: asyncio.ensure_future(on_dialog(d)))
            js = lambda id: pg.evaluate(f"() => {{ const el=document.getElementById('{id}'); if(!el) throw new Error('no element #{id}'); el.click(); }}")
            txt = lambda sel: pg.text_content(sel)
            async def wait_text(sel, pattern, timeout=60, exclude=r"(Analyzing|Loading|Working|Rendering|Decoding|…|Preparing|Matching|Building)"):
                for _ in range(timeout * 2):
                    t = ((await pg.text_content(sel)) or "").strip()
                    if re.search(pattern, t) and not re.search(exclude, t): return t
                    await pg.wait_for_timeout(500)
                return ((await pg.text_content(sel)) or "").strip()
            async def dismiss_tutorial():
                await pg.wait_for_timeout(500)
                if await pg.evaluate("() => { const o=document.getElementById('tutorialOverlay'); return o && !o.classList.contains('hidden'); }"):
                    await js("tutorialSkip"); await pg.wait_for_timeout(300)
            async def accept_ui(value=None):
                await pg.wait_for_timeout(250)
                if await pg.evaluate("() => document.getElementById('uiDialog')?.classList.contains('open')"):
                    dialogs.append("ui: " + ((await pg.text_content("#uiDialogTitle")) or "") + " — " + ((await pg.text_content("#uiDialogText")) or "")[:60])
                    if value is not None and not await pg.evaluate("() => document.getElementById('uiDialogField').classList.contains('hidden')"):
                        await pg.fill("#uiDialogInput", value)
                    await js("uiDialogOk"); await pg.wait_for_timeout(250)
            visible = lambda id: pg.evaluate(f"() => {{ const el=document.getElementById('{id}'); if(!el) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=='hidden'; }}")

            await pg.goto(URL)
            await pg.evaluate("() => { window.__csp=[]; document.addEventListener('securitypolicyviolation', e => window.__csp.push(e.violatedDirective+' '+e.blockedURI)); }")
            await pg.wait_for_timeout(600)

            # ---------- 1. Sign up + tutorial ----------
            try:
                await js("signInButton"); await js("signupTab")
                await pg.fill("#authName", "Tester"); await pg.fill("#authEmail", "t@example.com"); await pg.fill("#authPassword", "testerpass1")
                await js("authSubmit"); await pg.wait_for_timeout(1500)
                tut_open = await pg.evaluate("() => !document.getElementById('tutorialOverlay').classList.contains('hidden')")
                checked = await pg.evaluate("() => document.getElementById('tutorialDontShowAgain').checked")
                # walk all 9 steps
                steps = 0
                for _ in range(12):
                    label = await txt("#tutorialNext")
                    await js("tutorialNext"); steps += 1; await pg.wait_for_timeout(250)
                    if label.strip() == "Finish": break
                closed = await pg.evaluate("() => document.getElementById('tutorialOverlay').classList.contains('hidden')")
                screen = await pg.evaluate("() => !document.getElementById('homePage').classList.contains('hidden')")
                await pg.reload(); await pg.wait_for_timeout(1200)
                reopened = await pg.evaluate("() => !document.getElementById('tutorialOverlay').classList.contains('hidden')")
                report("signup + tutorial (auto-open, default-checked, 9 steps, lands on Home, does not reopen)", tut_open and checked and steps == 9 and closed and screen and not reopened, f"open={tut_open} checked={checked} steps={steps} closed={closed} home={screen} reopened={reopened}")
            except Exception as e: report("signup + tutorial", False, repr(e))

            # ---------- 2. Create hub -> scratch -> taps -> save ----------
            try:
                await js("homeCreateButton"); await pg.wait_for_timeout(300)
                hub = await visible("createHubPage")
                await js("createScratchButton"); await pg.wait_for_timeout(400)
                mode = await txt("#createModePill")
                media_hidden = not await visible("tapAlongDrop")
                await js("startButton"); await pg.wait_for_timeout(2600)
                for i in range(8):
                    await js("tapButton"); await pg.wait_for_timeout(450)
                await js("endButton"); await pg.wait_for_timeout(300)
                bpm = (await txt("#bpm") or "").strip()
                async with pg.expect_download() as dl:
                    await js("exportButton")
                d = await dl.value; midi_path = os.path.join(OUT, d.suggested_filename); await d.save_as(midi_path)
                await js("saveButton"); await pg.wait_for_timeout(300)
                await pg.fill("#saveName", "Scratch Track")
                await js("confirmSaveButton"); await pg.wait_for_timeout(1200)
                status = await txt("#status")
                report("create hub → scratch → 8 taps → save", hub and mode.strip().lower() == "from scratch" and media_hidden and bpm.isdigit() and "Scratch Track" in (status or ""), f"mode={mode.strip()} mediaHidden={media_hidden} bpm={bpm} status={status!r}")
            except Exception as e: report("create scratch", False, repr(e))

            # ---------- 3. MIDI export ----------
            try:
                import mido; m = mido.MidiFile(midi_path); notes = sum(1 for tr in m.tracks for msg in tr if msg.type == "note_on" and msg.velocity > 0)
                report("click track MIDI export", notes == 8, f"notes={notes}")
            except Exception as e: report("MIDI export", False, repr(e))

            # ---------- 4. Media mode: tap-along with audio ----------
            try:
                await js("changeCreateModeButton"); await pg.wait_for_timeout(300)
                await js("createMediaButton"); await accept_ui(); await pg.wait_for_timeout(500)
                media_visible = await visible("tapAlongDrop")
                await pg.set_input_files("#tapAlongFile", f"{TD}/clicks120.wav"); await pg.wait_for_timeout(1500)
                info = await txt("#tapAlongFileInfo")
                await js("tapAlongStartButton"); await pg.wait_for_timeout(2300)
                for i in range(40):
                    await js("tapAccentButton" if i % 4 == 0 else "tapRegularButton"); await pg.wait_for_timeout(190)
                await pg.wait_for_timeout(300)
                await js("tapAlongPauseButton"); await pg.wait_for_timeout(300)
                taps = await pg.evaluate("() => document.querySelectorAll('#intervals .chip').length")
                st = await txt("#tapAlongStatus")
                report("media mode → tap-along with recording", media_visible and taps >= 4, f"file={info!r} intervalChips={taps} status={st!r}")
            except Exception as e: report("tap-along", False, repr(e))

            # save this media track too
            try:
                await js("endButton"); await pg.wait_for_timeout(200)
                await js("saveButton"); await pg.wait_for_timeout(300); await pg.fill("#saveName", "Media Track"); await js("confirmSaveButton"); await pg.wait_for_timeout(1200)
                report("save media track", "Media Track" in (await txt("#status") or ""), await txt("#status"))
            except Exception as e: report("save media track", False, repr(e))

            # ---------- 5. PDF score: load, auto-analyze, practice ----------
            try:
                # v1.8.1: the PDF has its own workflow (From Sheet Music), not the audio one
                await js("changeCreateModeButton"); await pg.wait_for_timeout(500)
                await pg.set_input_files("#createSheetPdfFile", f"{TD}/score_real.pdf"); await pg.wait_for_timeout(1500)
                st = await wait_text("#scoreAnalysisStatus", r"ready|Read exactly", timeout=90)
                info = await txt("#scorePdfFileInfo")
                anchors = await txt("#scoreAnchorCount")
                boxes = await pg.evaluate("() => document.querySelectorAll('#scoreOverlay *').length")
                page_label = await txt("#scorePageLabel")
                await js("scorePracticeStart"); await pg.wait_for_timeout(2500)
                pst = await txt("#scorePracticeStatus")
                await js("scorePracticeStop"); await pg.wait_for_timeout(300)
                nmeas = int(re.search(r"(\d+) measures", anchors or "0 measures").group(1)) if re.search(r"(\d+) measures", anchors or "") else 0
                ok = ("1 page" in (info or "")) and nmeas >= 8 and boxes > 0 and ("running" in (pst or "").lower() or "following" in (pst or "").lower())
                report("PDF score (From Sheet Music): load, auto-detect ≥8 measures, practice mode", ok, f"info={info!r} anchors={anchors!r} overlayNodes={boxes} page={page_label!r} practice={pst!r}")
            except Exception as e: report("PDF score", False, repr(e))

            # ---------- 6. Library: open, rename (prompt), move, share, import, delete ----------
            try:
                await js("dashLibraryButton") if await pg.query_selector("#dashLibraryButton") else await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()")
                await pg.wait_for_timeout(800)
                names = await pg.inner_text("#trackList")
                await pg.evaluate("() => document.querySelector('#trackList [data-action=\"rename\"]').click()"); await accept_ui("Renamed Track"); await pg.wait_for_timeout(800)
                renamed = "Renamed Track" in (await pg.inner_text("#trackList"))
                await pg.fill("#newFolderName", "Etudes"); await js("addFolderButton"); await pg.wait_for_timeout(800)
                folder = "ETUDES" in (await pg.inner_text("#trackList")).upper()
                async with pg.expect_download() as dl:
                    await pg.evaluate("() => document.querySelector('#trackList [data-action=\"share\"]').click()")
                d = await dl.value; share_path = os.path.join(OUT, d.suggested_filename); await d.save_as(share_path)
                await accept_ui()
                await pg.set_input_files("#importTrackFile", share_path); await pg.wait_for_timeout(1200); await accept_ui()
                after = await pg.inner_text("#trackList")
                imported = after.count("imported") >= 1 or len(re.findall(r"beats ·", after)) >= 3
                await pg.evaluate("() => document.querySelector('#trackList [data-action=\"open\"]').click()"); await pg.wait_for_timeout(800)
                opened = await visible("recorderPage") and (await txt("#createModePill") or "").strip() .lower() == "review and edit"
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()"); await pg.wait_for_timeout(600)
                n_before = len(re.findall(r"beats ·", await pg.inner_text("#trackList")))
                await pg.evaluate("() => [...document.querySelectorAll('#trackList [data-action=\"delete\"]')].pop().click()"); await pg.wait_for_timeout(300)
                await js("uiDialogCancel"); await pg.wait_for_timeout(400)
                n_cancel = len(re.findall(r"beats ·", await pg.inner_text("#trackList")))
                await pg.evaluate("() => [...document.querySelectorAll('#trackList [data-action=\"delete\"]')].pop().click()"); await accept_ui(); await pg.wait_for_timeout(600)
                n_after = len(re.findall(r"beats ·", await pg.inner_text("#trackList")))
                deleted_ok = n_cancel == n_before and n_after == n_before - 1
                report("library: rename, folder, share export, import, open (review mode), delete w/ in-page confirm", renamed and folder and imported and opened and deleted_ok, f"renamed={renamed} folder={folder} imported={imported} opened={opened} delete cancel/confirm={n_before}->{n_cancel}->{n_after}")
            except Exception as e: report("library", False, repr(e))

            # ---------- 7. Analyze recording ----------
            try:
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"analyze\"]').click()"); await pg.wait_for_timeout(500)
                await pg.select_option("#analysisMeter", "4/4")
                await pg.set_input_files("#analyzeAudioFile", f"{TD}/clicks120.wav"); await pg.wait_for_timeout(2500)
                await js("runAudioAnalysisButton")
                st = await wait_text("#analyzeStatus", r"(ready|Full beat map)", timeout=90)
                summary = (await pg.inner_text("#analysisSummary")).replace("\n", " · ")
                beats = int(re.search(r"(\d+) performed beats", summary).group(1)) if re.search(r"(\d+) performed beats", summary) else 0
                gone = not await pg.evaluate("() => !!document.getElementById('createTrackFromAnalysisButton')")
                report("analyze 8 s / 120 BPM file → 16 beats (create-from-analysis button removed)", beats == 16 and "ready" in st.lower() and gone, f"beats={beats} status={st[:80]!r}")
            except Exception as e: report("analyze", False, repr(e))

            # ---------- 8. Warp: standard renderer end to end ----------
            try:
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"warp\"]').click()"); await pg.wait_for_timeout(800)
                bridge = await txt("#warpAnalysisBridge")
                opts = await pg.evaluate("() => [...document.querySelectorAll('#warpTrackSelect option')].map(o=>o.textContent)")
                # choose the scratch track (8 taps)
                val = await pg.evaluate("() => { const o=[...document.querySelectorAll('#warpTrackSelect option')].find(o=>/Renamed|Scratch/.test(o.textContent)); return o?o.value:''; }")
                await pg.select_option("#warpTrackSelect", val); await pg.wait_for_timeout(600)
                summary = await txt("#warpTrackSummary")
                await pg.evaluate("() => document.querySelector('[data-warp-renderer=\"standard\"]').click()"); await pg.wait_for_timeout(200)
                await js("applyWarpButton")
                st = await wait_text("#warpStatus", r".+", timeout=120)
                src = await pg.evaluate("() => document.getElementById('warpedAudio').src || ''")
                csrc = await pg.evaluate("() => document.getElementById('warpedClicksAudio').src || ''")
                stats = (await pg.inner_text("#alignmentStats")).replace("\n", " · ") if await pg.query_selector("#alignmentStats") else ""
                async with pg.expect_download() as dl:
                    await js("downloadWarpButton")
                d = await dl.value; wav_path = os.path.join(OUT, d.suggested_filename); await d.save_as(wav_path)
                import wave; w = wave.open(wav_path); dur = w.getnframes() / w.getframerate(); w.close()
                report("warp (standard): analyzed source → click track → render → WAV download", src.startswith("blob:") and csrc.startswith("blob:") and dur > 1, f"bridge={bridge[:50]!r} opts={len(opts)} dur={dur:.2f}s status={st[:70]!r} stats={stats[:90]!r}")
            except Exception as e: report("warp standard", False, repr(e))

            # ---------- 9. Cleanup + save + versions + open saved ----------
            try:
                await js("applyCleanupButton"); st = await wait_text("#warpStatus", r".+", timeout=60); await pg.wait_for_timeout(500)
                await js("saveWarpButton"); await pg.wait_for_timeout(500)
                await pg.fill("#saveWarpName", "My Warp Project"); await js("confirmSaveWarpButton")
                st2 = await wait_text("#warpStatus", r"(Saved|saved|Version)", timeout=60)
                await js("makeAnotherVersionButton") if await visible("makeAnotherVersionButton") else None; await pg.wait_for_timeout(300)
                await pg.evaluate("() => document.querySelector('[data-warp-renderer=\"studio\"]').click()"); await pg.wait_for_timeout(200)
                await js("applyWarpButton"); st3 = await wait_text("#warpStatus", r".+", timeout=180)
                engine = await txt("#qualityEngineStatus")
                await js("saveWarpButton"); await pg.wait_for_timeout(500); await js("confirmSaveWarpButton"); st4 = await wait_text("#warpStatus", r"(Saved|saved|Version)", timeout=60)
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()"); await pg.wait_for_timeout(600)
                await js("warpedWarpsTab"); await pg.wait_for_timeout(900)
                listing = await pg.inner_text("#warpedList")
                await pg.evaluate("() => document.querySelector('#warpedList [data-warp-action=\"open\"]').click()"); await pg.wait_for_timeout(1500)
                versions = await pg.evaluate("() => document.querySelectorAll('#savedWarpVersionSelect option').length")
                clean = await pg.evaluate("() => document.getElementById('savedWarpCleanAudio').src || ''")
                studio_used = "signalsmith" in (engine or "").lower() or "studio" in (st3 or "").lower()
                report("cleanup → save → studio-quality version 2 → saved library → open (2 versions, decrypted audio)", "2 version" in listing and versions == 2 and clean.startswith("blob:"), f"cleanup={st[:50]!r} save={st2[:50]!r} studio={st3[:60]!r} engine={engine!r} list={listing[:80]!r} versions={versions}")
                report("studio-quality (Signalsmith WASM) render actually used", studio_used, f"engine={engine!r}")
            except Exception as e: report("cleanup/save/versions", False, repr(e))

            # ---------- 10. Help page + settings persistence + Esc ----------
            try:
                await js("helpSettingsButton"); await pg.wait_for_timeout(400)
                await pg.select_option("#settingWarpStrength", "exact"); await pg.wait_for_timeout(300)
                await pg.reload(); await pg.wait_for_timeout(1200); await dismiss_tutorial()
                await js("helpSettingsButton"); await pg.wait_for_timeout(400)
                v = await pg.evaluate("() => document.getElementById('settingWarpStrength').value")
                await js("accountButton"); await pg.wait_for_timeout(300)
                await pg.keyboard.press("Escape"); await pg.wait_for_timeout(200)
                closed = not await pg.evaluate("() => document.getElementById('accountModal').classList.contains('open')")
                report("settings persist across reload; Esc closes modal", v == "exact" and closed, f"strength={v} escClosed={closed}")
            except Exception as e: report("help/settings", False, repr(e))

            # ---------- 11. Logout → storage has no plaintext → login → data intact ----------
            try:
                await pg.evaluate("() => document.querySelector('[data-nav=\"home\"]')?.click()"); await pg.wait_for_timeout(300)
                await js("logoutButton"); await pg.wait_for_timeout(300); await js("confirmLogoutButton"); await pg.wait_for_timeout(600)
                raw = await pg.evaluate("() => localStorage.getItem('tempotap-web-data-v1')")
                leak = any(s in raw for s in ["Scratch Track", "Media Track", "Renamed Track", "My Warp Project", "testerpass1"])
                await js("signInButton"); await js("loginTab"); await pg.fill("#authEmail", "t@example.com"); await pg.fill("#authPassword", "testerpass1"); await js("authSubmit"); await pg.wait_for_timeout(1500); await dismiss_tutorial()
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()"); await pg.wait_for_timeout(500)
                if await pg.query_selector("#warpedClicksTab") and await visible("warpedClicksTab"): await js("warpedClicksTab")
                await pg.wait_for_timeout(1200)
                lib = await pg.inner_text("#trackList")
                report("logout leaves no plaintext; login restores library", (not leak) and "Renamed Track" in lib and len(re.findall(r"beats ·", lib)) >= 2, f"leak={leak} label={await txt('#recorderUserLabel')!r} lib={lib.replace(chr(10),' | ')[:160]!r} screen={await pg.evaluate('() => currentScreen') if False else ''}")
            except Exception as e: report("logout/login", False, repr(e))

            # ---------- 12. Delete account wipes vault + audio ----------
            try:
                await js("accountButton"); await pg.wait_for_timeout(300); await js("openDeleteAccountButton"); await pg.wait_for_timeout(300)
                await pg.fill("#deleteAccountPassword", "testerpass1"); await js("confirmDeleteAccountButton"); await pg.wait_for_timeout(1500); await accept_ui()
                raw = json.loads(await pg.evaluate("() => localStorage.getItem('tempotap-web-data-v1')"))
                idb = await pg.evaluate("""async () => { const db=await new Promise(res=>{const r=indexedDB.open('tempotap-web-audio-v1',1);r.onsuccess=()=>res(r.result)}); const n=await new Promise(res=>{const r=db.transaction('audio').objectStore('audio').count();r.onsuccess=()=>res(r.result)}); db.close(); return n; }""")
                report("delete account: users empty, vault removed, audio store empty", raw["users"] == [] and raw["vaults"] == {} and idb == 0, f"users={len(raw['users'])} vaults={list(raw['vaults'].keys())} audioRecords={idb}")
            except Exception as e: report("delete account", False, repr(e))

            violations = await pg.evaluate("() => window.__csp")
            report("no CSP violations", not violations, str(violations))
            report("no page errors / console errors", not errs, "\n      ".join(errs[:8]))
            print("\nDialogs seen:", *[f"\n  - {d}" for d in dialogs])
            await b.close()
    finally:
        srv.terminate()
    fails = [r for r in results if not r[1]]
    print(f"\n{len(results)-len(fails)}/{len(results)} passed" + (" — MOBILE viewport" if MOBILE else ""))

asyncio.run(main())

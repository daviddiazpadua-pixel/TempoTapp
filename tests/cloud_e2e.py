"""Cloud-accounts end-to-end test.

Runs the app with window.TEMPOTAPP_CLOUD set. By default it swaps vendor/firebase-bundle.js
for tests/../fb/fake-fb.js (an in-page stand-in with the same surface, persisted in
localStorage so a reload behaves like a server). Pass --real to use the bundled SDK against
the Firebase emulators (expects them on 127.0.0.1: auth 9099, firestore 8080, storage 9199).
"""
import asyncio, json, os, re, subprocess, sys, time
from playwright.async_api import async_playwright

ROOT = "/home/claude/TempoTap-app"; PORT = 8791
URL = f"http://127.0.0.1:{PORT}/index.html"
TD = "/home/claude/testdata"
FAKE = "/home/claude/TempoTap-app/tests/fake-fb.js"
REAL = "--real" in sys.argv
RESULTS = []

def report(name, ok, detail=""):
    RESULTS.append((name, ok, detail)); print(("PASS " if ok else "FAIL ") + name + ("  " + detail if detail else ""))

CLOUD_CFG = ("window.TEMPOTAPP_CLOUD={firebase:{apiKey:'demo',authDomain:'demo.firebaseapp.com',projectId:'tempotapp-dev',storageBucket:'tempotapp-dev.appspot.com',appId:'demo'},emulator:{host:'127.0.0.1',auth:9099,firestore:8080,storage:9199}};"
             if REAL else "window.TEMPOTAPP_CLOUD={firebase:{projectId:'fake'}};")

async def main():
    srv = subprocess.Popen(["python3", "-m", "http.server", str(PORT), "--bind", "127.0.0.1"], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            b = await p.chromium.launch(args=["--autoplay-policy=no-user-gesture-required"])
            ctx = await b.new_context(accept_downloads=True, viewport={"width": 1280, "height": 900})
            cloud_on = {"v": False}
            async def route_cfg(route):
                await route.fulfill(status=200, content_type="application/javascript", body=(CLOUD_CFG if cloud_on["v"] else "window.TEMPOTAPP_CLOUD=null;"))
            await ctx.route("**/vendor/cloud-config.js", route_cfg)
            async def route_testfile(route):
                name = route.request.url.rsplit('/',1)[-1]
                await route.fulfill(status=200, content_type="audio/wav", body=open(f"{TD}/{name}","rb").read())
            await ctx.route("**/__testdata__/*", route_testfile)
            async def set_file(input_id, name):
                await pg.evaluate(f"""async () => {{ const r=await fetch('/__testdata__/{name}'); const b=await r.blob(); const f=new File([b],'{name}',{{type:'audio/wav'}}); const dt=new DataTransfer(); dt.items.add(f); const i=document.getElementById('{input_id}'); i.files=dt.files; i.dispatchEvent(new Event('change',{{bubbles:true}})); }}""")
            if not REAL:
                async def route_bundle(route):
                    await route.fulfill(status=200, content_type="application/javascript", body=open(FAKE).read())
                await ctx.route("**/vendor/firebase-bundle.js", route_bundle)
            pg = await ctx.new_page()
            errs, dialogs = [], []
            pg.on("pageerror", lambda e: errs.append(f"pageerror: {e}"))
            pg.on("console", lambda m: errs.append(f"console.error: {m.text}") if m.type == "error" else (print("   console.warn:", m.text[:300]) if m.type == "warning" else None))
            js = lambda id: pg.evaluate(f"() => {{ const el=document.getElementById('{id}'); if(!el) throw new Error('no element #{id}'); el.click(); }}")
            txt = lambda sel: pg.text_content(sel)
            visible = lambda id: pg.evaluate(f"() => {{ const el=document.getElementById('{id}'); if(!el) return false; const r=el.getBoundingClientRect(); return r.width>0 && r.height>0 && getComputedStyle(el).visibility!=='hidden'; }}")
            async def wait_text(sel, pattern, timeout=60, exclude=r"(Analyzing|Loading|Working|Rendering|Decoding|…|Preparing|Matching|Building|Uploading|Saving)"):
                for _ in range(timeout * 2):
                    t = ((await pg.text_content(sel)) or "").strip()
                    if re.search(pattern, t) and not re.search(exclude, t): return t
                    await pg.wait_for_timeout(500)
                return ((await pg.text_content(sel)) or "").strip()
            async def ui_open():
                return await pg.evaluate("() => document.getElementById('uiDialog')?.classList.contains('open')")
            async def accept_ui(value=None, cancel=False):
                await pg.wait_for_timeout(300)
                if await ui_open():
                    dialogs.append("ui: " + ((await txt("#uiDialogTitle")) or "") + " — " + ((await txt("#uiDialogText")) or "")[:70])
                    if value is not None and not await pg.evaluate("() => document.getElementById('uiDialogField').classList.contains('hidden')"):
                        await pg.fill("#uiDialogInput", value)
                    await js("uiDialogCancel" if cancel else "uiDialogOk"); await pg.wait_for_timeout(300); return True
                return False
            async def dismiss_tutorial():
                await pg.wait_for_timeout(500)
                if await pg.evaluate("() => { const o=document.getElementById('tutorialOverlay'); return o && !o.classList.contains('hidden'); }"):
                    await js("tutorialSkip"); await pg.wait_for_timeout(300)
            async def signup(name, email, pw):
                await js("signInButton"); await js("signupTab")
                await pg.fill("#authName", name); await pg.fill("#authEmail", email); await pg.fill("#authPassword", pw)
                await js("authSubmit"); await pg.wait_for_timeout(1500); await dismiss_tutorial()
            async def login(email, pw):
                await js("signInButton"); await js("loginTab")
                await pg.fill("#authEmail", email); await pg.fill("#authPassword", pw)
                await js("authSubmit"); await pg.wait_for_timeout(1500)
            async def scratch_track(name, taps=8):
                await js("homeCreateButton"); await pg.wait_for_timeout(300); await js("createScratchButton"); await pg.wait_for_timeout(400)
                await js("startButton"); await pg.wait_for_timeout(2600)
                for _ in range(taps): await js("tapButton"); await pg.wait_for_timeout(300)
                await js("endButton"); await pg.wait_for_timeout(300)
                await js("saveButton"); await pg.wait_for_timeout(300); await pg.fill("#saveName", name); await js("confirmSaveButton"); await pg.wait_for_timeout(1500)
            async def score_track(name):
                await js("homeCreateButton"); await pg.wait_for_timeout(300)
                await pg.set_input_files("#createSheetPdfFile", f"{TD}/score_real.pdf")
                await wait_text("#scoreAnalysisStatus", r"ready|Read exactly", timeout=90); await pg.wait_for_timeout(600)
                await js("saveButton"); await pg.wait_for_timeout(300); await pg.fill("#saveName", name); await js("confirmSaveButton")
                return await wait_text("#status", r"saved", timeout=30)
            async def library_names():
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()"); await pg.wait_for_timeout(1200)
                return await pg.evaluate("() => [...document.querySelectorAll('#trackList .track-name')].map(e=>e.textContent.trim())")
            async def wipe_cloud_cache():
                # drop the cloud download cache; keep Lena's device-only files (small local ids "t1:score") for the migration test
                await pg.evaluate(r"""() => new Promise(r => { const q=indexedDB.open('tempotap-web-audio-v1'); q.onerror=()=>r();
                    q.onsuccess=()=>{ const db=q.result; const tx=db.transaction(db.objectStoreNames[0],'readwrite'); const st=tx.objectStore(db.objectStoreNames[0]);
                    const k=st.getAllKeys(); k.onsuccess=()=>{ for(const key of k.result) if(!/^t\d{1,6}:/.test(String(key))) st.delete(key); }; tx.oncomplete=()=>{db.close();r()}; }; })""")
            async def logout():
                await js("logoutButton"); await pg.wait_for_timeout(300)
                if await visible("confirmLogoutButton"): await js("confirmLogoutButton")
                await pg.wait_for_timeout(800)

            # ---------- 0. Device-only mode first: create a local library to migrate later ----------
            await pg.goto(URL); await pg.wait_for_timeout(600)
            await signup("Local Lena", "lena@example.com", "lenapass123")
            await scratch_track("Pre-sync Track", taps=6)
            pre_st = await score_track("Pre-sync Score")
            local_names = await library_names()
            await logout()
            report("device-only library created for migration test (incl. a track with its sheet music)", "Pre-sync Track" in local_names and "with its sheet music" in pre_st, f"names={local_names} scoreSave={pre_st!r}")

            # ---------- 1. Switch on cloud mode ----------
            cloud_on["v"] = True
            await pg.reload(); await pg.wait_for_timeout(1200)
            try:
                await js("signInButton"); await js("loginTab"); await pg.wait_for_timeout(200)
                g = await visible("authGoogleButton"); f = await visible("authForgotButton"); note_local = await visible("authRecoveryNote")
                await js("signupTab"); await pg.wait_for_timeout(200)
                sync_note = await visible("authSyncNote"); rec_note = await visible("authRecoveryNote")
                await js("authClose")
                report("cloud UI: Google button + forgot link shown, local recovery note hidden, sync note on signup", g and f and not note_local and sync_note and not rec_note, f"google={g} forgot={f} syncNote={sync_note}")
            except Exception as e: report("cloud UI", False, repr(e))

            # ---------- 2. Sign up in the cloud ----------
            try:
                await signup("Cloud Carla", "carla@example.com", "carlapass123")
                chip = (await txt("#userChip") or "").strip()
                await js("accountButton"); await pg.wait_for_timeout(300)
                verify_note = await visible("accountVerifyNote")
                await js("accountResendVerify"); await pg.wait_for_timeout(400); resent = await accept_ui()
                await pg.evaluate("() => { window.__FAKE_VERIFY__ = true; }")
                await js("accountRecheckVerify"); await pg.wait_for_timeout(600); await accept_ui()
                verify_after = await visible("accountVerifyNote")
                await js("accountModalClose")
                sent = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return Object.values(s.users).some(u=>u.email==='carla@example.com'&&u.verificationSent); }")
                report("cloud signup: verification email sent, note shown, resend works, clears after confirm", chip == "Cloud Carla" and verify_note and resent and (sent in (True, 'real')) and (not verify_after or REAL), f"chip={chip!r} note={verify_note} resent={resent} sent={sent} after={verify_after}")
            except Exception as e: report("cloud signup", False, repr(e))

            # ---------- 3. Save a track; it must land in Firestore, not localStorage ----------
            try:
                await scratch_track("Cloud Track A")
                names = await library_names()
                ls = await pg.evaluate("() => localStorage.getItem('tempotap-web-data-v1') || ''")
                in_cloud = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return Object.keys(s.docs).some(k=>/\\/tracks\\//.test(k) && s.docs[k].name==='Cloud Track A'); }")
                report("cloud save: track listed, stored in cloud, not in local plaintext", "Cloud Track A" in names and "Cloud Track A" not in ls and in_cloud in (True, 'real'), f"names={names} inCloud={in_cloud}")
            except Exception as e: report("cloud save", False, repr(e))

            # ---------- 4. Reload keeps the session and the library ----------
            try:
                await pg.reload(); await pg.wait_for_timeout(1500)
                chip = (await txt("#userChip") or "").strip(); names = await library_names()
                report("reload: still signed in, library loads from cloud", chip == "Cloud Carla" and "Cloud Track A" in names, f"chip={chip!r} names={names}")
            except Exception as e: report("reload", False, repr(e))

            # ---------- 5. Rename + folder + delete go to the cloud ----------
            try:
                await pg.evaluate("() => document.querySelector('#trackList [data-action=\"rename\"]').click()"); await accept_ui("Cloud Track A2"); await pg.wait_for_timeout(800)
                await pg.fill("#newFolderName", "Etudes"); await js("addFolderButton"); await pg.wait_for_timeout(800)
                listing = await pg.inner_text("#trackList")
                await pg.reload(); await pg.wait_for_timeout(1500); listing2 = await pg.inner_text("#trackList") if await visible("trackList") else (await library_names() and await pg.inner_text("#trackList"))
                report("rename + new folder persist in cloud across reload", "Cloud Track A2" in listing and "ETUDES" in listing.upper() and "ETUDES" in listing2.upper(), f"listing={listing[:120]!r}")
            except Exception as e: report("rename/folder", False, repr(e))

            # ---------- 6. Warp → save audio to Storage, open from library (download + cache) ----------
            try:
                await dismiss_tutorial()
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"analyze\"]').click()"); await pg.wait_for_timeout(500)
                diag = await pg.evaluate("() => { const i=document.getElementById('analyzeAudioFile'); const r=i.getBoundingClientRect(); return {page:!document.getElementById('analyzePage').classList.contains('hidden'), tut:!document.getElementById('tutorialOverlay').classList.contains('hidden'), dlg:document.getElementById('uiDialog')?.classList.contains('open'), w:r.width}; }")
                print("   diag:", diag)
                await pg.select_option("#analysisMeter", "4/4")
                await set_file("analyzeAudioFile", "clicks120.wav"); await pg.wait_for_timeout(2500)
                await js("runAudioAnalysisButton"); await wait_text("#analyzeStatus", r"(ready|Full beat map)", timeout=90)
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"warp\"]').click()"); await pg.wait_for_timeout(800)
                val = await pg.evaluate("() => { const o=[...document.querySelectorAll('#warpTrackSelect option')].find(o=>/Cloud Track/.test(o.textContent)); return o?o.value:''; }")
                await pg.select_option("#warpTrackSelect", val); await pg.wait_for_timeout(600)
                await pg.evaluate("() => document.querySelector('[data-warp-renderer=\"standard\"]').click()"); await pg.wait_for_timeout(200)
                await js("applyWarpButton"); await wait_text("#warpStatus", r".+", timeout=120)
                await js("saveWarpButton"); await pg.wait_for_timeout(500); await pg.fill("#saveWarpName", "Cloud Warp"); await js("confirmSaveWarpButton")
                st = await wait_text("#warpStatus", r"(Saved|saved|Version)", timeout=90)
                files = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return Object.keys(s.files).filter(k=>/warps\\/\\d+\\/(clean|clicks)\\.wav$/.test(k)).length; }")
                # wipe the local audio cache so opening must download from Storage
                await wipe_cloud_cache()
                await pg.evaluate("() => document.querySelector('[data-main-nav=\"library\"]').click()"); await pg.wait_for_timeout(600)
                await js("warpedWarpsTab"); await pg.wait_for_timeout(900)
                listing = await pg.inner_text("#warpedList")
                await pg.evaluate("() => document.querySelector('#warpedList [data-warp-action=\"open\"]').click()"); await pg.wait_for_timeout(2500)
                clean = await pg.evaluate("() => document.getElementById('savedWarpCleanAudio').src || ''")
                report("warp saved to cloud storage (2 files) and re-opened after cache wipe", (files in (2, 'real')) and "Cloud Warp" in listing and clean.startswith("blob:"), f"save={st[:50]!r} files={files} list={listing[:60]!r} src={clean[:20]!r}")
            except Exception as e: report("warp cloud storage", False, repr(e))

            # ---------- 6b. v1.9: sheet music saved with a click track goes to Storage ----------
            try:
                st = await score_track("Cloud Score")
                sfiles = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return Object.keys(s.files).filter(k=>/tracks\/\d+\/score$/.test(k)).length; }")
                report("cloud: sheet music stored in Storage with its click track", "with its sheet music" in st and sfiles in (1, 'real'), f"status={st!r} scoreFiles={sfiles}")
            except Exception as e: report("cloud sheet music", False, repr(e))

            # ---------- 7. Second device: sign out, wipe local, sign in → everything is there ----------
            try:
                await logout()
                await pg.evaluate("() => { for(const k of Object.keys(localStorage)) if(!k.startsWith('fakefb') && k!=='tempotap-web-data-v1') localStorage.removeItem(k); }")
                await wipe_cloud_cache()
                await pg.reload(); await pg.wait_for_timeout(1200)
                await login("carla@example.com", "carlapass123"); await dismiss_tutorial()
                names = await library_names()
                await js("warpedWarpsTab"); await pg.wait_for_timeout(900); wl = await pg.inner_text("#warpedList")
                report("second device: sign in shows synced tracks and warped audio", "Cloud Track A2" in names and "Cloud Warp" in wl, f"names={names} warps={wl[:50]!r}")
            except Exception as e: report("second device", False, repr(e))
            try:
                await js("warpedScoresTab"); await pg.wait_for_timeout(800)
                listed = await pg.evaluate("() => [...document.querySelectorAll('#trackList .track-name')].map(e=>e.textContent.trim())")
                await pg.evaluate("() => document.querySelector('#trackList [data-action=open]').click()")
                st = await wait_text("#status", r"with its sheet music|could not", timeout=120)
                info = (await txt("#scorePdfFileInfo") or "").strip()
                report("second device: Sheet Music tab opens the score downloaded from the cloud", listed == ["Cloud Score"] and "with its sheet music" in st and "score_real.pdf" in info, f"listed={listed} status={st!r} info={info!r}")
            except Exception as e: report("second device sheet music", False, repr(e))

            # ---------- 8. Wrong password / forgot password ----------
            try:
                await logout()
                await js("signInButton"); await js("loginTab"); await pg.fill("#authEmail", "carla@example.com"); await pg.fill("#authPassword", "wrongpass123"); await js("authSubmit"); await pg.wait_for_timeout(1000)
                err = (await txt("#authError") or "").strip()
                await js("authForgotButton"); await pg.wait_for_timeout(300); await accept_ui("carla@example.com"); await pg.wait_for_timeout(500); sent_msg = await accept_ui()
                reset_to = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; return s? s.resetSentTo : 'real'; }")
                await js("authClose")
                report("wrong password shows friendly error; forgot password sends reset email", "Incorrect" in err and sent_msg and reset_to in ("carla@example.com", 'real'), f"err={err!r} resetTo={reset_to}")
            except Exception as e: report("wrong/forgot password", False, repr(e))

            # ---------- 9. Migration of the device-only library on first cloud sign-in ----------
            try:
                # lena has no cloud account yet: create one with the same email+password, then sign in → migration offer
                await signup("Cloud Lena", "lena@example.com", "lenapass123")
                offered = await accept_ui()  # "Found a library on this device" → Upload
                await pg.wait_for_timeout(2500); done = await accept_ui()  # "Library uploaded"
                names = await library_names()
                await logout(); await pg.reload(); await pg.wait_for_timeout(1000)
                await login("lena@example.com", "lenapass123"); await dismiss_tutorial()
                again = await ui_open()
                names2 = await library_names()
                mfiles = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return Object.keys(s.files).filter(k=>/tracks\/\d+\/score$/.test(k)).length; }")
                report("migration: offer on first sign-in, uploads local tracks + their sheet music, not offered again", offered and done and "Pre-sync Track" in names and "Pre-sync Score" in names and not again and "Pre-sync Track" in names2 and mfiles in (2, 'real'), f"offered={offered} done={done} names={names} again={again} scoreFilesTotal={mfiles}")
            except Exception as e: report("migration", False, repr(e))

            # ---------- 10. Google sign-in (separate account, no password), delete without password ----------
            try:
                await logout()
                await pg.evaluate("() => { window.__FAKE_GOOGLE_EMAIL__='gina@example.com'; }")
                await js("signInButton"); await js("loginTab"); await js("authGoogleButton"); await pg.wait_for_timeout(1500); await dismiss_tutorial()
                chip = (await txt("#userChip") or "").strip()
                await scratch_track("Gina Track"); names = await library_names()
                await js("accountButton"); await pg.wait_for_timeout(300); vnote = await visible("accountVerifyNote")
                await js("openDeleteAccountButton"); await pg.wait_for_timeout(300)
                pw_hidden = not await visible("deleteAccountPassword")
                await js("confirmDeleteAccountButton"); await pg.wait_for_timeout(1500); await accept_ui()
                signed_out = await visible("signInButton")
                gone = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return !Object.values(s.users).some(u=>u.email==='gina@example.com') && !Object.keys(s.docs).some(k=>s.docs[k].name==='Gina Track'); }")
                report("Google sign-in: account created, no verify note, delete without password wipes data", chip and "Gina Track" in names and not vnote and pw_hidden and signed_out and gone in (True, 'real'), f"chip={chip!r} pwHidden={pw_hidden} signedOut={signed_out} gone={gone}")
            except Exception as e: report("google sign-in", False, repr(e))

            # ---------- 11. Delete a password account (reauth) ----------
            try:
                await login("carla@example.com", "carlapass123"); await dismiss_tutorial()
                await js("accountButton"); await pg.wait_for_timeout(300); await js("openDeleteAccountButton"); await pg.wait_for_timeout(300)
                await pg.fill("#deleteAccountPassword", "nope-nope-1"); await js("confirmDeleteAccountButton"); await pg.wait_for_timeout(1000)
                bad = (await txt("#deleteAccountError") or "").strip()
                await pg.fill("#deleteAccountPassword", "carlapass123"); await js("confirmDeleteAccountButton"); await pg.wait_for_timeout(2500); await accept_ui()
                gone = await pg.evaluate("() => { const s=window.__FAKE_FB_STATE__; if(!s) return 'real'; return !Object.values(s.users).some(u=>u.email==='carla@example.com') && !Object.keys(s.docs).some(k=>k.includes('/users/')&&s.docs[k].name&&/Cloud/.test(s.docs[k].name)) && (()=>{ const lena=Object.values(s.users).find(u=>u.email==='lena@example.com'); return Object.keys(s.files).every(k=>lena&&k.includes('/'+lena.uid+'/')); })(); }")
                report("delete password account: wrong password rejected, right password wipes docs + files", bad and gone in (True, 'real'), f"bad={bad!r} gone={gone}")
            except Exception as e: report("delete account", False, repr(e))

            report("no page errors / console errors", not errs, "; ".join(errs[:4]))
            print("\nDialogs:"); [print("  -", d) for d in dialogs]
            await b.close()
    finally:
        srv.terminate()
    n = sum(1 for r in RESULTS if r[1]); print(f"\n{n}/{len(RESULTS)} passed")

asyncio.run(main())

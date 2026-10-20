// Stand-in for vendor/firebase-bundle.js used only by tests: same window.FB surface,
// backed by localStorage so reloads keep data (simulating a server). Not shipped.
(function(){
  const LS='fakefb-store'; const load=()=>{try{return JSON.parse(localStorage.getItem(LS)||'{}')}catch{return {}}}; const save=(s)=>localStorage.setItem(LS,JSON.stringify(s));
  const state=Object.assign({users:{},docs:{},files:{},session:null},load());
  const persist=()=>save({users:state.users,docs:state.docs,files:state.files,session:state.session});
  const err=(code,msg)=>{const e=new Error(msg||code);e.code=code;return e};
  const listeners=[];
  function mkUser(rec){ return {uid:rec.uid,email:rec.email,displayName:rec.displayName||null,emailVerified:!!rec.emailVerified,providerData:[{providerId:rec.provider||'password'}]}; }
  function cur(){ return state.session?mkUser(state.users[state.session]):null; }
  const auth={
    getAuth(){ return {get currentUser(){return cur()}} },
    connectAuthEmulator(){}, setPersistence:async()=>{}, browserLocalPersistence:{},
    onAuthStateChanged(_a,cb){ listeners.push(cb); setTimeout(()=>cb(cur()),0); return ()=>{const i=listeners.indexOf(cb);if(i>=0)listeners.splice(i,1)} },
    async createUserWithEmailAndPassword(_a,email,password){ if(Object.values(state.users).some(u=>u.email===email)) throw err('auth/email-already-in-use'); if(password.length<6) throw err('auth/weak-password'); const uid='u'+Math.random().toString(36).slice(2,10); state.users[uid]={uid,email,password,provider:'password',emailVerified:false}; state.session=uid; persist(); listeners.forEach(cb=>cb(cur())); return {user:mkUser(state.users[uid])}; },
    async signInWithEmailAndPassword(_a,email,password){ const u=Object.values(state.users).find(x=>x.email===email&&x.provider==='password'); if(!u||u.password!==password) throw err('auth/invalid-credential'); state.session=u.uid; persist(); listeners.forEach(cb=>cb(cur())); return {user:mkUser(u)}; },
    async signInWithPopup(_a,provider){ const email=window.__FAKE_GOOGLE_EMAIL__||'google.user@example.com'; let u=Object.values(state.users).find(x=>x.email===email); if(!u){ const uid='g'+Math.random().toString(36).slice(2,10); u=state.users[uid]={uid,email,provider:'google.com',displayName:'Google User',emailVerified:true}; } state.session=u.uid; persist(); listeners.forEach(cb=>cb(cur())); return {user:mkUser(u)}; },
    async signInWithRedirect(){}, async getRedirectResult(){ return null; },
    async signOut(){ state.session=null; persist(); listeners.forEach(cb=>cb(null)); },
    async sendEmailVerification(u){ state.users[u.uid].verificationSent=true; persist(); },
    async sendPasswordResetEmail(_a,email){ state.resetSentTo=email; persist(); },
    async updateProfile(u,{displayName}){ state.users[u.uid].displayName=displayName; persist(); },
    GoogleAuthProvider:class{ setCustomParameters(){} },
    EmailAuthProvider:{ credential:(email,password)=>({email,password}) },
    async reauthenticateWithCredential(u,cred){ const rec=state.users[u.uid]; if(rec.password!==cred.password) throw err('auth/wrong-password'); },
    async reauthenticateWithPopup(){},
    async deleteUser(u){ delete state.users[u.uid]; state.session=null; persist(); listeners.forEach(cb=>cb(null)); },
    async reload(u){ if(window.__FAKE_VERIFY__){ state.users[u.uid].emailVerified=true; persist(); } },
  };
  function key(parts){ return parts.join('/'); }
  const fs={
    initializeFirestore(){ return {} }, persistentLocalCache(){ return {} }, persistentSingleTabManager(){ return {} }, connectFirestoreEmulator(){},
    collection(_db,...p){ return {col:key(p)}; }, doc(_db,...p){ return {path:key(p),col:key(p.slice(0,-1)),ref:true}; },
    async getDoc(ref){ const d=state.docs[ref.path]; return {exists:()=>!!d,data:()=>d?JSON.parse(JSON.stringify(d)):undefined}; },
    async getDocs(colRef){ const pre=colRef.col+'/'; const out=Object.keys(state.docs).filter(k=>k.startsWith(pre)&&!k.slice(pre.length).includes('/')).map(k=>({ref:{path:k},data:()=>JSON.parse(JSON.stringify(state.docs[k]))})); return {docs:out}; },
    async setDoc(ref,data){ if(!state.session) throw err('permission-denied'); state.docs[ref.path]=JSON.parse(JSON.stringify(data)); persist(); },
    async updateDoc(ref,patch){ if(!state.docs[ref.path]) throw err('not-found'); Object.assign(state.docs[ref.path],JSON.parse(JSON.stringify(patch))); persist(); },
    async deleteDoc(ref){ delete state.docs[ref.path]; persist(); },
    writeBatch(){ const ops=[]; return {delete(ref){ops.push(ref)},async commit(){ for(const r of ops) delete state.docs[r.path]; persist(); }}; },
    query(){ throw new Error('not used') }, where(){}, orderBy(){}, serverTimestamp(){ return new Date().toISOString() }, onSnapshot(){ return ()=>{} },
  };
  const b64=(buf)=>{let s='';const u=new Uint8Array(buf);for(let i=0;i<u.length;i+=0x8000)s+=String.fromCharCode.apply(null,u.subarray(i,i+0x8000));return btoa(s)};
  const unb64=(s)=>{const b=atob(s);const u=new Uint8Array(b.length);for(let i=0;i<b.length;i++)u[i]=b.charCodeAt(i);return u.buffer};
  const st={
    getStorage(){ return {} }, connectStorageEmulator(){},
    ref(_s,path){ return {path}; },
    async uploadBytes(ref,blob){ if(!state.session) throw err('storage/unauthorized'); state.files[ref.path]=b64(await blob.arrayBuffer()); persist(); },
    async getBytes(ref){ const f=state.files[ref.path]; if(!f) throw err('storage/object-not-found'); return unb64(f); },
    async deleteObject(ref){ if(!state.files[ref.path]) throw err('storage/object-not-found'); delete state.files[ref.path]; persist(); },
    async getDownloadURL(){ return 'blob:fake'; },
  };
  window.FB={ initializeApp(){ return {} }, auth, fs, st };
  window.__FAKE_FB_STATE__=state;
})();

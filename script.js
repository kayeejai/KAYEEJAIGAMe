(function(){
  "use strict";

  const firebaseConfig = {
    apiKey: "AIzaSyCaJ5I88uTu4y08i_dnh6queGnDDcL_biw",
    authDomain: "kayeejai-arena.firebaseapp.com",
    projectId: "kayeejai-arena",
    storageBucket: "kayeejai-arena.firebasestorage.app",
    messagingSenderId: "283622850863",
    appId: "1:283622850863:web:d4ac760a89b8710e82e1da",
    measurementId: "G-RW54KE9JVV",
    databaseURL: "https://kayeejai-arena-default-rtdb.asia-southeast1.firebasedatabase.app"
  };

  let db = null;
  let auth = null;
  let currentUser = null;
  let firebaseReady = false;
  let authReady = false;
  let roomCode = localStorage.getItem("kyjRoom") || "";
  let playerId = localStorage.getItem("kyjPlayerId") || "";
  let playerName = localStorage.getItem("kyjPlayerName") || "";
  let playerRef = null;
  let isHost = false;
  let roomListener = null;
  let currentRoomData = null;
  let registering = false;
  let lastStartAt = null;
  let memoryDone = false;

  let memoryDeck = [];
  let memoryFirst = null;
  let memorySecond = null;
  let memoryLocked = false;
  let memoryMatched = 0;
  let memoryScore = 0;
  let memoryTime = 40;
  let memoryTimer = null;
  let memoryPlaying = false;


  try {
    if (window.firebase && !firebase.apps.length) firebase.initializeApp(firebaseConfig);
    if (window.firebase) {
      db = firebase.database();
      auth = firebase.auth();
      firebaseReady = true;
    }
  } catch(e) {
    console.error("Firebase init error:", e);
  }

  const $ = id => document.getElementById(id);

  /* ===== BACKGROUND MUSIC: soft ambient loop generated with Web Audio (no audio files) ===== */
  const KJMusic = (function(){
    const VOL = 0.16;
    let ctx = null, master = null, tone = null, timer = null, nextT = 0, step = 0, mode = "lobby", muted = false;
    try{ muted = localStorage.getItem("kyjMusic") === "off"; }catch(e){}
    const hz = m => 440 * Math.pow(2, (m - 69) / 12);
    const CH = [[48,55,59,64],[45,52,55,60],[41,48,52,57],[43,50,55,59]];   // Cmaj7 Am7 Fmaj7 G6
    const ARP = { lobby:[0,-1,2,-1,3,-1,2,-1], game:[0,2,3,2,1,2,3,2] };
    function build(){
      const AC = window.AudioContext || window.webkitAudioContext;
      if(!AC) return false;
      try{
        ctx = new AC();
        master = ctx.createGain(); master.gain.value = 0;
        tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 1500; tone.Q.value = .4;
        const dly = ctx.createDelay(1); dly.delayTime.value = .36;
        const fb = ctx.createGain(); fb.gain.value = .3;
        const wet = ctx.createGain(); wet.gain.value = .32;
        tone.connect(master); tone.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(wet); wet.connect(master);
        master.connect(ctx.destination);
        return true;
      }catch(e){ ctx = null; return false; }
    }
    function voice(type, freq, t, dur, peak, attack){
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(peak, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(tone);
      o.start(t); o.stop(t + dur + .05);
    }
    function schedule(){
      if(!ctx || ctx.state !== "running") return;
      const game = mode === "game", spb = game ? 60/92/2 : 60/68/2;
      if(nextT < ctx.currentTime) nextT = ctx.currentTime + .05;
      while(nextT < ctx.currentTime + .4){
        const i = step % 8, ch = CH[Math.floor(step / 8) % CH.length];
        if(i === 0){
          const len = spb * 8;
          ch.forEach(m => voice("triangle", hz(m), nextT, len * 1.05, .05, len * .35));
          voice("sine", hz(ch[0] - 12), nextT, len * .9, .09, .05);
        }
        const a = ARP[game ? "game" : "lobby"][i];
        if(a >= 0) voice("sine", hz(ch[a] + 12), nextT, spb * 3.2, game ? .06 : .05, .012);
        nextT += spb; step++;
      }
    }
    function start(){
      if(!ctx && !build()) return;
      if(ctx.state === "suspended") ctx.resume();
      if(!timer){ nextT = ctx.currentTime + .1; timer = setInterval(schedule, 100); }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(muted ? 0 : VOL, ctx.currentTime, .6);
    }
    function setMuted(v){
      muted = v;
      try{ localStorage.setItem("kyjMusic", v ? "off" : "on"); }catch(e){}
      if(v){
        if(ctx){
          master.gain.cancelScheduledValues(ctx.currentTime);
          master.gain.setTargetAtTime(0, ctx.currentTime, .15);
          setTimeout(()=>{ if(muted && ctx && ctx.state === "running") ctx.suspend(); }, 700);
        }
      }else start();
    }
    function setMode(m){
      if(m === mode) return;
      mode = m;
      if(tone && ctx) tone.frequency.setTargetAtTime(m === "game" ? 2300 : 1500, ctx.currentTime, .8);
    }
    // browsers only allow sound after a tap/keypress, so start on the first one
    const EVTS = ["pointerup","touchend","click","keydown"];
    function arm(e){
      if(e && e.target && e.target.closest && e.target.closest("#musicButton")) return;
      if(muted) return;
      start();
      setTimeout(()=>{ if(ctx && ctx.state === "running") EVTS.forEach(n=>document.removeEventListener(n, arm, true)); }, 300);
    }
    EVTS.forEach(n=>document.addEventListener(n, arm, true));
    document.addEventListener("visibilitychange", ()=>{
      if(!ctx) return;
      if(document.hidden) ctx.suspend();
      else if(!muted) ctx.resume();
    });
    return { toggle(){ setMuted(!muted); }, isMuted(){ return muted; }, setMode:setMode };
  })();


  function setAuthMessage(message, isError=true){
    const el = $("authMessage");
    if(!el) return;
    el.textContent = message || "";
    el.classList.toggle("success", !isError && !!message);
  }

  function showAuthView(view){
    ["authLoginView","authRegisterView","authNameView"].forEach(id=>{
      const el = $(id);
      if(el) el.classList.toggle("hidden", id !== view);
    });
    setAuthMessage("");
  }

  function friendlyAuthError(e){
    const code = e && e.code ? e.code : "";
    const map = {
      "auth/invalid-email":"รูปแบบอีเมลไม่ถูกต้อง",
      "auth/user-not-found":"ไม่พบบัญชีนี้",
      "auth/wrong-password":"อีเมลหรือรหัสผ่านไม่ถูกต้อง",
      "auth/invalid-credential":"อีเมลหรือรหัสผ่านไม่ถูกต้อง",
      "auth/email-already-in-use":"อีเมลนี้มีบัญชีอยู่แล้ว",
      "auth/weak-password":"รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
      "auth/too-many-requests":"ลองใหม่อีกครั้งภายหลัง",
      "auth/popup-blocked":"เบราว์เซอร์บล็อกหน้าต่างเข้าสู่ระบบ ลองอีกครั้ง",
      "auth/network-request-failed":"เชื่อมต่ออินเทอร์เน็ตไม่สำเร็จ",
      "auth/operation-not-allowed":"ยังไม่ได้เปิดวิธีล็อคอินนี้ใน Firebase Console (Authentication > Sign-in method)",
      "auth/unauthorized-domain":"โดเมนนี้ยังไม่ได้เพิ่มใน Firebase (Authentication > Settings > Authorized domains)",
      "auth/invalid-api-key":"apiKey ใน firebaseConfig ไม่ถูกต้อง",
      "auth/api-key-not-valid.-please-pass-a-valid-api-key.":"apiKey ใน firebaseConfig ไม่ถูกต้อง",
      "auth/popup-closed-by-user":"ปิดหน้าต่างล็อคอินก่อนเสร็จ",
      "auth/cancelled-popup-request":"ยกเลิกการล็อคอิน ลองใหม่อีกครั้ง",
      "auth/operation-not-supported-in-this-environment":"เปิดเว็บแบบนี้ไม่รองรับ ต้องเปิดผ่าน http(s) ไม่ใช่ file://"
    };
    const text = map[code] || (e && e.message ? e.message.replace("Firebase: ", "") : "เกิดข้อผิดพลาด");
    console.error("Auth error:", code, e);
    return code ? text + " [" + code + "]" : text;
  }

  async function saveUserProfile(user, name){
    if(!user) return;
    const clean = (name || user.displayName || "").trim().slice(0,20);
    if(!clean) return;
    playerId = user.uid;
    playerName = clean;
    localStorage.setItem("kyjPlayerId", playerId);
    localStorage.setItem("kyjPlayerName", playerName);
    try{
      await db.ref("users/" + user.uid).update({
        name: playerName,
        email: user.email || "",
        photoURL: user.photoURL || "",
        updatedAt: firebase.database.ServerValue.TIMESTAMP
      });
    }catch(e){ console.error("Profile save error",e); }
  }

  async function finishAuthProfile(user){
    currentUser = user;
    if(!user) return;
    playerId = user.uid;
    localStorage.setItem("kyjPlayerId", playerId);
    let savedName = localStorage.getItem("kyjPlayerName") || user.displayName || "";
    try{
      const snap = await db.ref("users/" + user.uid).once("value");
      const data = snap.val() || {};
      savedName = (data.name || savedName || "").trim().slice(0,20);
      if(data.tyChar) localStorage.setItem("kyjTyChar", JSON.stringify(data.tyChar));
    }catch(e){ console.error(e); }
    if(savedName){
      await saveUserProfile(user, savedName);
      ensurePublicProfile();
      watchFriends();
      const gate = $("authGate");
      if(gate) gate.classList.add("hidden");
      updateSavedName();
      restoreSavedRoom();
    }else{
      $("authNameInput").value = "";
      showAuthView("authNameView");
    }
  }

  async function emailLogin(){
    const email = $("loginEmail").value.trim();
    const password = $("loginPassword").value;
    if(!email || !password) return setAuthMessage("กรุณากรอกอีเมลและรหัสผ่าน");
    try{
      setAuthMessage("กำลังเข้าสู่ระบบ...", false);
      await auth.signInWithEmailAndPassword(email,password);
    }catch(e){ setAuthMessage(friendlyAuthError(e)); }
  }

  async function emailRegister(){
    const name = $("registerName").value.trim().slice(0,20);
    const email = $("registerEmail").value.trim();
    const password = $("registerPassword").value;
    if(!name) return setAuthMessage("กรุณาใส่ PLAYER NAME");
    if(!email || !password) return setAuthMessage("กรุณากรอกอีเมลและรหัสผ่าน");
    if(password.length < 6) return setAuthMessage("รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
    registering = true;
    try{
      setAuthMessage("กำลังสร้างบัญชี...", false);
      const cred = await auth.createUserWithEmailAndPassword(email,password);
      try{ await cred.user.updateProfile({displayName:name}); }catch(e){ console.error(e); }
      await saveUserProfile(cred.user,name);
      const gate = $("authGate");
      if(gate) gate.classList.add("hidden");
      currentUser = cred.user;
      updateSavedName();
      restoreSavedRoom();
    }catch(e){ setAuthMessage(friendlyAuthError(e)); }
    finally{ registering = false; }
  }

  async function googleLogin(){
    try{
      setAuthMessage("กำลังเปิด Google Login...", false);
      const provider = new firebase.auth.GoogleAuthProvider();
      try{
        await auth.signInWithPopup(provider);
      }catch(e){
        const c = e && e.code;
        if(c === "auth/popup-blocked" || c === "auth/operation-not-supported-in-this-environment"){
          await auth.signInWithRedirect(provider);
        }else{
          throw e;
        }
      }
    }catch(e){ setAuthMessage(friendlyAuthError(e)); }
  }

  async function saveAuthName(){
    const name = $("authNameInput").value.trim().slice(0,20);
    if(!name) return setAuthMessage("กรุณาใส่ชื่อผู้เล่น");
    try{
      await currentUser.updateProfile({displayName:name});
      await saveUserProfile(currentUser,name);
      $("authGate").classList.add("hidden");
      updateSavedName();
      restoreSavedRoom();
    }catch(e){ setAuthMessage(friendlyAuthError(e)); }
  }

  function restoreSavedRoom(){
    if(typeof tyRestore === "function") tyRestore();
    if(!authReady || !currentUser || !roomCode || !firebaseReady) return;
    setTimeout(()=>{
      db.ref("rooms/" + roomCode).once("value").then(snap=>{
        if(snap.exists() && snap.val().players && snap.val().players[playerId]){
          isHost = snap.val().hostId === playerId;
          openLobby();
          listenToRoom();
        }else{
          localStorage.removeItem("kyjRoom");
          roomCode = "";
        }
      }).catch(()=>{});
    },300);
  }

  function setupAuth(){
    if(location.protocol === "file:"){
      setAuthMessage("เปิดไฟล์ตรงๆ (file://) ล็อคอินไม่ได้ ให้เปิดผ่าน Live Server หรืออัปขึ้นโฮสต์");
    }
    if(!auth){
      const msg = "โหลด Firebase ไม่สำเร็จ (เช็คอินเทอร์เน็ต หรือดู Console)";
      ["googleLoginButton","emailLoginButton","emailRegisterButton"].forEach(id=>{
        const b = $(id); if(b) b.addEventListener("click",()=>setAuthMessage(msg));
      });
      $("showRegisterButton").addEventListener("click",()=>showAuthView("authRegisterView"));
      $("showLoginButton").addEventListener("click",()=>showAuthView("authLoginView"));
      setAuthMessage(msg);
      return;
    }
    $("googleLoginButton").addEventListener("click",googleLogin);
    $("emailLoginButton").addEventListener("click",emailLogin);
    $("emailRegisterButton").addEventListener("click",emailRegister);
    $("showRegisterButton").addEventListener("click",()=>showAuthView("authRegisterView"));
    $("showLoginButton").addEventListener("click",()=>showAuthView("authLoginView"));
    $("saveAuthNameButton").addEventListener("click",saveAuthName);
    auth.getRedirectResult().catch(e=>setAuthMessage(friendlyAuthError(e)));
    auth.onAuthStateChanged(async user=>{
      currentUser = user;
      if(registering) return;
      if(!user){
        authReady = true;
        unwatchFriends(); myPid = "";
        $("authGate").classList.remove("hidden");
        showAuthView("authLoginView");
        return;
      }
      authReady = true;
      await finishAuthProfile(user);
    });
  }

  function getPlayerName(){
    return (playerName || "").trim().slice(0,20);
  }

  function syncPlayerNameFromInput(){
    const input = $("playerNameInput");
    if (!input) return false;
    const name = input.value.trim().slice(0,20);
    if (!name) {
      input.focus();
      alert("กรุณาใส่ชื่อผู้เล่นก่อน");
      return false;
    }
    playerName = name;
    localStorage.setItem("kyjPlayerName", playerName);
    updateSavedName();
    persistPlayerName(name);
    return true;
  }

  /* บันทึกชื่อขึ้นบัญชี (Firebase) ด้วย เพื่อให้ล็อกอินครั้งหน้าชื่อยังเป็นชื่อล่าสุด */
  function persistPlayerName(name){
    if(!currentUser || !name) return;
    try{ currentUser.updateProfile({displayName:name}).catch(()=>{}); }catch(e){}
    syncPublicName(name);
    try{
      db.ref("users/" + currentUser.uid).update({
        name:name,
        updatedAt:firebase.database.ServerValue.TIMESTAMP
      }).catch(e=>console.error("Name save error",e));
    }catch(e){ console.error(e); }
  }

  function updateSavedName(){
    const input = $("playerNameInput");
    const saved = $("savedNameText");
    if (input && playerName && !input.value) input.value = playerName;
    if (saved) saved.textContent = playerName ? "ชื่อที่บันทึก: " + playerName : "";
  }

  function showPage(name){
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const page = $("page-" + name);
    if (page) page.classList.add("active");
    $("mobileMenu").classList.remove("open");
    window.scrollTo({top:0,behavior:"smooth"});
    if(name === "leaderboard") loadLeaderboard();
    if(name === "profile") loadProfile();
    if(name === "friends") loadFriends();
  }

  if ($("playerNameInput")) {
    $("playerNameInput").value = playerName;
    $("playerNameInput").addEventListener("input", () => {
      if ($("savedNameText")) $("savedNameText").textContent = "";
    });
  }
  if ($("savePlayerNameButton")) {
    $("savePlayerNameButton").addEventListener("click", () => {
      if (syncPlayerNameFromInput()) {
        $("savePlayerNameButton").textContent = "SAVED";
        setTimeout(() => $("savePlayerNameButton").textContent = "SAVE", 1000);
      }
    });
  }
  /* เซฟชื่ออัตโนมัติเมื่อพิมพ์เสร็จ (ออกจากช่อง) ไม่ต้องกด SAVE ทุกครั้ง */
  if ($("playerNameInput")) {
    $("playerNameInput").addEventListener("change", () => {
      const n = $("playerNameInput").value.trim().slice(0,20);
      if (!n) return;
      playerName = n;
      localStorage.setItem("kyjPlayerName", n);
      updateSavedName();
      persistPlayerName(n);
    });
  }
  updateSavedName();

  document.querySelectorAll("[data-page]").forEach(btn => {
    btn.addEventListener("click", () => showPage(btn.dataset.page));
  });
  $("brandButton").addEventListener("click", () => showPage("home"));
  $("menuButton").addEventListener("click", () => $("mobileMenu").classList.toggle("open"));
  $("heroPlayButton").addEventListener("click", () => showPage("arena"));
  $("heroHowButton").addEventListener("click", () => {
    showPage("arena");
    setTimeout(() => $("roomPanel").scrollIntoView({behavior:"smooth",block:"center"}),150);
  });

  function randomRoomCode(){
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for(let i=0;i<6;i++) out += chars[Math.floor(Math.random()*chars.length)];
    return out;
  }

  const T_DEFAULT_PLAYLIST = ["memory","odd","number","puzzle","mind"];
  const isTournament = d => !!(d && d.mode === "tournament");
  /* Host can be a "game master" who only controls the room (hostPlays === false) */
  const hostSpectates = d => !!(d && d.hostPlays === false);
  function activePlayers(d){
    const all = (d && d.players) || {}, out = {};
    Object.keys(all).forEach(id=>{ if(!(hostSpectates(d) && id === d.hostId)) out[id] = all[id]; });
    return out;
  }
  const amSpectator = () => !!(currentRoomData && hostSpectates(currentRoomData) && currentRoomData.hostId === playerId);
  async function createRoom(mode){
    const tournament = mode === "tournament";
    if (!currentUser) return showAuthView("authLoginView");
    playerId = currentUser.uid;
    if (!firebaseReady) return alert("Firebase ยังไม่พร้อม ลองรีเฟรชหน้าเว็บอีกครั้ง");
    if (!syncPlayerNameFromInput()) return;
    const button = $(tournament ? "createTournamentButton" : "createRoomButton");
    button.disabled = true;
    button.textContent = "CREATING...";
    try {
      let code = randomRoomCode();
      let snap = await db.ref("rooms/" + code).once("value");
      while(snap.exists()){
        code = randomRoomCode();
        snap = await db.ref("rooms/" + code).once("value");
      }
      const now = firebase.database.ServerValue.TIMESTAMP;
      const data = {
        hostId: playerId,
        status: "waiting",
        game: tournament ? T_DEFAULT_PLAYLIST[0] : "memory",
        playlist: tournament ? T_DEFAULT_PLAYLIST.slice() : ["memory"],
        mode: tournament ? "tournament" : "normal",
        hostPlays: true,
        round: 0,
        createdAt: now,
        players: {}
      };
      data.players[playerId] = {name:getPlayerName(), ready:false, joinedAt:now};
      await db.ref("rooms/" + code).set(data);
      roomCode = code;
      isHost = true;
      localStorage.setItem("kyjRoom", roomCode);
      openLobby();
      listenToRoom();
    } catch(e) {
      console.error(e);
      alert("สร้างห้องไม่สำเร็จ: " + e.message);
    } finally {
      button.disabled = false;
      button.textContent = tournament ? "CREATE TOURNAMENT" : "CREATE ROOM";
    }
  }

  async function joinRoom(){
    if (!currentUser) return showAuthView("authLoginView");
    playerId = currentUser.uid;
    if (!firebaseReady) return alert("Firebase ยังไม่พร้อม ลองรีเฟรชหน้าเว็บอีกครั้ง");
    if (!syncPlayerNameFromInput()) return;
    const code = $("roomCodeInput").value.trim().toUpperCase();
    if(code.length !== 6) return alert("กรุณาใส่รหัสห้อง 6 ตัว");
    try{
      const ref = db.ref("rooms/" + code);
      const snap = await ref.once("value");
      if(!snap.exists()) return alert("ไม่พบห้องนี้");
      const data = snap.val();
      if(data.status !== "waiting") return alert("ห้องนี้เริ่มเกมไปแล้ว");
      const players = data.players || {};
      if(Object.keys(players).length >= 50) return alert("ห้องเต็มแล้ว");
      await ref.child("players/" + playerId).set({
        name:getPlayerName(),ready:false,joinedAt:firebase.database.ServerValue.TIMESTAMP
      });
      roomCode = code;
      isHost = false;
      localStorage.setItem("kyjRoom",roomCode);
      openLobby();
      listenToRoom();
    }catch(e){
      console.error(e);
      alert("เข้าห้องไม่สำเร็จ: " + e.message);
    }
  }

  function openLobby(){
    $("roomPanel").classList.add("hidden");
    document.querySelector(".arena-stats").classList.add("hidden");
    document.querySelector(".section-title.compact").classList.add("hidden");
    document.querySelector(".game-grid").classList.add("hidden");
    $("lobbyScreen").classList.remove("hidden");
    $("roomCodeDisplay").textContent = roomCode || "------";
    $("hostStartButton").style.display = isHost ? "block" : "none";
  }

  function listenToRoom(){
    if(!firebaseReady || !roomCode) return;
    if(roomListener) roomListener.off();
    roomListener = db.ref("rooms/" + roomCode);
    roomListener.on("value", snap => {
      if(!snap.exists()){
        clearRoomState();
        return;
      }
      currentRoomData = snap.val();
      isHost = currentRoomData.hostId === playerId;
      $("hostStartButton").style.display = isHost ? "block" : "none";
      renderLobby(currentRoomData);
      const st = currentRoomData.status;
      if(st === "starting"){
        if(lastStartAt !== (currentRoomData.startAt || 0)){
          lastStartAt = currentRoomData.startAt || 0;
          memoryDone = false;
          showGameScreen();
          startSyncedCountdown(lastStartAt);
        }
      } else if(st === "waiting" && lastStartAt !== null){
        lastStartAt = null;
        returnToLobby();
      }
      renderRoomResults(currentRoomData);
    });
  }

  function renderLobby(data){
    const players = data.players || {};
    const list = $("playerList");
    list.innerHTML = "";
    const entries = Object.entries(players);
    entries.forEach(([id,p])=>{
      const div = document.createElement("div");
      div.className = "lobby-player";
      div.dataset.fa = "view"; div.dataset.uid = id;
      const spec = hostSpectates(data) && id === data.hostId;
      const name = document.createElement("span");
      name.textContent = (p.name || "PLAYER") + (id === data.hostId ? (spec ? " 👑 HOST" : " 👑") : "");
      const status = document.createElement("span");
      status.className = spec ? "ready" : (p.ready ? "ready" : "waiting");
      status.textContent = spec ? "ผู้คุมห้อง" : (p.ready ? "READY" : "WAITING");
      div.append(name,status);
      list.appendChild(div);
    });
    const tBadge = $("tournamentBadge");
    if(tBadge){
      const tp = data.playlist || [];
      tBadge.classList.toggle("hidden", !isTournament(data));
      tBadge.textContent = "🏆 TOURNAMENT • " + tp.length + " ROUNDS • MAX " + tp.reduce((s,id)=>s + (MAXES[id] || 0), 0);
    }
    const act = Object.keys(activePlayers(data)).length;
    const hostRow = $("hostOptRow"), hostChk = $("hostPlaysToggle");
    if(hostRow){
      hostRow.classList.toggle("hidden", !(isHost && data.status === "waiting"));
      hostChk.checked = !hostSpectates(data);
    }
    $("readyButton").style.display = (hostSpectates(data) && data.hostId === playerId) ? "none" : "";
    $("lobbyStatus").textContent =
      act < 2 ? (hostSpectates(data) ? "ต้องมีผู้เล่น (ไม่นับ Host) อย่างน้อย 2 คนเพื่อเริ่มเกม" : "ต้องมีอย่างน้อย 2 คนเพื่อเริ่มเกม") :
      data.status === "waiting" ? "ผู้เล่นทุกคนต้อง READY ก่อนเริ่ม" :
      "เกมกำลังเริ่ม...";
    const me = players[playerId];
    $("readyButton").textContent = me && me.ready ? "UNREADY" : "READY";
    renderGamePicker(data);
  }

  const GAMES = [
    {id:"memory", name:"MEMORY MATCH", icon:"🃏", ready:true},
    {id:"odd", name:"ODD ONE OUT", icon:"🧠", ready:true, time:"40 SEC", max:150, desc:"มี 4 คำ กดคำที่ไม่เข้าพวก ตอบถูกเร็วได้คะแนนเยอะ"},
    {id:"number", name:"NUMBER HUNT", icon:"🔢", ready:true},
    {id:"puzzle", name:"PUZZLE RACE", icon:"🧩", ready:true},
    {id:"mind", name:"MIND MELD", icon:"🧠", ready:true, room:true, time:"4 ROUNDS", max:150, desc:"ทุกคนพิมพ์คำตอบ 1 คำพร้อมกันภายใน 15 วิ ยิ่งตรงกับเพื่อนยิ่งได้คะแนน ตอบไม่ตรงใครได้ 0"},
    {id:"emoji", name:"EMOJI RIDDLE", icon:"😎", ready:true, time:"45 SEC", max:150, desc:"ทายคำจากอีโมจิ ตอบจากตัวเลือก 4 ข้อ ตื่นเต้นและมีเสียงฮากันในวง"},
    {id:"scramble", name:"WORD SCRAMBLE", icon:"🔠", ready:true, time:"45 SEC", max:150, desc:"เรียงตัวอักษรไทยที่สลับไว้ให้เป็นคำที่ถูกต้อง"},
    {id:"spy", name:"WORD SPY", icon:"🕵️", ready:true, room:true, time:"VOTE", max:100, desc:"ทุกคนได้คำลับเดียวกัน ยกเว้นสายลับ 1 คนที่ได้คำใกล้เคียง ผลัดกันใบ้ แล้วโหวตจับสายลับ (แนะนำ 3 คนขึ้นไป)"},
    {id:"chain", name:"WORD CHAIN", icon:"🔗", ready:true, room:true, time:"3 ROUNDS", max:150, desc:"ผลัดกันตอบคำตามหมวด ห้ามซ้ำ ห้ามหมดเวลา มี 2 ชีวิต คนสุดท้ายที่รอดชนะ"},
    {id:"simon", name:"SIMON SURVIVAL", icon:"🎨", ready:true, room:true, time:"SURVIVE", max:150, desc:"ปุ่มสีกระพริบเป็นลำดับ ทุกคนต้องกดตามให้ถูก ลำดับยาวขึ้นทุกรอบ ใครพลาดตกรอบ คนรอดคนสุดท้ายได้คะแนนเต็ม คนอื่นลดหลั่นตามอันดับ"},
    {id:"find", name:"FIND IT", icon:"🔎", ready:true, time:"5 PICS", max:150, desc:"หาจุดที่ต่างกันระหว่าง 2 ภาพ ภาพละ 5 จุด มีเวลา 20 วินาทีต่อภาพ เล่นทั้งหมด 5 ภาพ"},
    {id:"code", name:"CODE BREAKER", icon:"🔐", ready:true, time:"60 SEC", max:100, desc:"แกะรหัสลับ 4 หลักให้ได้ภายใน 8 ครั้ง ใบ้ด้วย 🟢🟡"}
  ];
  function gameInfo(id){ return GAMES.find(g=>g.id === id) || GAMES[0]; }
  const GAME_SYM = {memory:"i-memory",odd:"i-odd",number:"i-num",puzzle:"i-puzzle",mind:"i-mind",emoji:"i-emoji",scramble:"i-scramble",spy:"i-spy",chain:"i-chain",simon:"i-simon",find:"i-find",code:"i-code"};
  function gameIconSvg(id){ return '<svg class="ico" viewBox="0 0 48 48" aria-hidden="true"><use href="#' + (GAME_SYM[id] || "i-flag") + '"/></svg>'; }

  function renderGamePicker(data){
    const box = $("pickerOptions");
    if(!box) return;
    const pl = data.playlist || [gameInfo(data.game).id];
    const canPick = isHost && data.status === "waiting";
    box.innerHTML = "";
    GAMES.forEach(g=>{
      const i = pl.indexOf(g.id);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick" + (i >= 0 ? " selected" : "") + (g.ready ? "" : " locked");
      b.disabled = !g.ready || !canPick;
      const icon = document.createElement("span"); icon.innerHTML = gameIconSvg(g.id);
      const name = document.createElement("b"); name.textContent = g.name;
      const tag = document.createElement("small");
      tag.textContent = g.ready ? (i >= 0 ? "#" + (i+1) : "") : "SOON";
      b.append(icon, name, tag);
      b.addEventListener("click", ()=>selectGame(g.id));
      box.appendChild(b);
    });
    $("pickerHint").textContent = isHost
      ? (isTournament(data) ? "ทัวร์นาเมนต์: เลือกเกมเป็นรอบ เล่นตามลำดับที่แตะ ต้องมีอย่างน้อย 2 รอบ (" + pl.length + " รอบ)" : "แตะเลือกได้หลายเกม เล่นตามลำดับที่แตะ (" + pl.length + " เกม)")
      : "Host เลือกไว้: " + pl.map(id=>gameInfo(id).name).join(" → ");
  }

  async function selectGame(id){
    if(!isHost || !roomCode || !currentRoomData || !gameInfo(id).ready) return;
    const pl = (currentRoomData.playlist || [gameInfo(currentRoomData.game).id]).slice();
    const i = pl.indexOf(id);
    if(i >= 0){ if(pl.length > 1) pl.splice(i,1); } else pl.push(id);
    try{ await db.ref("rooms/" + roomCode).update({playlist:pl, game:pl[0]}); }
    catch(e){ console.error(e); alert("เลือกเกมไม่สำเร็จ"); }
  }

  async function nextGame(){
    if(!isHost || !currentRoomData) return;
    const pl = currentRoomData.playlist || [], r = (currentRoomData.round || 0) + 1;
    if(r >= pl.length) return;
    try{ await db.ref("rooms/" + roomCode).update({status:"starting", startAt:Date.now()+3000, round:r, game:pl[r]}); }
    catch(e){ console.error(e); }
  }

  function startGameById(id){
    ({memory:startMemoryGame, odd:gOdd, number:gNumber, puzzle:gPuzzle, mind:gMindMeld, emoji:gEmoji, scramble:gScramble, simon:gSimon, spy:gWordSpy, chain:gWordChain, find:gFind, code:gCode}[id] || startMemoryGame)();
  }
  function startSelectedGame(){
    if(amSpectator()) return spectateRound();
    startGameById(gameInfo(currentRoomData && currentRoomData.game).id);
  }
  function spectateRound(){
    stopGame();
    memoryDone = true;
    const g = gameInfo(currentRoomData && currentRoomData.game);
    const title = $("gameScreen").querySelector("h2"), desc = $("gameScreen").querySelector("p");
    title.textContent = g.name;
    desc.textContent = "👑 คุณเป็นผู้คุมห้อง ไม่ได้เล่น — ดูคะแนนผู้เล่นด้านล่าง";
    $("startMemoryRoundButton").style.display = "none";
    renderRoomResults(currentRoomData);
  }

  /* ===== generic game engine (Aim / Number / Puzzle) ===== */
  let gPlaying = false, gScore = 0, gTime = 0, gTimers = [], gId = "", gHooks = [];
  function stopGame(){
    clearInterval(memoryTimer); memoryTimer = null;
    gTimers.forEach(t=>{ clearInterval(t); clearTimeout(t); });
    gTimers = []; gPlaying = false;
    gHooks.forEach(f=>f()); gHooks = [];
  }
  function addTimer(t){ gTimers.push(t); return t; }
  function setGScore(v){
    gScore = v;
    const el = $("playScore");
    el.textContent = v; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }
  function floatText(area, el, txt, color){
    const a = area.getBoundingClientRect(), r = el.getBoundingClientRect();
    const f = document.createElement("span");
    f.className = "ftxt"; f.textContent = txt;
    f.style.left = (r.left - a.left + r.width/2) + "px"; f.style.top = (r.top - a.top) + "px"; f.style.color = color;
    area.appendChild(f); setTimeout(()=>f.remove(), 650);
  }
  const rl = ()=>"ROUND " + (((currentRoomData && currentRoomData.round) || 0) + 1);
  function finishSelf(sc, msg){
    if(!gPlaying) return;
    setGScore(sc); gPlaying = false;
    $("playMessage").textContent = msg + " คะแนน " + sc;
    memoryDone = true; saveScores(gId, sc); renderRoomResults(currentRoomData);
  }
  function setGExtra(v){ $("playExtra").textContent = v; }
  function beginPlay(id, title, round, secs, extraLabel){
    stopGame();
    memoryPlaying = false; memoryDone = false; gPlaying = true; gTime = secs; gId = id;
    renderRoomResults(currentRoomData);
    $("gameScreen").classList.add("hidden");
    $("memoryGameScreen").classList.add("hidden");
    $("playGameScreen").classList.remove("hidden");
    $("playRound").textContent = round;
    $("playTitle").textContent = title;
    $("playExtraLabel").textContent = extraLabel;
    setGScore(0); setGExtra(0);
    $("playTime").textContent = secs;
    $("playMessage").textContent = "";
    const area = $("playArea");
    area.innerHTML = ""; area.className = "play-area"; area.style.height = "";
    $("playGameScreen").scrollIntoView({behavior:"smooth", block:"start"});
    if(secs > 0) addTimer(setInterval(()=>{
      gTime--; $("playTime").textContent = Math.max(0, gTime);
      if(gTime <= 0) endGame(id, "⏰ หมดเวลา!");
    }, 1000));
    return area;
  }
  function endGame(id, msg){
    if(!gPlaying) return;
    const sc = gScore;
    stopGame();
    $("playArea").classList.add("over");
    $("playMessage").textContent = msg + " คะแนน " + sc;
    memoryDone = true;
    saveScores(id, sc);
    renderRoomResults(currentRoomData);
  }
  const shuffle = arr => arr.sort(()=>Math.random() - 0.5);
  const tapOn = (el, fn) => el.addEventListener("pointerdown", e=>{ e.preventDefault(); if(gPlaying) fn(); });

  function gNumber(){
    const area = beginPlay("number","NUMBER HUNT","ROUND 3",45,"FOUND");
    let found = 0;
    const round = ()=>{
      const pool = shuffle(Array.from({length:99}, (_,i)=>i+1)).slice(0,25);
      const target = pool[Math.floor(Math.random()*25)];
      area.innerHTML = '<div class="q-box"><small>FIND NUMBER</small><h3>' + target + '</h3></div><div class="num-grid"></div>';
      const grid = area.querySelector(".num-grid");
      pool.forEach(n=>{
        const b = document.createElement("button");
        b.type = "button"; b.className = "num-cell"; b.textContent = n;
        tapOn(b, ()=>{
          if(n === target){ found++; setGExtra(found); setGScore(Math.min(150, gScore+10)); round(); }
          else { b.classList.add("bad"); setGScore(Math.max(0, gScore-5)); }
        });
        grid.appendChild(b);
      });
    };
    round();
  }

  function gPuzzle(){
    const area = beginPlay("puzzle","PUZZLE RACE","ROUND 4",60,"SOLVED");
    let solved = 0;
    const next = ()=>{
      const op = ["+","-","×"][Math.floor(Math.random()*3)], m = op === "×" ? 11 : 40;
      let a = Math.floor(Math.random()*m) + 2, b = Math.floor(Math.random()*m) + 2;
      if(op === "-" && b > a) [a,b] = [b,a];
      const ans = op === "+" ? a+b : op === "-" ? a-b : a*b;
      const opts = new Set([ans]);
      while(opts.size < 4){ const d = Math.floor(Math.random()*9) - 4; if(d) opts.add(Math.max(0, ans+d)); }
      area.innerHTML = '<div class="q-box"><small>SOLVE</small><h3>' + a + ' ' + op + ' ' + b + ' = ?</h3><div class="opt-grid"></div></div>';
      const g = area.querySelector(".opt-grid");
      shuffle([...opts]).forEach(v=>{
        const b2 = document.createElement("button");
        b2.type = "button"; b2.className = "num-cell opt"; b2.textContent = v;
        tapOn(b2, ()=>{
          if(v === ans){ solved++; setGExtra(solved); setGScore(Math.min(200, gScore+20)); next(); }
          else { b2.classList.add("bad"); setGScore(Math.max(0, gScore-10)); }
        });
        g.appendChild(b2);
      });
    };
    next();
  }


  /* ===== deterministic random (same for every player) ===== */
  function rng(n){
    n = (n|0) + 0x6D2B79F5 | 0;
    let t = Math.imul(n ^ n >>> 15, 1 | n);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
  const hueOf = id=>{ let h = 0; for(const c of id) h = (h*31 + c.charCodeAt(0)) % 360; return h; };

  /* ===== SIMON SURVIVAL =====
     ทุกคนดูลำดับสีชุดเดียวกัน (สุ่มจาก seed ร่วมกัน) แล้วกดตาม ลำดับยาวขึ้นทีละ 1 ทุกรอบ
     กดพลาด/หมดเวลา = ตกรอบ คนสุดท้ายที่รอด = คะแนนเต็ม ที่เหลือลดลงตามอันดับ
     ผู้เล่นแต่ละคนเล่นเอง แล้วส่งผลแต่ละรอบไปที่ rooms/{code}/live/{uid} ทุกเครื่องอ่านผลเดียวกันเพื่อสรุปอันดับ */
  function gSimon(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const MAXR=25, START_LEN=3, MAXSC=150, LEAD=1400, GAP=2600, GRACE=5000;
    const area = beginPlay("simon","SIMON SURVIVAL",rl(),0,"ALIVE");
    const players=activePlayers(currentRoomData), ids=Object.keys(players).sort(), N=ids.length, seed=currentRoomData.startAt||1;
    const nm=id=>((players[id] && players[id].name) || "PLAYER").slice(0,10);
    const seqAt=i=>Math.floor(rng(seed + i*131 + 7)*4);          // ปุ่มที่ i ของลำดับ (ทุกคนได้เหมือนกัน)
    const lenOf=r=>START_LEN + r - 1;                             // รอบ 1 = 3 ปุ่ม แล้ว +1 ทุกรอบ
    const stepOf=r=>Math.max(340, 640 - r*18);                    // ยิ่งรอบสูง ยิ่งกระพริบเร็ว
    const inMs=L=>3500 + L*1000;                                  // เวลากดทั้งรอบ
    const GL=["▲","●","■","◆"], FREQ=[262,330,392,523];
    const el=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };

    /* ----- state ----- */
    const me={res:{}}; let live={}; const dropped={};             // dropped[r][id] = ไม่ตอบ/หลุดจากห้อง นับว่าตกรอบ
    let R=1, phase="pre", t0=Date.now()+2200, idx=0, inEnd=0, gapAt=0;
    let playing=true, failed=false, finished=false, showLit=-1, tapLit=-1, lastScore=-1, dotSig="", chipSig="";
    const ref=db.ref("rooms/" + roomCode + "/live"); ref.child(playerId).remove();
    ref.on("value", sn=>{ live=sn.val()||{}; });
    gHooks.push(()=>{ ref.off(); ref.child(playerId).remove(); try{ if(actx) actx.close(); }catch(_){} });
    const pub=()=>ref.child(playerId).set({s:seed, res:me.res});
    const rec=id=>id===playerId ? me : (live[id] && live[id].s===seed ? live[id] : {res:{}});
    const resOf=id=>rec(id).res || {};

    /* ----- sound (เคารพปุ่มปิดเสียง) ----- */
    let actx=null;
    function beep(freq, ms, type, vol){
      try{
        if(localStorage.getItem("kyjMusic") === "off") return;
        const AC=window.AudioContext || window.webkitAudioContext; if(!AC) return;
        if(!actx) actx=new AC();
        if(actx.state==="suspended") actx.resume();
        const t=actx.currentTime, o=actx.createOscillator(), g=actx.createGain();
        o.type=type||"triangle"; o.frequency.value=freq;
        g.gain.setValueAtTime(0.0001,t); g.gain.linearRampToValueAtTime(vol||.2,t+.02); g.gain.exponentialRampToValueAtTime(0.0001,t+ms/1000);
        o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+ms/1000+.05);
      }catch(_){}
    }

    /* ----- replay: สรุปผลทุกรอบจากข้อมูลที่ทุกคนส่งมา ----- */
    function derive(){
      let alive=ids.slice(); const out={}, fell={}; let over=false, resolved=0, pending=null;
      for(let r=1; r<=MAXR; r++){
        const L=lenOf(r), key="r"+r, drop=dropped[r]||{};
        const miss=alive.filter(id=>resOf(id)[key]==null && !drop[id]);
        if(miss.length){ pending={r:r, ids:miss}; break; }
        const passed=[]; fell[r]=[];
        alive.forEach(id=>{
          const c=drop[id] ? 0 : resOf(id)[key];
          if(c>=L) passed.push(id); else { out[id]={r:r, c:c||0}; fell[r].push(id); }
        });
        resolved=r; alive=passed;
        if(alive.length<=1){ over=true; break; }
      }
      if(!over && resolved>=MAXR) over=true;
      return {alive:alive, out:out, fell:fell, over:over, resolved:resolved, pending:pending};
    }
    /* อันดับ: ตกทีหลังดีกว่า → ถ้าตกรอบเดียวกัน ดูว่ากดถูกกี่ปุ่ม → เท่ากันได้อันดับเดียวกัน */
    function rankOf(d){
      const ent=ids.map(id=>{ const o=d.out[id]; return o ? {id:id,a:o.r,b:o.c} : {id:id,a:1e9,b:1e9}; }), rk={};
      ent.forEach(e=>{ rk[e.id]=1 + ent.filter(x=>x.a>e.a || (x.a===e.a && x.b>e.b)).length; });
      return rk;
    }
    const scoreOf=rank=>Math.round(MAXSC*(N-rank+1)/N);
    const graceAt=()=>{ const L=lenOf(R); return t0 + L*stepOf(R) + inMs(L) + GRACE + (R===1 ? 4000 : 0); };

    /* ----- DOM ----- */
    const box=el("div","sm"), top=el("small"), msg=el("div","sm-msg"), bar=el("div","sm-bar"), barI=el("i"); bar.appendChild(barI);
    const dots=el("div","sm-dots"), pads=el("div","sm-pads lock"), chips=el("div","sm-ps");
    const pb=[0,1,2,3].map(k=>{
      const b=el("button","sm-pad sm-"+k); b.type="button"; b.setAttribute("aria-label","ปุ่ม " + GL[k]);
      b.appendChild(el("span","",GL[k]));
      tapOn(b, ()=>press(k)); pads.appendChild(b); return b;
    });
    box.append(top,msg,bar,dots,pads,chips); area.appendChild(box);

    function flashTap(k){
      tapLit=k; paintPads();
      addTimer(setTimeout(()=>{ if(tapLit===k){ tapLit=-1; paintPads(); } }, 170));
    }
    function paintPads(){ pb.forEach((b,j)=>b.classList.toggle("lit", j===showLit || j===tapLit)); }
    function report(c){ me.res["r"+R]=c; pub(); phase="wait"; }
    function press(k){
      if(!gPlaying || phase!=="input") return;
      const L=lenOf(R);
      flashTap(k);
      if(seqAt(idx)===k){
        beep(FREQ[k],260); idx++;
        if(idx>=L) report(L);
      }else{
        failed=true; beep(110,420,"sawtooth",.16);
        area.classList.remove("shake"); void area.offsetWidth; area.classList.add("shake");
        report(idx);
      }
      update();
    }

    /* ----- main loop ----- */
    function update(){
      if(!gPlaying) return;
      const now=Date.now(), L=lenOf(R), step=stepOf(R);
      let d=derive();
      if(d.pending && d.pending.r===R && now>graceAt()){            // มีคนไม่ส่งผล (หลุด/ปิดหน้าจอ) → นับว่าตกรอบ
        dropped[R]=dropped[R]||{}; d.pending.ids.forEach(id=>{ dropped[R][id]=true; }); d=derive();
      }
      let lit=-1;
      if(phase==="pre" && now>=t0) phase="show";
      if(phase==="show"){
        const e=now-t0, i=Math.floor(e/step);
        if(e>=L*step+150){ if(playing && !failed){ phase="input"; inEnd=now+inMs(L); idx=0; } else phase="wait"; }
        else if(i>=0 && i<L && e-i*step < step*.62) lit=seqAt(i);
      }
      if(lit!==showLit){ showLit=lit; if(lit>=0) beep(FREQ[lit], step*.6); paintPads(); }
      if(phase==="input" && now>=inEnd){ failed=true; beep(110,420,"sawtooth",.16); report(idx); }
      if(phase==="wait" && d.resolved>=R){
        if(d.over) phase="over"; else { phase="gap"; gapAt=now+GAP; }
      }
      if(phase==="gap" && now>=gapAt){
        R++; idx=0; failed=false; playing=!d.out[playerId]; phase="pre"; t0=now+LEAD;
      }

      /* ----- render ----- */
      const L2=lenOf(R), rk=rankOf(d), sc=scoreOf(rk[playerId]);
      top.textContent="ROUND " + R + " • ลำดับ " + L2 + " ปุ่ม" + (R>=MAXR ? " • รอบสุดท้าย" : "");
      pads.classList.toggle("lock", phase!=="input");
      const sig=R+"_"+idx;
      if(sig!==dotSig){
        dotSig=sig; dots.innerHTML="";
        for(let i=0;i<L2;i++) dots.appendChild(el("i", i<idx ? "on" : ""));
      }
      const fellNow=(d.fell[R]||[]).map(nm);
      let text="";
      if(phase==="pre") text = R===1 ? "🎮 เตรียมตัว! ดูลำดับสีให้ดี" : "➡️ รอบ " + R + " กำลังจะเริ่ม";
      else if(phase==="show") text = playing && !failed ? "👀 จำลำดับให้ดี…" : "👀 กำลังดูต่อ (คุณตกรอบแล้ว)";
      else if(phase==="input") text = "👉 กดตามลำดับ! " + idx + "/" + L2;
      else if(phase==="wait") text = failed ? "💀 คุณตกรอบ (กดถูก " + idx + "/" + L2 + ")" : playing ? "✅ ผ่านรอบนี้! รอคนอื่น…" : "👀 คุณตกรอบแล้ว • ดูต่อจนจบ";
      else if(phase==="gap") text = fellNow.length ? "💀 " + fellNow.join(", ") + " ตกรอบ" : "🎉 ทุกคนผ่านรอบนี้!";
      else text = "🏁 จบเกม!";
      msg.textContent=text;
      if(phase==="input"){
        const left=Math.max(0, inEnd-now);
        barI.style.width=(left/inMs(L2)*100) + "%"; bar.classList.toggle("hot", left<3000);
        $("playTime").textContent=Math.ceil(left/1000);
      }else{ barI.style.width="0%"; bar.classList.remove("hot"); $("playTime").textContent="-"; }
      setGExtra(d.alive.length);
      if(sc!==lastScore){ lastScore=sc; setGScore(sc); }
      if(d.resolved>0 && phase!=="over"){
        const f=(d.fell[d.resolved]||[]).map(nm);
        $("playMessage").textContent="รอบ " + d.resolved + ": " + (f.length ? "💀 " + f.join(", ") + " ตกรอบ" : "ทุกคนผ่าน");
      }
      const st=id=>{ if(d.out[id]) return "x"; const v=resOf(id)["r"+R]; return v==null ? "w" : (v>=L2 ? "o" : "x"); };
      const cs=R + ids.map(st).join("");
      if(cs!==chipSig){
        chipSig=cs; chips.innerHTML="";
        ids.forEach(id=>{
          const s=st(id), c=el("span","wc-p" + (s==="x" ? " out" : "") + (s==="o" ? " ok" : "") + (id===playerId ? " me" : ""));
          c.textContent=nm(id) + " " + (s==="x" ? "💀" : s==="o" ? "✅" : "⏳");
          chips.appendChild(c);
        });
      }

      if(phase==="over" && !finished){
        finished=true;
        const myRank=rk[playerId], tied=ids.filter(id=>rk[id]===myRank).length>1;
        const verdict = myRank===1 ? (tied ? "🤝 เสมออันดับ 1!" : "🏆 คุณคือผู้รอดคนสุดท้าย!") : "คุณได้อันดับ " + myRank + " จาก " + N;
        finishSelf(sc, verdict);
      }
    }
    update();
    addTimer(setInterval(update, 40));
  }

  /* ===== FIND IT: spot the difference (pictures are generated from a shared seed) ===== */
  const FD_W = 320, FD_H = 176, FD_PICS = 5, FD_DIFFS = 5, FD_SECS = 20, FD_PTS = 6;
  const FD_THEMES = [
    {bg:["#8fd3ff","#b6f0a2"], pool:["🌳","🌷","🌻","🌼","🐝","🦋","🐞","🍄","🌲","🐇","🐿️","🏡","🌹","🐦"]},
    {bg:["#2b6cb0","#0b2f55"], pool:["🐠","🐟","🐙","🦀","🐚","⭐","🐡","🦑","🐬","🦐","🐢","🦞","🐳","🦈"]},
    {bg:["#ffe8c2","#e7b27a"], pool:["🍎","🍌","🍇","🍕","🍩","🍪","🧁","🍓","🍔","🥐","🍒","🍉","🍊","🥕"]},
    {bg:["#2d1b69","#0a0820"], pool:["🪐","🌙","⭐","🚀","🛸","👽","☄️","🌍","🛰️","🌟","🌞","🔭","🌠","💫"]},
    {bg:["#cfd8e3","#8d9bb0"], pool:["🚗","🚕","🚌","🏠","🏢","🌳","🚦","🚲","🛵","🚑","🚒","🏪","⛽","🚓"]},
    {bg:["#ffd6e8","#ffb3d1"], pool:["🧸","🚂","⚽","🎈","🏀","🎨","🎯","🎲","🧩","🎁","🎸","🎺","🥁","🎮"]}
  ];
  const fdSort = (arr, seed, k)=>arr.map((v,i)=>[rng(seed + i*k + 5), v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
  function fdBuild(seed, th, gid){
    const COLS = 4, ROWS = 3, CW = FD_W/COLS, CH = FD_H/ROWS, SZ = 30, cells = [];
    for(let r = 0; r < ROWS; r++) for(let c = 0; c < COLS; c++){
      cells.push({x:c*CW + CW/2 + (rng(seed + r*9 + c*31 + 1) - .5)*14, y:r*CH + CH/2 + 2 + (rng(seed + r*13 + c*7 + 2) - .5)*10});
    }
    const order = fdSort(cells.map((_,i)=>i), seed, 53), empty = order.slice(0,2), used = order.slice(2);
    const pool = fdSort(th.pool, seed, 71), spare = pool.slice(10), base = {};
    used.forEach((ci,k)=>{ base[ci] = {e:pool[k], s:1, r:0, dx:0, dy:0}; });
    const A = JSON.parse(JSON.stringify(base)), B = JSON.parse(JSON.stringify(base)), diffs = [];
    const types = fdSort(["remove","swap","grow","shrink","rotate","add","shift"], seed, 37).slice(0, FD_DIFFS);
    let ui = 0;
    types.forEach((t,k)=>{
      if(t === "add"){
        const ci = empty[0]; B[ci] = {e:spare[0], s:1, r:0, dx:0, dy:0};
        diffs.push({pts:[[cells[ci].x, cells[ci].y]]}); return;
      }
      const ci = used[ui++], c = cells[ci], it = B[ci], pts = [[c.x, c.y]];
      if(t === "remove") delete B[ci];
      else if(t === "swap") it.e = spare[1 + (k % 3)];
      else if(t === "grow") it.s = 1.55;
      else if(t === "shrink") it.s = .6;
      else if(t === "rotate") it.r = rng(seed + k) < .5 ? 40 : -40;
      else if(t === "shift"){ it.dx = rng(seed + k*3) < .5 ? 20 : -20; it.dy = rng(seed + k*5) < .5 ? 9 : -9; pts.push([c.x + it.dx, c.y + it.dy]); }
      diffs.push({pts:pts});
    });
    const draw = (map, id)=>{
      let h = '<svg class="fd-pic" viewBox="0 0 ' + FD_W + ' ' + FD_H + '" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +
        '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + th.bg[0] + '"/><stop offset="1" stop-color="' + th.bg[1] + '"/></linearGradient></defs>' +
        '<rect width="' + FD_W + '" height="' + FD_H + '" fill="url(#' + id + ')"/>';
      for(let i = 0; i < 4; i++) h += '<circle cx="' + (rng(seed + i*11 + 40)*FD_W).toFixed(0) + '" cy="' + (rng(seed + i*13 + 41)*FD_H).toFixed(0) + '" r="' + (18 + rng(seed + i*17 + 42)*26).toFixed(0) + '" fill="#fff" opacity=".10"/>';
      Object.keys(map).forEach(ci=>{
        const it = map[ci], c = cells[ci];
        h += '<text transform="translate(' + (c.x + it.dx).toFixed(1) + ' ' + (c.y + it.dy).toFixed(1) + ') rotate(' + it.r + ') scale(' + it.s + ')" dy=".35em" font-size="' + SZ + '" text-anchor="middle" font-family="\'Apple Color Emoji\',\'Segoe UI Emoji\',\'Noto Color Emoji\',sans-serif">' + it.e + '</text>';
      });
      return h + '</svg>';
    };
    return {a:draw(A, "fdA" + gid), b:draw(B, "fdB" + gid), diffs:diffs};
  }
  function gFind(){
    const area = beginPlay("find","FIND IT",rl(),FD_SECS,"PIC");
    clearInterval(gTimers.pop());               /* use a per-picture clock instead of the global one */
    const seed0 = (currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    const themes = fdSort(FD_THEMES.map((_,i)=>i), seed0, 17);
    const say = t=>{ $("playMessage").textContent = t; };
    let pic = 0, left = FD_SECS, found = 0, locked = false, cool = false, cur = null;
    const NS = "http://www.w3.org/2000/svg";
    const ring = (d, color)=>area.querySelectorAll("svg").forEach(sv=>{
      const c = document.createElementNS(NS, "circle");
      c.setAttribute("cx", d.pts[0][0]); c.setAttribute("cy", d.pts[0][1]); c.setAttribute("r", 22);
      c.setAttribute("fill", "none"); c.setAttribute("stroke", color); c.setAttribute("stroke-width", 3);
      sv.appendChild(c);
    });
    const nextPic = ms=>{ locked = true; addTimer(setTimeout(()=>{ if(!gPlaying) return; pic++; showPic(); }, ms)); };
    function showPic(){
      if(pic >= FD_PICS) return endGame("find", "🏁 ครบ " + FD_PICS + " ภาพแล้ว!");
      left = FD_SECS; found = 0; locked = false;
      const sc = fdBuild(seed0 + (pic + 1)*7919, FD_THEMES[themes[pic % themes.length]], pic);
      cur = {d:sc.diffs, got:[]};
      area.innerHTML = '<div class="fd-wrap"><small class="fd-lab">🖼️ ต้นฉบับ</small>' + sc.a + '<small class="fd-lab">🔎 หาจุดที่ต่าง ' + FD_DIFFS + ' จุด (แตะได้ทั้ง 2 ภาพ)</small>' + sc.b + '</div>';
      $("playTime").textContent = left; setGExtra((pic + 1) + "/" + FD_PICS);
      say("พบ 0/" + FD_DIFFS);
      area.querySelectorAll("svg").forEach(sv=>sv.addEventListener("pointerdown", e=>onTap(e, sv)));
    }
    function onTap(e, sv){
      e.preventDefault();
      if(!gPlaying || locked || cool) return;
      const r = sv.getBoundingClientRect(), x = (e.clientX - r.left)/r.width*FD_W, y = (e.clientY - r.top)/r.height*FD_H;
      const hit = cur.d.findIndex((d,i)=>!cur.got[i] && d.pts.some(p=>Math.hypot(p[0] - x, p[1] - y) < 27));
      if(hit >= 0){
        cur.got[hit] = 1; found++; ring(cur.d[hit], "#27e07b");
        setGScore(Math.min(FD_PICS*FD_DIFFS*FD_PTS, gScore + FD_PTS));
        say(found === FD_DIFFS ? "🎉 ถูกครบทุกจุด!" : "✅ ถูกต้อง! พบ " + found + "/" + FD_DIFFS);
        if(found === FD_DIFFS) nextPic(900);
      }else{
        cool = true; addTimer(setTimeout(()=>{ cool = false; }, 450));
        setGScore(Math.max(0, gScore - 3)); say("❌ ไม่ใช่จุดต่าง -3");
        const t = document.createElementNS(NS, "text");
        t.setAttribute("x", x); t.setAttribute("y", y); t.setAttribute("font-size", 24); t.setAttribute("text-anchor", "middle"); t.setAttribute("dy", ".35em");
        t.textContent = "❌"; sv.appendChild(t); setTimeout(()=>t.remove(), 450);
      }
    }
    addTimer(setInterval(()=>{
      if(!gPlaying || locked) return;
      left--; $("playTime").textContent = Math.max(0, left);
      if(left > 0) return;
      cur.d.forEach((d,i)=>{ if(!cur.got[i]) ring(d, "#ffd84a"); });
      say("⏰ หมดเวลา! พบ " + found + "/" + FD_DIFFS + " (วงเหลืองคือจุดที่พลาด)");
      nextPic(1800);
    }, 1000));
    showPic();
  }

  /* ===== quiz engine: ODD ONE OUT + EMOJI RIDDLE ===== */
  const ODD_SETS = [
    [["แมว","หมา","ช้าง"],"โต๊ะ"], [["แอปเปิ้ล","กล้วย","ส้ม"],"รถยนต์"], [["แดง","เขียว","น้ำเงิน"],"ปลา"],
    [["ดินสอ","ปากกา","ยางลบ"],"ทีวี"], [["รถเมล์","เรือ","เครื่องบิน"],"หมอน"], [["ฝน","ลม","พายุ"],"ช้อน"],
    [["ไทย","ญี่ปุ่น","เกาหลี"],"ปารีส"], [["กรุงเทพ","เชียงใหม่","ภูเก็ต"],"ญี่ปุ่น"], [["นก","ผีเสื้อ","ผึ้ง"],"ปลา"],
    [["ปลา","ฉลาม","โลมา"],"ไก่"], [["ข้าว","ก๋วยเตี๋ยว","ขนมปัง"],"ผ้าห่ม"], [["ฟุตบอล","บาสเกตบอล","วอลเลย์บอล"],"ส้มตำ"],
    [["กีตาร์","เปียโน","ไวโอลิน"],"ค้อน"], [["หมอ","ครู","ตำรวจ"],"ตึก"], [["ตา","หู","จมูก"],"กระเป๋า"],
    [["เสื้อ","กางเกง","รองเท้า"],"จาน"], [["นม","น้ำส้ม","กาแฟ"],"ก้อนหิน"], [["ดวงอาทิตย์","ดวงจันทร์","ดวงดาว"],"ต้นไม้"],
    [["ฤดูร้อน","ฤดูหนาว","ฤดูฝน"],"วันจันทร์"], [["มือถือ","แท็บเล็ต","คอมพิวเตอร์"],"แก้วน้ำ"], [["ฉัน","เธอ","เขา"],"สวย"],
    [["มะม่วง","ทุเรียน","มังคุด"],"ผักบุ้ง"], [["หมู","ไก่","วัว"],"ผักกาด"], [["ภูเขา","แม่น้ำ","ทะเล"],"โทรศัพท์"],
    [["นักร้อง","นักแสดง","นักกีฬา"],"ตู้เย็น"]
  ];
  const EMOJI_Q = [
    ["🐯👑","Tiger King",["Lion King","Cat Queen","Wild Crown"]], ["🍎📱","iPhone",["Android","Samsung","Nokia"]],
    ["🌧️🧥","เสื้อกันฝน",["ร่ม","เสื้อกันหนาว","รองเท้าบู๊ต"]], ["☀️🌻","ดอกทานตะวัน",["ดอกกุหลาบ","ดอกบัว","ดอกมะลิ"]],
    ["🐝🏠","รังผึ้ง",["รังนก","รังมด","ถ้ำค้างคาว"]], ["🍗🔥","ไก่ย่าง",["ไก่ทอด","ไก่ต้ม","ไก่ชน"]],
    ["🧊☕","กาแฟเย็น",["ชาร้อน","โกโก้ร้อน","น้ำแข็งใส"]], ["⭐🌙","กลางคืน",["กลางวัน","ฟ้าใส","พายุ"]],
    ["✈️🏖️","ไปเที่ยวทะเล",["ไปทำงาน","ไปเรียน","ไปโรงพยาบาล"]], ["🐒🍌","ลิงกินกล้วย",["ช้างกินอ้อย","หมีกินน้ำผึ้ง","แพนด้ากินไผ่"]],
    ["🕷️🦸","Spider-Man",["Batman","Iron Man","Superman"]], ["👻🏠","บ้านผีสิง",["บ้านไอติม","บ้านต้นไม้","บ้านตุ๊กตา"]],
    ["🍕🍝","อิตาลี",["ฝรั่งเศส","ญี่ปุ่น","เยอรมนี"]], ["🗼🥐","ฝรั่งเศส",["อังกฤษ","สเปน","จีน"]],
    ["🎤🎶","ร้องเพลง",["เต้นรำ","วาดรูป","เล่นเกม"]], ["💤🛏️","นอนหลับ",["ตื่นนอน","วิ่งออกกำลังกาย","กินข้าว"]],
    ["🥶❄️","หนาวมาก",["ร้อนมาก","ฝนตก","ลมแรง"]], ["🚗⛽","เติมน้ำมัน",["ล้างรถ","ซ่อมรถ","จอดรถ"]],
    ["🍔🍟","ฟาสต์ฟู้ด",["อาหารเจ","ผลไม้","ขนมไทย"]], ["🎮👦","เด็กติดเกม",["เด็กเรียนเก่ง","เด็กเล่นกีฬา","เด็กขี้อาย"]],
    ["🐶🦴","หมากินกระดูก",["แมวกินปลา","หนูกินชีส","นกกินข้าวโพด"]], ["🌊🏄","เล่นเซิร์ฟ",["ว่ายน้ำ","ตกปลา","ดำน้ำ"]],
    ["⚽🏆","ฟุตบอลโลก",["โอลิมปิก","ซีเกมส์","ไทยลีก"]], ["🧙⚡","Harry Potter",["Gandalf","Merlin","Doctor Strange"]],
    ["❄️👸","Frozen",["Cinderella","Moana","Tangled"]], ["🍜🦐🌶️","ต้มยำกุ้ง",["ผัดไทย","ส้มตำ","แกงเขียวหวาน"]],
    ["🥭🍚","ข้าวเหนียวมะม่วง",["ข้าวผัด","ข้าวมันไก่","ข้าวต้ม"]], ["🦇🌃","Batman",["Superman","Flash","Hulk"]]
  ];
  function gQuiz(o){
    const area = beginPlay(o.id, o.title, rl(), o.secs, o.label);
    const seed = (currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    const order = o.data.map((_,i)=>[rng(seed + i*61), i]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    const say = t=>{ $("playMessage").textContent = t; };
    let n = 0, done = 0;
    const next = ()=>{
      const k = n++, q = o.make(o.data[order[k % order.length]]);
      const opts = q.opts.map((t,i)=>[rng(seed + k*131 + i*17 + 3), t]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
      area.innerHTML = '<div class="q-box"><small></small><h3 class="' + (q.big ? "big" : "") + '"></h3><div class="opt-grid"></div></div>';
      area.querySelector("small").textContent = q.hint;
      area.querySelector("h3").textContent = q.title || "";
      const g = area.querySelector(".opt-grid"), t0 = performance.now();
      opts.forEach(t=>{
        const b = document.createElement("button");
        b.type = "button"; b.className = "num-cell opt qz-opt"; b.textContent = t;
        tapOn(b, ()=>{
          if(b.disabled) return;
          if(t === q.ans){
            const pts = (performance.now() - t0) < 3500 ? 15 : 10;
            done++; setGExtra(done); setGScore(Math.min(o.max, gScore + pts));
            floatText(area, b, "+" + pts, "#62e48a"); say("✅ ถูก! +" + pts);
            b.classList.add("good");
            gTimers.push(setTimeout(()=>{ if(gPlaying){ say(""); next(); } }, 300));
            area.querySelectorAll(".qz-opt").forEach(x=>x.disabled = true);
          }else{
            b.disabled = true; b.classList.add("bad");
            setGScore(Math.max(0, gScore - 5)); say("❌ ผิด -5");
          }
        });
        g.appendChild(b);
      });
    };
    next();
  }
  function gOdd(){
    gQuiz({id:"odd", title:"ODD ONE OUT", secs:40, label:"CORRECT", max:150, data:ODD_SETS,
      make:s=>({hint:"กดคำที่ไม่เข้าพวก", title:"", opts:s[0].concat([s[1]]), ans:s[1]})});
  }
  function gEmoji(){
    gQuiz({id:"emoji", title:"EMOJI RIDDLE", secs:45, label:"CORRECT", max:150, data:EMOJI_Q,
      make:s=>({hint:"ทายคำจากอีโมจิ", title:s[0], big:true, opts:[s[1]].concat(s[2]), ans:s[1]})});
  }

  /* ===== lane runner engine: TRAFFIC RUSH (canvas, smooth) ===== */
  function gRun(o){
    const area = beginPlay(o.id, o.title, o.round || rl(), o.secs, o.label);
    const W=320, H=400, N=o.lanes, LW=W/N, CY=336, dpr=Math.min(2, window.devicePixelRatio||1);
    area.innerHTML = '<canvas id="runCv" width="' + W*dpr + '" height="' + H*dpr + '"></canvas>';
    const cv=$("runCv"), ctx=cv.getContext("2d");
    const seed=(currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    let lane=N>>1, x=lane*LW+LW/2, dist=0, sp=o.v0*.6, t=0, boost=0, slow=0, inv=0, shake=0, combo=0, coins=0;
    let hearts=o.hearts||0, row=0, objs=[], fx=[], on=true, last=performance.now();
    if(hearts) setGExtra(hearts);
    const mv=d=>{ if(gPlaying) lane=Math.max(0, Math.min(N-1, lane+d)); };
    let sx=null, swiped=false;
    cv.addEventListener("pointerdown", e=>{ e.preventDefault(); try{cv.setPointerCapture(e.pointerId);}catch(_){} sx=e.clientX; swiped=false; });
    cv.addEventListener("pointermove", e=>{ if(sx===null) return; const dx=e.clientX-sx; if(Math.abs(dx)>22){ mv(dx>0?1:-1); sx=e.clientX; swiped=true; } });
    cv.addEventListener("pointerup", e=>{ if(sx!==null && !swiped){ const r=cv.getBoundingClientRect(); mv(e.clientX < r.left+r.width/2 ? -1 : 1); } sx=null; });
    cv.addEventListener("pointercancel", ()=>{ sx=null; });
    const kd=e=>{ const k=e.key; if(k==="ArrowLeft"||k==="a"){ mv(-1); e.preventDefault(); } else if(k==="ArrowRight"||k==="d"){ mv(1); e.preventDefault(); } };
    window.addEventListener("keydown", kd);
    gHooks.push(()=>{ on=false; window.removeEventListener("keydown", kd); });

    const oy=ob=>CY-(ob.d + ob.s*(t-ob.ts) - dist);
    const pop=(tx,c)=>fx.push({x:x, y:CY-40, t:tx, c:c, l:.7});
    const rr=(a,b,w,h,r)=>{ ctx.beginPath(); ctx.moveTo(a+r,b); ctx.arcTo(a+w,b,a+w,b+h,r); ctx.arcTo(a+w,b+h,a,b+h,r); ctx.arcTo(a,b+h,a,b,r); ctx.arcTo(a,b,a+w,b,r); ctx.closePath(); };
    const car=(cx,cy,c)=>{
      ctx.fillStyle=c; rr(cx-15,cy-26,30,52,8); ctx.fill();
      ctx.fillStyle="rgba(0,0,0,.55)"; rr(cx-11,cy-16,22,13,4); ctx.fill();
      ctx.fillStyle="#ff5a5a"; ctx.fillRect(cx-12,cy+21,7,3); ctx.fillRect(cx+5,cy+21,7,3);
    };
    const hit=ob=>{
      ob.dead=true;
      if(ob.t==="c"){
        coins++; combo++;
        const m=Math.min(3, 1+Math.floor(combo/6)), p=o.coin*m;
        setGScore(Math.min(o.max, gScore+p)); setGExtra(coins); pop("+"+p, "#ffd84a");
      }else if(ob.t==="n"){
        boost=1.6; setGScore(Math.min(o.max, gScore+(o.nitro||0))); pop("NITRO", "#62e8ff");
      }else if(inv<=0){
        combo=0; slow=1; inv=1.1; shake=.35;
        if(navigator.vibrate) navigator.vibrate(60);
        if(o.hearts){
          hearts--; setGExtra(hearts); pop("💥", "#ff7b83");
          if(hearts<=0){ draw(); endGame(o.id, "💥 รถพัง!"); }
        }else{ setGScore(Math.max(0, gScore-12)); pop("-12", "#ff7b83"); }
      }
    };
    function draw(){
      ctx.setTransform(dpr,0,0,dpr, shake>0 ? (Math.random()-.5)*8*dpr : 0, 0);
      ctx.textBaseline="middle";
      ctx.fillStyle="#07080d"; ctx.fillRect(-10,0,W+20,H);
      ctx.strokeStyle="rgba(255,255,255,.16)"; ctx.lineWidth=2;
      const off=dist%52;
      for(let i=1;i<N;i++) for(let y=-52+off; y<H; y+=52){ ctx.beginPath(); ctx.moveTo(i*LW,y); ctx.lineTo(i*LW,y+28); ctx.stroke(); }
      ctx.fillStyle="#ff2a3a"; ctx.fillRect(0,0,3,H); ctx.fillRect(W-3,0,3,H);
      if(boost>0){ ctx.strokeStyle="rgba(98,232,255,.35)"; for(let i=0;i<10;i++){ const a=Math.random()*W, b=Math.random()*H; ctx.beginPath(); ctx.moveTo(a,b); ctx.lineTo(a,b+40); ctx.stroke(); } }
      objs.forEach(ob=>{
        const cx=ob.l*LW+LW/2, y=oy(ob);
        if(ob.t==="c"){ ctx.beginPath(); ctx.arc(cx,y,11,0,7); ctx.fillStyle="#ffd84a"; ctx.fill(); ctx.lineWidth=3; ctx.strokeStyle="#c89a10"; ctx.stroke(); }
        else if(ob.t==="n"){ ctx.font="28px sans-serif"; ctx.textAlign="center"; ctx.fillText("⚡",cx,y); }
        else if(ob.t==="b"){ ctx.fillStyle="#fff"; rr(cx-28,y-10,56,20,4); ctx.fill(); ctx.fillStyle="#ff2a3a"; for(let k=0;k<4;k++) ctx.fillRect(cx-26+k*14,y-10,7,20); }
        else car(cx,y,ob.c||"#3c6eea");
      });
      if(!(inv>0 && Math.floor(t*18)%2)){
        if(boost>0){ ctx.fillStyle="#62e8ff"; ctx.beginPath(); ctx.moveTo(x-9,CY+28); ctx.lineTo(x,CY+50+Math.random()*10); ctx.lineTo(x+9,CY+28); ctx.fill(); }
        car(x,CY,"#ff2a3a");
      }
      ctx.font="800 12px Orbitron,sans-serif"; ctx.textAlign="left"; ctx.fillStyle="rgba(255,255,255,.7)";
      ctx.fillText(Math.round(sp/3) + " KM/H", 10, 20);
      const m=Math.min(3, 1+Math.floor(combo/6));
      if(o.coin && m>1){ ctx.textAlign="right"; ctx.fillStyle="#ffd84a"; ctx.fillText("COMBO x"+m, W-10, 20); }
      ctx.textAlign="center"; ctx.font="900 16px Orbitron,sans-serif";
      fx.forEach(f=>{ ctx.globalAlpha=Math.max(0,f.l/.7); ctx.fillStyle=f.c; ctx.fillText(f.t,f.x,f.y); });
      ctx.globalAlpha=1;
      if(t<.9){ ctx.globalAlpha=1-t/.9; ctx.font="900 44px Orbitron,sans-serif"; ctx.fillStyle="#fff"; ctx.fillText("GO!",W/2,H/2); ctx.globalAlpha=1; }
    }
    const loop=now=>{
      if(!on) return;
      const dt=Math.min(.05,(now-last)/1000); last=now; t+=dt;
      boost=Math.max(0,boost-dt); slow=Math.max(0,slow-dt); inv=Math.max(0,inv-dt); shake=Math.max(0,shake-dt);
      const base=o.v0+(o.v1-o.v0)*Math.min(1,t/o.secs);
      sp+=(base*(boost>0?1.55:1)*(slow>0?.55:1)-sp)*Math.min(1,dt*(slow>0?8:3));
      dist+=sp*dt; x+=(lane*LW+LW/2-x)*Math.min(1,dt*15);
      while((row+2)*o.gap < dist+H+80){
        o.gen(row,seed).forEach(g=>objs.push({l:g.l, t:g.t, d:(row+2)*o.gap, s:g.s||0, ts:t, c:g.c}));
        row++;
      }
      for(const ob of objs){
        if(ob.dead) continue;
        const y=oy(ob), big=ob.t==="k"||ob.t==="b";
        if(Math.abs(y-CY)<(big?38:30) && Math.abs(ob.l*LW+LW/2-x)<LW*.42){ hit(ob); if(!on) return; }
        else if(ob.t==="c" && !ob.miss && y>CY+40){ ob.miss=1; combo=0; }
      }
      objs=objs.filter(ob=>!ob.dead && oy(ob)<H+60);
      if(o.dscore){ const sc=Math.min(o.max, Math.floor(dist/o.dscore)); if(sc>gScore) setGScore(sc); }
      fx.forEach(f=>{ f.l-=dt; f.y-=50*dt; }); fx=fx.filter(f=>f.l>0);
      draw(); requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* ===== TRAFFIC RUSH ===== */
  function gTraffic(){
    const cols=["#3c6eea","#2fbf71","#f2b134","#a45ee5","#e8e8f0"];
    gRun({id:"traffic", title:"TRAFFIC RUSH", secs:40, label:"LIVES", lanes:4, gap:130, v0:240, v1:400, hearts:3, dscore:110, max:100,
      gen:(i,sd)=>{
        if(i<2) return [];
        const k=rng(sd+i*7), a=Math.floor(rng(sd+i*7+1)*4), out=[];
        const mk=l=>({l:l, t:"k", s:90+Math.floor(rng(sd+i*7+2+l)*70), c:cols[Math.floor(rng(sd+i*7+9+l)*cols.length)]});
        if(k<.55) out.push(mk(a));
        else if(k<.8){ const b=(a+1+Math.floor(rng(sd+i*7+4)*3))%4; out.push(mk(a), mk(b)); }
        if(rng(sd+i*7+5)<.09 && !out.some(c=>c.l===(a+2)%4)) out.push({l:(a+2)%4, t:"n"});
        return out;
      }});
  }

  /* ===== CODE BREAKER (Mastermind: แกะรหัส 4 หลัก เลขไม่ซ้ำ) ===== */
  function gCode(){
    const N = 4, TRIES = 8, area = beginPlay("code","CODE BREAKER",rl(),60,"TRIES");
    setGExtra("0/" + TRIES);
    const seed = (currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    const pool = [0,1,2,3,4,5,6,7,8,9];
    for(let i=9; i>0; i--){ const j = Math.floor(rng(seed + i*37)*(i+1)); [pool[i],pool[j]] = [pool[j],pool[i]]; }
    const secret = pool.slice(0, N);
    let cur = [], hist = [], done = false;
    area.innerHTML = '<div class="cb">' +
      '<div class="cb-hint">แกะรหัส 4 หลัก (0-9 ไม่ซ้ำกัน)<br>🟢 ถูกเลข+ตำแหน่ง • 🟡 ถูกเลขแต่ผิดตำแหน่ง</div>' +
      '<div class="cb-hist"></div><div class="cb-cur"></div><div class="cb-pad"></div></div>';
    const hEl = area.querySelector(".cb-hist"), cEl = area.querySelector(".cb-cur"), pEl = area.querySelector(".cb-pad");
    const say = t=>{ $("playMessage").textContent = t; };
    const btns = [];
    const draw = ()=>{
      hEl.innerHTML = "";
      hist.forEach(h=>{
        const r = document.createElement("div"); r.className = "cb-row";
        const g = document.createElement("b"); g.textContent = h.g.join("");
        const f = document.createElement("span"); f.className = "cb-fb"; f.textContent = "🟢 " + h.b + "   🟡 " + h.c;
        r.append(g, f); hEl.appendChild(r);
      });
      hEl.scrollTop = hEl.scrollHeight;
      cEl.innerHTML = "";
      for(let i=0; i<N; i++){
        const s = document.createElement("div");
        s.className = "cb-slot" + (i === cur.length && !done ? " on" : "");
        s.textContent = cur[i] !== undefined ? cur[i] : "";
        cEl.appendChild(s);
      }
      btns.forEach((b,d)=>b.classList.toggle("used", cur.indexOf(d) >= 0));
    };
    const add = d=>{
      if(done || !gPlaying) return;
      if(cur.length >= N) return;
      if(cur.indexOf(d) >= 0){ say("เลขในแต่ละครั้งห้ามซ้ำกัน"); return; }
      say(""); cur.push(d); draw();
    };
    const del = ()=>{ if(done || !gPlaying) return; cur.pop(); say(""); draw(); };
    const submit = ()=>{
      if(done || !gPlaying) return;
      if(cur.length < N){ say("ใส่ให้ครบ " + N + " หลักก่อน"); return; }
      let b = 0, c = 0;
      cur.forEach((d,i)=>{ if(d === secret[i]) b++; else if(secret.indexOf(d) >= 0) c++; });
      hist.push({g:cur.slice(), b:b, c:c}); cur = [];
      setGExtra(hist.length + "/" + TRIES);
      if(b === N){
        done = true; draw();
        finishSelf(Math.min(100, 40 + (TRIES - hist.length)*6 + Math.floor(gTime*0.3)), "🔓 แกะรหัสสำเร็จ!");
        return;
      }
      const part = Math.min(20, b*6 + c*2);
      if(part > gScore) setGScore(part);
      if(hist.length >= TRIES){
        done = true; draw();
        finishSelf(gScore, "🔒 ครบ " + TRIES + " ครั้งแล้ว รหัสคือ " + secret.join("") + " •");
        return;
      }
      say(""); draw();
    };
    for(let d=0; d<10; d++){
      const b = document.createElement("button");
      b.type = "button"; b.className = "num-cell"; b.textContent = d;
      tapOn(b, ()=>add(d)); pEl.appendChild(b); btns.push(b);
    }
    const bd = document.createElement("button"); bd.type = "button"; bd.className = "btn secondary cb-key"; bd.textContent = "⌫ ลบ";
    const bo = document.createElement("button"); bo.type = "button"; bo.className = "btn primary cb-key"; bo.textContent = "ENTER ✓";
    tapOn(bd, del); tapOn(bo, submit);
    pEl.append(bd, bo);
    const kd = e=>{
      if(e.key >= "0" && e.key <= "9"){ add(+e.key); e.preventDefault(); }
      else if(e.key === "Backspace"){ del(); e.preventDefault(); }
      else if(e.key === "Enter"){ submit(); e.preventDefault(); }
    };
    window.addEventListener("keydown", kd);
    gHooks.push(()=>window.removeEventListener("keydown", kd));
    draw();
  }

  /* ===== WORD SCRAMBLE ไทย (เรียงตัวอักษรที่สลับ) ===== */
  const TH_WORDS = [
    ["สัตว์","กระต่าย"],["สัตว์","จระเข้"],["สัตว์","ปลาหมึก"],["สัตว์","แมงมุม"],["สัตว์","ผีเสื้อ"],
    ["สัตว์","ม้าลาย"],["สัตว์","ปลาดาว"],["สัตว์","ยีราฟ"],["สัตว์","นกฮูก"],["สัตว์","ไดโนเสาร์"],
    ["อาหาร","ข้าวผัด"],["อาหาร","ต้มยำกุ้ง"],["อาหาร","ส้มตำ"],["อาหาร","ไก่ทอด"],["อาหาร","ก๋วยเตี๋ยว"],
    ["อาหาร","ผัดไทย"],["อาหาร","ไอศกรีม"],["อาหาร","ขนมปัง"],["อาหาร","มะม่วง"],["อาหาร","แตงโม"],
    ["อาหาร","สับปะรด"],["อาหาร","ทุเรียน"],
    ["สถานที่","โรงเรียน"],["สถานที่","สนามบิน"],["สถานที่","ห้องสมุด"],["สถานที่","ตลาดนัด"],
    ["สถานที่","สวนสนุก"],["สถานที่","ทะเล"],["สถานที่","น้ำตก"],["สถานที่","โรงหนัง"],
    ["ของใช้","โทรศัพท์"],["ของใช้","กระเป๋า"],["ของใช้","รองเท้า"],["ของใช้","นาฬิกา"],
    ["ของใช้","หนังสือ"],["ของใช้","ดินสอ"],["ของใช้","ยางลบ"],
    ["ยานพาหนะ","จักรยาน"],["ยานพาหนะ","เครื่องบิน"],["ยานพาหนะ","รถไฟ"],
    ["ธรรมชาติ","ดอกไม้"],["ธรรมชาติ","ภูเขา"],["ธรรมชาติ","ท้องฟ้า"],["ธรรมชาติ","ดวงจันทร์"],
    ["ธรรมชาติ","สายรุ้ง"],["ธรรมชาติ","ดวงอาทิตย์"]
  ];
  /* แยกคำไทยเป็น "ก้อนตัวอักษร": พยัญชนะ+สระบน/ล่าง/วรรณยุกต์ ติดกัน, สระหน้า เ แ โ ใ ไ แยกเป็นก้อนของตัวเอง */
  const thTiles = w => w.match(/[\u0E01-\u0E2E][\u0E31\u0E34-\u0E3A\u0E47-\u0E4E]*|[\u0E40-\u0E44]|[\s\S]/gu) || [];

  function gScramble(){
    const area = beginPlay("scramble","WORD SCRAMBLE",rl(),45,"WORDS");
    const seed = (currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    const order = TH_WORDS.map((w,i)=>[rng(seed + i*61), i]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
    const say = t=>{ $("playMessage").textContent = t; };
    let n = 0, solved = 0;
    const shuf = (len, k)=>{
      const a = []; for(let i=0; i<len; i++) a.push(i);
      for(let i=len-1; i>0; i--){ const j = Math.floor(rng(seed + k*101 + i*13)*(i+1)); [a[i],a[j]] = [a[j],a[i]]; }
      return a;
    };
    const next = ()=>{
      const cat = TH_WORDS[order[n % order.length]][0], word = TH_WORDS[order[n % order.length]][1];
      const tiles = thTiles(word);
      let idx, tryK = 0;
      do{ idx = shuf(tiles.length, n*7 + tryK++); }
      while(idx.map(i=>tiles[i]).join("") === word && tryK < 30);
      n++;
      const t0 = performance.now();
      let placed = [];
      area.innerHTML = '<div class="sc"><div class="q-box"><small>หมวด: ' + cat + ' • ' + tiles.length + ' ก้อน</small><div class="sc-slots"></div></div>' +
        '<div class="sc-pool"></div><div class="sc-act"></div></div>';
      const sEl = area.querySelector(".sc-slots"), pEl = area.querySelector(".sc-pool"), aEl = area.querySelector(".sc-act");
      const poolBtns = [];
      const draw = ()=>{
        sEl.innerHTML = "";
        tiles.forEach((_,i)=>{
          const s = document.createElement("button");
          s.type = "button"; s.className = "sc-slot" + (placed[i] !== undefined ? " full" : "");
          s.textContent = placed[i] !== undefined ? tiles[placed[i]] : "";
          if(placed[i] !== undefined) tapOn(s, ()=>{ placed.splice(i,1); draw(); });
          sEl.appendChild(s);
        });
        poolBtns.forEach((b,k)=>b.classList.toggle("used", placed.indexOf(idx[k]) >= 0));
      };
      const check = ()=>{
        if(placed.length < tiles.length) return;
        if(placed.map(i=>tiles[i]).join("") === word){
          const fast = (performance.now() - t0) < 7000, pts = fast ? 20 : 15;
          solved++; setGExtra(solved); setGScore(Math.min(150, gScore + pts));
          say("✅ " + word + " +" + pts);
          sEl.classList.add("ok");
          gTimers.push(setTimeout(()=>{ if(gPlaying){ say(""); next(); } }, 350));
        }else{
          setGScore(Math.max(0, gScore - 3)); say("❌ ยังไม่ใช่ -3");
          sEl.classList.add("bad");
          gTimers.push(setTimeout(()=>{ if(gPlaying){ placed = []; sEl.classList.remove("bad"); draw(); } }, 350));
        }
      };
      idx.forEach((ti,k)=>{
        const b = document.createElement("button");
        b.type = "button"; b.className = "sc-tile"; b.textContent = tiles[ti];
        tapOn(b, ()=>{
          if(placed.length >= tiles.length || placed.indexOf(ti) >= 0) return;
          placed.push(ti); draw(); check();
        });
        pEl.appendChild(b); poolBtns.push(b);
      });
      const bc = document.createElement("button"); bc.type = "button"; bc.className = "btn secondary"; bc.textContent = "ล้าง";
      const bs = document.createElement("button"); bs.type = "button"; bs.className = "btn secondary"; bs.textContent = "ข้าม -3";
      tapOn(bc, ()=>{ placed = []; say(""); draw(); });
      tapOn(bs, ()=>{ setGScore(Math.max(0, gScore - 3)); say("ข้าม • คำคือ " + word); next(); });
      aEl.append(bc, bs);
      draw();
    };
    next();
  }

  /* ===== WORD CHAIN (3 rounds, realtime turns, lives) ===== */
  const WC_CATS = [
    ["🍎 ผลไม้","แอปเปิ้ล ส้ม กล้วย มะม่วง ทุเรียน มังคุด เงาะ ลำไย ลิ้นจี่ องุ่น สตรอว์เบอร์รี แตงโม สับปะรด ชมพู่ มะละกอ ฝรั่ง ขนุน แก้วมังกร ลองกอง มะพร้าว ส้มโอ แคนตาลูป มะขาม พุทรา ละมุด กีวี พีช แพร์ เชอร์รี่ บลูเบอร์รี่ มะยม มะปราง ระกำ สาลี่ ส้มเขียวหวาน"],
    ["🐾 สัตว์","แมว หมา ช้าง ม้า วัว ควาย หมู ไก่ เป็ด แกะ แพะ ลิง เสือ สิงโต หมี กวาง กระต่าย หนู งู จระเข้ ปลา นก ฉลาม โลมา วาฬ ยีราฟ ม้าลาย จิงโจ้ แพนด้า กบ เต่า ปู กุ้ง ผีเสื้อ ผึ้ง มด แมงมุม ค้างคาว นกฮูก อินทรี นกยูง ลา อูฐ หมาป่า จิ้งจอก กระรอก แรด ฮิปโป ปลาหมึก หอย ตุ๊กแก จิ้งจก"],
    ["🍳 ของในครัว","หม้อ กระทะ จาน ชาม ช้อน ส้อม มีด เขียง ตะหลิว กระบวย ตู้เย็น เตาแก๊ส ไมโครเวฟ หม้อหุงข้าว กาต้มน้ำ แก้ว ถ้วย ตะเกียบ ครก สาก กรรไกร เครื่องปั่น กระติกน้ำ ที่เปิดขวด ถาด ตะแกรง ผ้ากันเปื้อน ฝาหม้อ เตาอบ หม้อทอด ที่ขูดมะละกอ ผ้าขี้ริ้ว ฟองน้ำ จานรอง ทัพพี ที่คีบ"],
    ["🍜 อาหารไทย","ผัดไทย ต้มยำกุ้ง ส้มตำ ข้าวผัด แกงเขียวหวาน ข้าวมันไก่ ผัดกะเพรา ก๋วยเตี๋ยว ลาบ น้ำตก ไก่ทอด หมูปิ้ง ข้าวเหนียวมะม่วง ผัดซีอิ๊ว ราดหน้า แกงส้ม พะแนง มัสมั่น ต้มข่าไก่ ปลาทอด ไข่เจียว โจ๊ก ข้าวต้ม ยำวุ้นเส้น หอยทอด ไก่ย่าง คอหมูย่าง ขนมครก ทองหยิบ ข้าวขาหมู ข้าวหมูแดง บะหมี่ ก๋วยจั๊บ แกงจืด ไข่พะโล้ ปลาหมึกย่าง"],
    ["🌏 ประเทศ","ไทย ญี่ปุ่น เกาหลี จีน อินเดีย เวียดนาม ลาว กัมพูชา พม่า มาเลเซีย สิงคโปร์ อินโดนีเซีย ฟิลิปปินส์ อังกฤษ ฝรั่งเศส เยอรมนี อิตาลี สเปน รัสเซีย อเมริกา แคนาดา บราซิล อาร์เจนตินา ออสเตรเลีย อียิปต์ ตุรกี สวีเดน นอร์เวย์ สวิตเซอร์แลนด์ เม็กซิโก เนเธอร์แลนด์ โปรตุเกส กรีซ นิวซีแลนด์ เบลเยียม เดนมาร์ก ฟินแลนด์ ไต้หวัน ฮ่องกง เนปาล ศรีลังกา"],
    ["🎒 ของในกระเป๋านักเรียน","สมุด หนังสือ ดินสอ ปากกา ยางลบ ไม้บรรทัด กล่องดินสอ กรรไกร กาว ปากกาเน้นข้อความ เครื่องคิดเลข กระติกน้ำ ร่ม โทรศัพท์ ขนม กระเป๋าสตางค์ ผ้าเช็ดหน้า หูฟัง สีไม้ แฟ้ม ที่เหลาดินสอ ดินสอสี ปากกาลูกลื่น ปากกาเมจิก สีน้ำ พู่กัน ไม้โปรแทรกเตอร์ วงเวียน แท็บเล็ต ทิชชู่ ยาดม"],
    ["🚗 ยานพาหนะ","รถยนต์ รถเมล์ รถไฟ เครื่องบิน เรือ จักรยาน มอเตอร์ไซค์ รถบรรทุก รถตู้ แท็กซี่ ตุ๊กตุ๊ก สามล้อ รถไฟฟ้า เรือยนต์ เรือใบ เฮลิคอปเตอร์ จรวด สกูตเตอร์ รถแทรกเตอร์ รถพยาบาล รถดับเพลิง รถกระบะ รถเข็น รถม้า เรือเฟอร์รี่ เรือดำน้ำ บอลลูน รถถัง เรือหางยาว รถสองแถว วินมอเตอร์ไซค์ รถสกายแลป รถบัส เรือสำราญ"],
    ["👩‍⚕️ อาชีพ","หมอ ครู ตำรวจ ทหาร พยาบาล วิศวกร นักบิน ทนายความ เชฟ ช่างไฟ ช่างตัดผม นักร้อง นักแสดง นักข่าว นักบัญชี โปรแกรมเมอร์ ชาวนา ชาวประมง คนขับรถ พ่อค้า แม่ค้า สถาปนิก เภสัชกร ทันตแพทย์ นักกีฬา ช่างภาพ นักวิทยาศาสตร์ ยาม ดารา นักดับเพลิง ช่างไม้ ช่างยนต์ บาริสต้า นักเขียน นักดนตรี ศิลปิน ชาวสวน"],
    ["🥤 เครื่องดื่ม","น้ำเปล่า ชาเขียว ชานม ชาไข่มุก กาแฟ โกโก้ นม น้ำส้ม น้ำมะนาว น้ำอัดลม โค้ก เป๊บซี่ น้ำแข็งใส สมูทตี้ นมถั่วเหลือง โอเลี้ยง ชาเย็น น้ำมะพร้าว น้ำผลไม้ ลาเต้ เอสเพรสโซ่ คาปูชิโน่ มัทฉะ น้ำเก๊กฮวย น้ำอัญชัน โซดา น้ำสมุนไพร นมเย็น ชามะนาว อเมริกาโน่ น้ำตะไคร้ น้ำแตงโมปั่น"],
    ["🥦 ผักและสมุนไพร","ผักกาด คะน้า กวางตุ้ง ผักบุ้ง แครอท มะเขือเทศ แตงกวา ฟักทอง มันฝรั่ง หัวหอม กระเทียม พริก ถั่วฝักยาว กะหล่ำปลี บรอกโคลี ข้าวโพด เห็ด ผักชี ต้นหอม โหระพา กะเพรา มะเขือ มะเขือยาว ผักกาดหอม ผักโขม หน่อไม้ ถั่วงอก ฟักเขียว บวบ มะระ ตำลึง ขิง ข่า ตะไคร้ สะระแหน่ ใบมะกรูด กะหล่ำดอก"],
    ["👕 เสื้อผ้าและของติดตัว","เสื้อ กางเกง กระโปรง รองเท้า ถุงเท้า หมวก ผ้าพันคอ ถุงมือ เข็มขัด เนคไท แว่นตา นาฬิกา สร้อย แหวน ต่างหู กระเป๋า ชุดว่ายน้ำ เสื้อกันหนาว เสื้อกันฝน รองเท้าแตะ ชุดนอน กางเกงขาสั้น เสื้อยืด เสื้อเชิ้ต ชุดสูท หน้ากากอนามัย ผ้าเช็ดหน้า เสื้อกั๊ก ชุดนักเรียน รองเท้าผ้าใบ รองเท้าส้นสูง กำไล"]
  ].map(c=>[c[0], c[1].split(" ")]);
  function gWordChain(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const R=3, ROUND_MS=60000, GAP=4000, WIN=3000, MAXW=20, LIVES=2, MAXSC=150;
    const area = beginPlay("chain","WORD CHAIN",rl(),240,"LIVES");
    const players=activePlayers(currentRoomData), ids=Object.keys(players).sort(), seed=currentRoomData.startAt||1;
    const nm=id=>((players[id] && players[id].name) || "PLAYER").slice(0,10);
    const order=WC_CATS.map((_,i)=>[rng(seed+i*37+11),i]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]).slice(0,R);
    const cats=order.map(i=>WC_CATS[i]);
    const norm=t=>String(t||"").replace(/\s+/g,"").toLowerCase();
    const me={a:{},o:{}}; let live={}, finished=false, lastScore=-1;
    const ref=db.ref("rooms/" + roomCode + "/live"); ref.child(playerId).remove();
    ref.on("value", sn=>{ live=sn.val()||{}; update(); });
    gHooks.push(()=>{ ref.off(); ref.child(playerId).remove(); });
    const pub=()=>ref.child(playerId).set({s:seed, a:me.a, o:me.o});
    const rec=id=>id===playerId ? me : (live[id] && live[id].s===seed ? live[id] : {a:{},o:{}});
    const nextAlive=(cur,lives)=>{
      const i=ids.indexOf(cur);
      for(let k=1;k<=ids.length;k++){ const id=ids[(i+k)%ids.length]; if(lives[id]>0) return id; }
      return cur;
    };

    /* replay: every client derives the same state from everyone's published answers */
    function sim(now){
      let start=seed+1500, total=0, last=null;
      for(let r=0;r<R;r++){
        if(now<start) return {phase:last?"between":"intro", r:r, cat:cats[r], start:start, last:last, total:total, lives:null};
        const bank=new Set(cats[r][1].map(norm)), lives={}, used=new Set(), words=[], pts={}, ev=[];
        ids.forEach(id=>{ lives[id]=LIVES; pts[id]=0; });
        let ts=start, k=0, owner=ids[r%ids.length], cur=null;
        for(;;){
          const alive=ids.filter(id=>lives[id]>0);
          if(alive.length<=1 || words.length>=MAXW || ts-start>=ROUND_MS) break;
          if(lives[owner]<=0) owner=nextAlive(owner,lives);
          const limit=Math.max(4, 8-Math.floor(words.length/5))*1000, dl=ts+limit, key=r+"_"+k;
          const a=(rec(owner).a||{})[key];
          if(a && a.t<=dl+1500){
            const w=norm(a.w);
            if(used.has(w)){ lives[owner]--; ev.push("🔁 " + nm(owner) + " ตอบซ้ำ: " + a.w + " (-1 ❤️)"); ts=a.t; }
            else{
              let ok=true, at=a.t;
              if(!bank.has(w)){
                const resolve=a.t+WIN;
                if(now<resolve){ cur={phase:"pending", owner:owner, key:key, word:a.w, resolve:resolve}; break; }
                const cnt=ids.filter(id=>id!==owner && (rec(id).o||{})[key] && rec(id).o[key]<=resolve).length;
                ok = !(cnt*2 > ids.length-1); at=resolve;
                if(!ok){ lives[owner]--; ev.push("🙅 " + nm(owner) + ": " + a.w + " โดนค้าน (-1 ❤️)"); }
              }
              if(ok){ words.push({w:a.w, by:owner}); used.add(w); pts[owner]+=5; ev.push("✅ " + nm(owner) + ": " + a.w + " +5"); }
              ts=at;
            }
          }else{
            if(now<dl){ cur={phase:"turn", owner:owner, dl:dl, limit:limit, key:key}; break; }
            lives[owner]--; ev.push("⏰ " + nm(owner) + " หมดเวลา (-1 ❤️)"); ts=dl;
          }
          owner=nextAlive(owner,lives); k++;
        }
        const alive=ids.filter(id=>lives[id]>0);
        if(cur) return {phase:cur.phase, r:r, cat:cats[r], cur:cur, words:words, lives:lives, alive:alive, ev:ev, total:total+pts[playerId], last:last};
        alive.forEach(id=>{ pts[id]+=(alive.length===1 ? 20 : 10); });
        ev.push(alive.length===1 ? "🏆 " + nm(alive[0]) + " รอดคนเดียว +20" : "🛡️ รอดถึงจบรอบ +10");
        total+=pts[playerId];
        last={r:r, words:words, ev:ev, my:pts[playerId], alive:alive};
        start=ts+GAP;
        if(r===R-1){
          if(now<ts+GAP) return {phase:"end", r:r, cat:cats[r], words:words, lives:lives, alive:alive, ev:ev, total:total, last:last};
          return {phase:"done", r:r, cat:cats[r], words:words, lives:lives, alive:alive, ev:ev, total:total, last:last};
        }
        if(now<start) return {phase:"between", r:r+1, cat:cats[r+1], start:start, last:last, total:total, words:words, lives:lives, alive:alive, ev:ev};
      }
      return {phase:"done", r:R-1, cat:cats[R-1], total:total, last:last, ev:[], words:[], lives:{}, alive:[]};
    }

    const el=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };
    const box=el("div","wc"), qb=el("div","q-box"), sm=el("small"), h3=el("h3","wc-cat");
    qb.append(sm,h3);
    const turn=el("div","wc-turn"), bar=el("div","wc-bar"), barI=el("i"); bar.appendChild(barI);
    const lv=el("div","wc-lives"), board=el("div","wc-board");
    const inRow=el("div","wc-in"), inp=el("input"), sendB=el("button","btn primary","ส่ง");
    inp.type="text"; inp.maxLength=24; inp.placeholder="พิมพ์คำตอบ"; inp.autocomplete="off"; sendB.type="button";
    inRow.append(inp,sendB);
    const objB=el("button","btn secondary full wc-obj","ค้าน 🙅"); objB.type="button";
    box.append(qb,turn,bar,lv,board,inRow,objB); area.appendChild(box);

    let st=null;
    function submit(){
      if(!gPlaying || !st || st.phase!=="turn" || st.cur.owner!==playerId) return;
      const v=inp.value.trim(), key=st.cur.key; if(!v || me.a[key]) return;
      me.a[key]={w:v, t:Date.now()}; inp.value=""; pub(); update();
    }
    tapOn(sendB, submit);
    inp.addEventListener("keydown", e=>{ if(e.key==="Enter"){ e.preventDefault(); submit(); } });
    tapOn(objB, ()=>{
      if(!st || st.phase!=="pending" || st.cur.owner===playerId) return;
      if(me.o[st.cur.key]) return;
      me.o[st.cur.key]=Date.now(); pub(); update();
    });

    function update(){
      if(!gPlaying) return;
      st=sim(Date.now());
      const now=Date.now(), c=st.cat, p=st.phase;
      sm.textContent="ROUND " + (st.r+1) + "/" + R + (st.words ? " • ผ่านแล้ว " + st.words.length + "/" + MAXW : "");
      h3.textContent=c[0];
      const myTurn = p==="turn" && st.cur.owner===playerId;
      const dead = st.lives && st.lives[playerId]<=0;
      if(p==="intro"){ turn.textContent="เตรียมตัว… เริ่มใน " + Math.max(0, Math.ceil((st.start-now)/1000)) + " วิ"; barI.style.width="100%"; }
      else if(p==="between"){ turn.textContent="จบรอบ! รอบต่อไปใน " + Math.max(0, Math.ceil((st.start-now)/1000)) + " วิ • หมวดถัดไป: " + c[0]; barI.style.width="0%"; }
      else if(p==="turn"){
        const left=Math.max(0, st.cur.dl-now);
        turn.textContent=(myTurn ? "👉 ตาคุณ! " : "ตาของ " + nm(st.cur.owner) + " ") + Math.ceil(left/1000) + " วิ";
        barI.style.width=(left/st.cur.limit*100) + "%";
      }else if(p==="pending"){
        turn.textContent=nm(st.cur.owner) + " ตอบ “" + st.cur.word + "” — ตัดสินใน " + Math.max(0, Math.ceil((st.cur.resolve-now)/1000)) + " วิ";
        barI.style.width=((st.cur.resolve-now)/WIN*100) + "%";
      }else{ turn.textContent="จบเกมแล้ว!"; barI.style.width="0%"; }
      bar.classList.toggle("hot", p==="turn" && st.cur.dl-now<2500);
      box.classList.toggle("mine", myTurn);
      lv.innerHTML="";
      if(st.lives) ids.forEach(id=>{
        const n=st.lives[id]||0, row=el("span","wc-p" + (n<=0 ? " out" : "") + (p==="turn" && st.cur.owner===id ? " cur" : "") + (id===playerId ? " me" : ""));
        row.textContent=nm(id) + " " + (n>0 ? "❤️".repeat(n) : "💀");
        lv.appendChild(row);
      });
      board.innerHTML="";
      (st.words||[]).forEach(w=>{ const b=el("span","wc-chip",w.w); b.title=nm(w.by); board.appendChild(b); });
      inp.disabled=!myTurn; sendB.disabled=!myTurn;
      inRow.style.display = (p==="done"||p==="end") ? "none" : "";
      if(myTurn && !st.wasMine){ try{ inp.focus(); }catch(_){} }
      st.wasMine=myTurn;
      const canObj = p==="pending" && st.cur.owner!==playerId && !me.o[st.cur.key];
      objB.style.display = p==="pending" && st.cur.owner!==playerId ? "" : "none";
      objB.disabled = !canObj; objB.textContent = canObj ? "ค้าน 🙅 (ไม่ใช่หมวดนี้)" : "ค้านแล้ว 🙅";
      const evs=(st.ev||[]); const msg = dead && p!=="done" ? "💀 คุณถูกตัดออกจากรอบนี้ • ยังกด ค้าน ช่วยตัดสินได้" : (evs.length ? evs[evs.length-1] : "");
      $("playMessage").textContent=msg;
      if(st.lives) setGExtra(Math.max(0, st.lives[playerId]||0));
      const sc=Math.min(MAXSC, st.total);
      if(sc!==lastScore){ lastScore=sc; setGScore(sc); }
      if(p==="done" && !finished){
        finished=true;
        finishSelf(sc, "🏁 จบเกม Word Chain!");
      }
    }
    update(); pub();
    addTimer(setInterval(update, 250));
  }

  /* ===== shared helpers for MIND MELD + WORD SPY ===== */
  const mkEl = (tag, cls, txt) => { const e = document.createElement(tag); if(cls) e.className = cls; if(txt !== undefined) e.textContent = txt; return e; };
  const normWord = s => String(s || "").toLowerCase().replace(/[\s.,!?'"()\-_\/\\ๆ\u200b]+/g, "");

  /* ===== MIND MELD (คิดตรงกัน) ===== */
  const MELD_TOPICS = [
    "ของที่ต้องมีติดกระเป๋านักเรียน 🎒", "สิ่งที่คนไทยกินตอนเช้า 🍳", "ของที่ต้องเอาไปทะเล 🏖️", "เครื่องดื่มที่คนสั่งบ่อยที่สุด ☕",
    "ของที่อยู่ในห้องนอน 🛏️", "ผลไม้ที่คนไทยชอบกิน 🍉", "สัตว์เลี้ยงยอดนิยม 🐶", "ของที่ต้องพกก่อนออกจากบ้าน 🔑",
    "เมนูที่กินกับข้าวสวย 🍚", "สิ่งที่ทำตอนฝนตก 🌧️", "จังหวัดที่คนอยากไปเที่ยว 🗺️", "แอปในมือถือที่เปิดบ่อยที่สุด 📱",
    "ของที่เห็นในร้านเซเว่น 🏪", "กีฬายอดนิยม ⚽", "ของหวานที่คนไทยชอบ 🍨", "ของที่ต้องมีในครัว 🍳",
    "สีที่คนชอบมากที่สุด 🎨", "สิ่งที่คนทำตอนว่าง 🛋️", "ของที่อยู่ในกระเป๋าสตางค์ 👛", "อาชีพในฝันตอนเด็ก ✨",
    "ขนมกินเล่นยอดนิยม 🍿", "สิ่งที่ขาดไม่ได้ในงานปาร์ตี้ 🎉", "ของที่ต้องเตรียมไปเที่ยวต่างประเทศ ✈️", "สิ่งที่คนชอบทำวันหยุด 🌤️"
  ];
  function gMindMeld(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const R = 4, TYPE = 15, WAIT = 2, SHOW = 8, RD = TYPE + WAIT + SHOW, TOTAL = R * RD;
    const area = beginPlay("mind", "MIND MELD", rl(), TOTAL + 6, "MATCH");
    const players = activePlayers(currentRoomData), ids = Object.keys(players).sort(), N = ids.length, seed = currentRoomData.startAt || 1;
    const idx = MELD_TOPICS.map((_, i) => i);
    for(let i = idx.length - 1; i > 0; i--){ const j = Math.floor(rng(seed + i * 31) * (i + 1)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
    const topics = idx.slice(0, R).map(i => MELD_TOPICS[i]);
    const me = {a:{}}; let live = {}, finished = false, shown = -1, total = 0, matchSum = 0, lastR = -1;
    const ref = db.ref("rooms/" + roomCode + "/live"); ref.child(playerId).remove();
    ref.on("value", sn => { live = sn.val() || {}; });
    gHooks.push(()=>{ ref.off(); ref.child(playerId).remove(); });
    const pub = () => ref.child(playerId).set({s:seed, a:me.a});
    const t0 = performance.now(), T = () => (performance.now() - t0) / 1000;
    const ansOf = (id, r) => {
      if(id === playerId) return me.a["r" + r] || "";
      const o = live[id];
      return (o && o.s === seed && o.a && o.a["r" + r]) || "";
    };

    const box = mkEl("div", "mm"), qb = mkEl("div", "q-box"), sm = mkEl("small"), h3 = mkEl("h3", "wc-cat");
    qb.append(sm, h3);
    const turn = mkEl("div", "wc-turn"), bar = mkEl("div", "wc-bar"), barI = mkEl("i"); bar.appendChild(barI);
    const inRow = mkEl("div", "wc-in"), inp = mkEl("input"), sendB = mkEl("button", "btn primary", "ส่ง");
    inp.type = "text"; inp.maxLength = 24; inp.placeholder = "พิมพ์คำตอบ 1 คำ"; inp.autocomplete = "off"; sendB.type = "button";
    inp.disabled = true; sendB.disabled = true;
    inRow.append(inp, sendB);
    const state = mkEl("div", "mm-state"), out = mkEl("div", "mm-out");
    box.append(qb, turn, bar, inRow, state, out); area.appendChild(box);

    const roundNow = () => Math.min(R - 1, Math.floor(T() / RD));
    function paintState(r){
      const done = ids.filter(id => ansOf(id, r)).length, mine = me.a["r" + r];
      state.textContent = (mine ? "ส่งแล้ว ✓ “" + mine + "” • " : "ยังไม่ได้ส่ง • ") + "ตอบแล้ว " + done + "/" + N;
    }
    function submit(r){
      const v = inp.value.trim().slice(0, 24);
      if(!v || me.a["r" + r] === v) return;
      me.a["r" + r] = v; pub(); paintState(r);
    }
    tapOn(sendB, () => submit(roundNow()));
    inp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); submit(roundNow()); } });

    function showRound(r){
      const groups = {};
      ids.forEach(id => {
        const a = ansOf(id, r), k = normWord(a);
        if(!k) return;
        (groups[k] = groups[k] || {label:a, ids:[]}).ids.push(id);
      });
      const list = Object.keys(groups).map(k => groups[k]).sort((x, y) => y.ids.length - x.ids.length);
      const mineK = normWord(ansOf(playerId, r)), mine = mineK ? groups[mineK] : null;
      const matches = mine ? mine.ids.length - 1 : 0;
      const pts = mine ? Math.min(40, Math.round(40 * matches / Math.max(1, N - 1))) : 0;
      total = Math.min(150, total + pts); matchSum += matches; setGScore(total); setGExtra(matchSum);

      out.innerHTML = "";
      const max = list.length ? list[0].ids.length : 1, chart = mkEl("div", "mm-chart");
      list.slice(0, 6).forEach(g => {
        const row = mkEl("div", "mm-bar" + (g === mine ? " me" : "")), track = mkEl("span", "mm-track"), fill = mkEl("i");
        fill.style.width = (g.ids.length / max * 100) + "%";
        track.appendChild(fill);
        row.append(mkEl("b", "", g.label), track, mkEl("em", "", String(g.ids.length)));
        chart.appendChild(row);
      });
      out.appendChild(chart);
      const odd = list.filter(g => g.ids.length === 1 && g !== mine).slice(0, 6);
      if(odd.length){
        const o = mkEl("div", "mm-odd"); o.appendChild(mkEl("div", "", "🤪 คำตอบแปลก ๆ"));
        const wrap = mkEl("div", "wc-board");
        odd.forEach(g => wrap.appendChild(mkEl("span", "wc-chip", ((players[g.ids[0]] && players[g.ids[0]].name) || "?") + ": " + g.label)));
        o.appendChild(wrap); out.appendChild(o);
      }
      out.appendChild(mkEl("div", "mm-res", !mine ? "😴 ไม่ได้ตอบ +0" : matches ? "🧠 ตรงกับเพื่อน " + matches + " คน +" + pts : "🫥 ไม่มีใครตอบตรงกับคุณ +0"));
    }

    function update(){
      if(finished) return;
      const t = T();
      if(t >= TOTAL){ finished = true; finishSelf(total, "🧠 จบ MIND MELD!"); return; }
      const r = Math.floor(t / RD), pr = t - r * RD, p = pr < TYPE ? "type" : pr < TYPE + WAIT ? "wait" : "show";
      if(r !== lastR){ lastR = r; h3.textContent = topics[r]; sm.textContent = "ROUND " + (r + 1) + "/" + R; inp.value = ""; out.innerHTML = ""; }
      const typing = p === "type";
      if(typing && inp.disabled){ inp.disabled = false; sendB.disabled = false; try{ inp.focus(); }catch(_){} }
      if(!typing && !inp.disabled){ submit(r); inp.disabled = true; sendB.disabled = true; try{ inp.blur(); }catch(_){} }
      if(typing){
        const left = TYPE - pr;
        turn.textContent = "พิมพ์คำตอบ 1 คำ — เหลือ " + Math.ceil(left) + " วิ";
        barI.style.width = (left / TYPE * 100) + "%"; bar.classList.toggle("hot", left < 4); paintState(r);
      }else if(p === "wait"){
        turn.textContent = "รวมคำตอบ…"; barI.style.width = "0%"; bar.classList.remove("hot"); paintState(r);
      }else{
        const left = RD - pr;
        turn.textContent = (r === R - 1 ? "เฉลย! จบเกมใน " : "เฉลย! ข้อต่อไปใน ") + Math.ceil(left) + " วิ";
        barI.style.width = (left / SHOW * 100) + "%"; bar.classList.remove("hot");
        if(shown !== r){ shown = r; showRound(r); paintState(r); }
      }
    }
    update();
    addTimer(setInterval(update, 250));
  }

  /* ===== WORD SPY (สายลับคำศัพท์) ===== */
  const SPY_PAIRS = [
    ["ชานมไข่มุก","ชาเขียว"], ["หมูกระทะ","ชาบู"], ["ส้มตำ","ยำมะม่วง"], ["โรงพยาบาล","คลินิก"],
    ["เซเว่น","ซูเปอร์มาร์เก็ต"], ["รถไฟฟ้า","รถเมล์"], ["ทะเล","แม่น้ำ"], ["ข้าวมันไก่","ข้าวหมูแดง"],
    ["ลิปสติก","บลัชออน"], ["ไอโฟน","แอนดรอยด์"], ["ตุ๊กตาหมี","ตุ๊กตากระต่าย"], ["ห้องสมุด","ร้านหนังสือ"],
    ["ฟุตบอล","ฟุตซอล"], ["กาแฟ","ชา"], ["ครู","อาจารย์"], ["ปากกา","ดินสอ"],
    ["เตียง","โซฟา"], ["พิซซ่า","สปาเกตตี้"], ["ฝนตก","พายุ"], ["สวนสนุก","สวนสัตว์"]
  ];
  function gWordSpy(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const players = activePlayers(currentRoomData), ids = Object.keys(players).sort(), N = ids.length, seed = currentRoomData.startAt || 1;
    const spy = ids[Math.floor(rng(seed) * N)], pair = SPY_PAIRS[Math.floor(rng(seed + 5) * SPY_PAIRS.length)], swp = rng(seed + 9) < .5;
    const mainW = swp ? pair[1] : pair[0], spyW = swp ? pair[0] : pair[1], wordOf = id => id === spy ? spyW : mainW, mine = wordOf(playerId);
    const order = ids.slice().sort((a, b) => rng(seed + hueOf(a) * 13) - rng(seed + hueOf(b) * 13));
    const H = N <= 5 ? 2 : 1, SLOTS = N * H, L = SLOTS <= 10 ? 10 : SLOTS <= 20 ? 7 : 5;
    const INTRO = 5, VOTE = 20, GRACE = 2, SHOW = 8, VS = INTRO + SLOTS * L, RT = VS + VOTE + GRACE;
    const area = beginPlay("spy", "WORD SPY", rl(), Math.ceil(RT + SHOW + 4), "VOTES");
    const name = id => (players[id] && players[id].name) || "PLAYER";
    const me = {h:{}, v:""}; let live = {}, rev = false, sig = "", lastK = -1;
    const ref = db.ref("rooms/" + roomCode + "/live"); ref.child(playerId).remove();
    ref.on("value", sn => { live = sn.val() || {}; });
    gHooks.push(()=>{ ref.off(); ref.child(playerId).remove(); });
    const pub = () => ref.child(playerId).set({s:seed, h:me.h, v:me.v});
    const t0 = performance.now(), T = () => (performance.now() - t0) / 1000;
    const rec = id => id === playerId ? me : ((live[id] && live[id].s === seed) ? live[id] : {});
    const hintOf = (id, k) => (rec(id).h || {})["k" + k] || "";
    const voteOf = id => rec(id).v || "";
    const slotOf = (id, h) => h * N + order.indexOf(id);

    const box = mkEl("div", "mm sp"), qb = mkEl("div", "q-box");
    qb.append(mkEl("small", "", "YOUR SECRET WORD"), mkEl("h3", "wc-cat", mine));
    const tip = mkEl("div", "imp-tip", "ทุกคนไม่รู้ว่าตัวเองเป็นสายลับหรือไม่ — ฟังคำใบ้เพื่อนให้ดี");
    const turn = mkEl("div", "wc-turn"), bar = mkEl("div", "wc-bar"), barI = mkEl("i"); bar.appendChild(barI);
    const inRow = mkEl("div", "wc-in"), inp = mkEl("input"), sendB = mkEl("button", "btn primary", "ส่ง");
    inp.type = "text"; inp.maxLength = 14; inp.placeholder = "พิมพ์คำใบ้ 1 คำ"; inp.autocomplete = "off"; sendB.type = "button";
    inRow.append(inp, sendB); inRow.style.display = "none";
    const msg = mkEl("div", "mm-state"), list = mkEl("div", "sp-list");
    box.append(qb, tip, turn, bar, inRow, msg, list); area.appendChild(box);

    const phaseNow = t => {
      if(t < INTRO) return {p:"intro", left:INTRO - t};
      if(t < VS){ const k = Math.floor((t - INTRO) / L); return {p:"hint", k:k, left:INTRO + (k + 1) * L - t}; }
      if(t < VS + VOTE) return {p:"vote", left:VS + VOTE - t};
      if(t < RT) return {p:"wait"};
      return {p:"reveal"};
    };
    function submitHint(){
      const ph = phaseNow(T());
      if(ph.p !== "hint" || order[ph.k % N] !== playerId || me.h["k" + ph.k]) return;
      const v = inp.value.trim().slice(0, 14), nv = normWord(v);
      if(!nv) return;
      if(nv.includes(normWord(mine))){ msg.textContent = "❌ ห้ามพิมพ์คำลับของตัวเองตรง ๆ"; return; }
      for(const id of ids) for(let j = 0; j < ph.k; j++) if(normWord(hintOf(id, j)) === nv){ msg.textContent = "❌ มีคนใช้คำนี้ไปแล้ว ลองคำอื่น"; return; }
      me.h["k" + ph.k] = v; inp.value = ""; msg.textContent = ""; pub(); sync(true);
    }
    tapOn(sendB, submitHint);
    inp.addEventListener("keydown", e => { if(e.key === "Enter"){ e.preventDefault(); submitHint(); } });

    const votesFor = id => ids.filter(o => o !== id && voteOf(o) === id).length;
    function sync(force){
      const ph = phaseNow(T()), curSlot = ph.p === "hint" ? ph.k : (ph.p === "intro" ? -1 : SLOTS);
      const s2 = [ph.p, curSlot, rev ? 1 : 0, me.v, ids.map(id => { const a = []; for(let h = 0; h < H; h++) a.push(hintOf(id, slotOf(id, h))); return a.join("~"); }).join("|")].join("#");
      if(!force && s2 === sig) return;
      sig = s2; list.innerHTML = "";
      const cur = ph.p === "hint" ? order[ph.k % N] : "";
      order.forEach(id => {
        const row = mkEl("div", "sp-row" + (cur === id ? " cur" : "") + (id === playerId ? " me" : "") + (me.v === id ? " sel" : "") + (rev && id === spy ? " bad" : ""));
        row.appendChild(mkEl("span", "sp-name", name(id) + (rev && id === spy ? " 🕵️" : "") + (id === playerId ? " (คุณ)" : "")));
        if(rev) row.appendChild(mkEl("span", "sp-act", wordOf(id) + " • " + votesFor(id) + " โหวต"));
        else if(ph.p === "vote" && id !== playerId){
          const b = mkEl("button", "btn secondary", me.v === id ? "VOTED" : "VOTE"); b.type = "button";
          tapOn(b, () => { me.v = id; pub(); sync(true); });
          row.appendChild(b);
        }
        const hs = mkEl("span", "sp-hints");
        for(let h = 0; h < H; h++){
          const k = slotOf(id, h), w = hintOf(id, k);
          hs.appendChild(mkEl("span", "wc-chip" + (w ? "" : " empty"), w || (k < curSlot || ph.p !== "intro" && ph.p !== "hint" ? "—" : "…")));
        }
        row.appendChild(hs); list.appendChild(row);
      });
    }

    function reveal(){
      rev = true;
      const against = ids.filter(id => id !== spy && voteOf(id) === spy).length, caught = against * 2 > Math.max(1, N - 1);
      let sc, m;
      if(playerId === spy){ sc = caught ? 20 : 100; m = caught ? "🕵️ คุณคือสายลับ และโดนจับได้!" : "😈 คุณคือสายลับ และรอดตัวได้!"; }
      else{
        const good = me.v === spy;
        sc = good ? (caught ? 100 : 70) : (caught ? 40 : 10);
        m = good ? "🎯 โหวตถูก!" : "❌ โหวตผิด";
        m += caught ? " จับสายลับได้สำเร็จ" : " สายลับหนีรอดไปได้";
      }
      turn.textContent = "เฉลย!"; barI.style.width = "0%"; inRow.style.display = "none";
      sync(true); setGExtra(votesFor(spy));
      finishSelf(sc, m + " (" + name(spy) + " คือสายลับ • คำจริง “" + mainW + "” สายลับได้ “" + spyW + "”)");
    }

    function update(){
      if(rev) return;
      const ph = phaseNow(T());
      if(ph.p === "intro"){
        turn.textContent = "แจกคำลับแล้ว! อ่านคำของคุณ — เริ่มใน " + Math.ceil(ph.left) + " วิ"; barI.style.width = (ph.left / INTRO * 100) + "%"; bar.classList.remove("hot");
      }else if(ph.p === "hint"){
        const cur = order[ph.k % N], myTurn = cur === playerId && !me.h["k" + ph.k];
        turn.textContent = cur === playerId ? (myTurn ? "👉 ตาคุณ! ใบ้คำ 1 คำ — เหลือ " + Math.ceil(ph.left) + " วิ" : "ส่งแล้ว ✓ รอเพื่อน…") : "ตาของ " + name(cur) + " — เหลือ " + Math.ceil(ph.left) + " วิ";
        barI.style.width = (ph.left / L * 100) + "%"; bar.classList.toggle("hot", ph.left < 3);
        inRow.style.display = myTurn ? "" : "none";
        if(myTurn && lastK !== ph.k){ lastK = ph.k; msg.textContent = ""; inp.value = ""; try{ inp.focus(); }catch(_){} }
      }else if(ph.p === "vote"){
        const voted = ids.filter(id => voteOf(id)).length;
        turn.textContent = "โหวตหาสายลับ! เหลือ " + Math.ceil(ph.left) + " วิ • โหวตแล้ว " + voted + "/" + N;
        barI.style.width = (ph.left / VOTE * 100) + "%"; bar.classList.toggle("hot", ph.left < 5);
        inRow.style.display = "none"; msg.textContent = me.v ? "คุณโหวต " + name(me.v) + " (แตะคนอื่นเพื่อเปลี่ยนได้)" : "แตะ VOTE ที่คนที่คุณคิดว่าเป็นสายลับ";
      }else if(ph.p === "wait"){
        turn.textContent = "นับคะแนนโหวต…"; barI.style.width = "0%"; inRow.style.display = "none";
      }else{ reveal(); return; }
      sync(false);
    }
    update();
    addTimer(setInterval(update, 250));
  }

  /* ===== music button + switch to the livelier loop while a game screen is open ===== */
  (function(){
    const btn = $("musicButton");
    const paint = ()=>{
      const off = KJMusic.isMuted();
      btn.textContent = off ? "🔇" : "🔊";
      btn.classList.toggle("off", off);
      btn.setAttribute("aria-pressed", String(!off));
      btn.title = off ? "เปิดเพลงพื้นหลัง" : "ปิดเพลงพื้นหลัง";
    };
    btn.addEventListener("click", ()=>{ KJMusic.toggle(); paint(); });
    paint();
    const inGame = ()=>["playGameScreen","memoryGameScreen"].some(id=>{ const e = $(id); return e && !e.classList.contains("hidden"); });
    setInterval(()=>KJMusic.setMode(inGame() ? "game" : "lobby"), 600);
  })();

  async function toggleReady(){
    if(!roomCode || !firebaseReady) return;
    const ref = db.ref("rooms/" + roomCode + "/players/" + playerId + "/ready");
    const snap = await ref.once("value");
    await ref.set(!snap.val());
  }

  async function setHostPlays(v){
    if(!isHost || !roomCode || !currentRoomData || currentRoomData.status !== "waiting") return;
    try{ await db.ref("rooms/" + roomCode).update({hostPlays: !!v}); }
    catch(e){ console.error(e); alert("เปลี่ยนโหมด Host ไม่สำเร็จ"); }
  }

  async function hostStartGame(){
    if(!isHost || !roomCode || !currentRoomData) return;
    const entries = Object.values(activePlayers(currentRoomData));
    if(entries.length < 2) return alert(hostSpectates(currentRoomData) ? "ต้องมีผู้เล่นอย่างน้อย 2 คน (ไม่นับ Host ที่คุมห้อง)" : "ต้องมีผู้เล่นอย่างน้อย 2 คน");
    if(!entries.every(p => p.ready)) return alert("ผู้เล่นทุกคนต้อง READY ก่อน");
    if(!gameInfo(currentRoomData.game).ready) return alert("เกมนี้ยังไม่เปิดให้เล่น");
    const startAt = Date.now() + 3000;
    const pl = currentRoomData.playlist || [currentRoomData.game || "memory"];
    if(isTournament(currentRoomData) && pl.length < 2) return alert("ทัวร์นาเมนต์ต้องมีอย่างน้อย 2 รอบ");
    await db.ref("rooms/" + roomCode).update({status:"starting", startAt:startAt, session:startAt, round:0, game:pl[0], scores:null, skipRound:null});
  }

  function startSyncedCountdown(startAt){
    showGameScreen();
    const fresh = startAt - Date.now() > 0;
    const tick = () => {
      const remain = Math.max(0, startAt - Date.now());
      const sec = Math.ceil(remain/1000);
      const title = $("gameScreen").querySelector("h2");
      const desc = $("gameScreen").querySelector("p");
      const button = $("startMemoryRoundButton");
      if(remain > 0){
        title.textContent = String(sec);
        desc.textContent = "GET READY...";
        button.style.display = "none";
        requestAnimationFrame(tick);
      } else {
        title.textContent = gameInfo(currentRoomData && currentRoomData.game).name;
        button.textContent = "START " + title.textContent;
        desc.textContent = "เกมเริ่มแล้ว";
        button.style.display = "inline-block";
        if(fresh && roomCode && !memoryPlaying && !gPlaying && !memoryDone) startSelectedGame();
      }
    };
    tick();
  }

  function showGameScreen(){
    $("lobbyScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");
    $("memoryGameScreen").classList.add("hidden");
    $("playGameScreen").classList.add("hidden");
  }

  function startMemoryGame(){
    stopGame();
    $("playGameScreen").classList.add("hidden");
    memoryPlaying = true;
    memoryDone = false;
    renderRoomResults(currentRoomData);
    memoryLocked = false;
    memoryFirst = null;
    memorySecond = null;
    memoryMatched = 0;
    memoryScore = 0;
    memoryTime = 40;
    const symbols = ["🍎","🍌","🍇","🍉","🍓","🍒","🍋","🥝"];
    memoryDeck = [...symbols,...symbols].sort(() => Math.random()-0.5);
    const board = $("memoryBoard");
    board.innerHTML = "";
    memoryDeck.forEach((symbol,index)=>{
      const card = document.createElement("button");
      card.type = "button";
      card.className = "memory-card";
      card.dataset.index = index;
      card.innerHTML = '<div class="memory-card-inner"><div class="memory-card-back">?</div><div class="memory-card-front"></div></div>';
      card.querySelector(".memory-card-front").textContent = symbol;
      card.addEventListener("click",()=>flipMemoryCard(index));
      board.appendChild(card);
    });
    $("memoryGameScreen").classList.remove("hidden");
    $("gameScreen").classList.add("hidden");
    $("memoryMessage").textContent = "หาคู่ให้ครบ!";
    updateMemoryUI();
    memoryTimer = setInterval(()=>{
      memoryTime--;
      updateMemoryUI();
      if(memoryTime <= 0) finishMemoryGame(false);
    },1000);
  }

  function flipMemoryCard(index){
    if(!memoryPlaying || memoryLocked) return;
    const card = $("memoryBoard").children[index];
    if(!card || card.classList.contains("flipped") || card.classList.contains("matched")) return;
    card.classList.add("flipped");
    if(memoryFirst === null){
      memoryFirst = index;
      return;
    }
    memorySecond = index;
    memoryLocked = true;
    const a = memoryDeck[memoryFirst], b = memoryDeck[memorySecond];
    if(a === b){
      const firstCard = $("memoryBoard").children[memoryFirst];
      const secondCard = $("memoryBoard").children[memorySecond];
      firstCard.classList.add("matched");
      secondCard.classList.add("matched");
      memoryMatched++;
      memoryScore = Math.floor((memoryMatched / 8) * 150);
      memoryFirst = null;
      memorySecond = null;
      memoryLocked = false;
      updateMemoryUI();
      if(memoryMatched === 8) finishMemoryGame(true);
    } else {
      setTimeout(()=>{
        const firstCard = $("memoryBoard").children[memoryFirst];
        const secondCard = $("memoryBoard").children[memorySecond];
        if(firstCard) firstCard.classList.remove("flipped");
        if(secondCard) secondCard.classList.remove("flipped");
        memoryFirst = null;
        memorySecond = null;
        memoryLocked = false;
      },700);
    }
  }

  function updateMemoryUI(){
    $("memoryTime").textContent = memoryTime;
    $("memoryScore").textContent = memoryScore;
    $("memoryPairs").textContent = memoryMatched + "/8";
  }

  function finishMemoryGame(completed){
    if(!memoryPlaying) return;
    memoryPlaying = false;
    clearInterval(memoryTimer);
    memoryTimer = null;
    document.querySelectorAll(".memory-card").forEach(c=>c.disabled=true);
    $("memoryMessage").textContent = completed
      ? "🎉 ครบทุกคู่! คะแนน " + memoryScore
      : "⏰ หมดเวลา! คะแนน " + memoryScore;
    memoryDone = true;
    saveScores("memory", memoryScore);
    renderRoomResults(currentRoomData);
  }

  const MAXES = {memory:150, odd:150, number:150, puzzle:200, mind:150, emoji:150, scramble:150, simon:150, spy:100, chain:150, find:150, code:100};
  /* 12 เกมรวมสูงสุด 3000 คะแนน = เกมละไม่เกิน 250 */
  const TOTAL_CAP = 3000, PER_GAME_CAP = 250;
  async function saveScores(id, score){
    if(!firebaseReady || !currentUser) return;
    const uid = currentUser.uid;
    score = Math.max(0, Math.min(PER_GAME_CAP, Math.floor(Number(score) || 0)));
    try{
      if(roomCode){ const o = {name:playerName}; o[id] = score; await db.ref("rooms/" + roomCode + "/scores/" + uid).update(o); }
    }catch(e){ console.error("Room score error", e); }
    try{
      await db.ref("leaderboard/" + uid).transaction(cur=>{
        cur = cur || {};
        const best = cur.best || {};
        if(!(best[id] >= score)) best[id] = score;
        let total = 0;
        Object.keys(best).forEach(k=>{ if(typeof best[k] === "number") total += best[k]; });
        total = Math.min(TOTAL_CAP, total);
        const sum = (cur.sum || 0) + score, plays = (cur.plays || 0) + 1;
        return {name:playerName, best:best, total:total, sum:sum, plays:plays, avg:Math.round(sum / plays * 10) / 10, wins:cur.wins || 0, tyWins:cur.tyWins || 0, updatedAt:Date.now()};
      });
    }catch(e){ console.error("Leaderboard error", e); }
  }

  function renderRoomResults(data){
    const box = $("roomResults");
    if(!box) return;
    box.innerHTML = "";
    if(!roomCode || !data || !memoryDone) return;
    if(isTournament(data)) return renderTournamentResults(box, data);
    const cur = gameInfo(data.game).id, players = activePlayers(data), scores = data.scores || {};
    const rows = Object.keys(players).map(id=>{
      const s = scores[id] || {};
      let total = 0;
      Object.keys(s).forEach(k=>{ if(typeof s[k] === "number") total += s[k]; });
      return {id:id, name:players[id].name || "PLAYER", total:total, done:typeof s[cur] === "number"};
    }).sort((x,y)=>(y.done - x.done) || (y.total - x.total));
    const done = rows.filter(r=>r.done).length;
    const allDone = rows.length > 0 && done === rows.length;
    const pl = data.playlist || [cur], last = (data.round || 0) >= pl.length - 1;
    if(allDone && last) maybeRecordWin(data, rows.map(r=>({id:r.id, total:r.total})));
    const title = document.createElement("h3");
    title.textContent = allDone ? (last ? "🏆 สรุปผลรวมทั้งหมด" : "🏁 " + gameInfo(cur).name + " • คะแนนรวมตอนนี้") : "รอผู้เล่นอื่น... (" + done + "/" + rows.length + ")";
    box.appendChild(title);
    const medals = ["🥇","🥈","🥉"];
    rows.forEach((r,i)=>{
      const row = document.createElement("div");
      row.className = "result-row" + (r.id === playerId ? " me" : "");
      const rank = document.createElement("b");
      rank.textContent = allDone ? (medals[i] || String(i+1)) : "•";
      const name = document.createElement("span");
      name.textContent = r.name;
      const pts = document.createElement("strong");
      pts.textContent = r.done ? r.total : "กำลังเล่น...";
      row.append(rank, name, pts);
      box.appendChild(row);
    });
    const note = document.createElement("div");
    note.className = "result-note";
    if(allDone && isHost){
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn primary full";
      btn.textContent = last ? "จบเกม • กลับล็อบบี้" : "NEXT ▶ " + gameInfo(pl[(data.round || 0) + 1]).name;
      btn.addEventListener("click", last ? resetRoom : nextGame);
      note.appendChild(btn);
    }else if(allDone){ note.textContent = last ? "รอ Host กลับล็อบบี้" : "รอ Host เริ่มเกมถัดไป"; }
    box.appendChild(note);
  }


  /* ===== TOURNAMENT results: per-round table + final ranking by total score ===== */
  function renderTournamentResults(box, data){
    const players = activePlayers(data), scores = data.scores || {};
    const pl = data.playlist || [], round = data.round || 0, cur = pl[round] || gameInfo(data.game).id;
    const last = round >= pl.length - 1;
    const skipped = data.skipRound === round;
    const rows = Object.keys(players).map(id=>{
      const s = scores[id] || {};
      const per = pl.map(g=> typeof s[g] === "number" ? s[g] : 0);
      const upto = pl.slice(0, round + 1);
      const total = last ? per.reduce((a,b)=>a+b,0) : upto.reduce((a,g)=>a + (typeof s[g] === "number" ? s[g] : 0), 0);
      return {id:id, name:players[id].name || "PLAYER", per:per, total:total, done:typeof s[cur] === "number"};
    });
    const done = rows.filter(r=>r.done).length;
    const allDone = rows.length > 0 && (done === rows.length || skipped);
    // sort: finished first while waiting, then by total (ties keep the same rank)
    rows.sort((x,y)=> allDone ? (y.total - x.total) : ((y.done - x.done) || (y.total - x.total)));
    let rank = 0;
    rows.forEach((r,i)=>{ r.rank = (i > 0 && r.total === rows[i-1].total) ? rows[i-1].rank : i + 1; });

    const finalView = allDone && last;
    if(finalView) maybeRecordWin(data, rows.map(r=>({id:r.id, total:r.total})));
    const maxTotal = pl.reduce((s,id)=>s + (MAXES[id] || 0), 0);
    const title = document.createElement("h3");
    title.textContent = finalView ? "🏆 ผลทัวร์นาเมนต์ • อันดับรวม"
      : allDone ? "🏁 " + gameInfo(cur).name + " • อันดับตอนนี้ (รอบ " + (round + 1) + "/" + pl.length + ")"
      : "รอผู้เล่นอื่น... (" + done + "/" + rows.length + ") • รอบ " + (round + 1) + "/" + pl.length;
    box.appendChild(title);
    if(finalView){
      const sub = document.createElement("div"); sub.className = "t-sub";
      sub.textContent = "คะแนนเต็ม " + maxTotal + " • " + pl.map((g,i)=>"R" + (i+1) + " " + gameInfo(g).name).join(" • ");
      box.appendChild(sub);
    }
    const medals = ["🥇","🥈","🥉"];
    rows.forEach(r=>{
      const row = document.createElement("div");
      row.className = "result-row t-row" + (r.id === playerId ? " me" : "") + (finalView && r.rank <= 3 ? " podium p" + r.rank : "");
      const rk = document.createElement("b");
      rk.textContent = allDone ? (medals[r.rank - 1] || String(r.rank)) : "•";
      const nm = document.createElement("span"); nm.textContent = r.name;
      const pts = document.createElement("strong");
      pts.textContent = (r.done || allDone) ? r.total : "กำลังเล่น...";
      row.append(rk, nm, pts);
      if(allDone){
        const chips = document.createElement("div"); chips.className = "t-chips";
        r.per.forEach((v,i)=>{ if(i <= round){ const c = document.createElement("i"); c.textContent = "R" + (i+1) + " " + v; chips.appendChild(c); } });
        row.appendChild(chips);
      }
      box.appendChild(row);
    });
    const note = document.createElement("div");
    note.className = "result-note";
    if(allDone && isHost){
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn primary full";
      btn.textContent = last ? "จบทัวร์นาเมนต์ • กลับล็อบบี้" : "NEXT ▶ " + gameInfo(pl[round + 1]).name;
      btn.addEventListener("click", last ? resetRoom : nextGame);
      note.appendChild(btn);
    }else if(allDone){
      note.textContent = last ? "รอ Host กลับล็อบบี้" : "รอ Host เริ่มรอบถัดไป";
    }else if(isHost){
      const btn = document.createElement("button");
      btn.type = "button"; btn.className = "btn secondary full";
      btn.textContent = "ข้ามคนที่ยังเล่นไม่เสร็จ (นับ 0 คะแนนรอบนี้)";
      btn.addEventListener("click", async ()=>{
        if(!confirm("ข้ามคนที่ยังเล่นไม่เสร็จ? รอบนี้จะนับเป็น 0 คะแนน")) return;
        try{ await db.ref("rooms/" + roomCode).update({skipRound: round}); }catch(e){ console.error(e); alert("ข้ามไม่สำเร็จ"); }
      });
      note.appendChild(btn);
    }
    box.appendChild(note);
  }

  async function resetRoom(){
    if(!isHost || !roomCode || !currentRoomData) return;
    const updates = {status:"waiting", startAt:null, round:0, scores:null, live:null, skipRound:null};
    Object.keys(currentRoomData.players || {}).forEach(id=>{ updates["players/" + id + "/ready"] = false; });
    try{ await db.ref("rooms/" + roomCode).update(updates); }
    catch(e){ console.error(e); alert("เริ่มรอบใหม่ไม่สำเร็จ"); }
  }

  function returnToLobby(){
    stopGame();
    $("playGameScreen").classList.add("hidden");
    clearInterval(memoryTimer);
    memoryTimer = null;
    memoryPlaying = false;
    memoryDone = false;
    $("memoryGameScreen").classList.add("hidden");
    $("gameScreen").classList.add("hidden");
    renderRoomResults(null);
    openLobby();
  }

  async function loadLeaderboard(){
    const list = $("leaderboardList");
    if(!list || !firebaseReady) return;
    list.textContent = "กำลังโหลด...";
    try{
      const snap = await db.ref("leaderboard").orderByChild("avg").limitToLast(20).once("value");
      const rows = [];
      snap.forEach(c=>{ rows.push({uid:c.key, name:c.val().name || "PLAYER", avg:c.val().avg || 0, plays:c.val().plays || 0}); });
      rows.reverse();
      list.innerHTML = "";
      if(!rows.length){
        list.textContent = "ยังไม่มีคะแนน เล่นเกมแล้วชื่อคุณจะขึ้นที่นี่";
        return;
      }
      rows.forEach((r,i)=>{
        const row = document.createElement("div");
        if(currentUser && r.uid === currentUser.uid) row.className = "me";
        row.dataset.fa = "view"; row.dataset.uid = r.uid;
        const rank = document.createElement("b");
        rank.textContent = String(i+1).padStart(2,"0");
        const name = document.createElement("span");
        name.textContent = r.name;
        const pts = document.createElement("strong");
        pts.textContent = Number(r.avg).toFixed(1);
        row.append(rank, name, pts);
        list.appendChild(row);
      });
    }catch(e){
      console.error("Leaderboard load error", e);
      list.textContent = "โหลดอันดับไม่สำเร็จ (เช็ค Database Rules)";
    }
  }

  /* ===== WINS: the winner(s) of a finished room session get +1 on their profile ===== */
  let winKey = "";
  function maybeRecordWin(data, rows){
    if(!currentUser || !firebaseReady || amSpectator() || !rows || rows.length < 2) return;
    const top = Math.max.apply(null, rows.map(r=>r.total));
    const mine = rows.find(r=>r.id === playerId);
    if(top <= 0 || !mine || mine.total !== top) return;
    const key = roomCode + "|" + (data.session || data.startAt || 0);
    let stored = ""; try{ stored = localStorage.getItem("kyjWinKey") || ""; }catch(e){}
    if(winKey === key || stored === key) return;
    winKey = key; try{ localStorage.setItem("kyjWinKey", key); }catch(e){}
    db.ref("leaderboard/" + currentUser.uid).transaction(cur=>{
      cur = cur || {};
      cur.wins = (cur.wins || 0) + 1;
      if(!cur.name) cur.name = playerName;
      return cur;
    }).catch(e=>{ console.error("Win save error", e); winKey = ""; try{ localStorage.removeItem("kyjWinKey"); }catch(_){} });
  }

  /* ===== TYCOON WINS: separate counter, +1 for the winner of a finished Tycoon game ===== */
  let tyWinKey = "";
  function maybeRecordTyWin(g){
    if(!currentUser || !firebaseReady || !g || g.ph !== "over" || g.win !== playerId || !g.order || g.order.length < 2) return;
    const key = tyCode + "|" + (g.tAt || 0) + "|" + (g.n || 0);
    let stored = ""; try{ stored = localStorage.getItem("kyjTyWinKey") || ""; }catch(e){}
    if(tyWinKey === key || stored === key) return;
    tyWinKey = key; try{ localStorage.setItem("kyjTyWinKey", key); }catch(e){}
    db.ref("leaderboard/" + currentUser.uid).transaction(cur=>{
      cur = cur || {};
      cur.tyWins = (cur.tyWins || 0) + 1;
      if(!cur.name) cur.name = playerName;
      return cur;
    }).catch(e=>{ console.error("Tycoon win save error", e); tyWinKey = ""; try{ localStorage.removeItem("kyjTyWinKey"); }catch(_){} });
  }

  /* ===== PROFILE PICTURE: resized to 160px square in the browser, saved on device + in the user's profile ===== */
  const avKey = () => "kyjAvatar_" + (currentUser ? currentUser.uid : "");
  function paintAvatar(src){
    const box = $("avatarPreview"); if(!box) return;
    box.style.backgroundImage = src ? 'url("' + src + '")' : "";
    box.textContent = src ? "" : "👤";
    box.classList.toggle("has", !!src);
    $("avatarRemove").style.display = src ? "" : "none";
  }
  async function loadAvatar(){
    if(!currentUser) return;
    let src = ""; try{ src = localStorage.getItem(avKey()) || ""; }catch(e){}
    paintAvatar(src);
    try{
      const v = (await db.ref("users/" + currentUser.uid + "/avatar").once("value")).val();
      if(typeof v === "string" && v.indexOf("data:image/") === 0){
        try{ localStorage.setItem(avKey(), v); }catch(e){}
        paintAvatar(v);
      }
    }catch(e){ console.error(e); }
  }
  function resizeToSquare(file){
    return new Promise((resolve, reject)=>{
      const fr = new FileReader();
      fr.onerror = ()=>reject(new Error("read"));
      fr.onload = ()=>{
        const img = new Image();
        img.onerror = ()=>reject(new Error("decode"));
        img.onload = ()=>{
          const S = 160, c = document.createElement("canvas"); c.width = S; c.height = S;
          const m = Math.min(img.width, img.height), sx = (img.width - m) / 2, sy = (img.height - m) / 2;
          const g = c.getContext("2d"); g.fillStyle = "#111"; g.fillRect(0, 0, S, S);
          g.drawImage(img, sx, sy, m, m, 0, 0, S, S);
          resolve(c.toDataURL("image/jpeg", 0.82));
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }
  function initAvatarUI(){
    const inp = $("avatarInput"), rm = $("avatarRemove"), msg = $("avatarMsg");
    if(!inp) return;
    const say = t => { msg.textContent = t || ""; };
    inp.addEventListener("change", async ()=>{
      const f = inp.files && inp.files[0]; inp.value = "";
      if(!f || !currentUser) return;
      if(!/^image\//.test(f.type)) return say("กรุณาเลือกไฟล์รูปภาพ");
      if(f.size > 15 * 1024 * 1024) return say("ไฟล์ใหญ่เกินไป (ไม่เกิน 15MB)");
      say("กำลังอัปโหลด...");
      let url;
      try{ url = await resizeToSquare(f); }catch(e){ return say("เปิดรูปนี้ไม่ได้ ลองรูปอื่น (JPG/PNG)"); }
      try{ localStorage.setItem(avKey(), url); }catch(e){}
      paintAvatar(url);
      try{ await db.ref("users/" + currentUser.uid).update({avatar:url}); syncPublicAvatar(url); say("✅ บันทึกรูปโปรไฟล์แล้ว"); }
      catch(e){ console.error(e); say("บันทึกบนเครื่องนี้แล้ว แต่ยังซิงค์ขึ้นเซิร์ฟเวอร์ไม่ได้ (เช็ค Database Rules)"); }
    });
    rm.addEventListener("click", async ()=>{
      if(!currentUser) return;
      try{ localStorage.removeItem(avKey()); }catch(e){}
      paintAvatar("");
      try{ await db.ref("users/" + currentUser.uid + "/avatar").remove(); syncPublicAvatar(""); say("ลบรูปแล้ว"); }catch(e){ console.error(e); say("ลบบนเครื่องนี้แล้ว"); }
    });
  }

  async function loadProfile(){
    const box = $("profileInfo");
    if(!box || !currentUser) return;
    let best = {}, total = 0, wins = 0, tyWins = 0, avg = 0, plays = 0;
    try{
      const snap = await db.ref("leaderboard/" + currentUser.uid).once("value");
      const v = snap.val() || {};
      best = v.best || {};
      total = v.total || 0;
      wins = v.wins || 0;
      tyWins = v.tyWins || 0;
      avg = v.avg || 0;
      plays = v.plays || 0;
    }catch(e){ console.error(e); }
    box.innerHTML = "";
    [["PLAYER", playerName || "-"],["EMAIL", currentUser.email || "-"],["🏆 WINS", wins],["🎲 TYCOON WINS", tyWins],["AVG SCORE", Number(avg).toFixed(1)],["GAMES PLAYED", plays],["TOTAL SCORE", total]].concat(GAMES.map(g=>[g.name + " BEST", best[g.id] || 0])).forEach(pair=>{
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = pair[0];
      const val = document.createElement("strong");
      val.textContent = pair[1];
      row.append(label, val);
      box.appendChild(row);
    });
    const nm = $("profileName"), wb = $("profileWins");
    if(nm) nm.textContent = playerName || "PLAYER";
    if(wb) wb.textContent = "🏆 ชนะ " + wins + " ครั้ง";
    loadAvatar();
    paintMyPid();
    if(!myPid) ensurePublicProfile();
  }

  function exitMemoryGame(){
    clearInterval(memoryTimer);
    memoryPlaying = false;
    $("memoryGameScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");
  }

  async function logout(){
    try{
      if(roomCode) await leaveRoom();
      if(tyCode) await tyLeave();
      closeProfile(); unwatchFriends(); myPid = "";
      await auth.signOut();
      localStorage.removeItem("kyjPlayerId");
      localStorage.removeItem("kyjPlayerName");
      playerId = "";
      playerName = "";
      showPage("home");
    }catch(e){ setAuthMessage(friendlyAuthError(e)); }
  }

  async function leaveRoom(){
    if(roomCode && firebaseReady){
      try{
        await db.ref("rooms/" + roomCode + "/players/" + playerId).remove();
        if(isHost) await db.ref("rooms/" + roomCode).remove();
      }catch(e){ console.error(e); }
    }
    clearRoomState();
  }

  /* ===== AUTO-DELETE STALE ROOMS: rooms idle for 1 hour are removed (normal, tournament and tycoon) ===== */
  const ROOM_TTL_MS = 60 * 60 * 1000;      // 1 hour
  const ROOM_SWEEP_MS = 60 * 60 * 1000;    // sweep every hour
  const ROOM_BEAT_MS = 5 * 60 * 1000;      // players in a room mark it "alive" every 5 min
  async function cleanupStaleRooms(){
    if(!firebaseReady || !currentUser) return;
    const cutoff = Date.now() - ROOM_TTL_MS;
    try{
      const snap = await db.ref("rooms").orderByChild("createdAt").endAt(cutoff).limitToFirst(200).once("value");
      const jobs = [];
      snap.forEach(c=>{
        const v = c.val() || {};
        if(Math.max(v.createdAt || 0, v.lastActive || 0) > cutoff) return;
        if(c.key === roomCode || (typeof tyCode !== "undefined" && c.key === tyCode)) return;
        jobs.push(db.ref("rooms/" + c.key).remove().catch(()=>{}));
      });
      await Promise.all(jobs);
    }catch(e){ console.warn("Room cleanup skipped:", e && e.message); }
  }
  function roomHeartbeat(){
    if(!firebaseReady || !currentUser) return;
    [roomCode, (typeof tyCode !== "undefined" ? tyCode : "")].forEach(code=>{
      if(code) db.ref("rooms/" + code + "/lastActive").set(firebase.database.ServerValue.TIMESTAMP).catch(()=>{});
    });
  }
  setInterval(roomHeartbeat, ROOM_BEAT_MS);
  setInterval(cleanupStaleRooms, ROOM_SWEEP_MS);
  setTimeout(cleanupStaleRooms, 8000);

  function clearRoomState(){
    if(roomListener) roomListener.off();
    roomListener = null;
    stopGame();
    $("playGameScreen").classList.add("hidden");
    clearInterval(memoryTimer);
    memoryTimer = null;
    memoryPlaying = false;
    memoryDone = false;
    lastStartAt = null;
    roomCode = "";
    isHost = false;
    currentRoomData = null;
    localStorage.removeItem("kyjRoom");
    $("lobbyScreen").classList.add("hidden");
    $("gameScreen").classList.add("hidden");
    $("memoryGameScreen").classList.add("hidden");
    $("roomPanel").classList.remove("hidden");
    document.querySelector(".arena-stats").classList.remove("hidden");
    document.querySelector(".section-title.compact").classList.remove("hidden");
    document.querySelector(".game-grid").classList.remove("hidden");
  }

  $("createRoomButton").addEventListener("click",()=>createRoom("normal"));
  $("createTournamentButton").addEventListener("click",()=>createRoom("tournament"));
  $("joinRoomButton").addEventListener("click",joinRoom);
  $("roomCodeInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  $("readyButton").addEventListener("click",toggleReady);
  if($("hostPlaysToggle")) $("hostPlaysToggle").addEventListener("change",e=>setHostPlays(e.target.checked));
  initAvatarUI();
  $("hostStartButton").addEventListener("click",hostStartGame);
  $("leaveRoomButton").addEventListener("click",leaveRoom);
  $("copyRoomButton").addEventListener("click",async()=>{
    try{
      await navigator.clipboard.writeText(roomCode);
      $("copyRoomButton").textContent="COPIED!";
      setTimeout(()=>$("copyRoomButton").textContent="COPY",1200);
    }catch(e){
      alert("รหัสห้อง: " + roomCode);
    }
  });
  const pmBtn=$("playMemoryButton");
  if(pmBtn) pmBtn.addEventListener("click",()=>{
    showPage("arena");
    startMemoryGame();
  });
  $("startMemoryRoundButton").addEventListener("click",startSelectedGame);
  $("exitPlayButton").addEventListener("click",()=>{ stopGame(); $("playGameScreen").classList.add("hidden"); $("gameScreen").classList.remove("hidden"); });
  document.querySelectorAll("[data-play]").forEach(b=>b.addEventListener("click",()=>{ showPage("arena"); startGameById(b.dataset.play); }));
  /* stats bar: computed from the real game list, so it stays correct when games change */
  (function(){
    const ready = GAMES.filter(g=>g.ready);
    const sg = $("statGames"), sm = $("statMaxScore");
    if(sg) sg.textContent = ready.length;
    if(sm) sm.textContent = ready.reduce((s,g)=>s + (MAXES[g.id] || g.max || 0), 0);
  })();
  $("exitMemoryButton").addEventListener("click",exitMemoryGame);
  $("backToLobbyButton").addEventListener("click",()=>{
    $("gameScreen").classList.add("hidden");
    if(roomCode) $("lobbyScreen").classList.remove("hidden");
    else $("roomPanel").classList.remove("hidden");
  });

  /* ===== KAYEEJAI TYCOON (เกมเศรษฐี) ===== */
  const TY_TILES = [
    {t:"start",n:"START",i:"🚀"},
    {t:"p",n:"Memory Cafe",i:"🃏",p:60,g:0},
    {t:"p",n:"Aim Range",i:"🦅",p:80,g:0},
    {t:"chance",n:"CHANCE",i:"🎁"},
    {t:"p",n:"Number Tower",i:"🔢",p:100,g:1},
    {t:"p",n:"Puzzle Park",i:"🧩",p:120,g:1},
    {t:"jail",n:"JAIL",i:"🚔"},
    {t:"p",n:"Target Alley",i:"🎯",p:140,g:2},
    {t:"tax",n:"TAX",i:"💸"},
    {t:"p",n:"Push Dojo",i:"🥊",p:160,g:2},
    {t:"p",n:"Lava Lounge",i:"🌋",p:180,g:3},
    {t:"chance",n:"CHANCE",i:"🎁"},
    {t:"park",n:"PARKING",i:"🅿️"},
    {t:"p",n:"Impostor Inn",i:"🕵️",p:200,g:3},
    {t:"p",n:"Flag Fort",i:"🚩",p:220,g:4},
    {t:"p",n:"Traffic Plaza",i:"🚦",p:240,g:4},
    {t:"p",n:"Bomb Bay",i:"💣",p:260,g:5},
    {t:"chance",n:"CHANCE",i:"🎁"},
    {t:"gojail",n:"GO JAIL",i:"👮"},
    {t:"p",n:"Final Stadium",i:"🏁",p:300,g:5},
    {t:"tax",n:"TAX",i:"💸"},
    {t:"p",n:"Arena Mall",i:"🎮",p:320,g:6},
    {t:"p",n:"Champion Hall",i:"🏆",p:350,g:6},
    {t:"p",n:"KAYEEJAI Tower",i:"👑",p:400,g:6}
  ];
  const TY_FACES = ["🐱","🐶","🐰","🦊","🐼","🐸","🐵","🦁","🐯","🐻","🐧","🦄"];
  const TY_HATS = ["","👑","🎩","🧢","🎓","🤠","🎀","🌸"];
  const TY_AVC = ["#ff6b6b","#ffa94d","#ffd43b","#69db7c","#4dabf7","#9775fa","#f783ac","#dee2e6"];
  const TY_DICE_MS = 1100, TY_STEP_MS = 380;
  const TY_PIPS = {1:[4],2:[2,6],3:[2,4,6],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
  const TY_DIE_ROT = {1:[0,0],2:[0,-90],3:[-90,0],4:[90,0],5:[0,90],6:[0,180]};
  const TY_DIE_FACES = [1,2,3,4,5,6].map(n=>'<div class="face f' + n + '">' + [0,1,2,3,4,5,6,7,8].map(i=>'<i' + (TY_PIPS[n].indexOf(i) >= 0 ? ' class="p"' : '') + '></i>').join("") + '</div>').join("");
  const TY_COL = ["#ff6b6b","#ffa94d","#ffd43b","#69db7c","#4dabf7","#9775fa","#f783ac"];
  const TY_START = 700, TY_GO = 200, TY_TAX = 100, TY_TURN_MS = 60000, TY_FACE = "⚀⚁⚂⚃⚄⚅";
  let tyCode = localStorage.getItem("kyjTyRoom") || "", tyRef = null, tyRoom = null, tyG = null;
  let tyLastRoll = null, tyRollStart = 0;
  let tyShown = {}, tyAnim = {}, tyRolling = false, tyTick = null, tySeenT = 0, tySeenAt = 0;

  const tyEsc = s=>String(s == null ? "" : s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const tyClone = o=>JSON.parse(JSON.stringify(o));
  const tyFix = g=>{ ["own","out","jail","pos","cash","nm","av"].forEach(k=>{ g[k] = g[k] || {}; }); g.log = g.log || []; return g; };
  const tyLog = (g,m)=>{ g.log.push(m); while(g.log.length > 8) g.log.shift(); };
  const tyPresent = ()=>((tyRoom && tyRoom.players) || {});
  const tyGrp = i=>TY_TILES.map((t,k)=>(t.t === "p" && t.g === TY_TILES[i].g) ? k : -1).filter(k=>k >= 0);
  const TY_XY = i=>i <= 6 ? [6, 6-i] : i <= 12 ? [6-(i-6), 0] : i <= 18 ? [0, i-12] : [i-18, 6];

  function tyNormAv(a, idx){
    if(typeof a === "string") a = {f:a};
    a = a || {};
    const f = (typeof a.f === "string" && a.f) ? Array.from(a.f).slice(0,8).join("") : TY_FACES[idx % TY_FACES.length];
    const h = TY_HATS.indexOf(a.h) >= 0 ? a.h : "";
    const c = (Number.isInteger(a.c) && a.c >= 0 && a.c < TY_AVC.length) ? a.c : idx % TY_AVC.length;
    return {f:f, h:h, c:c};
  }
  const tyAvOf = (g,u)=>tyNormAv(g.av && g.av[u], Math.max(0, g.order.indexOf(u)));
  const tyTokHtml = (av, cls)=>'<i class="ty-tk' + (cls ? " " + cls : "") + '" style="--c:' + TY_AVC[av.c] + '"><span class="tk-f">' + tyEsc(av.f) + '</span>' + (av.h ? '<span class="tk-h">' + av.h + '</span>' : "") + '</i>';
  const tyTakenCols = pl=>Object.keys(pl || {}).filter(k=>k !== playerId && pl[k] && pl[k].av && Number.isInteger(pl[k].av.c)).map(k=>pl[k].av.c);
  function tyMyChar(pl){
    let saved = null;
    try{ saved = JSON.parse(localStorage.getItem("kyjTyChar") || "null"); }catch(e){}
    const n = tyNormAv(saved || {f:TY_FACES[Math.floor(Math.random()*TY_FACES.length)]}, 0), taken = tyTakenCols(pl);
    if(taken.indexOf(n.c) >= 0){ const free = TY_AVC.findIndex((x,i)=>taken.indexOf(i) < 0); if(free >= 0) n.c = free; }
    return n;
  }
  function tySetChar(patch){
    if(!tyRoom || !tyRef || tyRoom.status !== "lobby") return;
    const pl = tyRoom.players || {}, nx = Object.assign({}, tyNormAv(pl[playerId] && pl[playerId].av, 0), patch);
    if(patch.c !== undefined && tyTakenCols(pl).indexOf(nx.c) >= 0) return;
    localStorage.setItem("kyjTyChar", JSON.stringify(nx));
    if(currentUser) db.ref("users/" + currentUser.uid + "/tyChar").set(nx).catch(()=>{});
    db.ref("rooms/" + tyCode + "/players/" + playerId + "/av").set(nx).catch(e=>console.error(e));
  }
  function tyRenderCreator(pl){
    const prev = $("tyAvPrev"); if(!prev) return;
    const me = tyNormAv(pl[playerId] && pl[playerId].av, 0), taken = tyTakenCols(pl);
    const btn = (k,v,label,sel,extra)=>'<button type="button" class="ty-opt' + (sel ? " sel" : "") + '" data-k="' + k + '" data-v="' + tyEsc(v) + '"' + (extra || "") + '>' + label + '</button>';
    prev.innerHTML = tyTokHtml(me, "big");
    $("tyAvFaces").innerHTML = TY_FACES.map(f=>btn("f", f, f, f === me.f)).join("");
    $("tyAvHats").innerHTML = TY_HATS.map(h=>btn("h", h, h || "🚫", h === me.h)).join("");
    $("tyAvColors").innerHTML = TY_AVC.map((c,i)=>btn("c", i, "", i === me.c, ' style="background:' + c + '"' + (taken.indexOf(i) >= 0 ? " disabled" : ""))).join("");
  }
  const tyBusy = ()=>!!((tyRollStart && Date.now() - tyRollStart < TY_DICE_MS) || Object.keys(tyAnim).some(u=>tyAnim[u]));
  function tyDieHtml(v, el, k){
    const r = TY_DIE_ROT[v] || TY_DIE_ROT[1], on = el >= 0, dl = on ? "animation-delay:-" + Math.round(el) + "ms;" : "";
    return '<div class="die-wrap k' + k + (on ? " roll" : "") + '" style="' + dl + '"><div class="die" style="--fx:' + r[0] + 'deg;--fy:' + r[1] + 'deg;' + dl + '">' + TY_DIE_FACES + '</div></div>';
  }

  function tyRent(g,i){
    const o = g.own["t"+i], T = TY_TILES[i];
    const mono = tyGrp(i).every(k=>g.own["t"+k] && g.own["t"+k].o === o.o);
    return Math.round(T.p/5 * [1,2.5,4][o.l || 0] * (mono ? 2 : 1));
  }
  function tyWorth(g,u){
    let w = g.cash[u] || 0;
    Object.keys(g.own).forEach(k=>{ const o = g.own[k]; if(o.o === u){ const p = TY_TILES[+k.slice(1)].p; w += p + (o.l || 0)*p/2; } });
    return Math.round(w);
  }
  function tyBust(g,u){
    g.out[u] = 1; g.cash[u] = 0;
    Object.keys(g.own).forEach(k=>{ if(g.own[k].o === u) delete g.own[k]; });
  }
  function tyPay(g,from,to,amt){
    const have = Math.max(0, g.cash[from] || 0);
    g.cash[from] = (g.cash[from] || 0) - amt;
    if(to) g.cash[to] = (g.cash[to] || 0) + Math.min(amt, have);
    if(g.cash[from] < 0){ tyBust(g, from); tyLog(g, "💥 " + g.nm[from] + " ล้มละลาย!"); }
  }
  function tyEndTurn(g){
    const pres = tyPresent();
    g.order.forEach(u=>{ if(!g.out[u] && !pres[u]){ tyBust(g,u); tyLog(g, "🚪 " + g.nm[u] + " ออกจากเกม"); } });
    const live = g.order.filter(u=>!g.out[u]);
    g.n = (g.n || 0) + 1;
    if(live.length <= 1){
      g.ph = "over"; g.at = null;
      g.win = live.slice().sort((a,b)=>tyWorth(g,b) - tyWorth(g,a))[0] || g.cur;
      tyLog(g, "🏆 จบเกม!");
      return g;
    }
    let i = g.order.indexOf(g.cur);
    do{ i = (i+1) % g.order.length; }while(g.out[g.order[i]]);
    g.cur = g.order[i]; g.ph = "roll"; g.tAt = Date.now(); g.at = null;
    return g;
  }
  function tyChance(g,u){
    const c = Math.floor(Math.random()*6), nm = g.nm[u];
    if(c === 0){ g.cash[u] += 150; tyLog(g, "🎁 " + nm + " ได้โบนัส +150"); }
    else if(c === 1){ tyLog(g, "🎁 " + nm + " ค่าซ่อมระบบ -100"); tyPay(g,u,null,100); }
    else if(c === 2){ g.pos[u] = 0; g.cash[u] += TY_GO; tyLog(g, "🎁 " + nm + " วาร์ปไป START +" + TY_GO); }
    else if(c === 3){ g.pos[u] = 6; g.jail[u] = 2; tyLog(g, "🎁 " + nm + " ถูกจับเข้าคุก!"); }
    else if(c === 4){
      tyLog(g, "🎁 " + nm + " เก็บเงินสนับสนุนคนละ 40");
      g.order.forEach(o=>{ if(o !== u && !g.out[o]) tyPay(g,o,u,40); });
    }
    else{ g.cash[u] += 80; tyLog(g, "🎁 " + nm + " ชนะแจ็คพอต +80"); }
  }
  function tyRoll(g,d1,d2){
    const u = g.cur, nm = g.nm[u], jl = g.jail[u] || 0;
    g.dice = [d1,d2]; g.rid = (g.rid || 0) + 1;
    if(jl){
      if(d1 === d2){ g.jail[u] = 0; tyLog(g, "🎲 " + nm + " ทอยได้แต้มคู่ ออกจากคุก!"); }
      else{ g.jail[u] = jl - 1; tyLog(g, "🚔 " + nm + " ยังติดคุก"); return tyEndTurn(g); }
    }
    const from = g.pos[u] || 0, to = (from + d1 + d2) % 24;
    g.pos[u] = to;
    if(from + d1 + d2 >= 24){ g.cash[u] += TY_GO; tyLog(g, "🚀 " + nm + " ผ่าน START +" + TY_GO); }
    const T = TY_TILES[to], ow = g.own["t"+to];
    if(T.t === "p"){
      if(!ow){
        if(g.cash[u] >= T.p){ g.ph = "buy"; g.at = to; g.tAt = Date.now(); return g; }
        tyLog(g, nm + " เงินไม่พอซื้อ " + T.n);
      }else if(ow.o === u){
        if((ow.l || 0) < 2 && g.cash[u] >= T.p/2){ g.ph = "up"; g.at = to; g.tAt = Date.now(); return g; }
      }else{
        const r = tyRent(g,to);
        tyLog(g, "💰 " + nm + " จ่ายค่าเช่า " + r + " ให้ " + g.nm[ow.o]);
        tyPay(g,u,ow.o,r);
      }
    }else if(T.t === "tax"){ tyLog(g, "💸 " + nm + " จ่ายภาษี " + TY_TAX); tyPay(g,u,null,TY_TAX); }
    else if(T.t === "gojail"){ g.pos[u] = 6; g.jail[u] = 2; tyLog(g, "👮 " + nm + " ถูกจับเข้าคุก!"); }
    else if(T.t === "chance") tyChance(g,u);
    return tyEndTurn(g);
  }

  const tyCommit = g=>{ if(tyRef) tyRef.child("g").set(g).catch(e=>{ console.error(e); alert("ส่งข้อมูลไม่สำเร็จ ลองอีกครั้ง"); }); };
  function tyAct(a){
    if(!tyG || tyG.cur !== playerId || tyRolling || tyBusy()) return;
    const g = tyClone(tyG); tyFix(g);
    const u = playerId, i = g.at, T = TY_TILES[i] || {};
    if(a === "roll" && g.ph === "roll"){
      tyRolling = true; setTimeout(()=>{ tyRolling = false; }, 1500);
      tyCommit(tyRoll(g, 1+Math.floor(Math.random()*6), 1+Math.floor(Math.random()*6)));
    }else if(a === "buy" && g.ph === "buy"){
      g.cash[u] -= T.p; g.own["t"+i] = {o:u, l:0}; tyLog(g, "🏠 " + g.nm[u] + " ซื้อ " + T.n + " -" + T.p);
      tyCommit(tyEndTurn(g));
    }else if(a === "up" && g.ph === "up"){
      const o = g.own["t"+i]; g.cash[u] -= T.p/2; o.l = (o.l || 0) + 1;
      tyLog(g, "⬆️ " + g.nm[u] + " อัปเกรด " + T.n + " เป็นระดับ " + o.l);
      tyCommit(tyEndTurn(g));
    }else if(a === "skip" && (g.ph === "buy" || g.ph === "up")){
      tyCommit(tyEndTurn(g));
    }
  }

  function tyMove(u,to){
    if(tyShown[u] === undefined){ tyShown[u] = to; return; }
    if(tyShown[u] === to || tyAnim[u]) return;
    if((to - tyShown[u] + 24) % 24 > 12){ tyShown[u] = to; return; }
    const wait = Math.max(0, tyRollStart + TY_DICE_MS - Date.now());
    const stepFn = ()=>{
      const tgt = tyG && tyG.pos[u] !== undefined ? tyG.pos[u] : to;
      tyShown[u] = (tyShown[u] + 1) % 24;
      if(tyShown[u] === tgt) tyAnim[u] = null; else tyAnim[u] = setTimeout(stepFn, TY_STEP_MS);
      tyDraw();
    };
    tyAnim[u] = setTimeout(stepFn, wait + 250);
  }
  /* ===== Tycoon deed popup (BUY / UPGRADE) ===== */
  let tyDeedWant = false, tyDeedKey = "", tyDeedHid = null, tyDeedCur = "";
  const tyRentAt = (g,i,lv,u)=>{
    const T = TY_TILES[i], mono = tyGrp(i).every(k=>k === i || (g.own["t"+k] && g.own["t"+k].o === u));
    return Math.round(T.p/5 * [1,2.5,4][lv] * (mono ? 2 : 1));
  };
  const tyTimeLeft = ()=>Math.max(0, Math.ceil((TY_TURN_MS - (Date.now() - tySeenAt))/1000));
  function tyDeedHtml(g, me, T, i, o){
    const up = g.ph === "up", lv = up ? ((o && o.l) || 0) : 0, cash = g.cash[me] || 0, cost = up ? T.p/2 : T.p;
    const grp = tyGrp(i), mono = grp.every(k=>k === i || (g.own["t"+k] && g.own["t"+k].o === me));
    const cells = [0,1,2].map(k=>{
      const cls = up ? (k === lv ? " now" : (k === lv+1 ? " next" : "")) : (k === 0 ? " next" : "");
      return '<div class="dd-r' + cls + '"><span>' + (k ? "★".repeat(k) : "ปกติ") + '</span><b>' + tyRentAt(g,i,k,me) + '</b></div>';
    }).join("");
    const left = tyTimeLeft();
    return '<div class="dd-band" style="--g:' + TY_COL[T.g] + '"></div>' +
      '<div class="dd-head"><div class="dd-ico">' + T.i + '</div><div><small>' + (up ? "อัปเกรดทรัพย์สิน" : "โฉนดที่ดิน") + '</small><h3 id="tyDeedName">' + tyEsc(T.n) + '</h3></div></div>' +
      '<div class="dd-price"><span>' + (up ? "ค่าอัปเกรด" : "ราคา") + '</span><strong>' + cost + '</strong></div>' +
      '<div class="dd-rent"><small>ค่าเช่าที่เก็บจากผู้เล่นอื่น</small><div class="dd-rg">' + cells + '</div>' +
      '<p class="dd-note">' + (mono ? "ครบโซนสีนี้แล้ว ค่าเช่า ×2" : "ครบโซนสีนี้ (" + grp.length + " ที่) ค่าเช่า ×2") + '</p></div>' +
      '<div class="dd-cash"><span>เงินของคุณ</span><b>' + cash + '</b><i>→</i><b class="after">' + (cash - cost) + '</b></div>' +
      '<div class="dd-timer"><div class="dd-bar"><i id="tyDeedBar" style="width:' + Math.round(left/(TY_TURN_MS/1000)*100) + '%"></i></div>' +
      '<p>ตัดสินใจภายใน <b id="tyDeedSec">' + left + '</b> วินาที</p></div>' +
      '<div class="dd-btns"><button class="dd-btn go" data-a="' + (up ? "up" : "buy") + '" type="button">' + (up ? "UPGRADE" : "BUY") + '<small>-' + cost + '</small></button>' +
      '<button class="dd-btn no" data-a="skip" type="button">SKIP</button></div>';
  }
  function tyDeedSync(){
    const modal = $("tyModal"); if(!modal) return;
    const pg = $("page-tycoon"), on = tyDeedWant && !!pg && pg.classList.contains("active");
    modal.classList.toggle("hidden", !on);
    document.body.classList.toggle("ty-modal-open", on);
  }
  function tyDeedTimer(){
    const s = $("tyDeedSec"), b = $("tyDeedBar"); if(!s || !b) return;
    const left = tyTimeLeft();
    s.textContent = left; b.style.width = Math.round(left/(TY_TURN_MS/1000)*100) + "%";
    b.parentNode.parentNode.classList.toggle("urgent", left <= 10);
  }
  function tyDeedRender(g, mine, T, o){
    if(!$("tyModal")) return;
    const me = playerId, key = g.tAt + ":" + g.ph + ":" + g.at;
    const decision = mine && !g.out[me] && g.ph !== "over" && (g.ph === "buy" || g.ph === "up");
    if(!decision) tyDeedHid = null;
    const want = decision && !tyBusy();
    if(want){
      const rk = key + ":" + (g.cash[me] || 0);
      if(rk !== tyDeedCur){
        tyDeedCur = rk;
        $("tyDeed").innerHTML = tyDeedHtml(g, me, T, g.at, o);
        $("tyDeed").classList.remove("pop"); void $("tyDeed").offsetWidth; $("tyDeed").classList.add("pop");
      }
    }else if(!decision) tyDeedCur = "";
    tyDeedKey = key;
    tyDeedWant = want && tyDeedHid !== key;
    tyDeedSync();
    if(tyDeedWant){ const f = $("tyDeed").querySelector(".dd-btn.go"); if(f && !$("tyModal").dataset.f){ $("tyModal").dataset.f = "1"; f.focus({preventScroll:true}); } }
    else delete $("tyModal").dataset.f;
  }
  function tyDeedClose(){ tyDeedHid = tyDeedKey; tyDeedWant = false; tyDeedSync(); }

  function tyDraw(){
    const g = tyG; if(!g || !$("tyBoard")) return;
    let h = "";
    TY_TILES.forEach((T,i)=>{
      const xy = TY_XY(i), o = g.own["t"+i];
      let toks = "";
      g.order.forEach(u=>{ if(!g.out[u] && tyShown[u] === i) toks += tyTokHtml(tyAvOf(g,u), g.cur === u && g.ph !== "over" ? "on" : ""); });
      h += '<div class="ty-t' + (T.t === "p" ? "" : " sp") + (g.ph !== "over" && g.at === i ? " hot" : "") + '" style="grid-area:' + (xy[0]+1) + '/' + (xy[1]+1) + '">' +
        (T.t === "p" ? '<span class="st" style="background:' + TY_COL[T.g] + '"></span>' : "") +
        '<span class="ti">' + T.i + '</span><b>' + (T.t === "p" ? T.p : T.n) + '</b>' +
        (o ? '<span class="ow" style="background:' + TY_AVC[tyAvOf(g,o.o).c] + '"></span>' + (o.l ? '<em>' + "★".repeat(o.l) + '</em>' : "") : "") +
        '<div class="ty-toks">' + toks + '</div></div>';
    });
    const d = g.dice || [1,1], dEl = (tyRollStart && Date.now() - tyRollStart < TY_DICE_MS) ? Date.now() - tyRollStart : -1, rd = Math.floor((g.n || 0) / g.order.length) + 1;
    h += '<div class="ty-mid"><svg class="ty-k" viewBox="0 0 128 128" role="img" aria-label="KAYEEJAI"><use href="#i-klogo"/></svg><div class="ty-dice" id="tyDice">' + tyDieHtml(d[0], dEl, 0) + tyDieHtml(d[1], dEl, 1) + '</div>' +
      '<div class="ty-turn">' + (g.ph === "over" ? "GAME OVER" : "ตา: " + tyEsc(g.nm[g.cur])) + '</div><small>ROUND ' + rd + ' • <span id="tyTimer"></span></small></div>';
    $("tyBoard").innerHTML = h;

    const me = playerId, mine = g.cur === me, T = TY_TILES[g.at] || {}, o = g.own["t"+g.at];
    let c = "";
    if(tyBusy()){
      c = '<div class="ty-wait">🎲 กำลังเดิน...</div>';
    }else if(g.ph === "over"){
      c = '<div class="ty-msg win">🏆 ' + tyEsc(g.nm[g.win]) + ' ชนะ!</div>' +
        (tyRoom.hostId === me ? '<button class="btn primary full" data-a="again" type="button">เล่นอีกรอบ</button>' : '<div class="ty-wait">รอ Host เริ่มรอบใหม่</div>') +
        '<button class="btn secondary full" data-a="back" type="button" style="margin-top:8px">ออกจากห้อง</button>';
    }else if(g.out[me]){
      c = '<div class="ty-wait">💀 คุณล้มละลายแล้ว รอดูจนจบเกม</div>';
    }else if(mine && g.ph === "roll"){
      c = '<div class="ty-msg">' + (g.jail[me] ? "🚔 ติดคุก ทอยแต้มคู่เพื่อออก" : "ถึงตาคุณ!") + '</div><button class="btn primary full" data-a="roll" type="button">🎲 ROLL</button>';
    }else if(mine && g.ph === "buy"){
      c = '<div class="ty-msg">ซื้อ ' + T.i + ' ' + T.n + ' ราคา ' + T.p + '? (ค่าเช่า ' + Math.round(T.p/5) + ')</div>' +
        '<div class="ty-two"><button class="btn primary" data-a="buy" type="button">BUY</button><button class="btn secondary" data-a="skip" type="button">SKIP</button></div>';
    }else if(mine && g.ph === "up"){
      c = '<div class="ty-msg">อัปเกรด ' + T.i + ' ' + T.n + ' เป็นระดับ ' + (((o && o.l) || 0) + 1) + ' ราคา ' + (T.p/2) + '?</div>' +
        '<div class="ty-two"><button class="btn primary" data-a="up" type="button">UPGRADE</button><button class="btn secondary" data-a="skip" type="button">SKIP</button></div>';
    }else{
      c = '<div class="ty-wait">⏳ รอ ' + tyEsc(g.nm[g.cur]) + ' ...</div>';
    }
    $("tyCtl").innerHTML = c;
    tyDeedRender(g, mine, T, o);

    $("tyPlayers").innerHTML = g.order.map(u=>{
      const props = Object.keys(g.own).filter(k=>g.own[k].o === u).length;
      return '<div class="ty-p' + (g.cur === u && g.ph !== "over" ? " cur" : "") + (g.out[u] ? " dead" : "") + (u === me ? " me" : "") + '">' +
        tyTokHtml(tyAvOf(g,u)) + '<span>' + tyEsc(g.nm[u]) + (g.jail[u] && !g.out[u] ? " 🚔" : "") + (g.out[u] ? " 💀" : "") + '</span>' +
        '<em>🏠' + props + '</em><strong>💰' + (g.cash[u] || 0) + '</strong></div>';
    }).join("");
    $("tyLog").innerHTML = g.log.slice().reverse().map(m=>'<div>' + tyEsc(m) + '</div>').join("");
  }

  function tyRenderLobby(){
    const pl = tyRoom.players || {}, ids = Object.keys(pl), host = tyRoom.hostId === playerId;
    $("tyCodeShow").textContent = tyCode;
    const list = $("tyPlayerList"); list.innerHTML = "";
    ids.forEach(id=>{
      const d = document.createElement("div"); d.className = "lobby-player";
      const n = document.createElement("span"); n.innerHTML = tyTokHtml(tyNormAv(pl[id].av, 0), "sm") + " " + tyEsc((pl[id].name || "PLAYER") + (id === tyRoom.hostId ? " 👑" : ""));
      d.appendChild(n); list.appendChild(d);
    });
    tyRenderCreator(pl);
    $("tyLobbyStatus").textContent = ids.length < 2 ? "ต้องมีผู้เล่นอย่างน้อย 2 คน (สูงสุด 6) • " + ids.length + "/6" : (host ? "พร้อมแล้ว กด START ได้เลย • " + ids.length + "/6" : "รอ Host เริ่มเกม • " + ids.length + "/6");
    $("tyStart").style.display = host ? "block" : "none";
  }
  function tyRender(){
    if(!tyRoom) return;
    if(!(tyRoom.players && tyRoom.players[playerId])){ tyReset(); return; }
    $("tyPanel").classList.add("hidden");
    const playing = tyRoom.status !== "lobby" && !!tyG;
    $("tyLobby").classList.toggle("hidden", playing);
    $("tyGame").classList.toggle("hidden", !playing);
    if(!playing){
      Object.keys(tyAnim).forEach(u=>clearTimeout(tyAnim[u])); tyAnim = {}; tyShown = {}; tyLastRoll = null; tyRollStart = 0;
      tyRenderLobby(); return;
    }
    if(tyG.tAt !== tySeenT){ tySeenT = tyG.tAt; tySeenAt = Date.now(); }
    const rid = tyG.rid || 0;
    if(tyLastRoll === null) tyLastRoll = rid;
    else if(rid !== tyLastRoll){ tyLastRoll = rid; tyRollStart = Date.now(); setTimeout(tyDraw, TY_DICE_MS + 60); }
    Object.keys(tyG.pos).forEach(u=>tyMove(u, tyG.pos[u]));
    maybeRecordTyWin(tyG);
    tyDraw();
  }
  function tyTickFn(){
    if(!tyG || !tyRoom || tyG.ph === "over") return;
    const left = Math.max(0, Math.ceil((TY_TURN_MS - (Date.now() - tySeenAt))/1000)), el = $("tyTimer");
    if(el) el.textContent = "⏱ " + left;
    tyDeedSync(); tyDeedTimer();
    if(tyRoom.hostId === playerId && Date.now() - tySeenAt > TY_TURN_MS + 1500 && tyRef){
      tySeenAt = Date.now();
      const t = tyG.tAt;
      tyRef.child("g").transaction(c=>{
        if(!c || c.ph === "over" || c.tAt !== t) return;
        tyFix(c); tyLog(c, "⏰ " + (c.nm[c.cur] || "PLAYER") + " หมดเวลา");
        return tyEndTurn(c);
      });
    }
  }
  function tyListen(){
    if(tyRef) tyRef.off();
    tyRef = db.ref("rooms/" + tyCode);
    tyRef.on("value", sn=>{
      if(!sn.exists()){ const had = !!tyRoom; tyReset(); if(had) alert("ห้อง Tycoon ถูกปิดแล้ว"); return; }
      tyRoom = sn.val();
      if(tyRoom.type !== "tycoon"){ tyReset(); return; }
      tyG = tyRoom.g ? tyFix(tyRoom.g) : null;
      tyRender();
    });
    if(!tyTick) tyTick = setInterval(tyTickFn, 1000);
  }
  function tyReset(){
    if(tyRef) tyRef.off();
    tyRef = null; tyRoom = null; tyG = null; tyCode = ""; tyShown = {}; tyRolling = false;
    Object.keys(tyAnim).forEach(u=>clearTimeout(tyAnim[u])); tyAnim = {}; tyLastRoll = null; tyRollStart = 0;
    clearInterval(tyTick); tyTick = null;
    tyDeedWant = false; tyDeedCur = ""; tyDeedKey = ""; tyDeedHid = null; tyDeedSync();
    localStorage.removeItem("kyjTyRoom");
    if($("tyPanel")){ $("tyPanel").classList.remove("hidden"); $("tyLobby").classList.add("hidden"); $("tyGame").classList.add("hidden"); }
  }
  function tyRestore(){
    if(!tyCode || !firebaseReady || !currentUser) return;
    db.ref("rooms/" + tyCode).once("value").then(sn=>{
      const d = sn.val();
      if(d && d.type === "tycoon" && d.players && d.players[currentUser.uid]){ playerId = currentUser.uid; tyListen(); }
      else{ tyCode = ""; localStorage.removeItem("kyjTyRoom"); }
    }).catch(()=>{});
  }
  async function tyCreate(){
    if(!currentUser) return showAuthView("authLoginView");
    if(!firebaseReady) return alert("Firebase ยังไม่พร้อม ลองรีเฟรชหน้าเว็บอีกครั้ง");
    playerId = currentUser.uid;
    try{
      let code = randomRoomCode();
      while((await db.ref("rooms/" + code).once("value")).exists()) code = randomRoomCode();
      const pl = {}; pl[playerId] = {name:getPlayerName() || "PLAYER", av:tyMyChar({})};
      await db.ref("rooms/" + code).set({type:"tycoon", hostId:playerId, status:"lobby", createdAt:firebase.database.ServerValue.TIMESTAMP, players:pl});
      tyCode = code; localStorage.setItem("kyjTyRoom", code); tyListen();
    }catch(e){ console.error(e); alert("สร้างห้องไม่สำเร็จ: " + e.message); }
  }
  async function tyJoin(){
    if(!currentUser) return showAuthView("authLoginView");
    if(!firebaseReady) return alert("Firebase ยังไม่พร้อม ลองรีเฟรชหน้าเว็บอีกครั้ง");
    playerId = currentUser.uid;
    const code = $("tyCode").value.trim().toUpperCase();
    if(code.length !== 6) return alert("กรุณาใส่รหัสห้อง 6 ตัว");
    try{
      const sn = await db.ref("rooms/" + code).once("value");
      if(!sn.exists()) return alert("ไม่พบห้องนี้");
      const d = sn.val(), pl = d.players || {};
      if(d.type !== "tycoon") return alert("รหัสนี้ไม่ใช่ห้อง Tycoon");
      if(!pl[playerId]){
        if(d.status !== "lobby") return alert("ห้องนี้เริ่มเกมไปแล้ว");
        if(Object.keys(pl).length >= 6) return alert("ห้องเต็มแล้ว");
        await db.ref("rooms/" + code + "/players/" + playerId).set({name:getPlayerName() || "PLAYER", av:tyMyChar(pl)});
      }
      tyCode = code; localStorage.setItem("kyjTyRoom", code); tyListen();
    }catch(e){ console.error(e); alert("เข้าห้องไม่สำเร็จ: " + e.message); }
  }
  async function tyStart(){
    if(!tyRoom || tyRoom.hostId !== playerId) return;
    const pl = tyRoom.players || {}, ids = Object.keys(pl);
    if(ids.length < 2) return alert("ต้องมีผู้เล่นอย่างน้อย 2 คน");
    const order = shuffle(ids.slice()).slice(0,6);
    const g = {order:order, cur:order[0], ph:"roll", n:0, tAt:Date.now(), dice:[1,1], pos:{}, cash:{}, nm:{}, av:{}, log:["🚀 เริ่มเกม! ทุกคนมีเงิน " + TY_START]};
    order.forEach(u=>{ g.pos[u] = 0; g.cash[u] = TY_START; g.nm[u] = pl[u].name || "PLAYER"; g.av[u] = tyNormAv(pl[u].av, order.indexOf(u)); });
    try{ await tyRef.update({status:"play", g:g}); }catch(e){ console.error(e); alert("เริ่มเกมไม่สำเร็จ"); }
  }
  async function tyLeave(){
    if(!tyCode || !db) return tyReset();
    const code = tyCode, room = tyRoom, playing = room && room.status === "play" && tyG && tyG.ph !== "over";
    if(tyRef) tyRef.off();
    try{
      if(playing){
        await db.ref("rooms/" + code + "/g").transaction(c=>{
          if(!c || c.ph === "over") return;
          tyFix(c); if(c.out[playerId]) return;
          tyBust(c, playerId); tyLog(c, "🚪 " + (c.nm[playerId] || "PLAYER") + " ออกจากเกม");
          if(c.cur === playerId) return tyEndTurn(c);
          const live = c.order.filter(u=>!c.out[u]);
          if(live.length <= 1){ c.ph = "over"; c.win = live[0] || c.cur; }
          return c;
        });
      }
      await db.ref("rooms/" + code + "/players/" + playerId).remove();
      if(room && room.hostId === playerId){
        const rest = Object.keys(room.players || {}).filter(u=>u !== playerId);
        if(!rest.length || room.status === "lobby") await db.ref("rooms/" + code).remove();
        else await db.ref("rooms/" + code + "/hostId").set(rest[0]);
      }
    }catch(e){ console.error(e); }
    tyReset();
  }

  if($("tyCreate")){
    $("tyCreate").addEventListener("click", tyCreate);
    $("tyJoin").addEventListener("click", tyJoin);
    $("tyCode").addEventListener("input", e=>e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
    $("tyStart").addEventListener("click", tyStart);
    if($("tyAvPick")){
      $("tyAvPick").addEventListener("click", e=>{
        const b = e.target.closest("[data-k]"); if(!b || b.disabled) return;
        tySetChar({[b.dataset.k]: b.dataset.k === "c" ? +b.dataset.v : b.dataset.v});
      });
      $("tyAvCustomBtn").addEventListener("click", ()=>{
        const raw = $("tyAvCustom").value.trim();
        const g1 = raw ? ((typeof Intl !== "undefined" && Intl.Segmenter) ? Array.from(new Intl.Segmenter(undefined,{granularity:"grapheme"}).segment(raw), x=>x.segment)[0] : Array.from(raw)[0]) : "";
        if(!g1 || !/\p{Extended_Pictographic}/u.test(g1)) return alert("ใส่อีโมจิ 1 ตัว เช่น 🐙");
        $("tyAvCustom").value = ""; tySetChar({f:g1});
      });
    }
    $("tyLeave").addEventListener("click", ()=>tyLeave());
    $("tyLeaveGame").addEventListener("click", ()=>tyLeave());
    $("tyCopy").addEventListener("click", async()=>{
      try{ await navigator.clipboard.writeText(tyCode); $("tyCopy").textContent = "COPIED!"; setTimeout(()=>$("tyCopy").textContent = "COPY", 1200); }
      catch(e){ alert("รหัสห้อง: " + tyCode); }
    });
    $("tyModal").addEventListener("click", e=>{
      const b = e.target.closest("[data-a]");
      if(b){ tyAct(b.dataset.a); return; }
      if(e.target === $("tyModal")) tyDeedClose();
    });
    document.addEventListener("keydown", e=>{ if(e.key === "Escape" && tyDeedWant) tyDeedClose(); });
    $("tyCtl").addEventListener("click", e=>{
      const b = e.target.closest("[data-a]"); if(!b) return;
      const a = b.dataset.a;
      if(a === "back") tyLeave();
      else if(a === "again"){ if(tyRef && tyRoom && tyRoom.hostId === playerId) tyRef.update({status:"lobby", g:null}); }
      else tyAct(a);
    });
  }


/* =====================================================================
   FRIENDS + PUBLIC PROFILE (Player ID)
   publicProfiles/{uid}        = {name, avatar, pid, updatedAt}   (ไม่มีอีเมล)
   uidIndex/{pid}              = uid                              (ใช้ค้นหาด้วย ID)
   friendRequests/{to}/{from}  = {at}
   friends/{uid}/{friendUid}   = true
   ===================================================================== */
let myPid = "";
let friendSet = {};
let requestMap = {};
let frRefs = [];
let pfUid = "";
let lastSearchUid = "";
let frToken = 0;
const pubCache = {};

const TS = () => firebase.database.ServerValue.TIMESTAMP;
const fmtPid = p => p ? String(p) : "--------";
const safeSrc = v => (typeof v === "string" && v.indexOf("data:image/") === 0) ? v : "";
const frPageActive = () => { const p = $("page-friends"); return !!(p && p.classList.contains("active")); };

function randomPid(){ return String(10000000 + Math.floor(Math.random() * 90000000)); }

async function claimPid(uid){
  for(let i = 0; i < 12; i++){
    const pid = randomPid();
    const res = await db.ref("uidIndex/" + pid).transaction(cur => cur === null ? uid : undefined);
    if(res.committed) return pid;
  }
  throw new Error("cannot claim pid");
}

function paintMyPid(){
  ["profileId","frMyId"].forEach(id=>{ const el = $(id); if(el) el.textContent = fmtPid(myPid); });
}

async function ensurePublicProfile(){
  if(!currentUser || !firebaseReady) return;
  const uid = currentUser.uid;
  try{
    const ref = db.ref("publicProfiles/" + uid);
    const v = (await ref.once("value")).val() || {};
    let pid = v.pid;
    if(!pid) pid = await claimPid(uid);
    myPid = pid;
    const upd = {pid:pid, name:getPlayerName() || v.name || "PLAYER", updatedAt:TS()};
    if(!v.avatar){
      try{
        const a = (await db.ref("users/" + uid + "/avatar").once("value")).val();
        if(safeSrc(a)) upd.avatar = a;
      }catch(e){}
    }
    await ref.update(upd);
    delete pubCache[uid];
    paintMyPid();
  }catch(e){ console.error("Public profile error", e); }
}

function syncPublicName(name){
  if(!currentUser || !firebaseReady || !name) return;
  delete pubCache[currentUser.uid];
  db.ref("publicProfiles/" + currentUser.uid).update({name:name, updatedAt:TS()}).catch(e=>console.error(e));
}
function syncPublicAvatar(url){
  if(!currentUser || !firebaseReady) return;
  delete pubCache[currentUser.uid];
  const ref = db.ref("publicProfiles/" + currentUser.uid);
  (url ? ref.update({avatar:url, updatedAt:TS()}) : ref.child("avatar").remove()).catch(e=>console.error(e));
}

async function getPublic(uid, force){
  const c = pubCache[uid];
  if(!force && c && Date.now() - c.t < 60000) return c.v;
  let v = null;
  try{ v = (await db.ref("publicProfiles/" + uid).once("value")).val(); }catch(e){ console.error(e); }
  pubCache[uid] = {v:v, t:Date.now()};
  return v;
}
async function getStats(uid){
  try{ return (await db.ref("leaderboard/" + uid).once("value")).val() || {}; }
  catch(e){ return {}; }
}
async function getRel(uid){
  const me = currentUser.uid;
  if(uid === me) return "self";
  const [f, inc, out] = await Promise.all([
    db.ref("friends/" + me + "/" + uid).once("value"),
    db.ref("friendRequests/" + me + "/" + uid).once("value"),
    db.ref("friendRequests/" + uid + "/" + me).once("value")
  ]);
  return f.exists() ? "friend" : inc.exists() ? "incoming" : out.exists() ? "sent" : "none";
}

/* ---------- small UI builders ---------- */
function avEl(p, big){
  const d = document.createElement("div");
  d.className = "fr-av" + (big ? " big" : "");
  const src = safeSrc(p && p.avatar);
  if(src){ d.style.backgroundImage = 'url("' + src + '")'; d.classList.add("has"); }
  else d.textContent = "👤";
  return d;
}
function actButtons(rel, uid){
  const box = document.createElement("div");
  box.className = "fr-act";
  const mk = (label, act, cls) => {
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn " + cls + " small-btn";
    b.textContent = label; b.dataset.fa = act; b.dataset.uid = uid;
    box.appendChild(b);
  };
  if(rel === "none") mk("+ ADD FRIEND", "add", "primary");
  else if(rel === "sent") mk("ส่งคำขอแล้ว • ยกเลิก", "cancel", "secondary");
  else if(rel === "incoming"){ mk("ACCEPT", "accept", "primary"); mk("DECLINE", "decline", "danger"); }
  else if(rel === "friend") mk("UNFRIEND", "remove", "danger");
  return box;
}
function personRow(uid, p, sub, rel){
  const row = document.createElement("div");
  row.className = "fr-row";
  const av = avEl(p); av.dataset.fa = "view"; av.dataset.uid = uid;
  const info = document.createElement("div");
  info.className = "fr-info"; info.dataset.fa = "view"; info.dataset.uid = uid;
  const nm = document.createElement("div"); nm.className = "fr-name"; nm.textContent = (p && p.name) || "PLAYER";
  const id = document.createElement("div"); id.className = "fr-id"; id.textContent = "ID " + fmtPid(p && p.pid) + (sub ? "  •  " + sub : "");
  info.append(nm, id);
  row.append(av, info);
  if(rel) row.appendChild(actButtons(rel, uid));
  else { const go = document.createElement("span"); go.className = "fr-go"; go.textContent = "›"; go.dataset.fa = "view"; go.dataset.uid = uid; row.appendChild(go); }
  return row;
}
function emptyNote(text){
  const d = document.createElement("div"); d.className = "fr-empty"; d.textContent = text; return d;
}

/* ---------- friend actions ---------- */
async function acceptReq(from){
  const me = currentUser.uid, u = {};
  u["friends/" + me + "/" + from] = true;
  u["friends/" + from + "/" + me] = true;
  u["friendRequests/" + me + "/" + from] = null;
  u["friendRequests/" + from + "/" + me] = null;
  await db.ref().update(u);
}
async function doFriendAction(act, uid){
  if(!currentUser || !firebaseReady || !uid) return;
  const me = currentUser.uid;
  try{
    if(act === "add"){
      const rel = await getRel(uid);
      if(rel === "incoming") await acceptReq(uid);
      else if(rel === "none") await db.ref("friendRequests/" + uid + "/" + me).set({at:TS()});
    }else if(act === "accept") await acceptReq(uid);
    else if(act === "decline") await db.ref("friendRequests/" + me + "/" + uid).remove();
    else if(act === "cancel") await db.ref("friendRequests/" + uid + "/" + me).remove();
    else if(act === "remove"){
      const p = await getPublic(uid);
      if(!confirm("ลบ " + ((p && p.name) || "ผู้เล่นนี้") + " ออกจากเพื่อน?")) return;
      const u = {}; u["friends/" + me + "/" + uid] = null; u["friends/" + uid + "/" + me] = null;
      await db.ref().update(u);
    }
  }catch(e){ console.error(e); alert("ทำรายการไม่สำเร็จ (เช็ค Database Rules)"); return; }
  refreshFriendUI();
}
function refreshFriendUI(){
  if(frPageActive()) loadFriends();
  const m = $("pfModal");
  if(pfUid && m && !m.classList.contains("hidden")) openProfile(pfUid);
  if(lastSearchUid) showSearchResult(lastSearchUid);
}

/* ---------- realtime watchers (badge + lists) ---------- */
function updateBadge(){
  const n = Object.keys(requestMap).length;
  document.querySelectorAll(".nav-badge").forEach(b=>{ b.textContent = n > 9 ? "9+" : n; b.classList.toggle("hidden", !n); });
}
function unwatchFriends(){
  frRefs.forEach(r=>{ try{ r.off(); }catch(e){} });
  frRefs = []; requestMap = {}; friendSet = {};
  updateBadge();
}
function watchFriends(){
  unwatchFriends();
  if(!currentUser || !firebaseReady) return;
  const me = currentUser.uid;
  const rq = db.ref("friendRequests/" + me), fr = db.ref("friends/" + me);
  rq.on("value", s=>{ requestMap = s.val() || {}; updateBadge(); if(frPageActive()) loadFriends(); }, e=>console.error("friendRequests watch", e));
  fr.on("value", s=>{ friendSet = s.val() || {}; if(frPageActive()) loadFriends(); }, e=>console.error("friends watch", e));
  frRefs = [rq, fr];
}

/* ---------- friends page ---------- */
async function loadFriends(){
  const reqBox = $("frRequests"), listBox = $("frList");
  if(!reqBox || !listBox || !currentUser || !firebaseReady) return;
  paintMyPid();
  if(!myPid) ensurePublicProfile();
  const tok = ++frToken;
  const reqIds = Object.keys(requestMap).sort((a,b)=>((requestMap[b] && requestMap[b].at) || 0) - ((requestMap[a] && requestMap[a].at) || 0));
  const fIds = Object.keys(friendSet);
  $("frReqCount").textContent = reqIds.length ? "(" + reqIds.length + ")" : "";
  $("frCount").textContent = "(" + fIds.length + ")";
  const [reqP, frP, frS] = await Promise.all([
    Promise.all(reqIds.map(id=>getPublic(id))),
    Promise.all(fIds.map(id=>getPublic(id))),
    Promise.all(fIds.map(id=>getStats(id)))
  ]);
  if(tok !== frToken) return;
  reqBox.innerHTML = ""; listBox.innerHTML = "";
  if(!reqIds.length) reqBox.appendChild(emptyNote("ไม่มีคำขอเป็นเพื่อน"));
  reqIds.forEach((id,i)=> reqBox.appendChild(personRow(id, reqP[i], "", "incoming")));
  if(!fIds.length) listBox.appendChild(emptyNote("ยังไม่มีเพื่อน ลองค้นหาด้วย ID ของเพื่อนด้านบน"));
  fIds.map((id,i)=>({id:id, p:frP[i], avg:(frS[i] && frS[i].avg) || 0}))
    .sort((a,b)=>String((a.p && a.p.name) || "").localeCompare(String((b.p && b.p.name) || "")))
    .forEach(f=> listBox.appendChild(personRow(f.id, f.p, "AVG " + Number(f.avg).toFixed(1), null)));
}

async function searchFriend(){
  const inp = $("frSearchInput"), msg = $("frSearchMsg"), box = $("frSearchResult");
  if(!inp || !currentUser || !firebaseReady) return;
  const pid = (inp.value || "").replace(/\D/g, "");
  box.innerHTML = ""; lastSearchUid = "";
  if(pid.length !== 8){ msg.textContent = "ใส่ ID ผู้เล่นให้ครบ 8 หลัก"; return; }
  msg.textContent = "กำลังค้นหา...";
  try{
    const uid = (await db.ref("uidIndex/" + pid).once("value")).val();
    if(!uid){ msg.textContent = "ไม่พบ ID นี้"; return; }
    msg.textContent = "";
    lastSearchUid = uid;
    await showSearchResult(uid);
  }catch(e){ console.error(e); msg.textContent = "ค้นหาไม่สำเร็จ (เช็ค Database Rules)"; }
}
async function showSearchResult(uid){
  const box = $("frSearchResult"); if(!box) return;
  let p = null, rel = "none";
  try{ [p, rel] = await Promise.all([getPublic(uid, true), getRel(uid)]); }catch(e){ console.error(e); }
  if(uid !== lastSearchUid) return;
  box.innerHTML = "";
  box.appendChild(personRow(uid, p, rel === "self" ? "นี่คือคุณ" : "", rel === "self" ? null : rel));
}

/* ---------- view someone's profile ---------- */
function closeProfile(){
  const m = $("pfModal"); if(!m) return;
  m.classList.add("hidden"); pfUid = "";
  const ty = $("tyModal");
  if(!ty || ty.classList.contains("hidden")) document.body.classList.remove("ty-modal-open");
}
async function openProfile(uid){
  const modal = $("pfModal"), body = $("pfBody");
  if(!uid || !modal || !currentUser || !firebaseReady) return;
  const wasHidden = modal.classList.contains("hidden");
  pfUid = uid;
  if(wasHidden){ body.textContent = "กำลังโหลด..."; modal.classList.remove("hidden"); document.body.classList.add("ty-modal-open"); }
  let p = null, st = {}, rel = "none";
  try{ [p, st, rel] = await Promise.all([getPublic(uid, true), getStats(uid), getRel(uid)]); }catch(e){ console.error(e); }
  if(pfUid !== uid || modal.classList.contains("hidden")) return;
  const name = (p && p.name) || st.name || "PLAYER";
  const best = st.best || {};
  body.innerHTML = "";

  const head = document.createElement("div"); head.className = "pf-head";
  head.appendChild(avEl(p, true));
  const meta = document.createElement("div"); meta.className = "pf-meta";
  const nm = document.createElement("div"); nm.className = "pf-name"; nm.textContent = name;
  const idRow = document.createElement("div"); idRow.className = "profile-id";
  const idl = document.createElement("span"); idl.textContent = "ID";
  const idv = document.createElement("b"); idv.textContent = fmtPid(p && p.pid);
  idRow.append(idl, idv);
  if(p && p.pid){
    const cp = document.createElement("button");
    cp.type = "button"; cp.className = "copy-btn"; cp.textContent = "COPY"; cp.dataset.copy = p.pid;
    idRow.appendChild(cp);
  }
  const wins = document.createElement("div"); wins.className = "profile-wins"; wins.textContent = "🏆 ชนะ " + (st.wins || 0) + " ครั้ง";
  meta.append(nm, idRow, wins);
  head.appendChild(meta);
  body.appendChild(head);

  const list = document.createElement("div"); list.className = "placeholder-list profile-list";
  [["AVG SCORE", Number(st.avg || 0).toFixed(1)],["GAMES PLAYED", st.plays || 0],["TOTAL SCORE", st.total || 0],["🏆 WINS", st.wins || 0],["🎲 TYCOON WINS", st.tyWins || 0]]
    .concat(GAMES.map(g=>[g.name + " BEST", best[g.id] || 0]))
    .forEach(pair=>{
      const row = document.createElement("div");
      const l = document.createElement("span"); l.textContent = pair[0];
      const v = document.createElement("strong"); v.textContent = pair[1];
      row.append(l, v); list.appendChild(row);
    });
  body.appendChild(list);

  const foot = document.createElement("div"); foot.className = "pf-foot";
  if(rel === "self"){ foot.appendChild(emptyNote("นี่คือโปรไฟล์ของคุณ")); }
  else { const ab = actButtons(rel, uid); ab.classList.add("full"); foot.appendChild(ab); }
  const close = document.createElement("button");
  close.type = "button"; close.className = "btn secondary full"; close.textContent = "CLOSE"; close.dataset.pfClose = "1";
  foot.appendChild(close);
  body.appendChild(foot);
}

/* ---------- wiring ---------- */
async function copyText(t, btn){
  try{
    await navigator.clipboard.writeText(t);
    if(btn){ const o = btn.textContent; btn.textContent = "COPIED!"; setTimeout(()=>btn.textContent = o, 1200); }
  }catch(e){ alert("ID: " + t); }
}
function initFriendsUI(){
  document.addEventListener("click", async e=>{
    const cp = e.target.closest("[data-copy]");
    if(cp){ const v = cp.dataset.copy === "my" ? myPid : cp.dataset.copy; if(v) copyText(v, cp); return; }
    if(e.target.closest("[data-pf-close]")) return closeProfile();
    const t = e.target.closest("[data-fa]");
    if(!t) return;
    const act = t.dataset.fa, uid = t.dataset.uid;
    if(act === "view") return openProfile(uid);
    if(t.tagName === "BUTTON") t.disabled = true;
    await doFriendAction(act, uid);
    if(t.tagName === "BUTTON") t.disabled = false;
  });
  const modal = $("pfModal");
  if(modal) modal.addEventListener("click", e=>{ if(e.target === modal) closeProfile(); });
  document.addEventListener("keydown", e=>{ if(e.key === "Escape") closeProfile(); });
  const inp = $("frSearchInput"), btn = $("frSearchButton");
  if(inp){
    inp.addEventListener("input", ()=>{ inp.value = inp.value.replace(/\D/g, "").slice(0, 8); });
    inp.addEventListener("keydown", e=>{ if(e.key === "Enter") searchFriend(); });
  }
  if(btn) btn.addEventListener("click", searchFriend);
}
initFriendsUI();

if ($("logoutButton")) {
  $("logoutButton").addEventListener("click",logout);
}

setupAuth();

})();

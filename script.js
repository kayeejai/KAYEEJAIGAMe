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
    }catch(e){ console.error(e); }
    if(savedName){
      await saveUserProfile(user, savedName);
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
    return true;
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

  async function createRoom(){
    if (!currentUser) return showAuthView("authLoginView");
    playerId = currentUser.uid;
    if (!firebaseReady) return alert("Firebase ยังไม่พร้อม ลองรีเฟรชหน้าเว็บอีกครั้ง");
    if (!syncPlayerNameFromInput()) return;
    const button = $("createRoomButton");
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
        game: "memory",
        playlist: ["memory"],
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
      button.textContent = "CREATE ROOM";
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
      const name = document.createElement("span");
      name.textContent = (p.name || "PLAYER") + (id === data.hostId ? " 👑" : "");
      const status = document.createElement("span");
      status.className = p.ready ? "ready" : "waiting";
      status.textContent = p.ready ? "READY" : "WAITING";
      div.append(name,status);
      list.appendChild(div);
    });
    $("lobbyStatus").textContent =
      entries.length < 2 ? "ต้องมีอย่างน้อย 2 คนเพื่อเริ่มเกม" :
      data.status === "waiting" ? "ผู้เล่นทุกคนต้อง READY ก่อนเริ่ม" :
      "เกมกำลังเริ่ม...";
    const me = players[playerId];
    $("readyButton").textContent = me && me.ready ? "UNREADY" : "READY";
    renderGamePicker(data);
  }

  const GAMES = [
    {id:"memory", name:"MEMORY MATCH", icon:"🃏", ready:true},
    {id:"aim", name:"AIM BATTLE", icon:"🦅", ready:true},
    {id:"number", name:"NUMBER HUNT", icon:"🔢", ready:true},
    {id:"puzzle", name:"PUZZLE RACE", icon:"🧩", ready:true},
    {id:"final", name:"FINAL RACE", icon:"🏁", ready:true},
    {id:"push", name:"PUSH BATTLE", icon:"🥊", ready:true, room:true, time:"45 SEC", max:100, desc:"ผลักคู่แข่งออกจากสังเวียน ใครตกคือออก คนสุดท้ายชนะ"},
    {id:"scramble", name:"WORD SCRAMBLE", icon:"🔠", ready:true, time:"45 SEC", max:150, desc:"เรียงตัวอักษรไทยที่สลับไว้ให้เป็นคำที่ถูกต้อง"},
    {id:"impostor", name:"FIND THE IMPOSTOR", icon:"🕵️", ready:true, room:true, time:"VOTE", max:100, desc:"ทุกคนเห็นภาพเดียวกัน ยกเว้น 1 คน โหวตหา Impostor"},
    {id:"ctf", name:"CAPTURE THE FLAG", icon:"🚩", ready:true, room:true, time:"TEAM", max:100, desc:"ทีมแดง vs ทีมฟ้า แย่งธงกลับฐาน"},
    {id:"target", name:"TARGET RUSH", icon:"🎯", ready:true, time:"30 SEC", max:150, desc:"ยิงเฉพาะสีที่ระบบประกาศ ยิงผิดเสียคะแนน"},
    {id:"traffic", name:"TRAFFIC RUSH", icon:"🚦", ready:true, time:"RACE", max:100, desc:"ขับบนถนนเดียวกัน หลบรถและสิ่งกีดขวาง"},
    {id:"code", name:"CODE BREAKER", icon:"🔐", ready:true, time:"60 SEC", max:100, desc:"แกะรหัสลับ 4 หลักให้ได้ภายใน 8 ครั้ง ใบ้ด้วย 🟢🟡"}
  ];
  function gameInfo(id){ return GAMES.find(g=>g.id === id) || GAMES[0]; }
  const GAME_SYM = {memory:"i-memory",aim:"i-aim",number:"i-num",puzzle:"i-puzzle",final:"i-flag",push:"i-push",scramble:"i-scramble",impostor:"i-spy",ctf:"i-ctf",target:"i-target",traffic:"i-traffic",code:"i-code"};
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
      ? "แตะเลือกได้หลายเกม เล่นตามลำดับที่แตะ (" + pl.length + " เกม)"
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
    ({memory:startMemoryGame, aim:gAim, number:gNumber, puzzle:gPuzzle, final:gFinal, push:()=>gArena("push"), scramble:gScramble, target:gTarget, impostor:gImpostor, ctf:gCTF, traffic:gTraffic, code:gCode}[id] || startMemoryGame)();
  }
  function startSelectedGame(){ startGameById(gameInfo(currentRoomData && currentRoomData.game).id); }

  /* ===== generic game engine (Aim / Number / Puzzle / Final) ===== */
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
    addTimer(setInterval(()=>{
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

  function gAim(){
    const area = beginPlay("aim","AIM BATTLE","ROUND 2",15,"HITS");
    area.style.height = "320px";
    let hits = 0;
    const spawn = ()=>{
      const t = document.createElement("button");
      t.type = "button"; t.className = "target";
      const w = area.clientWidth, dur = 1600 + Math.random()*900, ltr = Math.random() < 0.5;
      t.style.top = (6 + Math.random()*76) + "%";
      t.style.left = "0";
      t.style.transform = "translate3d(" + (ltr ? -60 : w) + "px,0,0)";
      t.style.transition = "transform " + dur + "ms linear";
      tapOn(t, ()=>{ hits++; setGExtra(hits); setGScore(Math.min(100, hits*5)); floatText(area, t, "+5", "#fff"); t.remove(); });
      area.appendChild(t);
      requestAnimationFrame(()=>requestAnimationFrame(()=>{ t.style.transform = "translate3d(" + (ltr ? w : -60) + "px,0,0)"; }));
      addTimer(setTimeout(()=>t.remove(), dur + 100));
    };
    spawn(); addTimer(setInterval(spawn, 650));
  }

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

  /* ===== TARGET RUSH ===== */
  function gTarget(){
    const area = beginPlay("target","TARGET RUSH",rl(),30,"HITS");
    area.style.height = "340px";
    const seed = (currentRoomData && currentRoomData.startAt) || Math.floor(Math.random()*1e9);
    const cols = ["🔴","🔵","🟢","🟡"];
    let hits = 0, slot = 0, want = cols[0];
    const banner = document.createElement("div");
    banner.className = "banner"; area.appendChild(banner);
    const setWant = k=>{
      want = cols[Math.floor(rng(seed + k*977)*4)];
      banner.textContent = "TARGET = " + want;
      banner.classList.remove("pop"); void banner.offsetWidth; banner.classList.add("pop");
    };
    setWant(0);
    const spawn = ()=>{
      const i = slot++;
      if(i && i % 8 === 0) setWant(i/8);
      const c = rng(seed + i*3) < 0.4 ? want : cols[Math.floor(rng(seed + i*3 + 1)*4)];
      const b = document.createElement("button");
      b.type = "button"; b.className = "tgt"; b.textContent = c;
      b.style.left = (10 + rng(seed + i*3 + 2)*78) + "%";
      b.style.top = (22 + rng(seed + i*7 + 5)*66) + "%";
      tapOn(b, ()=>{
        if(b.dataset.x) return;
        b.dataset.x = 1;
        const ok = c === want;
        if(ok){ hits++; setGExtra(hits); setGScore(Math.min(150, gScore+10)); }
        else setGScore(Math.max(0, gScore-8));
        floatText(area, b, ok ? "+10" : "-8", ok ? "#62e48a" : "#ff7b83");
        b.classList.add("burst"); setTimeout(()=>b.remove(), 160);
      });
      area.appendChild(b);
      addTimer(setTimeout(()=>b.remove(), 1800));
    };
    spawn(); addTimer(setInterval(spawn, 600));
  }

  /* ===== realtime arena: PUSH BATTLE ===== */
  function gArena(kind){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const secs = 45, C = 160;
    const area = beginPlay(kind, "PUSH BATTLE", rl(), secs, "ALIVE");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    area.innerHTML = '<canvas id="arenaCv" width="' + 320*dpr + '" height="' + 320*dpr + '"></canvas>' +
      '<div class="lane-ctrl one"><button type="button" class="btn primary" id="dashBtn">DASH ⚡</button></div>';
    const cv = $("arenaCv"), ctx = cv.getContext("2d");
    const players = currentRoomData.players || {}, ids = Object.keys(players).sort();
    const seed = currentRoomData.startAt || 1;
    const ang = 2*Math.PI*ids.indexOf(playerId)/Math.max(1, ids.length);
    const me = {x:C + Math.cos(ang)*90, y:C + Math.sin(ang)*90, vx:0, vy:0, alive:true, dash:false, cd:0};

    const liveRef = db.ref("rooms/" + roomCode + "/live");
    let live = {}; const disp = {};
    liveRef.child(playerId).remove();
    liveRef.on("value", sn=>{ live = sn.val() || {}; });
    const push = ()=>liveRef.child(playerId).set({x:Math.round(me.x), y:Math.round(me.y), a:me.alive?1:0, d:me.dash?1:0});

    let joy = {x:0, y:0}, anchor = null, on = true;
    cv.addEventListener("pointerdown", e=>{ e.preventDefault(); cv.setPointerCapture(e.pointerId); anchor = {x:e.clientX, y:e.clientY}; });
    cv.addEventListener("pointermove", e=>{
      if(!anchor) return;
      const dx = e.clientX - anchor.x, dy = e.clientY - anchor.y, m = Math.min(1, Math.hypot(dx,dy)/40), a = Math.atan2(dy,dx);
      joy = {x:Math.cos(a)*m, y:Math.sin(a)*m};
    });
    const up = ()=>{ anchor = null; joy = {x:0, y:0}; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    const keys = {ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
    const kd = e=>{ const k = keys[e.key]; if(k){ joy = {x:k[0], y:k[1]}; e.preventDefault(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", up);
    tapOn($("dashBtn"), ()=>{
      if(!me.alive || me.cd > 0) return;
      let dx = joy.x, dy = joy.y;
      if(!dx && !dy){ dx = me.vx; dy = me.vy; }
      const l = Math.hypot(dx,dy) || 1;
      me.vx += dx/l*8; me.vy += dy/l*8; me.dash = true; me.cd = 1.2;
      setTimeout(()=>me.dash = false, 250);
    });
    gHooks.push(()=>{
      on = false; liveRef.off(); liveRef.child(playerId).remove();
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", up);
    });

    const scoreAt = t=>{
      if(t >= secs - 1.2) return 100;
      return 10 + Math.floor(t/secs*60);
    };
    const die = t=>{
      me.alive = false; push();
      finishSelf(10 + Math.floor(t/secs*60), "💀 ตกรอบ!");
    };

    const t0 = performance.now(); let last = t0, lastPush = 0;
    const loop = now=>{
      if(!on) return;
      const dt = Math.min(0.05, (now-last)/1000), f = dt*60, t = (now-t0)/1000;
      last = now;
      Object.keys(live).forEach(id=>{
        const l = live[id], o = disp[id] || (disp[id] = {x:l.x, y:l.y});
        o.x += (l.x - o.x)*Math.min(1, dt*14); o.y += (l.y - o.y)*Math.min(1, dt*14);
      });
      if(me.alive){
        me.vx += joy.x*0.45*f; me.vy += joy.y*0.45*f;
        const fr = Math.pow(0.9, f);
        me.vx *= fr; me.vy *= fr; me.cd = Math.max(0, me.cd - dt);
        me.x += me.vx*f; me.y += me.vy*f;
        Object.keys(live).forEach(id=>{
          const o = disp[id];
          if(id === playerId || !o || !live[id].a) return;
          const dx = me.x - o.x, dy = me.y - o.y, d = Math.hypot(dx,dy) || 1;
          if(d < 28){
            const p = (1.5 + (live[id].d ? 5 : 0))*f*0.6;
            me.vx += dx/d*p; me.vy += dy/d*p; me.x += dx/d*(28-d)*0.5; me.y += dy/d*(28-d)*0.5;
          }
        });
        const R = 150 - (t/secs)*70;
        if(Math.hypot(me.x-C, me.y-C) > R + 8) die(t);
        if(gPlaying){ const sc = scoreAt(t); if(sc !== gScore) setGScore(sc); }
      }
      let alive = 0;
      ids.forEach(id=>{ const l = id === playerId ? {a:me.alive?1:0} : live[id]; if(l ? l.a : t < 3) alive++; });
      setGExtra(alive);
      if(t > 3 && alive <= 1 && me.alive) finishSelf(100, "🏆 ชนะ!");
      if(now - lastPush > 90){ lastPush = now; push(); }

      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,320,320);
      ctx.fillStyle = "#0c0d14"; ctx.fillRect(0,0,320,320);
      const R = 150 - (t/secs)*70;
      ctx.beginPath(); ctx.arc(C,C,R,0,7); ctx.fillStyle = "#181a28"; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = "#ff2a3a"; ctx.shadowColor = "#ff2a3a"; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
      ids.forEach(id=>{
        const isMe = id === playerId, l = live[id];
        const p = isMe ? me : disp[id];
        if(!p) return;
        const alv = isMe ? me.alive : (l && l.a);
        ctx.globalAlpha = alv ? 1 : 0.22;
        ctx.beginPath(); ctx.arc(p.x, p.y, 14, 0, 7);
        ctx.fillStyle = "hsl(" + hueOf(id) + ",80%,58%)"; ctx.fill();
        if(isMe || (l && l.d)){ ctx.lineWidth = 3; ctx.strokeStyle = l && l.d || (isMe && me.dash) ? "#fff" : "#ffd84a"; ctx.stroke(); }
        ctx.fillStyle = "#fff"; ctx.font = "700 10px Kanit,sans-serif"; ctx.textAlign = "center";
        ctx.fillText((players[id].name || "?").slice(0,7), p.x, p.y - 20);
        ctx.globalAlpha = 1;
      });
      requestAnimationFrame(loop);
    };
    push(); requestAnimationFrame(loop);
  }

  /* ===== lane runner engine: FINAL RACE + TRAFFIC RUSH (canvas, smooth) ===== */
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

  function gFinal(){
    const ls=[];
    const L=(g,sd)=>ls[g]!==undefined ? ls[g] : (ls[g]=g ? (L(g-1,sd)+1+Math.floor(rng(sd+g*13)*2))%3 : Math.floor(rng(sd)*3));
    gRun({id:"final", title:"FINAL RACE", round:"FINAL", secs:30, label:"COINS", lanes:3, gap:115, v0:230, v1:400, coin:2, nitro:5, max:250,
      gen:(i,sd)=>{
        const g=i>>2, j=i&3, a=L(g,sd), out=[];
        if(j<3){
          out.push({l:a, t:(j===1 && rng(sd+g*13+2)<.25) ? "n" : "c"});
          if(j===1 && rng(sd+g*13+4)<.4) out.push({l:(a+1+Math.floor(rng(sd+g*13+5)*2))%3, t:"b"});
        }else{ out.push({l:a, t:"b"}); out.push({l:L(g+1,sd), t:"c"}); }
        return out;
      }});
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

  /* ===== mobile joystick helper ===== */
  function mkJoy(cv){
    const j={x:0,y:0}; let a=null;
    cv.addEventListener("pointerdown", e=>{ e.preventDefault(); cv.setPointerCapture(e.pointerId); a={x:e.clientX, y:e.clientY}; });
    cv.addEventListener("pointermove", e=>{
      if(!a) return;
      const dx=e.clientX-a.x, dy=e.clientY-a.y, m=Math.min(1, Math.hypot(dx,dy)/40), g=Math.atan2(dy,dx);
      j.x=Math.cos(g)*m; j.y=Math.sin(g)*m;
    });
    const up=()=>{ a=null; j.x=0; j.y=0; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    const K={ArrowLeft:[-1,0], ArrowRight:[1,0], ArrowUp:[0,-1], ArrowDown:[0,1]};
    const kd=e=>{ const k=K[e.key]; if(k){ j.x=k[0]; j.y=k[1]; e.preventDefault(); } };
    window.addEventListener("keydown", kd); window.addEventListener("keyup", up);
    gHooks.push(()=>{ window.removeEventListener("keydown", kd); window.removeEventListener("keyup", up); });
    return j;
  }

  /* ===== CAPTURE THE FLAG (2 teams, realtime) ===== */
  function gCTF(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const secs=45, S=320, dpr=Math.min(2, window.devicePixelRatio||1);
    const area = beginPlay("ctf","CAPTURE THE FLAG",rl(),secs,"🔴 : 🔵");
    area.innerHTML = '<canvas id="arenaCv" width="' + S*dpr + '" height="' + S*dpr + '"></canvas>';
    const cv=$("arenaCv"), ctx=cv.getContext("2d");
    const players=currentRoomData.players||{}, ids=Object.keys(players).sort(), seed=currentRoomData.startAt||1;
    const tm=id=>ids.indexOf(id)%2, B=[{x:30,y:160},{x:290,y:160}], TC=["#ff3b4a","#3b8bff"];
    const home=(t,px)=>t===0 ? px<S/2 : px>S/2;
    const my=tm(playerId), slot=ids.indexOf(playerId);
    const me={x:B[my].x+(my?-22:22), y:160+((slot>>1)%5-2)*28, vx:0, vy:0, f:0, cap:0, stun:0};
    $("playMessage").textContent = "คุณอยู่ทีม " + (my ? "🔵" : "🔴") + " • ขโมยธงศัตรูกลับฐาน • โดนศัตรูชนในฝั่งเขา = กลับฐาน";
    const liveRef = db.ref("rooms/" + roomCode + "/live"); let live={}; const disp={};
    liveRef.child(playerId).remove();
    liveRef.on("value", sn=>{ live = sn.val() || {}; });
    const push = ()=>liveRef.child(playerId).set({s:seed, x:Math.round(me.x), y:Math.round(me.y), f:me.f, c:me.cap, z:me.stun>0?1:0});
    let on=true; const joy=mkJoy(cv);
    gHooks.push(()=>{ on=false; liveRef.off(); liveRef.child(playerId).remove(); });
    const ok=id=>live[id] && live[id].s===seed;
    const carries=id=>id===playerId ? me.f : (ok(id) && live[id].f);
    const carrier=team=>ids.find(id=>tm(id)!==team && carries(id));
    const teamScore=t=>ids.filter(id=>tm(id)===t).reduce((s,id)=>s+(id===playerId ? me.cap : (ok(id) ? (live[id].c||0) : 0)), 0);
    const pos=id=>id===playerId ? me : disp[id];
    const t0=performance.now(); let last=t0, lastPush=0, fin=false, lastTxt="";
    const loop=now=>{
      if(!on) return;
      const dt=Math.min(.05,(now-last)/1000), f=dt*60, t=(now-t0)/1000; last=now;
      Object.keys(live).forEach(id=>{
        const l=live[id]; if(!l || l.s!==seed) return;
        const o=disp[id] || (disp[id]={x:l.x, y:l.y});
        o.x+=(l.x-o.x)*Math.min(1,dt*14); o.y+=(l.y-o.y)*Math.min(1,dt*14);
      });
      me.stun=Math.max(0, me.stun-dt);
      if(!fin && me.stun<=0){
        const ac=.45*(me.f ? .8 : 1);
        me.vx+=joy.x*ac*f; me.vy+=joy.y*ac*f;
      }
      const fr=Math.pow(.9,f); me.vx*=fr; me.vy*=fr;
      me.x=Math.max(10,Math.min(S-10,me.x+me.vx*f)); me.y=Math.max(10,Math.min(S-10,me.y+me.vy*f));
      if(!fin && me.stun<=0){
        const eb=B[1-my], ob=B[my];
        const mateHas=ids.some(id=>tm(id)===my && carries(id));
        if(!me.f && !mateHas && Math.hypot(me.x-eb.x, me.y-eb.y)<24) me.f=1;
        if(me.f && Math.hypot(me.x-ob.x, me.y-ob.y)<30){ me.f=0; me.cap++; }
        if(!home(my, me.x)){
          const tagged=ids.some(id=>{
            if(tm(id)===my || id===playerId) return false;
            const l=live[id], o=disp[id];
            return l && l.s===seed && !l.z && o && home(tm(id), o.x) && Math.hypot(o.x-me.x, o.y-me.y)<26;
          });
          if(tagged){ me.f=0; me.stun=1.6; me.x=ob.x; me.y=160; me.vx=me.vy=0; }
        }
      }
      const a=teamScore(0), b=teamScore(1), txt=a + " : " + b;
      if(txt!==lastTxt){ lastTxt=txt; setGExtra(txt); }
      if(!fin && t>=secs-.7){
        fin=true;
        const mine=my?b:a, theirs=my?a:b;
        const sc=Math.min(100, (mine>theirs ? 60 : mine===theirs ? 40 : 25) + Math.min(40, me.cap*20));
        finishSelf(sc, mine>theirs ? "🏆 ทีมคุณชนะ " + mine + "-" + theirs + "!" : mine===theirs ? "🤝 เสมอ " + mine + "-" + theirs : "😵 ทีมคุณแพ้ " + mine + "-" + theirs);
      }
      if(now-lastPush>90){ lastPush=now; push(); }

      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,S,S);
      ctx.fillStyle="#0c0d14"; ctx.fillRect(0,0,S,S);
      ctx.fillStyle="rgba(255,59,74,.09)"; ctx.fillRect(0,0,S/2,S);
      ctx.fillStyle="rgba(59,139,255,.09)"; ctx.fillRect(S/2,0,S/2,S);
      ctx.strokeStyle="rgba(255,255,255,.25)"; ctx.lineWidth=2; ctx.setLineDash([8,8]);
      ctx.beginPath(); ctx.moveTo(S/2,0); ctx.lineTo(S/2,S); ctx.stroke(); ctx.setLineDash([]);
      [0,1].forEach(tt=>{
        ctx.beginPath(); ctx.arc(B[tt].x,B[tt].y,28,0,7); ctx.lineWidth=2; ctx.strokeStyle=TC[tt]; ctx.stroke();
        const c=carrier(tt), p=c ? pos(c) : B[tt];
        if(p){
          const fx=p.x, fy=c ? p.y-26 : p.y-4;
          ctx.strokeStyle="#fff"; ctx.lineWidth=2; ctx.beginPath(); ctx.moveTo(fx,fy+16); ctx.lineTo(fx,fy-8); ctx.stroke();
          ctx.fillStyle=TC[tt]; ctx.beginPath(); ctx.moveTo(fx,fy-8); ctx.lineTo(fx+16,fy-2); ctx.lineTo(fx,fy+4); ctx.fill();
        }
      });
      ids.forEach(id=>{
        const isMe=id===playerId, p=pos(id); if(!p) return;
        const stn=isMe ? me.stun>0 : (live[id] && live[id].z);
        ctx.globalAlpha=stn ? .3 : 1;
        ctx.beginPath(); ctx.arc(p.x,p.y,14,0,7); ctx.fillStyle=TC[tm(id)]; ctx.fill();
        ctx.lineWidth=3; ctx.strokeStyle=isMe ? "#fff" : "rgba(255,255,255,.35)"; ctx.stroke();
        ctx.fillStyle="#fff"; ctx.font="700 10px Kanit,sans-serif"; ctx.textAlign="center";
        ctx.fillText((players[id].name||"?").slice(0,7), p.x, p.y-20);
        ctx.globalAlpha=1;
      });
      requestAnimationFrame(loop);
    };
    push(); requestAnimationFrame(loop);
  }

  /* ===== FIND THE IMPOSTOR ===== */
  const IMP=[
    {a:["🐱 แมว",["เหมียว","หนวด","ขน","เลี้ยง"]], b:["🐶 หมา",["โฮ่ง","หาง","ขน","เลี้ยง"]]},
    {a:["🍎 แอปเปิล",["แดง","ผลไม้","กรอบ","หวาน"]], b:["🍅 มะเขือเทศ",["แดง","ผัก","ซอส","ฉ่ำ"]]},
    {a:["☀️ ดวงอาทิตย์",["ร้อน","กลางวัน","แสง","ฟ้า"]], b:["🌙 พระจันทร์",["เย็น","กลางคืน","แสง","ดาว"]]},
    {a:["🚗 รถยนต์",["ล้อ","ถนน","เร็ว","น้ำมัน"]], b:["🚲 จักรยาน",["ล้อ","ถนน","ปั่น","สองล้อ"]]},
    {a:["🍕 พิซซ่า",["ชีส","อิตาลี","อบ","วงกลม"]], b:["🍔 เบอร์เกอร์",["ชีส","อเมริกา","ขนมปัง","วงกลม"]]},
    {a:["🏖️ ทะเล",["คลื่น","ทราย","เค็ม","ว่ายน้ำ"]], b:["🏔️ ภูเขา",["หนาว","สูง","ปีน","ป่า"]]}
  ];
  function gImpostor(){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const area = beginPlay("impostor","FIND THE IMPOSTOR",rl(),30,"VOTES");
    const players=currentRoomData.players||{}, ids=Object.keys(players).sort(), seed=currentRoomData.startAt||1;
    const imp=ids[Math.floor(rng(seed)*ids.length)], set=IMP[Math.floor(rng(seed+5)*IMP.length)], swp=rng(seed+9)<.5;
    const card=id=>((id===imp)!==swp) ? set.b : set.a, mine=card(playerId);
    const me={w:"", v:""}; let live={}, rev=false, ph=0;
    const ref=db.ref("rooms/" + roomCode + "/live"); ref.child(playerId).remove();
    ref.on("value", sn=>{ live = sn.val() || {}; draw(); });
    gHooks.push(()=>{ ref.off(); ref.child(playerId).remove(); });
    const pub=()=>ref.child(playerId).set({s:seed, w:me.w, v:me.v});
    const t0=performance.now(), T=()=>(performance.now()-t0)/1000;
    const of=id=>id===playerId ? me : (live[id] && live[id].s===seed ? live[id] : {w:"", v:""});
    const cnt=id=>ids.filter(o=>of(o).v===id).length;
    const el=(tag,cls,txt)=>{ const e=document.createElement(tag); if(cls) e.className=cls; if(txt!==undefined) e.textContent=txt; return e; };
    function draw(){
      const vote=T()>=14; area.innerHTML="";
      const box=el("div","imp"), q=el("div","q-box");
      q.append(el("small","","YOUR CARD"), el("h3","",mine[0])); box.appendChild(q);
      box.appendChild(el("div","imp-tip", rev ? "เฉลยแล้ว" : !vote ? "เลือกคำใบ้ 1 คำ (ก่อน 14 วิ) โดยไม่บอกตรง ๆ" : "โหวตว่าใครคือ Impostor"));
      if(!vote && !me.w){
        const g=el("div","opt-grid");
        mine[1].forEach(w=>{ const b=el("button","num-cell opt",w); b.type="button"; tapOn(b, ()=>{ me.w=w; pub(); draw(); }); g.appendChild(b); });
        box.appendChild(g);
      }
      const list=el("div","imp-list");
      ids.forEach(id=>{
        const o=of(id), row=el("div","imp-row" + (id===playerId ? " me" : "") + (me.v===id ? " sel" : "") + (rev && id===imp ? " bad" : ""));
        row.appendChild(el("span","",(players[id].name||"PLAYER") + (rev && id===imp ? " 🕵️" : "")));
        row.appendChild(el("em","", o.w || "…"));
        if(rev) row.appendChild(el("span","", cnt(id) + " โหวต"));
        else if(vote && id!==playerId){ const b=el("button","btn secondary", me.v===id ? "VOTED" : "VOTE"); b.type="button"; tapOn(b, ()=>{ me.v=id; pub(); draw(); }); row.appendChild(b); }
        list.appendChild(row);
      });
      box.appendChild(list); area.appendChild(box);
    }
    function reveal(){
      rev=true;
      const against=ids.filter(id=>id!==imp && of(id).v===imp).length;
      let sc, msg;
      if(playerId===imp){ const surv=against*2<Math.max(1,ids.length-1); sc=surv?100:20; msg=surv ? "😈 คุณคือ Impostor และรอดได้!" : "🕵️ คุณคือ Impostor โดนจับได้!"; }
      else{ const good=me.v===imp; sc=good?100:30; msg=good ? "🎯 โหวตถูก!" : "❌ โหวตผิด"; }
      draw(); setGExtra(cnt(imp));
      finishSelf(sc, msg + " (" + (players[imp].name||"?") + " คือ Impostor)");
    }
    draw(); pub();
    addTimer(setInterval(()=>{
      if(rev) return;
      const p=T()>=14 ? 1 : 0; if(p!==ph){ ph=p; draw(); }
      if(T()>=27.5) reveal();
    }, 400));
  }

  async function toggleReady(){
    if(!roomCode || !firebaseReady) return;
    const ref = db.ref("rooms/" + roomCode + "/players/" + playerId + "/ready");
    const snap = await ref.once("value");
    await ref.set(!snap.val());
  }

  async function hostStartGame(){
    if(!isHost || !roomCode || !currentRoomData) return;
    const players = currentRoomData.players || {};
    const entries = Object.values(players);
    if(entries.length < 2) return alert("ต้องมีผู้เล่นอย่างน้อย 2 คน");
    if(!entries.every(p => p.ready)) return alert("ผู้เล่นทุกคนต้อง READY ก่อน");
    if(!gameInfo(currentRoomData.game).ready) return alert("เกมนี้ยังไม่เปิดให้เล่น");
    const startAt = Date.now() + 3000;
    const pl = currentRoomData.playlist || [currentRoomData.game || "memory"];
    await db.ref("rooms/" + roomCode).update({status:"starting", startAt:startAt, round:0, game:pl[0], scores:null});
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

  const MAXES = {memory:150, aim:100, number:150, puzzle:200, final:250, push:100, scramble:150, target:150, impostor:100, ctf:100, traffic:100, code:100};
  async function saveScores(id, score){
    if(!firebaseReady || !currentUser) return;
    const uid = currentUser.uid;
    score = Math.max(0, Math.min(MAXES[id] || 0, Math.floor(score)));
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
        return {name:playerName, best:best, total:total, updatedAt:Date.now()};
      });
    }catch(e){ console.error("Leaderboard error", e); }
  }

  function renderRoomResults(data){
    const box = $("roomResults");
    if(!box) return;
    box.innerHTML = "";
    if(!roomCode || !data || !memoryDone) return;
    const cur = gameInfo(data.game).id, players = data.players || {}, scores = data.scores || {};
    const rows = Object.keys(players).map(id=>{
      const s = scores[id] || {};
      let total = 0;
      Object.keys(s).forEach(k=>{ if(typeof s[k] === "number") total += s[k]; });
      return {id:id, name:players[id].name || "PLAYER", total:total, done:typeof s[cur] === "number"};
    }).sort((x,y)=>(y.done - x.done) || (y.total - x.total));
    const done = rows.filter(r=>r.done).length;
    const allDone = rows.length > 0 && done === rows.length;
    const pl = data.playlist || [cur], last = (data.round || 0) >= pl.length - 1;
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

  async function resetRoom(){
    if(!isHost || !roomCode || !currentRoomData) return;
    const updates = {status:"waiting", startAt:null, round:0, scores:null, live:null};
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
      const snap = await db.ref("leaderboard").orderByChild("total").limitToLast(20).once("value");
      const rows = [];
      snap.forEach(c=>{ rows.push({uid:c.key, name:c.val().name || "PLAYER", total:c.val().total || 0}); });
      rows.reverse();
      list.innerHTML = "";
      if(!rows.length){
        list.textContent = "ยังไม่มีคะแนน เล่นเกมแล้วชื่อคุณจะขึ้นที่นี่";
        return;
      }
      rows.forEach((r,i)=>{
        const row = document.createElement("div");
        if(currentUser && r.uid === currentUser.uid) row.className = "me";
        const rank = document.createElement("b");
        rank.textContent = String(i+1).padStart(2,"0");
        const name = document.createElement("span");
        name.textContent = r.name;
        const pts = document.createElement("strong");
        pts.textContent = r.total;
        row.append(rank, name, pts);
        list.appendChild(row);
      });
    }catch(e){
      console.error("Leaderboard load error", e);
      list.textContent = "โหลดอันดับไม่สำเร็จ (เช็ค Database Rules)";
    }
  }

  async function loadProfile(){
    const box = $("profileInfo");
    if(!box || !currentUser) return;
    let best = {}, total = 0;
    try{
      const snap = await db.ref("leaderboard/" + currentUser.uid).once("value");
      const v = snap.val() || {};
      best = v.best || {};
      total = v.total || 0;
    }catch(e){ console.error(e); }
    box.innerHTML = "";
    [["PLAYER", playerName || "-"],["EMAIL", currentUser.email || "-"],["TOTAL SCORE", total]].concat(GAMES.map(g=>[g.name + " BEST", best[g.id] || 0])).forEach(pair=>{
      const row = document.createElement("div");
      const label = document.createElement("span");
      label.textContent = pair[0];
      const val = document.createElement("strong");
      val.textContent = pair[1];
      row.append(label, val);
      box.appendChild(row);
    });
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

  $("createRoomButton").addEventListener("click",createRoom);
  $("joinRoomButton").addEventListener("click",joinRoom);
  $("roomCodeInput").addEventListener("input",e=>e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,""));
  $("readyButton").addEventListener("click",toggleReady);
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
  const TY_COL = ["#ff6b6b","#ffa94d","#ffd43b","#69db7c","#4dabf7","#9775fa","#f783ac"];
  const TY_START = 700, TY_GO = 200, TY_TAX = 100, TY_ROUNDS = 12, TY_TURN_MS = 60000, TY_FACE = "⚀⚁⚂⚃⚄⚅";
  let tyCode = localStorage.getItem("kyjTyRoom") || "", tyRef = null, tyRoom = null, tyG = null;
  let tyShown = {}, tyAnim = {}, tyRolling = false, tyTick = null, tySeenT = 0, tySeenAt = 0;

  const tyEsc = s=>String(s == null ? "" : s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const tyClone = o=>JSON.parse(JSON.stringify(o));
  const tyFix = g=>{ ["own","out","jail","pos","cash","nm"].forEach(k=>{ g[k] = g[k] || {}; }); g.log = g.log || []; return g; };
  const tyLog = (g,m)=>{ g.log.push(m); while(g.log.length > 8) g.log.shift(); };
  const tyPresent = ()=>((tyRoom && tyRoom.players) || {});
  const tyGrp = i=>TY_TILES.map((t,k)=>(t.t === "p" && t.g === TY_TILES[i].g) ? k : -1).filter(k=>k >= 0);
  const TY_XY = i=>i <= 6 ? [6, 6-i] : i <= 12 ? [6-(i-6), 0] : i <= 18 ? [0, i-12] : [i-18, 6];

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
    if(live.length <= 1 || g.n >= g.order.length * TY_ROUNDS){
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
    g.dice = [d1,d2];
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
    if(!tyG || tyG.cur !== playerId || tyRolling) return;
    const g = tyClone(tyG); tyFix(g);
    const u = playerId, i = g.at, T = TY_TILES[i] || {};
    if(a === "roll" && g.ph === "roll"){
      tyRolling = true; let k = 0;
      const iv = setInterval(()=>{
        const el = $("tyDice"), f = ()=>TY_FACE[Math.floor(Math.random()*6)];
        if(el) el.textContent = f() + " " + f();
        if(++k < 9) return;
        clearInterval(iv); tyRolling = false;
        const g2 = tyClone(tyG); tyFix(g2);
        if(g2.cur === playerId && g2.ph === "roll") tyCommit(tyRoll(g2, 1+Math.floor(Math.random()*6), 1+Math.floor(Math.random()*6)));
      }, 70);
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
    tyAnim[u] = setInterval(()=>{
      const tgt = tyG && tyG.pos[u] !== undefined ? tyG.pos[u] : to;
      tyShown[u] = (tyShown[u] + 1) % 24;
      if(tyShown[u] === tgt){ clearInterval(tyAnim[u]); tyAnim[u] = null; }
      tyDraw();
    }, 140);
  }
  function tyDraw(){
    const g = tyG; if(!g || !$("tyBoard")) return;
    let h = "";
    TY_TILES.forEach((T,i)=>{
      const xy = TY_XY(i), o = g.own["t"+i];
      let toks = "";
      g.order.forEach(u=>{ if(!g.out[u] && tyShown[u] === i) toks += '<i class="ty-tk" style="background:hsl(' + hueOf(u) + ',80%,58%)"></i>'; });
      h += '<div class="ty-t' + (T.t === "p" ? "" : " sp") + (g.ph !== "over" && g.at === i ? " hot" : "") + '" style="grid-area:' + (xy[0]+1) + '/' + (xy[1]+1) + '">' +
        (T.t === "p" ? '<span class="st" style="background:' + TY_COL[T.g] + '"></span>' : "") +
        T.i + '<b>' + (T.t === "p" ? T.p : T.n) + '</b>' +
        (o ? '<span class="ow" style="background:hsl(' + hueOf(o.o) + ',80%,58%)"></span>' + (o.l ? '<em>' + "★".repeat(o.l) + '</em>' : "") : "") +
        '<div class="ty-toks">' + toks + '</div></div>';
    });
    const d = g.dice || [1,1], rd = Math.min(TY_ROUNDS, Math.floor((g.n || 0) / g.order.length) + 1);
    h += '<div class="ty-mid"><div class="ty-logo">KAYEEJAI<br>TYCOON</div><div class="ty-dice" id="tyDice">' + TY_FACE[d[0]-1] + " " + TY_FACE[d[1]-1] + '</div>' +
      '<div class="ty-turn">' + (g.ph === "over" ? "GAME OVER" : "ตา: " + tyEsc(g.nm[g.cur])) + '</div><small>ROUND ' + rd + '/' + TY_ROUNDS + ' • <span id="tyTimer"></span></small></div>';
    $("tyBoard").innerHTML = h;

    const me = playerId, mine = g.cur === me, T = TY_TILES[g.at] || {}, o = g.own["t"+g.at];
    let c = "";
    if(g.ph === "over"){
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

    $("tyPlayers").innerHTML = g.order.map(u=>{
      const props = Object.keys(g.own).filter(k=>g.own[k].o === u).length;
      return '<div class="ty-p' + (g.cur === u && g.ph !== "over" ? " cur" : "") + (g.out[u] ? " dead" : "") + (u === me ? " me" : "") + '">' +
        '<i style="background:hsl(' + hueOf(u) + ',80%,58%)"></i><span>' + tyEsc(g.nm[u]) + (g.jail[u] && !g.out[u] ? " 🚔" : "") + (g.out[u] ? " 💀" : "") + '</span>' +
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
      const n = document.createElement("span"); n.textContent = (pl[id].name || "PLAYER") + (id === tyRoom.hostId ? " 👑" : "");
      d.appendChild(n); list.appendChild(d);
    });
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
      Object.keys(tyAnim).forEach(u=>clearInterval(tyAnim[u])); tyAnim = {}; tyShown = {};
      tyRenderLobby(); return;
    }
    if(tyG.tAt !== tySeenT){ tySeenT = tyG.tAt; tySeenAt = Date.now(); }
    Object.keys(tyG.pos).forEach(u=>tyMove(u, tyG.pos[u]));
    tyDraw();
  }
  function tyTickFn(){
    if(!tyG || !tyRoom || tyG.ph === "over") return;
    const left = Math.max(0, Math.ceil((TY_TURN_MS - (Date.now() - tySeenAt))/1000)), el = $("tyTimer");
    if(el) el.textContent = "⏱ " + left;
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
    Object.keys(tyAnim).forEach(u=>clearInterval(tyAnim[u])); tyAnim = {};
    clearInterval(tyTick); tyTick = null;
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
      const pl = {}; pl[playerId] = {name:getPlayerName() || "PLAYER"};
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
        await db.ref("rooms/" + code + "/players/" + playerId).set({name:getPlayerName() || "PLAYER"});
      }
      tyCode = code; localStorage.setItem("kyjTyRoom", code); tyListen();
    }catch(e){ console.error(e); alert("เข้าห้องไม่สำเร็จ: " + e.message); }
  }
  async function tyStart(){
    if(!tyRoom || tyRoom.hostId !== playerId) return;
    const pl = tyRoom.players || {}, ids = Object.keys(pl);
    if(ids.length < 2) return alert("ต้องมีผู้เล่นอย่างน้อย 2 คน");
    const order = shuffle(ids.slice()).slice(0,6);
    const g = {order:order, cur:order[0], ph:"roll", n:0, tAt:Date.now(), dice:[1,1], pos:{}, cash:{}, nm:{}, log:["🚀 เริ่มเกม! ทุกคนมีเงิน " + TY_START]};
    order.forEach(u=>{ g.pos[u] = 0; g.cash[u] = TY_START; g.nm[u] = pl[u].name || "PLAYER"; });
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
    $("tyLeave").addEventListener("click", ()=>tyLeave());
    $("tyLeaveGame").addEventListener("click", ()=>tyLeave());
    $("tyCopy").addEventListener("click", async()=>{
      try{ await navigator.clipboard.writeText(tyCode); $("tyCopy").textContent = "COPIED!"; setTimeout(()=>$("tyCopy").textContent = "COPY", 1200); }
      catch(e){ alert("รหัสห้อง: " + tyCode); }
    });
    $("tyCtl").addEventListener("click", e=>{
      const b = e.target.closest("[data-a]"); if(!b) return;
      const a = b.dataset.a;
      if(a === "back") tyLeave();
      else if(a === "again"){ if(tyRef && tyRoom && tyRoom.hostId === playerId) tyRef.update({status:"lobby", g:null}); }
      else tyAct(a);
    });
  }

if ($("logoutButton")) {
  $("logoutButton").addEventListener("click",logout);
}

setupAuth();

})();

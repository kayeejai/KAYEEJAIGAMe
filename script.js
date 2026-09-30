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
    {id:"lava", name:"FLOOR IS LAVA", icon:"🌋", ready:true, room:true, time:"40 SEC", max:100, desc:"หนี RED ZONE ก่อนพื้นกลายเป็นลาวา"},
    {id:"impostor", name:"FIND THE IMPOSTOR", icon:"🕵️", ready:false, time:"VOTE", max:100, desc:"ทุกคนเห็นภาพเดียวกัน ยกเว้น 1 คน โหวตหา Impostor"},
    {id:"ctf", name:"CAPTURE THE FLAG", icon:"🚩", ready:false, time:"TEAM", max:100, desc:"ทีมแดง vs ทีมฟ้า แย่งธงกลับฐาน"},
    {id:"target", name:"TARGET RUSH", icon:"🎯", ready:true, time:"30 SEC", max:150, desc:"ยิงเฉพาะสีที่ระบบประกาศ ยิงผิดเสียคะแนน"},
    {id:"traffic", name:"TRAFFIC RUSH", icon:"🚦", ready:false, time:"RACE", max:100, desc:"ขับบนถนนเดียวกัน หลบรถและสิ่งกีดขวาง"},
    {id:"bomb", name:"BOMB ZONE", icon:"💣", ready:false, time:"LIVE", max:100, desc:"เลือกช่องเดิน บางช่องปลอดภัย บางช่องมีระเบิด"}
  ];
  function gameInfo(id){ return GAMES.find(g=>g.id === id) || GAMES[0]; }

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
      const icon = document.createElement("span"); icon.textContent = g.icon;
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
    ({memory:startMemoryGame, aim:gAim, number:gNumber, puzzle:gPuzzle, final:gFinal, push:()=>gArena("push"), lava:()=>gArena("lava"), target:gTarget}[id] || startMemoryGame)();
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

  /* ===== realtime arena: PUSH BATTLE + FLOOR IS LAVA ===== */
  function gArena(kind){
    if(!roomCode || !currentRoomData){ alert("เกมนี้ต้องเล่นในห้อง (ต้องมีผู้เล่นหลายคน)"); return; }
    const isPush = kind === "push", secs = isPush ? 45 : 40, C = 160;
    const area = beginPlay(kind, isPush ? "PUSH BATTLE" : "FLOOR IS LAVA", rl(), secs, "ALIVE");
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    area.innerHTML = '<canvas id="arenaCv" width="' + 320*dpr + '" height="' + 320*dpr + '"></canvas>' +
      (isPush ? '<div class="lane-ctrl one"><button type="button" class="btn primary" id="dashBtn">DASH ⚡</button></div>' : "");
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
    if(isPush) tapOn($("dashBtn"), ()=>{
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

    const lavaSet = k=>{
      const set = new Set(), n = Math.min(6 + Math.floor(k/2), 15);
      for(let i=0; set.size < n; i++) set.add(Math.floor(rng(seed + k*131 + i)*25));
      return set;
    };
    const lavaAt = t=>{
      const tt = t - 2, k = Math.floor(Math.max(0, tt)/3), ph = tt - k*3;
      return tt < 0 ? {on:false} : {on:true, ph:ph, set:lavaSet(k), k:k};
    };
    const scoreAt = t=>{
      if(t >= secs - 1.2) return 100;
      return isPush ? 10 + Math.floor(t/secs*60) : Math.floor(t/secs*90);
    };
    const die = t=>{
      me.alive = false; push();
      finishSelf(isPush ? 10 + Math.floor(t/secs*60) : Math.floor(t/secs*90), "💀 ตกรอบ!");
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
      let lv = null;
      if(me.alive){
        me.vx += joy.x*0.45*f; me.vy += joy.y*0.45*f;
        const fr = Math.pow(0.9, f);
        me.vx *= fr; me.vy *= fr; me.cd = Math.max(0, me.cd - dt);
        me.x += me.vx*f; me.y += me.vy*f;
        if(isPush){
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
        }else{
          me.x = Math.max(6, Math.min(314, me.x)); me.y = Math.max(6, Math.min(314, me.y));
          lv = lavaAt(t);
          if(lv.on && lv.ph >= 1.6 && lv.ph < 2.6 && lv.set.has(Math.floor(me.y/64)*5 + Math.floor(me.x/64))) die(t);
        }
        if(gPlaying){ const sc = scoreAt(t); if(sc !== gScore) setGScore(sc); }
      }else if(!isPush) lv = lavaAt(t);
      let alive = 0;
      ids.forEach(id=>{ const l = id === playerId ? {a:me.alive?1:0} : live[id]; if(l ? l.a : t < 3) alive++; });
      setGExtra(alive);
      if(t > 3 && alive <= 1 && me.alive) finishSelf(100, "🏆 ชนะ!");
      if(now - lastPush > 90){ lastPush = now; push(); }

      ctx.setTransform(dpr,0,0,dpr,0,0); ctx.clearRect(0,0,320,320);
      ctx.fillStyle = "#0c0d14"; ctx.fillRect(0,0,320,320);
      if(isPush){
        const R = 150 - (t/secs)*70;
        ctx.beginPath(); ctx.arc(C,C,R,0,7); ctx.fillStyle = "#181a28"; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = "#ff2a3a"; ctx.shadowColor = "#ff2a3a"; ctx.shadowBlur = 14; ctx.stroke(); ctx.shadowBlur = 0;
      }else{
        for(let i=0; i<25; i++){
          const x = (i%5)*64, y = Math.floor(i/5)*64;
          ctx.fillStyle = "#181a28"; ctx.fillRect(x+1, y+1, 62, 62);
          if(lv && lv.on && lv.set.has(i) && lv.ph < 2.6){
            ctx.fillStyle = lv.ph < 1.6 ? "rgba(255,150,30," + (0.28 + 0.24*Math.sin(t*14)) + ")" : "#ff2a1a";
            ctx.fillRect(x+1, y+1, 62, 62);
          }
        }
        if(lv && lv.on && lv.ph < 1.6){
          ctx.font = "900 26px Orbitron,sans-serif"; ctx.textAlign = "center"; ctx.fillStyle = "#fff";
          ctx.shadowColor = "#ff2a3a"; ctx.shadowBlur = 16; ctx.fillText("🔥 RED ZONE", C, 34); ctx.shadowBlur = 0;
        }
      }
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

  function gFinal(){
    const area = beginPlay("final","FINAL RACE","FINAL",30,"COINS");
    area.innerHTML = '<div class="lane-grid" id="laneGrid"></div><div class="lane-ctrl"><button type="button" class="btn secondary" id="laneL">◀</button><button type="button" class="btn secondary" id="laneR">▶</button></div>';
    const grid = $("laneGrid");
    let lane = 1, coins = 0, items = [], tick = 0;
    const draw = ()=>{
      let h = "";
      for(let r=0; r<8; r++) for(let c=0; c<3; c++){
        const it = items.find(i=>i.r === r && i.c === c);
        h += "<div>" + (r === 7 && c === lane ? "🏎️" : it ? it.t : "") + "</div>";
      }
      grid.innerHTML = h;
    };
    const step = ()=>{
      tick++;
      items.forEach(i=>i.r++);
      items.filter(i=>i.r === 7 && i.c === lane).forEach(i=>{
        if(i.t === "🪙"){ coins++; setGExtra(coins); setGScore(Math.min(250, gScore+10)); }
        else { setGScore(Math.max(0, gScore-15)); area.classList.add("shake"); setTimeout(()=>area.classList.remove("shake"), 200); }
        i.r = 9;
      });
      items = items.filter(i=>i.r < 8);
      if(tick % 2 === 0) items.push({r:0, c:Math.floor(Math.random()*3), t:Math.random() < 0.6 ? "🪙" : "🚧"});
      draw();
    };
    const move = d=>{ lane = Math.max(0, Math.min(2, lane+d)); draw(); };
    tapOn($("laneL"), ()=>move(-1));
    tapOn($("laneR"), ()=>move(1));
    draw(); addTimer(setInterval(step, 220));
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

  const MAXES = {memory:150, aim:100, number:150, puzzle:200, final:250, push:100, lava:100, target:150};
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
  $("playMemoryButton").addEventListener("click",()=>{
    showPage("arena");
    startMemoryGame();
  });
  $("startMemoryRoundButton").addEventListener("click",startSelectedGame);
  $("exitPlayButton").addEventListener("click",()=>{ stopGame(); $("playGameScreen").classList.add("hidden"); $("gameScreen").classList.remove("hidden"); });
  GAMES.slice(5).forEach((g,i)=>{
    const card = document.createElement("article");
    card.className = "game-card";
    const btn = !g.ready ? '<button class="btn disabled full" type="button" disabled>COMING SOON</button>'
      : g.room ? '<button class="btn disabled full" type="button" disabled>ROOM ONLY</button>'
      : '<button class="btn primary full" data-play="' + g.id + '" type="button">PLAY GAME</button>';
    card.innerHTML = '<div class="game-icon">' + g.icon + '</div><div class="game-number">ROUND ' + (i+6) + '</div><h3>' + g.name + '</h3><p>' + g.desc + '</p><div class="game-meta"><span>' + g.time + '</span><span>MAX ' + g.max + '</span></div>' + btn;
    document.querySelector(".game-grid").appendChild(card);
  });
  document.querySelectorAll("[data-play]").forEach(b=>b.addEventListener("click",()=>{ showPage("arena"); startGameById(b.dataset.play); }));
  $("exitMemoryButton").addEventListener("click",exitMemoryGame);
  $("backToLobbyButton").addEventListener("click",()=>{
    $("gameScreen").classList.add("hidden");
    if(roomCode) $("lobbyScreen").classList.remove("hidden");
    else $("roomPanel").classList.remove("hidden");
  });

if ($("logoutButton")) {
  $("logoutButton").addEventListener("click",logout);
}

setupAuth();

})();

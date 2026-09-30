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
    const startAt = Date.now() + 3000;
    await db.ref("rooms/" + roomCode).update({status:"starting",startAt:startAt});
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
        title.textContent = "MEMORY MATCH";
        desc.textContent = "เกมเริ่มแล้ว";
        button.style.display = "inline-block";
        if(fresh && roomCode && !memoryPlaying && !memoryDone) startMemoryGame();
      }
    };
    tick();
  }

  function showGameScreen(){
    $("lobbyScreen").classList.add("hidden");
    $("gameScreen").classList.remove("hidden");
    $("memoryGameScreen").classList.add("hidden");
  }

  function startMemoryGame(){
    clearInterval(memoryTimer);
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
    saveScores(memoryScore);
    renderRoomResults(currentRoomData);
  }

  async function saveScores(score){
    if(!firebaseReady || !currentUser) return;
    const uid = currentUser.uid;
    score = Math.max(0, Math.min(150, Math.floor(score)));
    try{
      if(roomCode) await db.ref("rooms/" + roomCode + "/scores/" + uid).set({name:playerName, memory:score});
    }catch(e){ console.error("Room score error", e); }
    try{
      await db.ref("leaderboard/" + uid).transaction(cur=>{
        cur = cur || {};
        const best = cur.best || {};
        if(!(best.memory >= score)) best.memory = score;
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
    const players = data.players || {};
    const scores = data.scores || {};
    const rows = Object.keys(players).map(id=>{
      const s = scores[id];
      let total = null;
      if(s){
        total = 0;
        Object.keys(s).forEach(k=>{ if(typeof s[k] === "number") total += s[k]; });
      }
      return {id:id, name:players[id].name || "PLAYER", total:total};
    }).sort((a,b)=>(b.total === null ? -1 : b.total) - (a.total === null ? -1 : a.total));
    const done = rows.filter(r=>r.total !== null).length;
    const allDone = rows.length > 0 && done === rows.length;
    const title = document.createElement("h3");
    title.textContent = allDone ? "🏆 สรุปคะแนนรวมในห้อง" : "รอผู้เล่นอื่น... (" + done + "/" + rows.length + ")";
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
      pts.textContent = r.total === null ? "กำลังเล่น..." : r.total;
      row.append(rank, name, pts);
      box.appendChild(row);
    });
    if(allDone){
      const note = document.createElement("div");
      note.className = "result-note";
      if(isHost){
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn primary full";
        btn.textContent = "PLAY AGAIN";
        btn.addEventListener("click", resetRoom);
        note.appendChild(btn);
      }else{
        note.textContent = "รอ Host เริ่มรอบใหม่";
      }
      box.appendChild(note);
    }
  }

  async function resetRoom(){
    if(!isHost || !roomCode || !currentRoomData) return;
    const updates = {status:"waiting", startAt:null, scores:null};
    Object.keys(currentRoomData.players || {}).forEach(id=>{ updates["players/" + id + "/ready"] = false; });
    try{ await db.ref("rooms/" + roomCode).update(updates); }
    catch(e){ console.error(e); alert("เริ่มรอบใหม่ไม่สำเร็จ"); }
  }

  function returnToLobby(){
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
    [["PLAYER", playerName || "-"],["EMAIL", currentUser.email || "-"],["TOTAL SCORE", total],["MEMORY BEST", best.memory || 0]].forEach(pair=>{
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
  $("startMemoryRoundButton").addEventListener("click",startMemoryGame);
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

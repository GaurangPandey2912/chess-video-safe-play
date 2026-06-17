(function () {
  'use strict';

  let state = 'idle';
  let localStream = null;
  let remoteStream = null;
  let peer = null;
  let conn = null;
  let pc = null;
  let frameInterval = null;
  let chatInterval = null;
  let blocked = false;
  let lastChatHash = 0;

  const STUN = { urls: 'stun:stun.l.google.com:19302' };
  const BLOCKLIST = ['nude', 'naked', 'sex', 'porn', 'xxx', 'fuck', 'cock', 'dick', 'pussy', 'asshole', 'bitch', 'whore', 'slut'];
  const SKIN = { hMin: 0, hMax: 50, sMin: 20, sMax: 65, vMin: 40, vMax: 100 };
  const SKIN_THRESHOLD = 0.45;
  const FRAME_INTERVAL = 3000;
  const CHAT_INTERVAL = 1200;
  const SERVER_URL = 'http://localhost:3000';
  const WS_URL = 'ws://localhost:3000';

  const container = document.createElement('div');
  container.id = 'chess-video-bar';
  container.innerHTML = `
    <div class="cv-inner">
      <span class="cv-status" id="cv-status">Video Off</span>
      <div class="cv-actions" id="cv-actions">
        <button class="cv-btn cv-btn-start" id="cv-start">Start Video</button>
        <input class="cv-input" id="cv-peer-input" placeholder="Paste peer ID to join" />
        <button class="cv-btn cv-btn-join" id="cv-join">Join</button>
        <button class="cv-btn cv-btn-stop" style="display:none" id="cv-stop">Stop</button>
        <button class="cv-btn" id="cv-friends-btn" style="display:none">Friends</button>
      </div>
    </div>
    <div class="cv-friends-dropdown" id="cv-friends-dropdown" style="display:none"></div>
    <div class="cv-screen" id="cv-screen">
      <video class="cv-remote" id="cv-remote" playsinline autoplay></video>
      <video class="cv-local" id="cv-local" muted playsinline autoplay></video>
      <canvas id="cv-canvas" width="160" height="120" style="display:none"></canvas>
      <div class="cv-overlay" id="cv-overlay">⚠ Blocked — sensitive content detected</div>
    </div>
  `;
  document.body.appendChild(container);

  const $ = id => container.querySelector(id);
  const statusEl = $('#cv-status');
  const screenEl = $('#cv-screen');
  const localVideo = $('#cv-local');
  const remoteVideo = $('#cv-remote');
  const overlay = $('#cv-overlay');
  const peerInput = $('#cv-peer-input');
  const canvas = $('#cv-canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  function setStatus(text, cls) {
    statusEl.textContent = text;
    statusEl.className = 'cv-status ' + (cls || '');
  }

  function hash(s) {
    let h = 0;
    for (let i = 0; i < s.length; i++) { h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return h;
  }

  async function getCamera() {
    localStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240, frameRate: 15 }, audio: false });
    localVideo.srcObject = localStream;
  }

  let pendingIce = [];

  function flushIce() {
    if (!pendingIce.length) return;
    const p = pendingIce.slice();
    pendingIce = [];
    p.forEach(c => pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {}));
  }

  function createPC() {
    pc = new RTCPeerConnection({ iceServers: [STUN] });
    pc.onicecandidate = e => {
      if (e.candidate && conn && conn.open) {
        try { conn.send(JSON.stringify({ type: 'ice', candidate: e.candidate })); }
        catch (err) { console.warn('[CV] send ice fail:', err); }
      }
    };
    pc.ontrack = e => {
      if (!remoteStream) {
        remoteStream = new MediaStream();
        remoteVideo.srcObject = remoteStream;
      }
      remoteStream.addTrack(e.track);
      console.log('[CV] ontrack — track kind:', e.track.kind);
    };
    pc.onconnectionstatechange = () => {
      console.log('[CV] connection state:', pc.connectionState);
      if (pc.connectionState === 'connected') console.log('[CV] WebRTC connected!');
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        setStatus('Disconnected', 'idle');
        screenEl.style.display = 'none';
        stopMonitors();
      }
    };
    if (localStream) localStream.getTracks().forEach(t => pc.addTrack(t, localStream));
    return pc;
  }

  async function initHost() {
    try {
      await getCamera();
      setStatus('Creating room...', 'connecting');
      peer = new Peer();
      peer.on('open', id => {
        console.log('[CV] Host Peer ID:', id);
        peerInput.value = id;
        peerInput.select();
        navigator.clipboard.writeText(id);
        setStatus('Room ID: ' + id + ' (copied)', 'connecting');
      });
      peer.on('error', err => {
        console.error('[CV] Host peer error:', err.type, err.message);
        setStatus('Peer error: ' + err.type, 'idle');
      });
      peer.on('connection', c => {
        conn = c;
        console.log('[CV] Host received connection, conn open:', !!conn.open);
        const dataHandler = async data => {
          try {
            const msg = JSON.parse(data);
            console.log('[CV] Host got msg type:', msg.type);
            if (msg.type === 'answer') {
              console.log('[CV] Host received answer');
              await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
              flushIce();
            } else if (msg.type === 'ice' && pc) {
              if (pc.currentRemoteDescription) {
                await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
              } else {
                pendingIce.push(msg.candidate);
              }
            }
          } catch (e) { console.error('[CV] Host data error:', e); }
        };
        conn.on('data', dataHandler);
        conn.on('error', err => console.error('[CV] Host conn error:', err));
        conn.on('close', () => console.log('[CV] Host conn closed'));
        conn.on('open', async () => {
          console.log('[CV] Host conn open');
          createPC();
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          console.log('[CV] Host sending offer');
          conn.send(JSON.stringify({ type: 'offer', sdp: offer }));
          startMonitors();
          screenEl.style.display = 'block';
          setStatus('Connected', 'connected');
        });
      });
    } catch (e) {
      setStatus('Camera error: ' + e.message, 'idle');
    }
  }

  async function initGuest(hostId) {
    try {
      await getCamera();
      setStatus('Joining...', 'connecting');
      peer = new Peer();
      peer.on('open', id => {
        console.log('[CV] Guest Peer ID:', id);
        setStatus('Connecting to host...', 'connecting');
        conn = peer.connect(hostId, { reliable: true });
        conn.on('error', err => {
          console.error('[CV] Conn error:', err);
        });
        conn.on('close', () => {
          console.log('[CV] Guest conn closed');
          if (state === 'starting') setStatus('Connection failed', 'idle');
        });
        conn.on('open', () => {
          console.log('[CV] Guest conn open');
          conn.on('data', async data => {
            try {
              const msg = JSON.parse(data);
              console.log('[CV] Guest got msg type:', msg.type);
              if (msg.type === 'offer') {
                console.log('[CV] Guest received offer');
                if (!pc) createPC();
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                flushIce();
                conn.send(JSON.stringify({ type: 'answer', sdp: answer }));
                console.log('[CV] Guest sent answer');
                startMonitors();
                screenEl.style.display = 'block';
                setStatus('Connected', 'connected');
              } else if (msg.type === 'ice' && pc) {
                if (pc.currentRemoteDescription) {
                  await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                } else {
                  pendingIce.push(msg.candidate);
                }
              }
            } catch (e) { console.error('[CV] Guest data error:', e); }
          });
          if (!pc) createPC();
        });
      });
      peer.on('error', err => {
        console.error('[CV] Guest peer error:', err.type, err.message);
        setStatus('Peer error: ' + err.type, 'idle');
      });
    } catch (e) {
      setStatus('Camera error: ' + e.message, 'idle');
    }
  }

  function startMonitors() {
    if (frameInterval) return;
    frameInterval = setInterval(checkFrame, FRAME_INTERVAL);
    chatInterval = setInterval(checkChat, CHAT_INTERVAL);
  }

  function stopMonitors() {
    if (frameInterval) { clearInterval(frameInterval); frameInterval = null; }
    if (chatInterval) { clearInterval(chatInterval); chatInterval = null; }
  }

  function checkFrame() {
    if (!remoteVideo.videoWidth || blocked) return;
    ctx.drawImage(remoteVideo, 0, 0, 160, 120);
    const d = ctx.getImageData(0, 0, 160, 120).data;
    let skin = 0, total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2];
      const mx = Math.max(r,g,b), mn = Math.min(r,g,b);
      const v = (mx / 255) * 100;
      if (v < 5) continue;
      const s = mx ? ((mx - mn) / mx) * 100 : 0;
      let h = 0;
      const diff = mx - mn;
      if (diff) {
        if (mx === r) h = ((g - b) / diff + (g < b ? 6 : 0)) * 60;
        else if (mx === g) h = ((b - r) / diff + 2) * 60;
        else h = ((r - g) / diff + 4) * 60;
      }
      if (h >= SKIN.hMin && h <= SKIN.hMax && s >= SKIN.sMin && s <= SKIN.sMax && v >= SKIN.vMin && v <= SKIN.vMax) skin++;
      total++;
    }
    const ratio = skin / (total || 1);
    if (ratio > SKIN_THRESHOLD) {
      blocked = true;
      overlay.style.display = '';
      setStatus('Blocked', 'blocked');
      setTimeout(() => { blocked = false; overlay.style.display = 'none'; setStatus('Connected', 'connected'); }, 6000);
    }
  }

  function checkChat() {
    const el = document.querySelector('[class*="chat-log"], [class*="message-list"], [class*="chat"]');
    if (!el) return;
    const text = el.textContent;
    const h = hash(text);
    if (h === lastChatHash || text.length < 4) return;
    lastChatHash = h;
    const lower = text.toLowerCase();
    for (const word of BLOCKLIST) {
      if (lower.includes(word)) {
        blocked = true;
        overlay.style.display = '';
        setStatus('Blocked', 'blocked');
        setTimeout(() => { blocked = false; overlay.style.display = 'none'; setStatus('Connected', 'connected'); }, 6000);
        return;
      }
    }
  }

  function cleanup() {
    stopMonitors();
    if (pc) { pc.close(); pc = null; }
    if (conn) { conn.close(); conn = null; }
    if (peer) { peer.destroy(); peer = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    remoteStream = null;
    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    pendingIce = [];
  }

  $('#cv-start').onclick = () => {
    if (state !== 'idle') return;
    state = 'starting';
    initHost().catch(() => { state = 'idle'; });
  };

  $('#cv-join').onclick = () => {
    const pid = peerInput.value.trim();
    if (!pid || state !== 'idle') return;
    state = 'starting';
    initGuest(pid).catch(() => { state = 'idle'; });
  };

  $('#cv-stop').onclick = () => {
    cleanup();
    state = 'idle';
    setStatus('Stopped', 'idle');
    screenEl.style.display = 'none';
    overlay.style.display = 'none';
  };

  setStatus('Video Off', 'idle');

  // === Friend System ===
  let friendWs = null;
  let friendPeer = null;
  let friendsList = [];
  let incomingCallData = null;
  let friendCallActive = false;

  async function initFriendSystem() {
    const result = await chrome.storage.local.get(['cv_token', 'cv_user']);
    if (!result.cv_token || !result.cv_user) return;

    const username = result.cv_user.username;
    const peerId = 'cv-' + username;

    friendPeer = new Peer(peerId);
    friendPeer.on('call', handleIncomingPeerCall);
    friendPeer.on('error', () => {});

    const fb = document.getElementById('cv-friends-btn');
    if (fb) fb.style.display = '';

    connectFriendWS(result.cv_token, peerId);
  }

  function connectFriendWS(token, peerId) {
    if (friendWs) try { friendWs.close(); } catch (e) {}
    friendWs = new WebSocket(WS_URL);

    friendWs.onopen = () => {
      friendWs.send(JSON.stringify({ type: 'auth', token, peerId }));
    };
    friendWs.onmessage = (event) => {
      try { handleFriendMessage(JSON.parse(event.data)); } catch (e) {}
    };
    friendWs.onclose = () => {
      setTimeout(() => {
        chrome.storage.local.get(['cv_token', 'cv_user'], (r) => {
          if (r.cv_token) connectFriendWS(r.cv_token, 'cv-' + r.cv_user.username);
        });
      }, 5000);
    };
    friendWs.onerror = () => { try { friendWs.close(); } catch (e) {} };
  }

  function handleFriendMessage(msg) {
    switch (msg.type) {
      case 'friends-list':
        friendsList = msg.friends;
        break;
      case 'friend-online':
        updateFriendStatus(msg.userId, true, msg.username, msg.peerId);
        break;
      case 'friend-offline':
        updateFriendStatus(msg.userId, false);
        break;
      case 'incoming-call':
        showIncomingCallUI(msg.from, msg.peerId);
        break;
      case 'call-accepted':
        setStatus('Connected', 'connected');
        break;
      case 'call-rejected':
        setStatus('Call rejected', 'idle');
        setTimeout(() => setStatus('Video Off', 'idle'), 2000);
        break;
    }
  }

  function updateFriendStatus(userId, online, username, peerId) {
    const f = friendsList.find(x => x._id === userId);
    if (f) { f.online = online; if (peerId) f.peerId = peerId; }
  }

  async function callFriendViaPeer(remotePeerId) {
    if (!friendPeer || friendCallActive) return;

    try {
      if (!localStream) {
        await getCamera();
        localVideo.srcObject = localStream;
      }
    } catch (e) {
      setStatus('Camera access needed', 'idle');
      return;
    }

    friendCallActive = true;
    screenEl.style.display = 'block';
    setStatus('Calling...', 'connecting');

    const call = friendPeer.call(remotePeerId, localStream);
    setupFriendCall(call);
  }

  function setupFriendCall(call) {
    call.on('stream', (stream) => {
      remoteStream = stream;
      remoteVideo.srcObject = stream;
      setStatus('Connected', 'connected');
      startMonitors();
      friendCallActive = true;
      dd = document.getElementById('cv-friends-dropdown');
      if (dd) dd.style.display = 'none';
    });
    call.on('close', () => {
      cleanupFriendCall();
    });
  }

  function cleanupFriendCall() {
    stopMonitors();
    if (pc) { pc.close(); pc = null; }
    remoteStream = null;
    remoteVideo.srcObject = null;
    localVideo.srcObject = null;
    screenEl.style.display = 'none';
    overlay.style.display = 'none';
    friendCallActive = false;
    if (!document.querySelector('#cv-actions .cv-btn-start')) {
      setStatus('Video Off', 'idle');
    }
  }

  function handleIncomingPeerCall(call) {
    incomingCallData = { ...(incomingCallData || {}), call };
    // Auto-answer if user already accepted via notification
    if (incomingCallData && incomingCallData._answered) {
      answerFriendCall(call);
    }
  }

  async function answerFriendCall(call) {
    try {
      if (!localStream) {
        await getCamera();
        localVideo.srcObject = localStream;
      }
    } catch (e) { return; }

    friendCallActive = true;
    screenEl.style.display = 'block';
    call.answer(localStream);
    call.on('stream', (stream) => {
      remoteStream = stream;
      remoteVideo.srcObject = stream;
      setStatus('Connected', 'connected');
      startMonitors();
    });
    call.on('close', () => cleanupFriendCall());
  }

  function showIncomingCallUI(from, peerId) {
    incomingCallData = { from, peerId };

    const old = document.getElementById('cv-call-notification');
    if (old) old.remove();

    const n = document.createElement('div');
    n.id = 'cv-call-notification';
    n.style.cssText = 'position:fixed;bottom:90px;right:20px;z-index:999999;background:#1a1a2e;border:1px solid #30305a;border-radius:8px;padding:12px 16px;box-shadow:0 4px 20px rgba(0,0,0,0.5);font-family:-apple-system,sans-serif;color:#fff;font-size:13px;min-width:220px';
    n.innerHTML =
      '<div style="margin-bottom:8px">📞 Incoming call from <strong>' + from.username + '</strong></div>' +
      '<div style="display:flex;gap:8px">' +
      '<button id="cv-accept-call" style="background:#2a6e3e;color:#fff;border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:12px">Accept</button>' +
      '<button id="cv-reject-call" style="background:#7a1a1a;color:#fff;border:none;border-radius:4px;padding:5px 12px;cursor:pointer;font-size:12px">Reject</button>' +
      '</div>';
    document.body.appendChild(n);

    document.getElementById('cv-accept-call').onclick = async () => {
      n.remove();
      incomingCallData._answered = true;
      if (incomingCallData.call) {
        await answerFriendCall(incomingCallData.call);
      }
      if (friendWs && incomingCallData.from) {
        friendWs.send(JSON.stringify({ type: 'call-accepted', to: incomingCallData.from.userId, peerId: friendPeer ? friendPeer.id : '' }));
      }
    };

    document.getElementById('cv-reject-call').onclick = () => {
      n.remove();
      if (friendWs && incomingCallData.from) {
        friendWs.send(JSON.stringify({ type: 'call-rejected', to: incomingCallData.from.userId }));
      }
      incomingCallData = null;
    };

    setTimeout(() => { const el = document.getElementById('cv-call-notification'); if (el) el.remove(); }, 30000);
  }

  document.addEventListener('click', (e) => {
    if (e.target.classList.contains('cv-call-btn')) {
      callFriendViaPeer(e.target.dataset.peerid);
    }
  });

  const friendsBtn = document.getElementById('cv-friends-btn');
  const friendsDropdown = document.getElementById('cv-friends-dropdown');

  if (friendsBtn && friendsDropdown) {
    friendsBtn.onclick = () => {
      const shown = friendsDropdown.style.display !== 'none';
      friendsDropdown.style.display = shown ? 'none' : 'block';
      if (!shown) renderFriendsDropdown();
    };

    document.addEventListener('click', (e) => {
      if (friendsDropdown.style.display !== 'none' &&
          !e.target.closest('#cv-friends-btn') &&
          !e.target.closest('#cv-friends-dropdown')) {
        friendsDropdown.style.display = 'none';
      }
    });
  }

  function renderFriendsDropdown() {
    const dd = document.getElementById('cv-friends-dropdown');
    if (!dd) return;

    const online = friendsList.filter(f => f.online);
    const offline = friendsList.filter(f => !f.online);

    if (!friendsList.length) {
      dd.innerHTML = '<div style="padding:10px;color:#6b7280;font-size:12px;text-align:center">No friends yet.<br>Open the dashboard to add friends!</div>';
      return;
    }

    let html = '';
    if (online.length) {
      html += '<div style="padding:6px 10px 2px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Online</div>';
      online.forEach(f => {
        html += '<div class="cv-friend-item" data-userid="' + f._id + '">' +
          '<span class="cv-friend-name"><span class="cv-friend-dot online"></span>' + f.username + '</span>' +
          '<button class="cv-call-btn" data-peerid="' + (f.peerId || f._id) + '">Call</button>' +
          '</div>';
      });
    }
    if (offline.length) {
      html += '<div style="padding:6px 10px 2px;font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:0.5px">Offline</div>';
      offline.forEach(f => {
        html += '<div class="cv-friend-item" data-userid="' + f._id + '">' +
          '<span class="cv-friend-name"><span class="cv-friend-dot offline"></span>' + f.username + '</span>' +
          '</div>';
      });
    }

    dd.innerHTML = html;
  }

  initFriendSystem();
})();

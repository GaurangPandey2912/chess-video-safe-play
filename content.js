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
      </div>
    </div>
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
  const ctx = canvas.getContext('2d');

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
})();

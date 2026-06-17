const TOKEN_KEY = 'cv_token';
const USER_KEY = 'cv_user';

function getToken() { return localStorage.getItem(TOKEN_KEY); }
function getUser() { const u = localStorage.getItem(USER_KEY); return u ? JSON.parse(u) : null; }
function isLoggedIn() { return !!getToken(); }

function updateNav() {
  const user = getUser();
  document.getElementById('nav-username').textContent = user ? `👤 ${user.username}` : '';
  document.getElementById('nav-username').style.display = user ? 'inline' : 'none';
  document.getElementById('nav-login').style.display = user ? 'none' : 'inline';
  document.getElementById('nav-signup').style.display = user ? 'none' : 'inline';
  document.getElementById('nav-logout').style.display = user ? 'inline-block' : 'none';
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  location.reload();
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...opts.headers };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { logout(); return null; }
  return res.json();
}

function show(el) { document.getElementById(el).style.display = ''; }
function hide(el) { document.getElementById(el).style.display = 'none'; }

/* ---------- WebSocket ---------- */
let ws = null;

function connectWS() {
  const token = getToken();
  if (!token) return;

  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}`;

  ws = new WebSocket(url);
  ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token }));
  ws.onmessage = e => handleWSMessage(JSON.parse(e.data));
  ws.onclose = () => { setTimeout(connectWS, 3000); };
}

function handleWSMessage(msg) {
  switch (msg.type) {
    case 'friends-list':
      renderFriends(msg.friends);
      break;
    case 'friend-online':
      updateFriendStatus(msg.userId, true, msg.username, msg.peerId);
      notify(`🟢 ${msg.username} is online`);
      break;
    case 'friend-offline':
      updateFriendStatus(msg.userId, false);
      break;
  }
}

/* ---------- Notifications ---------- */
function notify(text) {
  const el = document.getElementById('notification') || (() => {
    const d = document.createElement('div');
    d.id = 'notification';
    d.style.cssText = 'position:fixed;bottom:20px;right:20px;background:#1a1a2e;border:1px solid #30305a;border-radius:8px;padding:12px 16px;font-size:13px;z-index:9999;max-width:300px;box-shadow:0 4px 20px rgba(0,0,0,0.5);animation:fadeIn 0.3s';
    document.body.appendChild(d);
    const style = document.createElement('style');
    style.textContent = '@keyframes fadeIn{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}';
    document.head.appendChild(style);
    return d;
  })();
  el.textContent = text;
  clearTimeout(el._timer);
  el._timer = setTimeout(() => el.remove(), 4000);
}

/* ---------- Render ---------- */
function renderFriends(friends) {
  const online = friends.filter(f => f.online);
  const offline = friends.filter(f => !f.online);

  const onlineEl = document.getElementById('online-friends');
  const offlineEl = document.getElementById('offline-friends');
  const allEl = document.getElementById('all-friends');

  onlineEl.innerHTML = online.length ? '' : '<p class="text-muted">No friends online</p>';
  offlineEl.innerHTML = offline.length ? '' : '<p class="text-muted">No offline friends</p>';
  allEl.innerHTML = '';

  const renderFriend = (f, container) => {
    const card = document.createElement('div');
    card.className = 'friend-card';
    card.dataset.userId = f._id;
    card.innerHTML = `
      <div class="friend-info">
        <span class="status-dot ${f.online ? 'online' : 'offline'}"></span>
        <span class="friend-name">${f.username}</span>
      </div>
      <div>
        ${f.online ? `<button class="btn btn-sm btn-call" data-peerid="${f.peerId || f.username}">📞 Call</button>` : ''}
        <button class="btn btn-sm btn-danger btn-remove">✕</button>
      </div>`;
    container.appendChild(card);
  };

  online.forEach(f => { renderFriend(f, onlineEl); renderFriend(f, allEl); });
  offline.forEach(f => { renderFriend(f, offlineEl); renderFriend(f, allEl); });

  if (!friends.length) allEl.innerHTML = '<p class="text-muted">No friends yet. Search for users above!</p>';
}

function updateFriendStatus(userId, online, username, peerId) {
  document.querySelectorAll(`.friend-card[data-user-id="${userId}"]`).forEach(card => {
    const dot = card.querySelector('.status-dot');
    dot.className = `status-dot ${online ? 'online' : 'offline'}`;
    const actions = card.querySelector('div:last-child');
    if (online && !card.querySelector('.btn-call')) {
      const btn = document.createElement('button');
      btn.className = 'btn btn-sm btn-call';
      btn.dataset.peerid = peerId;
      btn.textContent = '📞 Call';
      actions.prepend(btn);
    } else if (!online) {
      const callBtn = card.querySelector('.btn-call');
      if (callBtn) callBtn.remove();
    }
  });
  loadFriends();
}

function renderRequests(data) {
  const incomingEl = document.getElementById('incoming-requests');
  const outgoingEl = document.getElementById('outgoing-requests');

  incomingEl.innerHTML = '<h4>Incoming</h4>';
  if (!data.incoming.length) {
    incomingEl.innerHTML += '<p class="text-muted" id="incoming-empty">No pending requests</p>';
  } else {
    data.incoming.forEach(r => {
      incomingEl.innerHTML += `
        <div class="request-card" data-id="${r._id}">
          <span>${r.from.username} wants to be friends</span>
          <div class="btn-group" style="margin:0;gap:6px">
            <button class="btn btn-sm btn-accept">Accept</button>
            <button class="btn btn-sm btn-danger btn-reject">Reject</button>
          </div>
        </div>`;
    });
  }

  outgoingEl.innerHTML = '<h4>Outgoing</h4>';
  if (!data.outgoing.length) {
    outgoingEl.innerHTML += '<p class="text-muted" id="outgoing-empty">No pending requests</p>';
  } else {
    data.outgoing.forEach(r => {
      outgoingEl.innerHTML += `
        <div class="request-card">
          <span>Sent to ${r.to.username} <span class="text-muted">(Pending)</span></span>
        </div>`;
    });
  }
}

/* ---------- Data loading ---------- */
async function loadFriends() {
  const data = await api('/api/friends');
  if (data) renderFriends(data.friends);
}

async function loadRequests() {
  const data = await api('/api/friends/requests');
  if (data) renderRequests(data);
}

/* ---------- Init ---------- */
document.addEventListener('DOMContentLoaded', () => {
  updateNav();

  if (!isLoggedIn()) {
    show('auth-required');
    return;
  }

  hide('auth-required');
  show('loading');

  Promise.all([loadFriends(), loadRequests()]).then(() => {
    hide('loading');
    show('dashboard');
    connectWS();
  });

  /* Search */
  document.getElementById('search-btn').addEventListener('click', async () => {
    const q = document.getElementById('search-input').value.trim();
    if (!q) return;
    const data = await api(`/api/friends/search?q=${encodeURIComponent(q)}`);
    const container = document.getElementById('search-results');
    container.innerHTML = '';
    if (!data || !data.users.length) {
      container.innerHTML = '<p class="text-muted">No users found</p>';
      return;
    }
    data.users.forEach(u => {
      const div = document.createElement('div');
      div.className = 'search-result';
      div.innerHTML = `
        <span>${u.username}</span>
        <button class="btn btn-sm btn-add" data-id="${u._id}">Add Friend</button>`;
      container.appendChild(div);
    });
  });

  /* Event delegation */
  document.addEventListener('click', async (e) => {
    const target = e.target;

    if (target.classList.contains('btn-add')) {
      const data = await api(`/api/friends/request/${target.dataset.id}`, { method: 'POST' });
      notify(data?.message || data?.error || 'Done');
      loadRequests();
    }

    if (target.classList.contains('btn-accept')) {
      await api(`/api/friends/${target.closest('.request-card').dataset.id}/accept`, { method: 'POST' });
      loadRequests();
      loadFriends();
    }

    if (target.classList.contains('btn-reject')) {
      await api(`/api/friends/${target.closest('.request-card').dataset.id}/reject`, { method: 'POST' });
      loadRequests();
    }

    if (target.classList.contains('btn-remove')) {
      if (!confirm('Remove this friend?')) return;
      const fid = target.closest('.friend-card').dataset.userId;
      await api(`/api/friends/${fid}`, { method: 'DELETE' });
      loadFriends();
    }

    if (target.classList.contains('btn-call')) {
      const peerId = target.dataset.peerid;
      window.open(`https://www.chess.com`, '_blank');
      setTimeout(() => {
        alert(`📞 Starting call... Paste this Peer ID on chess.com to connect: ${peerId}`);
      }, 1000);
    }
  });

  document.getElementById('search-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('search-btn').click();
  });

  document.getElementById('nav-logout').addEventListener('click', logout);
});

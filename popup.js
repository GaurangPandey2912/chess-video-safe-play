const API = 'http://localhost:3000'

document.getElementById('tab-login').onclick = () => {
  document.getElementById('tab-login').classList.add('active')
  document.getElementById('tab-signup').classList.remove('active')
  document.getElementById('form-login').classList.remove('hidden')
  document.getElementById('form-signup').classList.add('hidden')
}

document.getElementById('tab-signup').onclick = () => {
  document.getElementById('tab-signup').classList.add('active')
  document.getElementById('tab-login').classList.remove('active')
  document.getElementById('form-signup').classList.remove('hidden')
  document.getElementById('form-login').classList.add('hidden')
}

async function apiCall(path, body) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

function showLoginState(token, user) {
  document.getElementById('auth-panel').style.display = 'none'
  document.getElementById('logged-in').style.display = 'block'
  document.getElementById('username-display').textContent = '\u{1F464} ' + user.username
  loadFriends(token)
}

function showError(id, msg) {
  const el = document.getElementById(id)
  el.textContent = msg
  el.style.display = 'block'
}

function hideError(id) {
  document.getElementById(id).style.display = 'none'
}

async function loadFriends(token) {
  try {
    const res = await fetch(API + '/api/friends', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    const data = await res.json()
    const online = data.friends.filter(f => f.online)
    const offline = data.friends.filter(f => !f.online)

    const onlineEl = document.getElementById('online-list')
    const offlineEl = document.getElementById('offline-list')
    onlineEl.innerHTML = ''
    offlineEl.innerHTML = ''

    if (!online.length) onlineEl.innerHTML = '<p style="color:#6b7280;font-size:11px">No friends online</p>'
    if (!offline.length) offlineEl.innerHTML = '<p style="color:#6b7280;font-size:11px">No offline friends</p>'

    online.forEach(f => {
      const d = document.createElement('div')
      d.className = 'friend-item'
      d.innerHTML = '<span class="left"><span class="status-dot online"></span>' + f.username + '</span>' +
        '<button class="btn btn-sm btn-secondary call-friend" data-peerid="' + (f.peerId || f._id) + '">Call</button>'
      onlineEl.appendChild(d)
    })

    offline.forEach(f => {
      const d = document.createElement('div')
      d.className = 'friend-item'
      d.innerHTML = '<span class="left"><span class="status-dot offline"></span>' + f.username + '</span>'
      offlineEl.appendChild(d)
    })
  } catch (e) {
    document.getElementById('online-list').innerHTML = '<p style="color:#ff6b6b;font-size:11px">Server unreachable</p>'
  }
}

chrome.storage.local.get(['cv_token', 'cv_user'], (result) => {
  if (result.cv_token && result.cv_user) {
    showLoginState(result.cv_token, result.cv_user)
  } else {
    document.getElementById('auth-panel').style.display = 'block'
  }
})

document.getElementById('login-submit').onclick = async () => {
  hideError('login-error')
  const email = document.getElementById('login-email').value.trim()
  const password = document.getElementById('login-password').value
  if (!email || !password) { showError('login-error', 'Fill in all fields'); return }
  try {
    const data = await apiCall('/api/auth/login', { email, password })
    chrome.storage.local.set({ cv_token: data.token, cv_user: data.user }, () => {
      showLoginState(data.token, data.user)
    })
  } catch (e) {
    showError('login-error', e.message)
  }
}

document.getElementById('signup-submit').onclick = async () => {
  hideError('signup-error')
  const username = document.getElementById('signup-username').value.trim()
  const email = document.getElementById('signup-email').value.trim()
  const password = document.getElementById('signup-password').value
  if (!username || !email || !password) { showError('signup-error', 'Fill in all fields'); return }
  if (password.length < 6) { showError('signup-error', 'Password must be 6+ characters'); return }
  try {
    const data = await apiCall('/api/auth/signup', { username, email, password })
    chrome.storage.local.set({ cv_token: data.token, cv_user: data.user }, () => {
      showLoginState(data.token, data.user)
    })
  } catch (e) {
    showError('signup-error', e.message)
  }
}

document.getElementById('login-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('login-submit').click()
})

document.getElementById('signup-password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('signup-submit').click()
})

document.getElementById('logout-btn').onclick = () => {
  chrome.storage.local.remove(['cv_token', 'cv_user'], () => location.reload())
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('call-friend')) {
    const peerId = e.target.dataset.peerid
    chrome.tabs.create({ url: 'https://www.chess.com' }, () => {
      alert('On chess.com, paste this Peer ID to connect: ' + peerId)
    })
  }
})

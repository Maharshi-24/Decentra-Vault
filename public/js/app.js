const API_URL = 'http://localhost:3000/api';
let currentToken = localStorage.getItem('token');
let apiKeys = [];

document.addEventListener('DOMContentLoaded', () => {
  initApp();
});

function initApp() {
  const storedToken = localStorage.getItem('token') || sessionStorage.getItem('token');
  
  if (storedToken) {
    currentToken = storedToken;
    fetch(`${API_URL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    })
    .then(res => res.json())
    .then(data => {
      if (data.developer) {
        showDashboard(data.developer);
      } else {
        cleanupSession();
        hideSkeleton();
      }
    })
    .catch(() => {
      hideSkeleton();
    });
  } else {
    hideSkeleton();
  }

  // Bind Form Listeners
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', handleLogin);
  }

  const signupForm = document.getElementById('signupForm');
  if (signupForm) {
    signupForm.addEventListener('submit', handleSignup);
  }
}

function cleanupSession() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  currentToken = null;
}

function hideSkeleton() {
  const skeleton = document.getElementById('skeletonLoader');
  if (skeleton) skeleton.style.display = 'none';
  
  const loginView = document.getElementById('loginView');
  if (loginView && !document.getElementById('dashboard').style.display.includes('block')) {
    loginView.style.display = 'block';
  }
}

function toggleAuth() {
  const login = document.getElementById('loginView');
  const signup = document.getElementById('signupView');
  
  if (login.classList.contains('hidden') || login.style.display === 'none') {
    login.style.display = 'block';
    login.classList.remove('hidden');
    signup.style.display = 'none';
    signup.classList.add('hidden');
  } else {
    login.style.display = 'none';
    login.classList.add('hidden');
    signup.style.display = 'block';
    signup.classList.remove('hidden');
  }
  hideErrors();
}

function hideErrors() {
  const err1 = document.getElementById('errorMsg');
  const err2 = document.getElementById('signupErrorMsg');
  if (err1) err1.style.display = 'none';
  if (err2) err2.style.display = 'none';
}

function togglePasswordVisibility(inputId, icon) {
  const input = document.getElementById(inputId);
  if (input.type === 'password') {
    input.type = 'text';
    icon.classList.remove('fa-eye');
    icon.classList.add('fa-eye-slash');
  } else {
    input.type = 'password';
    icon.classList.remove('fa-eye-slash');
    icon.classList.add('fa-eye');
  }
}

async function handleLogin(e) {
  e.preventDefault();
  hideErrors();
  const email = document.getElementById('loginEmail').value;
  const password = document.getElementById('loginPassword').value;
  const keepLoggedIn = document.getElementById('keepLoggedIn').checked;

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      const token = data.session.access_token;
      if (keepLoggedIn) {
        localStorage.setItem('token', token);
      } else {
        sessionStorage.setItem('token', token);
      }
      currentToken = token;
      showDashboard(data.developer || { email });
    } else {
      showError('errorMsg', data.error);
    }
  } catch (err) {
    showError('errorMsg', 'Service unavailable');
  }
}

async function handleSignup(e) {
  e.preventDefault();
  hideErrors();
  const email = document.getElementById('signupEmail').value;
  const password = document.getElementById('signupPassword').value;
  const confirm = document.getElementById('signupConfirm').value;

  if (password !== confirm) {
    showError('signupErrorMsg', 'Passwords do not match');
    return;
  }

  try {
    const res = await fetch(`${API_URL}/auth/signup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok) {
      showToast('Account created! Please login.');
      toggleAuth();
      document.getElementById('loginEmail').value = email;
    } else {
      showError('signupErrorMsg', data.error);
    }
  } catch (err) {
    showError('signupErrorMsg', 'Service unavailable');
  }
}

function showError(id, msg) {
  const el = document.getElementById(id);
  if (el) {
    el.textContent = msg;
    el.style.display = 'block';
  }
}

function showDashboard(developer) {
  const authCard = document.getElementById('authCard');
  const dashboard = document.getElementById('dashboard');
  
  if (authCard) authCard.style.display = 'none';
  if (dashboard) {
    dashboard.style.display = 'block';
    dashboard.classList.add('card-container'); // Apply same card base
  }
  
  document.getElementById('userPlan').textContent = (developer.plan || 'free').toUpperCase();
  document.getElementById('profileInitial').textContent = (developer.email || 'U')[0].toUpperCase();
  document.getElementById('profileEmail').textContent = developer.email;
  document.getElementById('profilePlan').textContent = developer.plan || 'free';
  document.getElementById('profileId').textContent = developer.id;
  document.getElementById('profileJoined').textContent = new Date(developer.created_at).toLocaleDateString('en-US', { 
    month: 'long', 
    day: 'numeric', 
    year: 'numeric' 
  });

  fetchApiKeys();
}

function switchTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

async function fetchApiKeys() {
  try {
    const res = await fetch(`${API_URL}/keys`, {
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    const data = await res.json();
    if (res.ok) {
      renderKeysList(data.keys);
      document.getElementById('apiKeyCount').textContent = data.keys.length;
    }
  } catch (err) {
    console.error('Failed to fetch keys');
  }
}

function renderKeysList(keys) {
  const listEl = document.getElementById('keysList');
  if (!keys || keys.length === 0) {
    listEl.innerHTML = '<p style="color:var(--text-muted); font-size:14px; text-align:center;">No API keys yet. Create one to start using the SDK.</p>';
    return;
  }

  listEl.innerHTML = keys.map(k => {
    const statusColors = {
      'active': { bg: '#dcfce7', text: '#166534' },
      'revoked': { bg: '#fee2e2', text: '#991b1b' }
    };
    const colors = statusColors[k.status] || { bg: '#f3f4f6', text: '#374151' };
    
    return `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:18px; border:1px solid var(--border); border-radius:12px; margin-bottom:12px; background:white;">
        <div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:4px;">
            <span style="font-weight:700; color:#111827; font-size:16px;">${k.name || 'API Key'}</span>
            <span style="padding:2px 10px; background:${colors.bg}; color:${colors.text}; font-size:11px; font-weight:700; border-radius:100px; text-transform:uppercase;">${k.status}</span>
          </div>
          <div style="display:flex; align-items:center; gap:10px; margin-bottom:6px;">
            <span style="font-family:monospace; font-weight:500; color:var(--text-muted); font-size:14px;">${k.key_prefix}••••••••••••••••••••••••</span>
          </div>
        </div>
        <div style="display:flex; gap:8px;">
          <button onclick="manageKey('${k.id}', 'toggle')" style="background:none; border:1px solid var(--border); border-radius:6px; padding:6px 10px; cursor:pointer;">
            <i class="fas ${k.status === 'active' ? 'fa-ban' : 'fa-check'}"></i> 
          </button>
          <button onclick="manageKey('${k.id}', 'delete')" style="background:none; border:1px solid #fee2e2; border-radius:6px; padding:6px 10px; cursor:pointer; color:#dc2626;">
            <i class="fas fa-trash-alt"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');
}

async function manageKey(id, mode) {
  if (mode === 'delete' && !confirm('Are you sure you want to delete this API key?')) return;
  
  try {
    const res = await fetch(`${API_URL}/keys/${id}?mode=${mode}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${currentToken}` }
    });
    if (res.ok) {
        showToast(mode === 'delete' ? 'Key deleted' : 'Status updated');
        fetchApiKeys();
    }
  } catch (err) {
    showToast('Operation failed', true);
  }
}

function generateApiKey() {
  document.getElementById('modalOverlay').style.display = 'flex';
  document.getElementById('modalInputKeyName').value = '';
  document.getElementById('modalInputKeyName').focus();
}

function closeModal() {
  document.getElementById('modalOverlay').style.display = 'none';
}

async function confirmGenerateKey() {
  const name = document.getElementById('modalInputKeyName').value.trim() || 'My API Key';
  closeModal();
  
  try {
    const res = await fetch(`${API_URL}/keys/generate`, {
      method: 'POST',
      headers: { 
        'Authorization': `Bearer ${currentToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name })
    });
    const data = await res.json();
    if (res.ok) {
      const alertEl = document.getElementById('newKeyAlert');
      const codeEl = document.getElementById('newApiKeyRaw');
      codeEl.textContent = data.apiKey;
      alertEl.style.display = 'block';
      fetchApiKeys();
    } else {
      showToast(data.error || 'Failed', true);
    }
  } catch (err) {
    showToast('Network error', true);
  }
}

function copyToClipboard(elementId) {
  const text = document.getElementById(elementId).innerText;
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard!');
  });
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (toast && toastMsg) {
    toastMsg.innerText = msg;
    toast.style.background = isError ? '#dc2626' : '#111827';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

function logout() {
  cleanupSession();
  window.location.reload();
}

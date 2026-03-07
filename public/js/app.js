const API_URL = 'http://localhost:3000/api';
let currentToken = localStorage.getItem('token') || sessionStorage.getItem('token');

// Auth Guards
function checkAuth() {
  if (!currentToken) {
    if (!window.location.pathname.endsWith('login.html')) {
      window.location.href = '/pages/login.html';
    }
  } else {
    // If on login, redirect to dashboard
    if (window.location.pathname.endsWith('login.html')) {
      window.location.href = '/index.html';
    }
  }
}

function showToast(msg, isError = false) {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (toastMsg) toastMsg.innerText = msg;
  if (toast) {
    toast.style.background = isError ? '#ff0000' : '#000000';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3000);
  }
}

function logout() {
  localStorage.removeItem('token');
  sessionStorage.removeItem('token');
  window.location.href = '/pages/login.html';
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  checkAuth();
});

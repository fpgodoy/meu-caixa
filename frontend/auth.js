/* auth.js — Módulo compartilhado de autenticação App Contas */

const AUTH_TOKEN_KEY = 'appcontas_token';
const AUTH_USER_KEY  = 'appcontas_user';

// ── Sanitização HTML (global, usada em todas as páginas) ────────────
/**
 * Escapa caracteres especiais de HTML em uma string.
 * Use sempre que injetar dados vindos do servidor via innerHTML,
 * para evitar XSS caso um campo contenha <, >, ", & ou ' .
 *
 * @param {string|null|undefined} str — valor a ser escapado
 * @returns {string} — string segura para uso em innerHTML
 */
function escHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Token helpers ──────────────────────────────────────────────────
function getToken()  { return localStorage.getItem(AUTH_TOKEN_KEY); }
function saveToken(token, user) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
  localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
}
function clearAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
}
function getSavedUser() {
  try { return JSON.parse(localStorage.getItem(AUTH_USER_KEY) || 'null'); }
  catch { return null; }
}

// ── apiFetch — wrapper autenticado ────────────────────────────────
async function apiFetch(url, opts = {}) {
  const token = getToken();
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...opts, headers });

  if (res.status === 401) {
    clearAuth();
    showLoginModal();
    throw new Error('Sessão expirada. Faça login novamente.');
  }
  return res;
}

// ── checkAuth — testa token ao carregar a página ──────────────────
async function checkAuth() {
  const token = getToken();
  if (!token) { showLoginModal(); return null; }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) { clearAuth(); showLoginModal(); return null; }
    const user = await res.json();
    renderUserInfo(user);
    if (user.must_change_password) {
      showChangeCredentialsModal();
      return null;
    }
    hideLoginModal();
    window.onAuthSuccess?.();
    return user;
  } catch {
    showLoginModal();
    return null;
  }
}

// ── Logout ────────────────────────────────────────────────────────
function logout() {
  clearAuth();
  showLoginModal();
}

// ── Renderizar nome no header ─────────────────────────────────────
function renderUserInfo(user) {
  const el = document.getElementById('auth-user-display');
  if (el) el.textContent = user.username || '';
}

// ── Modal de login ────────────────────────────────────────────────
function showLoginModal() {
  const m = document.getElementById('login-modal');
  if (m) {
    m.classList.remove('hidden');
    // Esconde spinner e exibe o formulário
    const spinner  = m.querySelector('.auth-checking');
    const subtitle = m.querySelector('.auth-subtitle');
    const form     = m.querySelector('#login-form');
    if (spinner)  spinner.style.display  = 'none';
    if (subtitle) subtitle.style.display = '';
    if (form)     form.style.display     = '';
    document.getElementById('login-error')?.classList.add('hidden');
    document.getElementById('login-username')?.focus();
  }
}
function hideLoginModal() {
  const m = document.getElementById('login-modal');
  if (m) m.classList.add('hidden');
}

// ── Modal de primeiro acesso (troca obrigatória) ──────────────────
function showChangeCredentialsModal() {
  hideLoginModal();
  const m = document.getElementById('first-access-modal');
  if (m) {
    m.classList.remove('hidden');
    document.getElementById('fa-username')?.focus();
  }
}

// ── Handlers dos formulários ──────────────────────────────────────
async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-submit');

  btn.disabled = true;
  btn.textContent = 'Entrando…';

  try {
    const res  = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao fazer login');

    saveToken(data.access_token, { username });
    renderUserInfo({ username });

    if (data.must_change_password) {
      showChangeCredentialsModal();
    } else {
      hideLoginModal();
      window.onAuthSuccess?.();
    }
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar';
  }
}

async function handleChangeCredentials(e) {
  e.preventDefault();
  const newUsername = document.getElementById('fa-username').value.trim();
  const newPassword = document.getElementById('fa-password').value;
  const confirm     = document.getElementById('fa-password-confirm').value;
  const errEl       = document.getElementById('fa-error');
  const btn         = document.getElementById('fa-submit');

  if (newPassword !== confirm) {
    if (errEl) { errEl.textContent = 'As senhas não coincidem.'; errEl.classList.remove('hidden'); }
    return;
  }
  if (newPassword.length < 6) {
    if (errEl) { errEl.textContent = 'Senha deve ter ao menos 6 caracteres.'; errEl.classList.remove('hidden'); }
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Salvando…';

  try {
    const res  = await apiFetch('/api/auth/change-credentials', {
      method: 'PUT',
      body: JSON.stringify({ new_username: newUsername, new_password: newPassword }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao salvar');

    saveToken(data.access_token, { username: newUsername });
    renderUserInfo({ username: newUsername });

    const m = document.getElementById('first-access-modal');
    if (m) m.classList.add('hidden');
    window.onAuthSuccess?.();
  } catch (err) {
    if (errEl) { errEl.textContent = err.message; errEl.classList.remove('hidden'); }
  } finally {
    btn.disabled = false;
    btn.textContent = 'Salvar e entrar';
  }
}

// ── Bootstrap — liga os listeners quando o DOM estiver pronto ─────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('login-form')?.addEventListener('submit', handleLogin);
  document.getElementById('first-access-form')?.addEventListener('submit', handleChangeCredentials);
  document.getElementById('btn-logout')?.addEventListener('click', logout);
});

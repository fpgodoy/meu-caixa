/* configuracoes.js — Lógica da página de Configurações */

// checkAuth garante que só usuários logados acessam esta página
window.onAuthSuccess = () => {
  loadBackups();
  loadUsers();
};
checkAuth();

// ── Navegação entre seções ──────────────────────────────────────
document.querySelectorAll('.config-nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const section = btn.dataset.section;
    document.querySelectorAll('.config-nav-item').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.querySelectorAll('.config-panel').forEach(p => {
      p.classList.toggle('hidden', p.id !== `section-${section}`);
    });
  });
});

// ── Utilitários ─────────────────────────────────────────────────
function showToast(msg, type = 'success') {
  const toast = document.getElementById('backup-toast');
  toast.textContent = (type === 'success' ? '✅ ' : '❌ ') + msg;
  toast.className = `show ${type}`;
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.className = ''; }, 6000);
}

// ── Backup ───────────────────────────────────────────────────────
function renderBackupList(backups) {
  const container = document.getElementById('backup-list');
  if (!backups.length) {
    container.innerHTML = '<div class="backup-empty">Nenhum backup encontrado.</div>';
    return;
  }
  container.innerHTML = backups.map(b => `
    <div class="backup-item" id="bk-${b.arquivo}">
      <div>
        <div class="backup-item-name">${b.arquivo}</div>
        <div class="backup-item-meta">
          <span>${b.tamanho_kb} KB</span>
          <span>${b.criado_em}</span>
        </div>
      </div>
      <button
        class="btn-restore"
        data-arquivo="${b.arquivo}"
        title="Restaurar este backup"
      >
        <span class="restore-spinner"></span>
        <span class="restore-label">↩ Restaurar</span>
      </button>
    </div>
  `).join('');

  container.querySelectorAll('.btn-restore').forEach(btn => {
    btn.addEventListener('click', () => restoreBackup(btn.dataset.arquivo, btn));
  });
}

async function loadBackups() {
  try {
    const res  = await apiFetch('/api/backup/list');
    const data = await res.json();
    renderBackupList(data.backups || []);
  } catch {
    document.getElementById('backup-list').innerHTML =
      '<div class="backup-empty">Erro ao carregar lista de backups.</div>';
  }
}

async function restoreBackup(arquivo, btn) {
  const confirmed = confirm(
    `⚠️ ATENÇÃO: Restaurar "${arquivo}" irá SUBSTITUIR todos os dados atuais do banco.\n\nEsta operação não pode ser desfeita.\n\nDeseja continuar?`
  );
  if (!confirmed) return;

  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res  = await apiFetch(`/api/backup/restore/${encodeURIComponent(arquivo)}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro desconhecido');
    showToast(`Banco restaurado com sucesso a partir de ${arquivo}`);
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
}

document.getElementById('btn-backup').addEventListener('click', async () => {
  const btn = document.getElementById('btn-backup');
  btn.disabled = true;
  btn.classList.add('loading');
  try {
    const res  = await apiFetch('/api/backup/create', { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro desconhecido');
    showToast(`Backup criado: ${data.arquivo} (${data.tamanho_kb} KB)`);
    await loadBackups();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.classList.remove('loading');
  }
});

// ── Usuários ─────────────────────────────────────────────────────
async function loadUsers() {
  const container = document.getElementById('users-list');
  if (!container) return;
  try {
    const res   = await apiFetch('/api/users');
    const users = await res.json();
    renderUserList(users);
  } catch {
    container.innerHTML = '<div class="backup-empty">Erro ao carregar usuários.</div>';
  }
}

function renderUserList(users) {
  const container = document.getElementById('users-list');
  if (!users.length) {
    container.innerHTML = '<div class="backup-empty">Nenhum usuário cadastrado.</div>';
    return;
  }
  container.innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:.85rem;">
      <thead>
        <tr style="color:var(--text-secondary);border-bottom:1px solid var(--border);">
          <th style="text-align:left;padding:8px 12px;font-weight:600">Usuário</th>
          <th style="text-align:left;padding:8px 12px;font-weight:600">Criado em</th>
          <th style="text-align:left;padding:8px 12px;font-weight:600">Status</th>
          <th style="padding:8px 12px"></th>
        </tr>
      </thead>
      <tbody>
        ${users.map(u => `
          <tr style="border-bottom:1px solid var(--border-light)">
            <td style="padding:10px 12px;font-family:monospace;color:var(--text-primary)">${u.username}</td>
            <td style="padding:10px 12px;color:var(--text-secondary)">${u.created_at || '—'}</td>
            <td style="padding:10px 12px">
              <span style="
                padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:700;
                background:${u.is_active ? 'var(--green-dim)' : 'var(--red-dim)'};
                color:${u.is_active ? 'var(--green)' : 'var(--red)'};
                border:1px solid ${u.is_active ? 'var(--green)' : 'var(--red)'};">
                ${u.is_active ? 'Ativo' : 'Inativo'}
              </span>
            </td>
            <td style="padding:10px 12px;display:flex;gap:8px;justify-content:flex-end">
              <button class="icon-btn edit" data-uid="${u.id}" title="Editar">✏️</button>
              ${u.is_active
                ? `<button class="icon-btn del" data-uid="${u.id}" title="Desativar">🔒</button>`
                : `<button class="icon-btn" data-uid="${u.id}" data-activate="true" title="Reativar" style="opacity:.7">🔓</button>`
              }
            </td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;

  // Botões editar
  container.querySelectorAll('.icon-btn.edit').forEach(btn => {
    btn.addEventListener('click', () => openUserModal(Number(btn.dataset.uid), users));
  });
  // Botões desativar/reativar
  container.querySelectorAll('.icon-btn.del, .icon-btn[data-activate]').forEach(btn => {
    btn.addEventListener('click', () => toggleUserActive(Number(btn.dataset.uid), !!btn.dataset.activate));
  });
}

// ── Modal usuário ────────────────────────────────────────────────
const userModalOverlay = document.getElementById('user-modal-overlay');

function openUserModal(userId, users) {
  const user = users?.find(u => u.id === userId);
  document.getElementById('user-modal-title').textContent = user ? 'Editar Usuário' : 'Novo Usuário';
  document.getElementById('user-form-id').value      = userId || '';
  document.getElementById('user-form-username').value = user?.username || '';
  document.getElementById('user-form-password').value = '';
  document.getElementById('user-form-error').classList.add('hidden');
  userModalOverlay.classList.remove('hidden');
  document.getElementById('user-form-username').focus();
}

function closeUserModal() { userModalOverlay.classList.add('hidden'); }

document.getElementById('btn-new-user')?.addEventListener('click', () => openUserModal(null, []));
document.getElementById('user-modal-close')?.addEventListener('click', closeUserModal);
document.getElementById('user-form-cancel')?.addEventListener('click', closeUserModal);
userModalOverlay?.addEventListener('click', e => { if (e.target === userModalOverlay) closeUserModal(); });

document.getElementById('user-form-submit')?.addEventListener('click', async () => {
  const id       = document.getElementById('user-form-id').value;
  const username = document.getElementById('user-form-username').value.trim();
  const password = document.getElementById('user-form-password').value;
  const errEl    = document.getElementById('user-form-error');

  if (!username) { errEl.textContent = 'Nome de usuário é obrigatório.'; errEl.classList.remove('hidden'); return; }
  if (!id && !password) { errEl.textContent = 'Informe uma senha para o novo usuário.'; errEl.classList.remove('hidden'); return; }
  if (password && password.length < 6) { errEl.textContent = 'Senha deve ter ao menos 6 caracteres.'; errEl.classList.remove('hidden'); return; }

  try {
    let res;
    if (id) {
      const body = {};
      if (password) body.password = password;
      res = await apiFetch(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
    } else {
      res = await apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      });
    }
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Erro ao salvar');
    closeUserModal();
    await loadUsers();
  } catch (e) {
    errEl.textContent = e.message;
    errEl.classList.remove('hidden');
  }
});

async function toggleUserActive(userId, activate) {
  const action = activate ? 'reativar' : 'desativar';
  if (!confirm(`Deseja ${action} este usuário?`)) return;
  try {
    if (!activate) {
      await apiFetch(`/api/users/${userId}`, { method: 'DELETE' });
    } else {
      await apiFetch(`/api/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify({ is_active: true }),
      });
    }
    await loadUsers();
  } catch (e) {
    alert('Erro: ' + e.message);
  }
}

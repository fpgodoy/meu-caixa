/* ── Config ─────────────────────────────────────────────────────── */
const API_BASE = '';   // nginx faz proxy de /api/ → backend:8000


/* ── State ──────────────────────────────────────────────────────── */
let currentDate = new Date();
let transactions = [];
let currentSort = localStorage.getItem('appContas_sort') || 'receitas';

/* ── Helpers ────────────────────────────────────────────────────── */
const fmt = (val) =>
  val == null
    ? ''
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
};

/** Parse an ISO date string as a local Date (no timezone shift). */
const parseLocalDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};

/** Today at midnight (local). */
const today = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

const anoMes = () => {
  const y = currentDate.getFullYear();
  const m = String(currentDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

const monthLabel = () =>
  currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

/* ── Auto-compute status from dates ─────────────────────────────── */
function computeStatus(tx) {
  const pagamento  = parseLocalDate(tx.data_pagamento);
  const vencimento = parseLocalDate(tx.vencimento);
  const now        = today();

  if (pagamento) {
    // Has a payment / scheduling date
    return pagamento <= now ? 'OK' : 'AGEN';
  }
  // No payment date yet
  if (vencimento && vencimento < now) {
    return 'VENC'; // past due, unpaid
  }
  return 'PEN'; // pending (not yet due or no due date)
}

function statusClass(s) {
  if (s === 'OK')   return 'status-ok';
  if (s === 'AGEN') return 'status-agen';
  if (s === 'VENC') return 'status-venc';
  return 'status-pen';
}

/* ── Compute running SALDO ──────────────────────────────────────── */
// Special rows (is_special) are always treated as 'entrada' (positive balance)
function computeSaldos() {
  let saldo = 0;
  return transactions.map((tx) => {
    const display = saldo;
    const val = tx.efetivo != null ? Number(tx.efetivo) : (tx.previsto != null ? Number(tx.previsto) : 0);
    const effectiveEntrada = tx.is_special ? true : tx.tipo === 'entrada';
    saldo += effectiveEntrada ? val : -val;
    return display;
  });
}

/* ── DOM refs ───────────────────────────────────────────────────── */
const tbody        = document.getElementById('tx-body');
const monthLabelEl = document.getElementById('month-label');
const sumBalance   = document.getElementById('sum-balance');
const sumIncome    = document.getElementById('sum-income');
const sumExpense   = document.getElementById('sum-expense');
const sumPending   = document.getElementById('sum-pending');
const modalOverlay = document.getElementById('modal-overlay');
const delOverlay   = document.getElementById('del-overlay');
const txForm       = document.getElementById('tx-form');
const payPopover   = document.getElementById('pay-popover');
const payDateInput = document.getElementById('pay-date-input');
let deleteTargetId  = null;
let payTargetId     = null;

/* ── Fetch transactions ─────────────────────────────────────────── */
async function loadTransactions() {
  tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="spinner"></div> Carregando…</td></tr>`;
  monthLabelEl.textContent = monthLabel();

  try {
    const res = await apiFetch(`${API_BASE}/api/transactions?mes=${anoMes()}&sort=${currentSort}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    transactions = await res.json();
    renderTable();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">
      Erro ao conectar com o servidor.<br><small>${err.message}</small></td></tr>`;
  }
}

/* ── Sorting Toggle ─────────────────────────────────────────────── */
const sortToggle = document.getElementById('sort-toggle');
if (sortToggle) {
  sortToggle.checked = currentSort === 'receitas';
  sortToggle.addEventListener('change', (e) => {
    currentSort = e.target.checked ? 'receitas' : 'cronologica';
    localStorage.setItem('appContas_sort', currentSort);
    loadTransactions();
  });
}

/* ── Compute summary cards ──────────────────────────────────────── */
function computeSummary() {
  let totalIncome  = 0;
  let totalExpense = 0;
  let totalPending = 0;

  transactions.forEach((tx) => {
    if (tx.is_special && tx.ordem === 9999) return; // skip last anchor
    
    const isEntrada = (tx.is_special && tx.ordem === 0) ? true : tx.tipo === 'entrada';
    const val = tx.efetivo != null ? Number(tx.efetivo) : (tx.previsto != null ? Number(tx.previsto) : 0);
    
    if (isEntrada) {
      totalIncome += val;
    } else {
      if (tx.efetivo != null) {
        totalExpense += val;
      } else if (tx.previsto != null) {
        totalPending += val;
      }
    }
  });

  // Final balance = last saldo + last tx value
  const saldos = computeSaldos();
  let finalBalance = 0;
  if (transactions.length) {
    const last = transactions[transactions.length - 1];
    const lastSaldo = saldos[saldos.length - 1];
    const val = last.efetivo != null ? Number(last.efetivo) : (last.previsto != null ? Number(last.previsto) : 0);
    finalBalance = lastSaldo + (last.tipo === 'entrada' ? val : -val);
  }

  sumBalance.textContent = fmt(finalBalance);
  sumIncome.textContent  = fmt(totalIncome);
  sumExpense.textContent = fmt(totalExpense);
  sumPending.textContent = fmt(totalPending);
}

/* ── Format monetary value with sign for debits ─────────────────── */
function fmtValue(val, tipo) {
  if (val == null) return null;
  const amount = Number(val);
  return tipo === 'saida' ? -amount : amount;
}

/* ── Render table ───────────────────────────────────────────────── */
function renderTable() {
  if (!transactions.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Nenhuma conta cadastrada para este mês.</td></tr>`;
    [sumBalance, sumIncome, sumExpense, sumPending].forEach(el => el.textContent = fmt(0));
    return;
  }

  computeSummary();
  const saldos = computeSaldos();

  tbody.innerHTML = '';
  transactions.forEach((tx, i) => {
    const saldo     = saldos[i];
    const saldoClass = saldo > 0 ? 'positive' : saldo < 0 ? 'negative' : '';
    // Special rows always display as positive (entrada)
    const isEntrada  = tx.is_special ? true : tx.tipo === 'entrada';

    // Signed values
    const efectiveTipo = tx.is_special ? 'entrada' : tx.tipo;
    const prevSigned = fmtValue(tx.previsto, efectiveTipo);
    const efetSigned = fmtValue(tx.efetivo,  efectiveTipo);

    const prevFormatted = prevSigned != null
      ? `<span class="${isEntrada ? 'is-entrada-val' : 'is-saida-val'}">${fmt(prevSigned)}</span>`
      : `<span class="empty-val">—</span>`;

    const efetFormatted = efetSigned != null
      ? `<span class="${isEntrada ? 'is-entrada-val' : 'is-saida-val'}" data-efetivo-id="${tx.id}" style="cursor:pointer;" title="Editar Efetivo">${fmt(efetSigned)}</span>`
      : `<span class="empty-val" data-efetivo-id="${tx.id}" style="cursor:pointer;" title="Informar Efetivo">—</span>`;

    const vencVal = fmtDate(tx.vencimento)      || '<span class="empty-val">—</span>';
    const pagVal  = fmtDate(tx.data_pagamento)  || '<span class="empty-val">—</span>';

    const status   = computeStatus(tx);
    const stClass  = statusClass(status);

    const isClickable = !tx.is_special && status !== 'OK';
    const tr = document.createElement('tr');
    tr.className   = (tx.is_special ? 'special-row ' : '') + (isEntrada ? 'is-entrada' : 'is-saida');
    tr.dataset.id  = tx.id;

    tr.innerHTML = `
      <td class="col-mov ${saldoClass}" data-label="SALDO">${fmt(saldo)}</td>
      <td class="col-previsto" data-label="PREVISTO">${prevFormatted}</td>
      <td class="col-efetivo" data-label="EFETIVO">${efetFormatted}</td>
      <td class="col-venc" data-label="VENCIMENTO">${vencVal}</td>
      <td class="col-desc" data-label="DISCRIMINAÇÃO">${tx.discriminacao}</td>
      <td class="col-data" data-label="PAGAMENTO / AGEND.">${pagVal}</td>
      <td class="col-status" data-label="STATUS">
        ${tx.is_special ? '' : `<span class="status-badge ${stClass}${isClickable ? ' clickable' : ''}" data-id="${tx.id}" aria-label="Status ${status}">${status}</span>`}
      </td>
      <td class="col-actions">
        <div class="row-actions">
          <button class="icon-btn edit" data-id="${tx.id}" title="Editar">✎</button>
          ${tx.is_special ? '' : `<button class="icon-btn del" data-id="${tx.id}" title="Excluir">✕</button>`}
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('[data-efetivo-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openEfetivoPopover(Number(el.dataset.efetivoId), el);
    });
  });

  tbody.querySelectorAll('.status-badge.clickable').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPayPopover(Number(el.dataset.id), el);
    })
  );
  tbody.querySelectorAll('.icon-btn.edit').forEach((el) =>
    el.addEventListener('click', () => openEditModal(Number(el.dataset.id)))
  );
  tbody.querySelectorAll('.icon-btn.del').forEach((el) =>
    el.addEventListener('click', () => openDeleteModal(Number(el.dataset.id)))
  );
}

/* ── PATCH helper ───────────────────────────────────────────────── */
async function patchTx(id, data) {
  const res = await apiFetch(`${API_BASE}/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/* ── Month navigation ───────────────────────────────────────────── */
document.getElementById('btn-prev').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() - 1);
  loadTransactions();
});
document.getElementById('btn-next').addEventListener('click', () => {
  currentDate.setMonth(currentDate.getMonth() + 1);
  loadTransactions();
});

/* ── Month picker popover ────────────────────────────────────── */
const monthPicker  = document.getElementById('month-picker');
const pickerYear   = document.getElementById('picker-year');
const pickerMonth  = document.getElementById('picker-month');
const monthLabelBtn = document.getElementById('month-label');

function openMonthPicker() {
  // Populate year options: current ± 10 years
  const cy = currentDate.getFullYear();
  pickerYear.innerHTML = '';
  for (let y = cy - 10; y <= cy + 10; y++) {
    const opt = document.createElement('option');
    opt.value = y;
    opt.textContent = y;
    if (y === cy) opt.selected = true;
    pickerYear.appendChild(opt);
  }
  pickerMonth.value = currentDate.getMonth() + 1;

  // Position below the month label button
  const rect   = monthLabelBtn.getBoundingClientRect();
  monthPicker.classList.remove('hidden');
  const pw = monthPicker.offsetWidth || 240;
  let left = rect.left + rect.width / 2 - pw / 2;
  if (left < 8) left = 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  monthPicker.style.top  = `${rect.bottom + 8}px`;
  monthPicker.style.left = `${left}px`;
}

function closeMonthPicker() { monthPicker.classList.add('hidden'); }

monthLabelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openMonthPicker();
});

document.getElementById('picker-go').addEventListener('click', () => {
  currentDate = new Date(Number(pickerYear.value), Number(pickerMonth.value) - 1, 1);
  closeMonthPicker();
  loadTransactions();
});

document.getElementById('picker-cancel').addEventListener('click', closeMonthPicker);
document.addEventListener('click', (e) => {
  if (!monthPicker.classList.contains('hidden') && !monthPicker.contains(e.target) && e.target !== monthLabelBtn) {
    closeMonthPicker();
  }
});

/* ── Add / Edit modal ───────────────────────────────────────────── */
document.getElementById('btn-add').addEventListener('click', () => openAddModal());

function openAddModal() {
  document.getElementById('modal-title').textContent = 'Nova Conta';
  document.getElementById('form-id').value = '';
  document.getElementById('btn-move-month').classList.add('hidden');
  txForm.reset();
  modalOverlay.classList.remove('hidden');
  document.getElementById('form-discriminacao').focus();
}

function openEditModal(id) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;

  const title = tx.is_special ? tx.discriminacao : 'Editar Conta';
  document.getElementById('modal-title').textContent   = title;
  document.getElementById('form-id').value             = tx.id;
  document.getElementById('form-discriminacao').value  = tx.discriminacao;
  document.getElementById('form-tipo').value           = tx.tipo;
  document.getElementById('form-previsto').value       = tx.previsto ?? '';
  document.getElementById('form-efetivo').value        = tx.efetivo  ?? '';
  document.getElementById('form-vencimento').value     = tx.vencimento ?? '';
  document.getElementById('form-data-pagamento').value = tx.data_pagamento ?? '';

  // For special rows: lock everything except Efetivo; force Tipo to 'entrada'
  const LOCKED = ['form-discriminacao','form-tipo','form-previsto','form-vencimento','form-data-pagamento','form-status'];
  if (tx.is_special) document.getElementById('form-tipo').value = 'entrada';
  LOCKED.forEach((fid) => {
    const el = document.getElementById(fid);
    el.disabled = tx.is_special;
    el.style.opacity = tx.is_special ? '0.38' : '';
    el.style.cursor  = tx.is_special ? 'not-allowed' : '';
  });

  // Handle 'Próximo mês' button visibility and locked state
  const moveBtn = document.getElementById('btn-move-month');
  moveBtn.classList.remove('hidden');
  moveBtn.disabled = tx.is_special;

  modalOverlay.classList.remove('hidden');
  document.getElementById(tx.is_special ? 'form-efetivo' : 'form-discriminacao').focus();
}

function closeModal() {
  // Re-enable any fields that may have been locked for special rows
  ['form-discriminacao','form-tipo','form-previsto','form-vencimento','form-data-pagamento','form-status'].forEach((fid) => {
    const el = document.getElementById(fid);
    el.disabled = false;
    el.style.opacity = '';
    el.style.cursor  = '';
  });
  modalOverlay.classList.add('hidden');
}
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

/* ── Form submit ────────────────────────────────────────────────── */
txForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id       = document.getElementById('form-id').value;
  const maxOrdem = transactions.length ? Math.max(...transactions.map((t) => t.ordem)) + 1 : 1;

  // For special rows, only efetivo can be changed
  const editingTx = id ? transactions.find((t) => String(t.id) === id) : null;
  const isSpecialEdit = editingTx?.is_special;

  const payload = isSpecialEdit
    ? { efetivo: document.getElementById('form-efetivo').value || null }
    : {
        discriminacao:  document.getElementById('form-discriminacao').value.trim(),
        tipo:           document.getElementById('form-tipo').value,
        previsto:       document.getElementById('form-previsto').value       || null,
        efetivo:        document.getElementById('form-efetivo').value        || null,
        vencimento:     document.getElementById('form-vencimento').value     || null,
        data_pagamento: document.getElementById('form-data-pagamento').value || null,
      };

  try {
    if (id) {
      await patchTx(Number(id), payload);
    } else {
      const res = await apiFetch(`${API_BASE}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, ano_mes: anoMes(), ordem: maxOrdem }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    closeModal();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
});

// Move to next month logic
document.getElementById('btn-move-month').addEventListener('click', async () => {
  const idStr = document.getElementById('form-id').value;
  if (!idStr) return;
  const id = Number(idStr);
  
  // Calculate next month from currentDate
  const nextDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const nextAnoMes = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
  
  try {
    await patchTx(id, { ano_mes: nextAnoMes });
    closeModal();
    loadTransactions();
  } catch (err) {
    alert("Erro ao mover a conta: " + err.message);
  }
});
/* ── Batch Create modal ─────────────────────────────────────────── */
const batchOverlay = document.getElementById('batch-modal-overlay');
const batchForm = document.getElementById('batch-form');
const batchCalendar = document.getElementById('batch-calendar');
const batchMonthTitle = document.getElementById('batch-month-title');
const btnBatchSave = document.getElementById('btn-batch-save');
let batchSelectedDays = new Set();

function renderBatchCalendar() {
  batchCalendar.innerHTML = '';
  
  if (batchMonthTitle) {
    batchMonthTitle.textContent = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
  }

  const mNames = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const offsets = [-1, 0, 1];

  offsets.forEach((offset) => {
    const targetDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1);
    const year = targetDate.getFullYear();
    const month = targetDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const firstDay = new Date(year, month, 1).getDay();

    const block = document.createElement('div');
    block.className = 'batch-month-block';
    if (offset === 0) block.id = 'batch-current-month';
    
    const title = document.createElement('h3');
    title.textContent = `${mNames[month]} ${year}`;
    title.style.textAlign = 'center';
    title.style.fontSize = '0.9rem';
    title.style.marginBottom = '8px';
    title.style.color = offset === 0 ? 'var(--text-primary)' : 'var(--text-secondary)';
    block.appendChild(title);
    
    const grid = document.createElement('div');
    grid.className = 'batch-calendar-grid';
    grid.style.display = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gap = '6px';
    grid.style.background = 'rgba(0,0,0,.2)';
    grid.style.padding = '12px';
    grid.style.borderRadius = 'var(--radius-sm)';
    grid.style.border = '1px solid var(--border-light)';
    
    const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    daysOfWeek.forEach((d) => {
      const el = document.createElement('div');
      el.className = 'batch-day-header';
      el.textContent = d;
      grid.appendChild(el);
    });

    for (let i = 0; i < firstDay; i++) {
      const el = document.createElement('div');
      grid.appendChild(el);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const el = document.createElement('button');
      el.className = 'batch-day';
      el.textContent = d;
      el.type = 'button';
      
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      
      if (batchSelectedDays.has(dateStr)) el.classList.add('selected');

      el.addEventListener('click', () => {
        if (batchSelectedDays.has(dateStr)) {
          batchSelectedDays.delete(dateStr);
          el.classList.remove('selected');
        } else {
          batchSelectedDays.add(dateStr);
          el.classList.add('selected');
        }
        btnBatchSave.textContent = `Criar Registros (${batchSelectedDays.size})`;
      });

      grid.appendChild(el);
    }
    
    block.appendChild(grid);
    batchCalendar.appendChild(block);
  });
}

document.getElementById('btn-batch').addEventListener('click', () => {
  batchSelectedDays.clear();
  btnBatchSave.textContent = 'Criar Registros (0)';
  batchForm.reset();

  renderBatchCalendar();

  batchOverlay.classList.remove('hidden');
  document.getElementById('batch-discriminacao').focus();
  
  setTimeout(() => {
    const curr = document.getElementById('batch-current-month');
    if (curr) {
      batchCalendar.scrollTop = curr.offsetTop - batchCalendar.offsetTop - 10;
    }
  }, 10);
});

function closeBatchModal() { batchOverlay.classList.add('hidden'); }
document.getElementById('batch-modal-close').addEventListener('click', closeBatchModal);
document.getElementById('btn-batch-cancel').addEventListener('click', closeBatchModal);

batchForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (batchSelectedDays.size === 0) {
    alert('Selecione ao menos um dia no calendário.');
    return;
  }
  const discriminacao = document.getElementById('batch-discriminacao').value.trim();
  const tipo = document.getElementById('batch-tipo').value;
  const previsto = document.getElementById('batch-previsto').value;
  const maxOrdem = transactions.length ? Math.max(...transactions.map((t) => t.ordem)) + 1 : 1;
  const targetAnoMes = anoMes();

  btnBatchSave.disabled = true;
  btnBatchSave.textContent = 'Criando...';

  try {
    const promises = Array.from(batchSelectedDays).map((dateStr, ix) => {
      const payload = {
        discriminacao,
        tipo,
        previsto: previsto ? Number(previsto) : null,
        efetivo: null,
        vencimento: dateStr,
        data_pagamento: null,
        ano_mes: targetAnoMes,
        ordem: maxOrdem + ix
      };
      return apiFetch(`${API_BASE}/api/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); });
    });
    
    await Promise.all(promises);
    closeBatchModal();
    loadTransactions();
  } catch (err) {
    alert('Erro ao criar registros em lote: ' + err.message);
  } finally {
    btnBatchSave.disabled = false;
  }
});
/* ── Delete modal ───────────────────────────────────────────────── */
function openDeleteModal(id) {
  deleteTargetId = id;
  delOverlay.classList.remove('hidden');
}
function closeDeleteModal() { delOverlay.classList.add('hidden'); deleteTargetId = null; }

document.getElementById('del-close').addEventListener('click', closeDeleteModal);
document.getElementById('del-cancel').addEventListener('click', closeDeleteModal);
delOverlay.addEventListener('click', (e) => { if (e.target === delOverlay) closeDeleteModal(); });

document.getElementById('del-confirm').addEventListener('click', async () => {
  if (!deleteTargetId) return;
  try {
    await apiFetch(`${API_BASE}/api/transactions/${deleteTargetId}`, { method: 'DELETE' });
    closeDeleteModal();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
});

/* ── Payment-date popover ───────────────────────────────────────── */
function openPayPopover(id, anchorEl) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;

  payTargetId = id;

  // Pre-fill with existing date if AGEN, otherwise default to vencimento
  payDateInput.value = tx.data_pagamento 
    ? tx.data_pagamento.split('T')[0] 
    : (tx.vencimento ? tx.vencimento.split('T')[0] : '');

  // Position below the badge, adjusted to stay in viewport
  payPopover.classList.remove('hidden');   // make visible before measuring

  const rect    = anchorEl.getBoundingClientRect();
  const pWidth  = payPopover.offsetWidth  || 240;
  const pHeight = payPopover.offsetHeight || 130;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let top  = rect.bottom + 8;
  let left = rect.left;

  // Prevent overflow right
  if (left + pWidth > vw - 8) left = vw - pWidth - 8;
  // Prevent overflow bottom — flip above instead
  if (top + pHeight > vh - 8) top = rect.top - pHeight - 8;

  payPopover.style.top  = `${top}px`;
  payPopover.style.left = `${left}px`;

  // Re-trigger animation
  payPopover.style.animation = 'none';
  requestAnimationFrame(() => { payPopover.style.animation = ''; });

  payDateInput.focus();
}

function closePayPopover() {
  payPopover.classList.add('hidden');
  payTargetId = null;
}

// OK — save the entered date
document.getElementById('pay-confirm-btn').addEventListener('click', async () => {
  if (!payTargetId) return;
  const dateVal = payDateInput.value || null;
  try {
    await patchTx(payTargetId, { data_pagamento: dateVal });
    closePayPopover();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
});

// Limpar — remove payment date
document.getElementById('pay-clear-btn').addEventListener('click', async () => {
  if (!payTargetId) return;
  try {
    await patchTx(payTargetId, { data_pagamento: null });
    closePayPopover();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao limpar: ${err.message}`);
  }
});

document.getElementById('pay-cancel-btn').addEventListener('click', closePayPopover);

// Close on outside click
document.addEventListener('click', (e) => {
  if (!payPopover.classList.contains('hidden') && !payPopover.contains(e.target)) {
    closePayPopover();
  }
});

// Close on Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePayPopover();
    if (typeof closeEfetivoPopover === 'function') closeEfetivoPopover();
    closeModal();
    closeDeleteModal();
  }
});

/* ── Efetivo popover ────────────────────────────────────────────── */
let efetivoTargetId = null;

function openEfetivoPopover(id, anchorEl) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx || tx.is_special) return;

  efetivoTargetId = id;
  const popover = document.getElementById('efetivo-popover');
  const input = document.getElementById('efetivo-val-input');

  // Pre-fill with existing if any, else default to previsto
  input.value = tx.efetivo != null ? tx.efetivo : (tx.previsto != null ? tx.previsto : '');

  popover.classList.remove('hidden');

  const rect    = anchorEl.getBoundingClientRect();
  const pWidth  = popover.offsetWidth  || 240;
  const pHeight = popover.offsetHeight || 130;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let top  = rect.bottom + 8;
  let left = rect.left;
  if (left + pWidth > vw - 8) left = vw - pWidth - 8;
  if (top + pHeight > vh - 8) top = rect.top - pHeight - 8;

  popover.style.top  = `${top}px`;
  popover.style.left = `${left}px`;
  popover.style.animation = 'none';
  requestAnimationFrame(() => { popover.style.animation = ''; });

  input.focus();
}

function closeEfetivoPopover() {
  const popover = document.getElementById('efetivo-popover');
  if (popover) popover.classList.add('hidden');
  efetivoTargetId = null;
}

document.getElementById('efetivo-confirm-btn')?.addEventListener('click', async () => {
  if (!efetivoTargetId) return;
  const input = document.getElementById('efetivo-val-input');
  const val = input.value ? Number(input.value) : null;
  try {
    await patchTx(efetivoTargetId, { efetivo: val });
    closeEfetivoPopover();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
});

document.getElementById('efetivo-clear-btn')?.addEventListener('click', async () => {
  if (!efetivoTargetId) return;
  try {
    await patchTx(efetivoTargetId, { efetivo: null });
    closeEfetivoPopover();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao limpar: ${err.message}`);
  }
});

document.getElementById('efetivo-cancel-btn')?.addEventListener('click', closeEfetivoPopover);

document.addEventListener('click', (e) => {
  const popover = document.getElementById('efetivo-popover');
  if (popover && !popover.classList.contains('hidden') && !popover.contains(e.target)) {
    closeEfetivoPopover();
  }
});

/* ── Init ───────────────────────────────────────────────────────── */
window.onAuthSuccess = initApp;

async function initApp() {
  try {
    const res = await apiFetch(`${API_BASE}/api/default-month`);
    if (res.ok) {
      const { default_month } = await res.json();
      if (default_month) {
        const [y, m] = default_month.split('-');
        currentDate = new Date(Number(y), Number(m) - 1, 1);
      }
    }
  } catch (err) {
    console.warn("Could not fetch default month:", err);
  }
  loadTransactions();
}

// checkAuth inicia o fluxo; chama onAuthSuccess se autenticado
checkAuth().then(user => { if (user) initApp(); });

/* ── Config ─────────────────────────────────────────────────────── */
const API_BASE = `http://${window.location.hostname}:8001`;

/* ── State ──────────────────────────────────────────────────────── */
let records = [];
let deleteTargetId = null;
let isEditMode = false;

/* ── Helpers ────────────────────────────────────────────────────── */
const fmt = (val) =>
  val == null
    ? '—'
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const MESES = ['', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
               'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

const currentAnoMes = () => {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
};

/* ── DOM refs ───────────────────────────────────────────────────── */
const recBody      = document.getElementById('rec-body');
const modalOverlay = document.getElementById('modal-overlay');
const delOverlay   = document.getElementById('del-overlay');
const recForm      = document.getElementById('rec-form');
const periodSel    = document.getElementById('form-periodicidade');
const groupMesAnual = document.getElementById('group-mes-anual');
const groupApplyFrom = document.getElementById('group-apply-from');
const applyFromInput = document.getElementById('form-apply-from');

/* ── Load records ───────────────────────────────────────────────── */
async function loadRecords() {
  recBody.innerHTML = `<tr class="loading-row"><td colspan="7"><div class="spinner"></div> Carregando…</td></tr>`;
  try {
    const res = await fetch(`${API_BASE}/api/recorrentes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    records = await res.json();
    renderTable();
  } catch (err) {
    recBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:40px;color:#ef4444;">
      Erro ao conectar com o servidor.<br><small>${err.message}</small></td></tr>`;
  }
}

/* ── Render table ───────────────────────────────────────────────── */
function renderTable() {
  if (!records.length) {
    recBody.innerHTML = `<tr class="empty-row"><td colspan="7">Nenhum registro recorrente cadastrado.</td></tr>`;
    return;
  }

  recBody.innerHTML = '';
  records.forEach((rec) => {
    const isEntrada = rec.tipo === 'entrada';
    const tipoBadge = isEntrada
      ? `<span class="tipo-badge tipo-entrada">+</span>`
      : `<span class="tipo-badge tipo-saida">−</span>`;

    const mesAnualStr = rec.periodicidade === 'anual' && rec.mes_anual
      ? MESES[rec.mes_anual]
      : '—';

    const periodLabel = rec.periodicidade === 'anual' ? 'Anual' : 'Mensal';

    const valorClass = isEntrada ? 'is-entrada-val' : 'is-saida-val';
    const valorSigned = isEntrada ? Number(rec.valor_previsto) : -Number(rec.valor_previsto);

    const vinculaBadge = rec.vincula_proximo_mes ? '<span style="font-size:0.7rem;background:var(--accent);color:#fff;padding:2px 6px;border-radius:10px;margin-left:8px;" title="Vencimento no mês seguinte">Mês +1</span>' : '';

    const tr = document.createElement('tr');
    tr.className = isEntrada ? 'is-entrada' : 'is-saida';
    tr.innerHTML = `
      <td class="col-tipo" style="text-align:center;">${tipoBadge}</td>
      <td style="text-align:right;">Dia ${rec.dia_vencimento}</td>
      <td style="text-align:center;">${periodLabel}</td>
      <td style="text-align:center;">${mesAnualStr}</td>
      <td class="col-desc">${rec.discriminacao}${vinculaBadge}</td>
      <td style="text-align:right;"><span class="${valorClass}">${fmt(valorSigned)}</span></td>
      <td class="col-actions">
        <div class="row-actions" style="opacity:1;">
          <button class="icon-btn edit" data-id="${rec.id}" title="Editar">✏️</button>
          <button class="icon-btn del"  data-id="${rec.id}" title="Excluir">🗑️</button>
        </div>
      </td>
    `;
    recBody.appendChild(tr);
  });

  recBody.querySelectorAll('.icon-btn.edit').forEach((el) =>
    el.addEventListener('click', () => openEditModal(Number(el.dataset.id)))
  );
  recBody.querySelectorAll('.icon-btn.del').forEach((el) =>
    el.addEventListener('click', () => openDeleteModal(Number(el.dataset.id)))
  );
}

/* ── Show/hide mes_anual field based on periodicidade ─────────────── */
periodSel.addEventListener('change', () => {
  groupMesAnual.style.display = periodSel.value === 'anual' ? '' : 'none';
});

/* ── Add modal ──────────────────────────────────────────────────── */
document.getElementById('btn-add-rec').addEventListener('click', openAddModal);

function openAddModal() {
  isEditMode = false;
  document.getElementById('modal-title').textContent = 'Novo Recorrente';
  document.getElementById('form-id').value = '';
  recForm.reset();
  document.getElementById('form-vincula').checked = false;
  groupMesAnual.style.display = 'none';
  groupApplyFrom.style.display = 'none';
  modalOverlay.classList.remove('hidden');
  document.getElementById('form-discriminacao').focus();
}

function openEditModal(id) {
  const rec = records.find((r) => r.id === id);
  if (!rec) return;
  isEditMode = true;

  document.getElementById('modal-title').textContent = 'Editar Recorrente';
  document.getElementById('form-id').value             = rec.id;
  document.getElementById('form-discriminacao').value  = rec.discriminacao;
  document.getElementById('form-tipo').value           = rec.tipo;
  document.getElementById('form-valor').value          = rec.valor_previsto;
  document.getElementById('form-periodicidade').value  = rec.periodicidade;
  document.getElementById('form-dia').value            = rec.dia_vencimento;
  document.getElementById('form-mes-anual').value      = rec.mes_anual || 1;
  document.getElementById('form-vincula').checked      = !!rec.vincula_proximo_mes;

  groupMesAnual.style.display = rec.periodicidade === 'anual' ? '' : 'none';

  // Show apply_from field in edit mode
  groupApplyFrom.style.display = '';
  applyFromInput.value = currentAnoMes();

  modalOverlay.classList.remove('hidden');
}

function closeModal() { modalOverlay.classList.add('hidden'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

/* ── Form submit ────────────────────────────────────────────────── */
recForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('form-id').value;

  const payload = {
    discriminacao:  document.getElementById('form-discriminacao').value.trim(),
    tipo:           document.getElementById('form-tipo').value,
    valor_previsto: document.getElementById('form-valor').value,
    periodicidade:  document.getElementById('form-periodicidade').value,
    dia_vencimento: Number(document.getElementById('form-dia').value),
    mes_anual:      periodSel.value === 'anual'
                      ? Number(document.getElementById('form-mes-anual').value)
                      : null,
    vincula_proximo_mes: document.getElementById('form-vincula').checked,
  };

  try {
    if (id) {
      // Edit mode — include apply_from
      const applyFrom = applyFromInput.value || currentAnoMes();
      const res = await fetch(`${API_BASE}/api/recorrentes/${id}?apply_from=${applyFrom}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } else {
      const res = await fetch(`${API_BASE}/api/recorrentes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    closeModal();
    await loadRecords();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
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
    const res = await fetch(`${API_BASE}/api/recorrentes/${deleteTargetId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeDeleteModal();
    await loadRecords();
  } catch (err) {
    alert(`Erro ao excluir: ${err.message}`);
  }
});

/* ── Keyboard ───────────────────────────────────────────────────── */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeModal(); closeDeleteModal(); }
});

/* ── Init ───────────────────────────────────────────────────────── */
loadRecords();

/* ── Config ─────────────────────────────────────────────────────── */
const API_BASE = '';   // nginx faz proxy de /api/ → backend:8000


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
const recBody       = document.getElementById('rec-body');
const modalOverlay  = document.getElementById('modal-overlay');
const delOverlay    = document.getElementById('del-overlay');
const recForm       = document.getElementById('rec-form');
const periodSel     = document.getElementById('form-periodicidade');
const groupMesAnual = document.getElementById('group-mes-anual');
const periodFromEl  = document.getElementById('form-period-from');
const periodUntilEl = document.getElementById('form-period-until');

/* ── Helpers de mês ─────────────────────────────────────────────── */
function addMonths(anoMes, n) {
  let [y, m] = anoMes.split('-').map(Number);
  m += n;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

/* ── Load records ───────────────────────────────────────────────── */
async function loadRecords() {
  recBody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="spinner"></div> Carregando…</td></tr>`;
  try {
    const res = await apiFetch(`${API_BASE}/api/recorrentes`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    records = await res.json();
    renderTable();
  } catch (err) {
    recBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">
      Erro ao conectar com o servidor.<br><small>${err.message}</small></td></tr>`;
  }
}

/* ── Render table ───────────────────────────────────────────────── */
function renderTable() {
  if (!records.length) {
    recBody.innerHTML = `<tr class="empty-row"><td colspan="8">Nenhum registro recorrente cadastrado.</td></tr>`;
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
    const valorClass  = isEntrada ? 'is-entrada-val' : 'is-saida-val';
    const valorSigned = isEntrada ? Number(rec.valor_previsto) : -Number(rec.valor_previsto);

    let geradoAte = '—';
    if (rec.ultimo_mes_gerado) {
      const [gy, gm] = rec.ultimo_mes_gerado.split('-');
      geradoAte = `${MESES[Number(gm)].substring(0, 3)}/${gy}`;
    }

    const vinculaBadge = rec.vincula_proximo_mes
      ? `<span style="font-size:0.7rem;background:var(--accent);color:#fff;padding:2px 6px;border-radius:10px;margin-left:8px;" title="Vencimento no mês seguinte">Mês +1</span>`
      : '';

    const tr = document.createElement('tr');
    tr.className = isEntrada ? 'is-entrada' : 'is-saida';
    tr.innerHTML = `
      <td class="col-tipo" style="text-align:center;" data-label="TIPO">${tipoBadge}</td>
      <td style="text-align:right;" data-label="DIA / VENC.">Dia ${rec.dia_vencimento}</td>
      <td style="text-align:center;" data-label="PERIODICIDADE">${periodLabel}</td>
      <td style="text-align:center;" data-label="MÊS">${mesAnualStr}</td>
      <td class="col-desc" data-label="DISCRIMINAÇÃO">${escHtml(rec.discriminacao)}${vinculaBadge}</td>
      <td style="text-align:right;" data-label="PREVISTO"><span class="${valorClass}">${fmt(valorSigned)}</span></td>
      <td style="text-align:center;color:var(--text-secondary);font-size:.82rem;" data-label="GERADO ATÉ">${geradoAte}</td>
      <td class="col-actions" data-label="AÇÕES">
        <div class="row-actions" style="opacity:1;">
          <button class="icon-btn edit" data-id="${rec.id}" title="Editar">✎</button>
          <button class="icon-btn del"  data-id="${rec.id}" title="Excluir">✕</button>
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

/* ── Show/hide mes_anual field ──────────────────────────────────── */
periodSel.addEventListener('change', () => {
  groupMesAnual.style.display = periodSel.value === 'anual' ? '' : 'none';
});

/* ── Configurar labels do período por modo ──────────────────────── */
function setPeriodoCreateMode() {
  document.getElementById('label-periodo').textContent    = 'Período de geração';
  document.getElementById('label-period-from').textContent = 'Início';
  document.getElementById('label-period-until').textContent = 'Fim';
  document.getElementById('hint-periodo').textContent =
    'Os registros serão criados para cada mês neste intervalo.';
  periodFromEl.value  = currentAnoMes();
  periodUntilEl.value = addMonths(currentAnoMes(), 23);
}

function setPeriodoEditMode(rec) {
  document.getElementById('label-periodo').textContent    = 'Período de aplicação das mudanças';
  document.getElementById('label-period-from').textContent = 'A partir de';
  document.getElementById('label-period-until').textContent = 'Até';
  document.getElementById('hint-periodo').textContent =
    'Registros existentes serão recriados no intervalo. Novos meses serão gerados se necessário.';
  periodFromEl.value  = currentAnoMes();
  if (rec.ultimo_mes_gerado) {
    periodUntilEl.value = addMonths(rec.ultimo_mes_gerado, 12);
  } else {
    periodUntilEl.value = addMonths(currentAnoMes(), 23);
  }
}

/* ── Add modal ──────────────────────────────────────────────────── */
document.getElementById('btn-add-rec').addEventListener('click', openAddModal);

function openAddModal() {
  isEditMode = false;
  document.getElementById('modal-title').textContent = 'Novo Recorrente';
  document.getElementById('form-id').value = '';
  recForm.reset();
  document.getElementById('form-vincula').checked = false;
  groupMesAnual.style.display = 'none';
  setPeriodoCreateMode();
  modalOverlay.classList.remove('hidden');
  document.getElementById('form-discriminacao').focus();
}

function openEditModal(id) {
  const rec = records.find((r) => r.id === id);
  if (!rec) return;
  isEditMode = true;

  document.getElementById('modal-title').textContent       = 'Editar Recorrente';
  document.getElementById('form-id').value                 = rec.id;
  document.getElementById('form-discriminacao').value      = rec.discriminacao;
  document.getElementById('form-tipo').value               = rec.tipo;
  document.getElementById('form-valor').value              = rec.valor_previsto;
  document.getElementById('form-periodicidade').value      = rec.periodicidade;
  document.getElementById('form-dia').value                = rec.dia_vencimento;
  document.getElementById('form-mes-anual').value          = rec.mes_anual || 1;
  document.getElementById('form-vincula').checked          = !!rec.vincula_proximo_mes;

  groupMesAnual.style.display = rec.periodicidade === 'anual' ? '' : 'none';
  setPeriodoEditMode(rec);
  modalOverlay.classList.remove('hidden');
}

function closeModal() { modalOverlay.classList.add('hidden'); }
document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });

/* ── Form submit ────────────────────────────────────────────────── */
recForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id    = document.getElementById('form-id').value;
  const from  = periodFromEl.value  || currentAnoMes();
  const until = periodUntilEl.value || addMonths(from, 23);

  const payload = {
    discriminacao:      document.getElementById('form-discriminacao').value.trim(),
    tipo:               document.getElementById('form-tipo').value,
    valor_previsto:     document.getElementById('form-valor').value,
    periodicidade:      document.getElementById('form-periodicidade').value,
    dia_vencimento:     Number(document.getElementById('form-dia').value),
    mes_anual:          periodSel.value === 'anual'
                          ? Number(document.getElementById('form-mes-anual').value)
                          : null,
    vincula_proximo_mes: document.getElementById('form-vincula').checked,
  };

  try {
    let res;
    if (id) {
      // Edição: apply_from = início, generate_until = fim
      res = await apiFetch(
        `${API_BASE}/api/recorrentes/${id}?apply_from=${from}&generate_until=${until}`,
        { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
    } else {
      // Criação: from_ano_mes = início, until_ano_mes = fim
      res = await apiFetch(
        `${API_BASE}/api/recorrentes?from_ano_mes=${from}&until_ano_mes=${until}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
      );
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    closeModal();
    await loadRecords();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
});

/* ── Modal de confirmação de exclusão ────────────────────────────── */
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
    const res = await apiFetch(`${API_BASE}/api/recorrentes/${deleteTargetId}`, { method: 'DELETE' });
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
// auth.js define checkAuth(); onAuthSuccess é chamado após token válido ou login
window.onAuthSuccess = loadRecords;
checkAuth();

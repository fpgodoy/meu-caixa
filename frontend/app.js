/* =============================================================================
   app.js — Lógica principal do dashboard de contas
   -----------------------------------------------------------------------------
   Responsável por:
     - Carregar e renderizar as transações do mês selecionado
     - Calcular os totalizadores do cabeçalho (entradas, saídas, a pagar, saldo)
     - Gerenciar modais de adição, edição e exclusão
     - Gerenciar popovers de data de pagamento e valor efetivo
     - Controlar a navegação entre meses
     - Criação em lote de registros via calendário
   =============================================================================

   NOTAS DE ROBUSTEZ:
     - Race condition: loadTransactions usa _loadSeq para descartar respostas
       obsoletas quando o usuário troca de mês rapidamente.
     - Navegação de mês: sempre cria uma nova instância de Date (imutável),
       evitando bugs do setMonth() com dias 29-31 em meses mais curtos.
   ============================================================================= */


/* ── Configuração ────────────────────────────────────────────────── */

// Prefixo base da API. Vazio porque o nginx faz o proxy de /api/ → backend:8000
const API_BASE = '';


/* ── Estado global ───────────────────────────────────────────────── */

// Mês/ano atualmente exibido no dashboard
let currentDate = new Date();

// Lista de transações carregadas da API para o mês corrente
let transactions = [];

// Modo de ordenação: 'receitas' (entradas primeiro) ou 'cronologica'
// Persistido no localStorage para manter a preferência entre sessões
let currentSort = localStorage.getItem('appContas_sort') || 'receitas';

// Contador de sequência para evitar race condition em loadTransactions.
// Cada chamada incrementa este número; respostas de chamadas anteriores
// são descartadas comparando o valor no momento da resposta com o atual.
let _loadSeq = 0;


/* ── Funções auxiliares (helpers) ────────────────────────────────── */

/**
 * Formata um número como moeda brasileira (R$).
 * Retorna string vazia se o valor for null ou undefined.
 */
const fmt = (val) =>
  val == null
    ? ''
    : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

/**
 * Formata uma string de data ISO (ex: "2024-03-15") para o padrão brasileiro "dd/mm/aaaa".
 * Retorna string vazia se a data for nula.
 */
const fmtDate = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('T')[0].split('-');
  return `${d}/${m}/${y}`;
};

/**
 * Converte uma string ISO para um objeto Date LOCAL (sem deslocamento de fuso horário).
 * Necessário porque `new Date("2024-03-15")` interpreta como UTC (meia-noite em Londres),
 * o que pode resultar no dia anterior em fusos negativos como o do Brasil.
 */
const parseLocalDate = (iso) => {
  if (!iso) return null;
  const [y, m, d] = iso.split('T')[0].split('-').map(Number);
  return new Date(y, m - 1, d);
};

/**
 * Retorna a data de hoje à meia-noite (horário local).
 * Usado para comparações de datas sem interferência de horários.
 */
const today = () => {
  const t = new Date();
  return new Date(t.getFullYear(), t.getMonth(), t.getDate());
};

/**
 * Retorna o mês corrente no formato "AAAA-MM" (ex: "2024-03").
 * Usado como parâmetro de filtro na chamada à API.
 */
const anoMes = () => {
  const y = currentDate.getFullYear();
  const m = String(currentDate.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
};

/**
 * Retorna o nome do mês e ano por extenso em português (ex: "março de 2024").
 * Exibido no cabeçalho do dashboard.
 */
const monthLabel = () =>
  currentDate.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });


/* ── Status das transações ───────────────────────────────────────── */

/**
 * Calcula o status de uma transação com base nas datas de vencimento e pagamento.
 *
 * Regras:
 *   - Se tem data_pagamento e ela já passou (ou é hoje) → OK   (quitado)
 *   - Se tem data_pagamento futura                       → AGEN (agendado)
 *   - Se não tem data_pagamento e já venceu              → VENC (vencido sem pagto)
 *   - Caso contrário                                     → PEN  (pendente)
 */
function computeStatus(tx) {
  const pagamento  = parseLocalDate(tx.data_pagamento);
  const vencimento = parseLocalDate(tx.vencimento);
  const now        = today();

  if (pagamento) {
    return pagamento <= now ? 'OK' : 'AGEN';
  }
  if (vencimento && vencimento < now) {
    return 'VENC';
  }
  return 'PEN';
}

/**
 * Retorna a classe CSS correspondente ao status da transação.
 * As classes são definidas em style.css (ex: .status-ok, .status-venc).
 */
function statusClass(s) {
  if (s === 'OK')   return 'status-ok';
  if (s === 'AGEN') return 'status-agen';
  if (s === 'VENC') return 'status-venc';
  return 'status-pen';
}


/* ── Cálculo do saldo acumulado (coluna SALDO) ───────────────────── */

/**
 * Percorre todas as transações na ordem em que aparecem e retorna um array
 * com o saldo acumulado ANTES de cada registro (saldo de entrada da linha).
 *
 * Regras de valor:
 *   - Usa `efetivo` se preenchido; senão usa `previsto`
 *   - Registros especiais (is_special) são sempre tratados como entrada
 *
 * O saldo exibido na linha representa o saldo antes daquele lançamento,
 * para que o usuário veja o "saldo de abertura" de cada operação.
 */
function computeSaldos() {
  let saldo = 0;
  return transactions.map((tx) => {
    const display = saldo; // saldo antes desta transação
    const val = tx.efetivo != null ? Number(tx.efetivo) : (tx.previsto != null ? Number(tx.previsto) : 0);
    const effectiveEntrada = tx.is_special ? true : tx.tipo === 'entrada';
    saldo += effectiveEntrada ? val : -val;
    return display;
  });
}


/* ── Referências aos elementos do DOM ────────────────────────────── */

// Tabela principal de transações
const tbody        = document.getElementById('tx-body');

// Rótulo do mês no cabeçalho da página
const monthLabelEl = document.getElementById('month-label');

// Cards de totalizadores no topo do dashboard
const sumBalance   = document.getElementById('sum-balance');  // Saldo final
const sumIncome    = document.getElementById('sum-income');   // Total de entradas
const sumExpense   = document.getElementById('sum-expense');  // Total de saídas
const sumPending   = document.getElementById('sum-pending');  // Total a pagar (não OK)

// Overlays dos modais
const modalOverlay = document.getElementById('modal-overlay'); // Modal add/edit
const delOverlay   = document.getElementById('del-overlay');   // Modal de confirmação de exclusão

// Formulário do modal add/edit
const txForm       = document.getElementById('tx-form');

// Popover de data de pagamento (acionado ao clicar no badge de status)
const payPopover   = document.getElementById('pay-popover');
const payDateInput = document.getElementById('pay-date-input');

// IDs dos registros-alvo dos modais/popovers de ação
let deleteTargetId  = null;
let payTargetId     = null;


/* ── Carregamento de transações via API ──────────────────────────── */

/**
 * Busca as transações do mês corrente na API e chama renderTable().
 * Exibe um spinner enquanto carrega e mensagem de erro em caso de falha.
 *
 * Usa o contador _loadSeq para descartar respostas de requisições antigas:
 * se o usuário mudar de mês enquanto uma requisição está em andamento,
 * apenas a resposta mais recente será processada.
 */
async function loadTransactions() {
  const seq = ++_loadSeq; // captura o número desta requisição
  tbody.innerHTML = `<tr class="loading-row"><td colspan="8"><div class="spinner"></div> Carregando…</td></tr>`;
  monthLabelEl.textContent = monthLabel();

  try {
    const res = await apiFetch(`${API_BASE}/api/transactions?mes=${anoMes()}&sort=${currentSort}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // Descarta a resposta se já foi iniciada uma requisição mais recente
    if (seq !== _loadSeq) return;
    transactions = data;
    renderTable();
  } catch (err) {
    if (seq !== _loadSeq) return; // descarta erro de requisição obsoleta
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:#ef4444;">
      Erro ao conectar com o servidor.<br><small>${err.message}</small></td></tr>`;
  }
}


/* ── Toggle de ordenação ─────────────────────────────────────────── */

// Alterna entre ordenação por tipo ("receitas primeiro") e cronológica.
// O estado é salvo no localStorage para persistir entre visitas.
const sortToggle = document.getElementById('sort-toggle');
if (sortToggle) {
  sortToggle.checked = currentSort === 'receitas';
  sortToggle.addEventListener('change', (e) => {
    currentSort = e.target.checked ? 'receitas' : 'cronologica';
    localStorage.setItem('appContas_sort', currentSort);
    loadTransactions();
  });
}


/* ── Cálculo dos totalizadores (cards do dashboard) ──────────────── */

/**
 * Percorre as transações e atualiza os quatro cards de resumo:
 *
 *   Entradas  → soma de todas as entradas usando efetivo se disponível, senão previsto
 *   Saídas    → soma de todas as saídas usando efetivo se disponível, senão previsto
 *   A Pagar   → soma das saídas (mesma lógica efetivo→previsto) APENAS dos registros
 *               que NÃO estão marcados como OK (ou seja, ainda pendentes de pagamento)
 *   Saldo     → saldo final após todos os lançamentos do mês
 *
 * @param {number[]} saldos — array pré-calculado por computeSaldos(), passado pelo
 *   renderTable() para evitar que computeSaldos() seja executado duas vezes.
 *
 * Nota: registros com is_special e ordem === 9999 são âncoras de layout e são ignorados.
 *       Registros com is_special e ordem === 0 representam o saldo de abertura (entrada).
 */
function computeSummary(saldos) {
  let totalIncome  = 0;
  let totalExpense = 0;
  let totalPending = 0;

  transactions.forEach((tx) => {
    // Ignora a âncora de fechamento (registro especial de ordem 9999)
    if (tx.is_special && tx.ordem === 9999) return;

    // O registro especial de ordem 0 é o saldo inicial (sempre tratado como entrada)
    const isEntrada = (tx.is_special && tx.ordem === 0) ? true : tx.tipo === 'entrada';

    // Valor efetivo tem prioridade; usa previsto quando efetivo não foi informado
    const val = tx.efetivo != null ? Number(tx.efetivo) : (tx.previsto != null ? Number(tx.previsto) : 0);

    if (isEntrada) {
      totalIncome += val;
    } else {
      // Acumula no total de saídas independentemente do status
      totalExpense += val;

      // Acumula no "total a pagar" apenas se ainda não foi quitado (status ≠ OK)
      const status = computeStatus(tx);
      if (status !== 'OK') {
        totalPending += val;
      }
    }
  });

  // Saldo final: usa o array `saldos` já calculado pelo chamador (renderTable)
  // para evitar um segundo percurso desnecessário em computeSaldos().
  let finalBalance = 0;
  if (transactions.length) {
    const last      = transactions[transactions.length - 1];
    const lastSaldo = saldos[saldos.length - 1];
    const val = last.efetivo != null ? Number(last.efetivo) : (last.previsto != null ? Number(last.previsto) : 0);
    finalBalance = lastSaldo + (last.tipo === 'entrada' ? val : -val);
  }

  sumBalance.textContent = fmt(finalBalance);
  sumIncome.textContent  = fmt(totalIncome);
  sumExpense.textContent = fmt(totalExpense);
  sumPending.textContent = fmt(totalPending);
}


/* ── Utilitário de valor com sinal ───────────────────────────────── */

/**
 * Aplica sinal negativo para saídas, positivo para entradas.
 * Retorna null quando val é null (exibido como "—" na tabela).
 */
function fmtValue(val, tipo) {
  if (val == null) return null;
  const amount = Number(val);
  return tipo === 'saida' ? -amount : amount;
}


/* ── Renderização da tabela de transações ───────────────────────── */

/**
 * Gera o HTML da tabela a partir do array `transactions`.
 * Se não houver registros, exibe mensagem de lista vazia.
 * Após renderizar as linhas, registra os event listeners de interação.
 */
function renderTable() {
  if (!transactions.length) {
    tbody.innerHTML = `<tr class="empty-row"><td colspan="8">Nenhuma conta cadastrada para este mês.</td></tr>`;
    [sumBalance, sumIncome, sumExpense, sumPending].forEach(el => el.textContent = fmt(0));
    return;
  }

  // Calcula os saldos uma única vez e os reutiliza tanto nos cards quanto nas linhas da tabela
  const saldos = computeSaldos();
  computeSummary(saldos);

  tbody.innerHTML = '';
  transactions.forEach((tx, i) => {
    const saldo      = saldos[i];
    const saldoClass = saldo > 0 ? 'positive' : saldo < 0 ? 'negative' : '';

    // Registros especiais (saldo inicial) são exibidos sempre como entrada (positivo)
    const isEntrada  = tx.is_special ? true : tx.tipo === 'entrada';

    // Calcula o valor formatado com sinal correto para previsto e efetivo
    const efectiveTipo  = tx.is_special ? 'entrada' : tx.tipo;
    const prevSigned    = fmtValue(tx.previsto, efectiveTipo);
    const efetSigned    = fmtValue(tx.efetivo,  efectiveTipo);

    // HTML da coluna PREVISTO (sem interação)
    const prevFormatted = prevSigned != null
      ? `<span class="${isEntrada ? 'is-entrada-val' : 'is-saida-val'}">${fmt(prevSigned)}</span>`
      : `<span class="empty-val">—</span>`;

    // HTML da coluna EFETIVO (clicável para edição via popover)
    const efetFormatted = efetSigned != null
      ? `<span class="${isEntrada ? 'is-entrada-val' : 'is-saida-val'}" data-efetivo-id="${tx.id}" style="cursor:pointer;" title="Editar Efetivo">${fmt(efetSigned)}</span>`
      : `<span class="empty-val" data-efetivo-id="${tx.id}" style="cursor:pointer;" title="Informar Efetivo">—</span>`;

    const vencVal = fmtDate(tx.vencimento)     || '<span class="empty-val">—</span>';
    const pagVal  = fmtDate(tx.data_pagamento) || '<span class="empty-val">—</span>';

    const status    = computeStatus(tx);
    const stClass   = statusClass(status);

    // O badge de status só é clicável em registros normais que ainda não foram quitados
    const isClickable = !tx.is_special && status !== 'OK';

    const tr = document.createElement('tr');
    tr.className  = (tx.is_special ? 'special-row ' : '') + (isEntrada ? 'is-entrada' : 'is-saida');
    tr.dataset.id = tx.id;

    tr.innerHTML = `
      <td class="col-mov ${saldoClass}" data-label="SALDO">${fmt(saldo)}</td>
      <td class="col-previsto" data-label="PREVISTO">${prevFormatted}</td>
      <td class="col-efetivo" data-label="EFETIVO">${efetFormatted}</td>
      <td class="col-venc" data-label="VENCIMENTO">${vencVal}</td>
      <td class="col-desc" data-label="DISCRIMINAÇÃO">${escHtml(tx.discriminacao)}</td>
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

  // Abre o popover de edição do valor efetivo ao clicar na célula
  tbody.querySelectorAll('[data-efetivo-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openEfetivoPopover(Number(el.dataset.efetivoId), el);
    });
  });

  // Abre o popover de data de pagamento ao clicar no badge de status (exceto OK)
  tbody.querySelectorAll('.status-badge.clickable').forEach((el) =>
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      openPayPopover(Number(el.dataset.id), el);
    })
  );

  // Abre o modal de edição ao clicar no ícone de lápis
  tbody.querySelectorAll('.icon-btn.edit').forEach((el) =>
    el.addEventListener('click', () => openEditModal(Number(el.dataset.id)))
  );

  // Abre o modal de confirmação de exclusão ao clicar no ícone ✕
  tbody.querySelectorAll('.icon-btn.del').forEach((el) =>
    el.addEventListener('click', () => openDeleteModal(Number(el.dataset.id)))
  );
}


/* ── Utilitário de atualização via API (PUT) ─────────────────────── */

/**
 * Envia uma requisição PUT para atualizar parcialmente uma transação.
 * @param {number} id   - ID da transação a ser atualizada
 * @param {object} data - Campos e valores a serem sobrescritos
 */
async function patchTx(id, data) {
  const res = await apiFetch(`${API_BASE}/api/transactions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}


/* ── Navegação entre meses ───────────────────────────────────────── */

// Botão "‹" — recua um mês
// Cria uma nova instância de Date (imutável) para evitar o bug do setMonth()
// com datas de dias 29–31 em meses mais curtos (ex: 31/jan → 03/fev com setMonth).
document.getElementById('btn-prev').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  loadTransactions();
});

// Botão "›" — avança um mês
document.getElementById('btn-next').addEventListener('click', () => {
  currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  loadTransactions();
});


/* ── Popover seletor de mês/ano ──────────────────────────────────── */

// Referências ao popover e seus controles
const monthPicker   = document.getElementById('month-picker');
const pickerYear    = document.getElementById('picker-year');
const pickerMonth   = document.getElementById('picker-month');
const monthLabelBtn = document.getElementById('month-label');

/**
 * Abre o popover de seleção de mês/ano abaixo do rótulo de mês,
 * pré-populando as opções de ano (±10 anos a partir do ano atual).
 */
function openMonthPicker() {
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

  // Posiciona o popover centralizado abaixo do botão de mês
  const rect = monthLabelBtn.getBoundingClientRect();
  monthPicker.classList.remove('hidden');
  const pw = monthPicker.offsetWidth || 240;
  let left = rect.left + rect.width / 2 - pw / 2;
  if (left < 8) left = 8;
  if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
  monthPicker.style.top  = `${rect.bottom + 8}px`;
  monthPicker.style.left = `${left}px`;
}

function closeMonthPicker() { monthPicker.classList.add('hidden'); }

// Abre o seletor ao clicar no rótulo do mês
monthLabelBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  openMonthPicker();
});

// Confirma a seleção e recarrega as transações do mês escolhido
document.getElementById('picker-go').addEventListener('click', () => {
  currentDate = new Date(Number(pickerYear.value), Number(pickerMonth.value) - 1, 1);
  closeMonthPicker();
  loadTransactions();
});

document.getElementById('picker-cancel').addEventListener('click', closeMonthPicker);

// Fecha o seletor ao clicar fora dele
document.addEventListener('click', (e) => {
  if (!monthPicker.classList.contains('hidden') && !monthPicker.contains(e.target) && e.target !== monthLabelBtn) {
    closeMonthPicker();
  }
});


/* ── Modal de adição e edição de transação ───────────────────────── */

document.getElementById('btn-add').addEventListener('click', () => openAddModal());

/** Abre o modal em modo de criação (formulário em branco). */
function openAddModal() {
  document.getElementById('modal-title').textContent = 'Nova Conta';
  document.getElementById('form-id').value = '';
  document.getElementById('btn-move-month').classList.add('hidden');
  txForm.reset();
  modalOverlay.classList.remove('hidden');
  document.getElementById('form-discriminacao').focus();
}

/**
 * Abre o modal em modo de edição, pré-preenchido com os dados da transação.
 * Registros especiais (is_special) têm apenas o campo "Efetivo" habilitado.
 */
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

  // Registros especiais só permitem editar o efetivo; os demais campos são bloqueados.
  // Nota: form-status foi removido desta lista pois o campo está oculto no HTML —
  // o status é calculado automaticamente por computeStatus() e não é editável.
  const LOCKED = ['form-discriminacao','form-tipo','form-previsto','form-vencimento','form-data-pagamento'];
  if (tx.is_special) document.getElementById('form-tipo').value = 'entrada';
  LOCKED.forEach((fid) => {
    const el = document.getElementById(fid);
    el.disabled      = tx.is_special;
    el.style.opacity = tx.is_special ? '0.38' : '';
    el.style.cursor  = tx.is_special ? 'not-allowed' : '';
  });

  // O botão "Próximo mês" é visível na edição, mas desabilitado para registros especiais
  const moveBtn = document.getElementById('btn-move-month');
  moveBtn.classList.remove('hidden');
  moveBtn.disabled = tx.is_special;

  modalOverlay.classList.remove('hidden');
  document.getElementById(tx.is_special ? 'form-efetivo' : 'form-discriminacao').focus();
}

/**
 * Fecha o modal e re-habilita todos os campos que possam ter sido bloqueados
 * durante a edição de um registro especial.
 */
function closeModal() {
  // Re-habilita os mesmos campos que podem ter sido bloqueados em openEditModal.
  // form-status não está na lista pois está oculto no HTML.
  ['form-discriminacao','form-tipo','form-previsto','form-vencimento','form-data-pagamento'].forEach((fid) => {
    const el = document.getElementById(fid);
    el.disabled      = false;
    el.style.opacity = '';
    el.style.cursor  = '';
  });
  modalOverlay.classList.add('hidden');
}

document.getElementById('modal-close').addEventListener('click', closeModal);
document.getElementById('btn-cancel').addEventListener('click', closeModal);
// Fecha ao clicar no fundo escuro do overlay (fora do painel do modal)
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeModal(); });


/* ── Envio do formulário (criar ou editar transação) ─────────────── */

txForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id       = document.getElementById('form-id').value;
  // A ordem do novo registro é sempre maior que a maior existente
  const maxOrdem = transactions.length ? Math.max(...transactions.map((t) => t.ordem)) + 1 : 1;

  // Registros especiais só permitem alterar o campo efetivo
  const editingTx     = id ? transactions.find((t) => String(t.id) === id) : null;
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
      // Edição: atualiza o registro existente pelo ID
      await patchTx(Number(id), payload);
    } else {
      // Criação: envia o registro com o mês corrente e a próxima ordem disponível
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


/* ── Botão "Mover para o próximo mês" ────────────────────────────── */

/**
 * Move o registro atualmente aberto no modal para o mês seguinte ao exibido.
 * Útil para adiar lançamentos que não foram concluídos no mês corrente.
 */
document.getElementById('btn-move-month').addEventListener('click', async () => {
  const idStr = document.getElementById('form-id').value;
  if (!idStr) return;
  const id = Number(idStr);

  const nextDate   = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  const nextAnoMes = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;

  try {
    await patchTx(id, { ano_mes: nextAnoMes });
    closeModal();
    loadTransactions();
  } catch (err) {
    alert("Erro ao mover a conta: " + err.message);
  }
});


/* ── Modal de criação em lote ───────────────────────────────────────
   Permite criar vários registros de uma vez, selecionando múltiplos dias
   num calendário que exibe o mês anterior, o atual e o próximo.
   ──────────────────────────────────────────────────────────────────── */

const batchOverlay    = document.getElementById('batch-modal-overlay');
const batchForm       = document.getElementById('batch-form');
const batchCalendar   = document.getElementById('batch-calendar');
const batchMonthTitle = document.getElementById('batch-month-title');
const btnBatchSave    = document.getElementById('btn-batch-save');

// Conjunto dos dias selecionados (strings no formato "AAAA-MM-DD")
let batchSelectedDays = new Set();

/**
 * Renderiza o calendário de seleção em lote com três meses visíveis:
 * mês anterior, mês atual e mês seguinte ao mês corrente do dashboard.
 * Dias já selecionados são marcados com a classe CSS "selected".
 */
function renderBatchCalendar() {
  batchCalendar.innerHTML = '';

  if (batchMonthTitle) {
    batchMonthTitle.textContent = `${String(currentDate.getMonth() + 1).padStart(2, '0')}/${currentDate.getFullYear()}`;
  }

  const mNames  = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const offsets = [-1, 0, 1]; // mês anterior, atual e próximo

  offsets.forEach((offset) => {
    const targetDate  = new Date(currentDate.getFullYear(), currentDate.getMonth() + offset, 1);
    const year        = targetDate.getFullYear();
    const month       = targetDate.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate(); // último dia do mês
    const firstDay    = new Date(year, month, 1).getDay();       // dia da semana do 1º dia

    const block = document.createElement('div');
    block.className = 'batch-month-block';
    // O mês atual recebe um id para que possamos fazer scroll até ele ao abrir o modal
    if (offset === 0) block.id = 'batch-current-month';

    // Cabeçalho do bloco com o nome do mês
    const title = document.createElement('h3');
    title.textContent       = `${mNames[month]} ${year}`;
    title.style.textAlign   = 'center';
    title.style.fontSize    = '0.9rem';
    title.style.marginBottom = '8px';
    title.style.color       = offset === 0 ? 'var(--text-primary)' : 'var(--text-secondary)';
    block.appendChild(title);

    // Grade de 7 colunas (dom–sáb)
    const grid = document.createElement('div');
    grid.className               = 'batch-calendar-grid';
    grid.style.display           = 'grid';
    grid.style.gridTemplateColumns = 'repeat(7, 1fr)';
    grid.style.gap               = '6px';
    grid.style.background        = 'rgba(0,0,0,.2)';
    grid.style.padding           = '12px';
    grid.style.borderRadius      = 'var(--radius-sm)';
    grid.style.border            = '1px solid var(--border-light)';

    // Linha de cabeçalho com os dias da semana
    const daysOfWeek = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
    daysOfWeek.forEach((d) => {
      const el = document.createElement('div');
      el.className   = 'batch-day-header';
      el.textContent = d;
      grid.appendChild(el);
    });

    // Células vazias para alinhar o primeiro dia ao dia da semana correto
    for (let i = 0; i < firstDay; i++) {
      grid.appendChild(document.createElement('div'));
    }

    // Botões de dia — clicáveis para seleção/deselecção
    for (let d = 1; d <= daysInMonth; d++) {
      const el = document.createElement('button');
      el.className   = 'batch-day';
      el.textContent = d;
      el.type        = 'button';

      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

      // Marca como selecionado se já estava no conjunto (ao re-renderizar)
      if (batchSelectedDays.has(dateStr)) el.classList.add('selected');

      el.addEventListener('click', () => {
        if (batchSelectedDays.has(dateStr)) {
          batchSelectedDays.delete(dateStr);
          el.classList.remove('selected');
        } else {
          batchSelectedDays.add(dateStr);
          el.classList.add('selected');
        }
        // Atualiza o contador no botão de salvar
        btnBatchSave.textContent = `Criar Registros (${batchSelectedDays.size})`;
      });

      grid.appendChild(el);
    }

    block.appendChild(grid);
    batchCalendar.appendChild(block);
  });
}

// Abre o modal de criação em lote e rola o calendário até o mês atual
document.getElementById('btn-batch').addEventListener('click', () => {
  batchSelectedDays.clear();
  btnBatchSave.textContent = 'Criar Registros (0)';
  batchForm.reset();

  renderBatchCalendar();
  batchOverlay.classList.remove('hidden');
  document.getElementById('batch-discriminacao').focus();

  // Aguarda o DOM renderizar antes de calcular a posição de scroll
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

/**
 * Envia uma requisição POST para cada dia selecionado no calendário,
 * criando registros com o mesmo nome, tipo e valor previsto.
 * As requisições são disparadas em paralelo com Promise.all.
 */
batchForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  if (batchSelectedDays.size === 0) {
    alert('Selecione ao menos um dia no calendário.');
    return;
  }

  const discriminacao = document.getElementById('batch-discriminacao').value.trim();
  const tipo          = document.getElementById('batch-tipo').value;
  const previsto      = document.getElementById('batch-previsto').value;
  const maxOrdem      = transactions.length ? Math.max(...transactions.map((t) => t.ordem)) + 1 : 1;
  const targetAnoMes  = anoMes(); // mês exibido no dashboard no momento da criação

  btnBatchSave.disabled     = true;
  btnBatchSave.textContent  = 'Criando...';

  try {
    const promises = Array.from(batchSelectedDays).map((dateStr, ix) => {
      const payload = {
        discriminacao,
        tipo,
        previsto:       previsto ? Number(previsto) : null,
        efetivo:        null,   // efetivo sempre começa vazio
        vencimento:     dateStr,
        data_pagamento: null,
        ano_mes:        targetAnoMes,
        ordem:          maxOrdem + ix,
      };
      return apiFetch(`${API_BASE}/api/transactions`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
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


/* ── Modal de confirmação de exclusão ────────────────────────────── */

function openDeleteModal(id) {
  deleteTargetId = id;
  delOverlay.classList.remove('hidden');
}

function closeDeleteModal() {
  delOverlay.classList.add('hidden');
  deleteTargetId = null;
}

document.getElementById('del-close').addEventListener('click', closeDeleteModal);
document.getElementById('del-cancel').addEventListener('click', closeDeleteModal);
// Fecha ao clicar fora do painel de confirmação
delOverlay.addEventListener('click', (e) => { if (e.target === delOverlay) closeDeleteModal(); });

// Executa a exclusão após confirmação do usuário
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


/* ── Popover de data de pagamento ────────────────────────────────── */

/**
 * Abre o popover de informação de data de pagamento ancorado no badge de status.
 * Pré-preenche com a data existente (se AGEN) ou com o vencimento como sugestão.
 * Posiciona abaixo do elemento âncora, com ajuste para não sair da viewport.
 */
function openPayPopover(id, anchorEl) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx) return;

  payTargetId = id;

  // Pré-preenche: data de pagamento existente ou vencimento como sugestão
  payDateInput.value = tx.data_pagamento
    ? tx.data_pagamento.split('T')[0]
    : (tx.vencimento ? tx.vencimento.split('T')[0] : '');

  // Torna o popover visível antes de medir seu tamanho (necessário para offsetWidth/Height)
  payPopover.classList.remove('hidden');

  const rect    = anchorEl.getBoundingClientRect();
  const pWidth  = payPopover.offsetWidth  || 240;
  const pHeight = payPopover.offsetHeight || 130;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let top  = rect.bottom + 8;
  let left = rect.left;

  // Evita que o popover ultrapasse a borda direita ou inferior da tela
  if (left + pWidth  > vw - 8) left = vw - pWidth - 8;
  if (top  + pHeight > vh - 8) top  = rect.top - pHeight - 8; // vira para cima

  payPopover.style.top  = `${top}px`;
  payPopover.style.left = `${left}px`;

  // Re-dispara a animação de entrada toda vez que o popover é aberto
  payPopover.style.animation = 'none';
  requestAnimationFrame(() => { payPopover.style.animation = ''; });

  payDateInput.focus();
}

function closePayPopover() {
  payPopover.classList.add('hidden');
  payTargetId = null;
}

// Confirma e salva a data de pagamento informada
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

// Remove a data de pagamento (desfaz o agendamento ou marcação de OK)
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

// Fecha o popover ao clicar fora dele
document.addEventListener('click', (e) => {
  if (!payPopover.classList.contains('hidden') && !payPopover.contains(e.target)) {
    closePayPopover();
  }
});

// Fecha qualquer popover/modal aberto ao pressionar Escape
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    closePayPopover();
    if (typeof closeEfetivoPopover === 'function') closeEfetivoPopover();
    closeModal();
    closeDeleteModal();
  }
});


/* ── Popover de valor efetivo ────────────────────────────────────── */

// ID da transação cujo efetivo está sendo editado via popover
let efetivoTargetId = null;

/**
 * Abre o popover de edição do valor efetivo ao clicar na célula da coluna EFETIVO.
 * Pré-preenche com o efetivo atual ou, se ainda não informado, com o previsto.
 * Registros especiais (is_special) não abrem este popover.
 */
function openEfetivoPopover(id, anchorEl) {
  const tx = transactions.find((t) => t.id === id);
  if (!tx || tx.is_special) return;

  efetivoTargetId = id;
  const popover = document.getElementById('efetivo-popover');
  const input   = document.getElementById('efetivo-val-input');

  // Usa o efetivo existente como valor inicial; se vazio, usa o previsto como sugestão
  input.value = tx.efetivo != null ? tx.efetivo : (tx.previsto != null ? tx.previsto : '');

  popover.classList.remove('hidden');

  const rect    = anchorEl.getBoundingClientRect();
  const pWidth  = popover.offsetWidth  || 240;
  const pHeight = popover.offsetHeight || 130;
  const vw      = window.innerWidth;
  const vh      = window.innerHeight;

  let top  = rect.bottom + 8;
  let left = rect.left;
  if (left + pWidth  > vw - 8) left = vw - pWidth - 8;
  if (top  + pHeight > vh - 8) top  = rect.top - pHeight - 8;

  popover.style.top       = `${top}px`;
  popover.style.left      = `${left}px`;
  popover.style.animation = 'none';
  requestAnimationFrame(() => { popover.style.animation = ''; });

  input.focus();
}

function closeEfetivoPopover() {
  const popover = document.getElementById('efetivo-popover');
  if (popover) popover.classList.add('hidden');
  efetivoTargetId = null;
}

// Salva o valor efetivo informado
document.getElementById('efetivo-confirm-btn')?.addEventListener('click', async () => {
  if (!efetivoTargetId) return;
  const input = document.getElementById('efetivo-val-input');
  const val   = input.value ? Number(input.value) : null;
  try {
    await patchTx(efetivoTargetId, { efetivo: val });
    closeEfetivoPopover();
    await loadTransactions();
  } catch (err) {
    alert(`Erro ao salvar: ${err.message}`);
  }
});

// Remove o valor efetivo (volta a exibir apenas o previsto)
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

// Fecha o popover ao clicar fora dele
document.addEventListener('click', (e) => {
  const popover = document.getElementById('efetivo-popover');
  if (popover && !popover.classList.contains('hidden') && !popover.contains(e.target)) {
    closeEfetivoPopover();
  }
});


/* ── Inicialização da aplicação ──────────────────────────────────── */

// Registrado em window para que auth.js possa chamar após autenticação bem-sucedida
window.onAuthSuccess = initApp;

/**
 * Ponto de entrada da aplicação.
 * Consulta o backend pelo mês padrão configurado pelo usuário nas preferências;
 * se encontrado, define currentDate antes de carregar as transações.
 */
async function initApp() {
  try {
    const res = await apiFetch(`${API_BASE}/api/default-month`);
    if (res.ok) {
      const { default_month } = await res.json();
      if (default_month) {
        const [y, m] = default_month.split('-');
        currentDate  = new Date(Number(y), Number(m) - 1, 1);
      }
    }
  } catch (err) {
    // Falha não-crítica: continua com o mês atual da máquina do usuário
    console.warn("Não foi possível obter o mês padrão:", err);
  }
  loadTransactions();
}

// checkAuth (definido em auth.js) verifica a sessão e, se autenticado,
// chama window.onAuthSuccess — que já está apontado para initApp acima.
// NÃO chamar initApp() aqui diretamente pois causaria double-fetch:
// auth.js já invoca onAuthSuccess internamente após validar o token.
checkAuth();

/* =========================================================================
   SOPA — Campanhas de e-mail: lê a planilha de campanhas direto do Google
   Sheets (aba exportada como CSV) e monta o painel de desempenho.
   A planilha precisa estar compartilhada como "Qualquer pessoa com o link
   pode ver" — o site é estático e lê a planilha sem login.
   ========================================================================= */

const SHEET_ID = "10EooVlcqVPc9k2TWuqZnKk3cli3NcQLDXWywvLFMoeY";
const SHEET_GID = "1473637621";
const SHEET_URL = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`;
// export = valores exatamente como aparecem na planilha; gviz é o plano B
const SHEET_CSV_URLS = [
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${SHEET_GID}`,
  `https://docs.google.com/spreadsheets/d/${SHEET_ID}/gviz/tq?tqx=out:csv&headers=1&gid=${SHEET_GID}`,
];
const REFRESH_MS = 2 * 60 * 1000;

const CAMP_PAGE_SIZE = 25;
const CAMP_TOP_MIN_DELIVERED = 100;
const DAY_MS = 86400000;

// campo interno → rótulo da coluna no CSV (comparado sem acento/maiúsculas)
const CAMP_COLUMNS = {
  name: "Nome da Campanha",
  sender: "Enviado por",
  sector: "Setor",
  sentAt: "Data de Envio",
  subject: "Assunto",
  sent: "Enviado para",
  hardBounces: "Salto brusco",
  softBounces: "Salto suave",
  delivered: "Entregue",
  opens: "Aberturas",
  mppOpens: "Apple MPP Opens",
  clicks: "Clicados",
  unsubscribes: "Cancelados",
  complaints: "Reclamações",
};
const CAMP_REQUIRED = ["name", "sentAt", "sent", "delivered", "opens", "clicks"];

// agrupa campanhas recorrentes pelo nome — a primeira regra que casar vence,
// então as mais específicas vêm antes. Edite aqui para criar novas séries.
const SERIES_RULES = [
  [/^(uploading.*conselheiros|ed\.?\s*\d+.*conselheiros)/i, "Uploading — Conselheiros"],
  [/^uploading\s*(-\s*)?(school|cs\b)/i, "Uploading School"],
  [/^uploading/i, "Uploading"],
  [/^giro/i, "#GiroPeloCESAR"],
  [/^cesar\s*life/i, "CESAR Life"],
  [/^cesar[\s_]*zoom/i, "CESAR Zoom"],
  [/cesar\s*beat/i, "CESAR BEAT"],
  [/meet\s*up/i, "MeetUps"],
  [/^hey[\s_]*ia/i, "Hey IA"],
  [/^#?ai native/i, "#AI Native"],
  [/talk to leaders|^ttl/i, "Talk to Leaders"],
  [/^conversa bp/i, "Conversa com o BP"],
  [/^leap/i, "LEAP"],
  [/aniversariantes|presentes de anivers|^aniversários/i, "Aniversariantes"],
  [/cesta natalidade/i, "Cesta Natalidade"],
  [/rematr[ií]cula/i, "Rematrícula School"],
  [/risoflora/i, "Risoflora"],
  [/vem[\s_]*curtir/i, "Vem Curtir o CESAR"],
  [/ciclo de performance/i, "Ciclo de Performance"],
  [/pesquisa/i, "Pesquisas"],
];
const SERIES_FALLBACK = "Outras campanhas";

const WEEKDAYS = [
  { day: 1, label: "seg" }, { day: 2, label: "ter" }, { day: 3, label: "qua" },
  { day: 4, label: "qui" }, { day: 5, label: "sex" }, { day: 6, label: "sáb" }, { day: 0, label: "dom" },
];

const HOUR_BUCKETS = [
  { label: "até 9h", test: (h) => h < 9 },
  { label: "9–11h", test: (h) => h >= 9 && h < 11 },
  { label: "11–13h", test: (h) => h >= 11 && h < 13 },
  { label: "13–15h", test: (h) => h >= 13 && h < 15 },
  { label: "15–17h", test: (h) => h >= 15 && h < 17 },
  { label: "17h+", test: (h) => h >= 17 },
];

const MONTHS_SHORT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/* --- formatação --- */
const NF_INT = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 0 });
const NF_COMPACT = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 });
const NF_DEC1 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const NF_DEC2 = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function fmtInt(n) { return NF_INT.format(n); }
function fmtPct(ratioValue) { return NF_DEC1.format(ratioValue * 100) + "%"; }
function fmtPctPoints(pctValue) { return NF_DEC1.format(pctValue) + "%"; }
function fmtDateTime(d) {
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${String(d.getFullYear()).slice(2)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function fmtDate(d) { return d.toLocaleDateString("pt-BR"); }
function plural(n, one, many) { return n === 1 ? one : many; }

function campEscape(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function truncate(str, max) {
  return str.length > max ? str.slice(0, max - 1).trimEnd() + "…" : str;
}

function normalizeText(str) {
  return String(str ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}

/* =========================================================================
   Leitura do CSV
   ========================================================================= */

async function fetchSheetCSV() {
  let lastError;
  for (const url of SHEET_CSV_URLS) {
    try {
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      // planilha privada: o Google devolve a página de login (HTML), não CSV
      if (/^\s*<(!doctype|html)/i.test(text)) throw new Error("resposta em HTML — a planilha não está pública");
      return text;
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
}

function detectDelimiter(text) {
  const end = text.search(/\r?\n/);
  const firstLine = end === -1 ? text : text.slice(0, end);
  return (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ";" : ",";
}

// RFC 4180: aspas, "" escapado e quebras de linha dentro de campos (os
// assuntos do modelo têm quebras de linha)
function parseCSV(text) {
  text = text.replace(/^﻿/, "");
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function parseCount(value) {
  const s = String(value ?? "").trim().replace(/\s/g, "").replace("%", "");
  if (!s) return 0;
  // "9.539" (milhar pt-BR, comum quando o arquivo passa pelo Excel) → 9539
  const clean = /^-?\d{1,3}(\.\d{3})+$/.test(s) ? s.replace(/\./g, "") : s.replace(",", ".");
  const n = Number(clean);
  return Number.isFinite(n) ? n : 0;
}

function parseSentAt(value) {
  const s = String(value ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  return null;
}

// No modelo exportado, o rótulo "Taxa de Entrega" aparece logo após
// "Entregue", mas o valor correspondente vem depois de "Taxa de
// Cancelamento" — todas as colunas do meio ficam deslocadas uma posição.
// Detecta pelo conteúdo (a coluna rotulada como taxa não tem "%") e
// recoloca o rótulo onde o dado realmente está. Se a ferramenta corrigir a
// exportação, nada é alterado.
function fixShiftedDeliveryRate(header, body) {
  const label = normalizeText("Taxa de Entrega");
  const rateIdx = header.indexOf(label);
  const cancelIdx = header.indexOf(normalizeText("Taxa de Cancelamento"));
  if (rateIdx === -1 || cancelIdx === -1 || cancelIdx < rateIdx) return;
  const sample = body.slice(0, 50).map((r) => r[rateIdx] || "").filter(Boolean);
  if (!sample.length) return;
  const looksLikeRate = sample.filter((v) => v.includes("%")).length >= sample.length / 2;
  if (looksLikeRate) return;
  header.splice(rateIdx, 1);
  header.splice(cancelIdx, 0, label);
}

function seriesOf(name) {
  const rule = SERIES_RULES.find(([re]) => re.test(name));
  return rule ? rule[1] : SERIES_FALLBACK;
}

function clamp(n, min, max) { return Math.min(Math.max(n, min), max); }

// linhas ainda não classificadas trazem o e-mail do remetente no lugar do
// setor — tratadas como "não informado" ("" ) e fora do ranking de setores
function parseSector(value) {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return !s || s.includes("@") ? "" : s;
}

function campaignsFromCSV(text) {
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error("O arquivo está vazio ou não tem nenhuma linha de campanha.");

  const header = rows[0].map(normalizeText);
  const body = rows.slice(1);
  fixShiftedDeliveryRate(header, body);

  const index = {};
  Object.entries(CAMP_COLUMNS).forEach(([key, label]) => { index[key] = header.indexOf(normalizeText(label)); });
  const missing = CAMP_REQUIRED.filter((k) => index[k] === -1).map((k) => CAMP_COLUMNS[k]);
  if (missing.length) throw new Error(`Colunas não encontradas no CSV: ${missing.join(", ")}`);

  const get = (r, key) => (index[key] === -1 ? "" : r[index[key]] ?? "");
  const campaigns = [];
  let skipped = 0;

  body.forEach((r, i) => {
    const name = get(r, "name").replace(/\s+/g, " ").trim();
    const sentAt = parseSentAt(get(r, "sentAt"));
    if (!name || !sentAt) { skipped++; return; }

    const raw = {
      sent: parseCount(get(r, "sent")),
      delivered: parseCount(get(r, "delivered")),
      opens: parseCount(get(r, "opens")),
      mpp: parseCount(get(r, "mppOpens")),
      clicks: parseCount(get(r, "clicks")),
    };
    // a ferramenta às vezes exporta números impossíveis (ex.: -38 não
    // entregues, mais aberturas que entregas) — limita para as taxas
    // nunca passarem de 100% e sinaliza a linha
    const sent = Math.max(0, raw.sent);
    const delivered = clamp(raw.delivered, 0, sent);
    const opens = clamp(raw.opens, 0, delivered);

    campaigns.push({
      key: i,
      name,
      subject: get(r, "subject").replace(/\s+/g, " ").trim(),
      sender: get(r, "sender").trim(),
      sector: parseSector(get(r, "sector")),
      sentAt,
      series: seriesOf(name),
      isTest: /\bteste\b/i.test(name),
      sent,
      delivered,
      bounced: sent - delivered,
      hardBounces: Math.max(0, parseCount(get(r, "hardBounces"))),
      softBounces: Math.max(0, parseCount(get(r, "softBounces"))),
      opens,
      mpp: clamp(raw.mpp, 0, opens),
      clicks: clamp(raw.clicks, 0, delivered),
      unsubscribes: Math.max(0, parseCount(get(r, "unsubscribes"))),
      complaints: Math.max(0, parseCount(get(r, "complaints"))),
      inconsistent: raw.delivered > raw.sent || raw.opens > raw.delivered || raw.clicks > raw.delivered || raw.sent < 0,
    });
  });

  if (!campaigns.length) throw new Error("Nenhuma campanha válida encontrada (verifique as colunas de nome e data de envio).");
  return { campaigns, skipped };
}

/* =========================================================================
   Métricas — sempre ponderadas pelo volume (soma das contagens ÷ soma da
   base), para um envio de 1 pessoa não pesar igual a um de 9 mil
   ========================================================================= */

function ratio(a, b) { return b > 0 ? a / b : 0; }

function aggregate(list, { excludeMpp = false } = {}) {
  const t = { n: list.length, sent: 0, delivered: 0, bounced: 0, hardBounces: 0, softBounces: 0, opens: 0, mpp: 0, clicks: 0, unsubscribes: 0, complaints: 0 };
  list.forEach((c) => {
    t.sent += c.sent;
    t.delivered += c.delivered;
    t.bounced += c.bounced;
    t.hardBounces += c.hardBounces;
    t.softBounces += c.softBounces;
    t.opens += c.opens;
    t.mpp += c.mpp;
    t.clicks += c.clicks;
    t.unsubscribes += c.unsubscribes;
    t.complaints += c.complaints;
  });
  t.openBase = excludeMpp ? t.opens - t.mpp : t.opens;
  t.deliveryRate = ratio(t.delivered, t.sent);
  t.bounceRate = ratio(t.bounced, t.sent);
  t.openRate = ratio(t.openBase, t.delivered);
  t.clickRate = ratio(t.clicks, t.delivered);
  t.ctor = Math.min(1, ratio(t.clicks, t.openBase));
  t.unsubRate = ratio(t.unsubscribes, t.delivered);
  t.mppShare = ratio(t.mpp, t.opens);
  return t;
}

// últimos 30 dias vs. 30 dias anteriores, contados a partir do envio mais
// recente do recorte (não de hoje — o arquivo pode ser antigo)
function periodTrend(list, opts, pick) {
  const ref = Math.max(...list.map((c) => c.sentAt.getTime()));
  const last = list.filter((c) => c.sentAt.getTime() > ref - 30 * DAY_MS);
  const prev = list.filter((c) => {
    const t = c.sentAt.getTime();
    return t > ref - 60 * DAY_MS && t <= ref - 30 * DAY_MS;
  });
  const a = aggregate(last, opts);
  const b = aggregate(prev, opts);
  if (!a.delivered || !b.delivered) return {};
  const delta = (pick(a) - pick(b)) * 100;
  return {
    trend: delta >= 0.05 ? "up" : delta <= -0.05 ? "down" : "flat",
    trendLabel: `${delta > 0 ? "+" : ""}${NF_DEC1.format(delta)} p.p.`,
    trendTitle: "Últimos 30 dias vs. 30 dias anteriores",
  };
}

function groupBy(list, keyFn) {
  const map = new Map();
  list.forEach((c) => {
    const k = keyFn(c);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(c);
  });
  return map;
}

function monthGroups(list) {
  const map = groupBy(list, (c) => `${c.sentAt.getFullYear()}-${String(c.sentAt.getMonth() + 1).padStart(2, "0")}`);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, items]) => {
      const [y, m] = key.split("-");
      return { key, label: `${MONTHS_SHORT[+m - 1]}/${y.slice(2)}`, items };
    });
}

/* =========================================================================
   Página
   ========================================================================= */

function defaultFilters() {
  return { search: "", series: "", sender: "", from: "", to: "", minSent: 0, hideTests: true, excludeMpp: false };
}

const Campaigns = {
  all: [],
  loadedAt: null,
  loadError: null,
  loading: false,
  filters: defaultFilters(),
  sort: { key: "sentAt", dir: "desc" },
  visibleRows: CAMP_PAGE_SIZE,

  init() {
    document.getElementById("camp-sheet-link").href = SHEET_URL;
    this.wireTheme();
    this.wireRefresh();
    this.wireFilters();
    this.wireTables();
    window.addEventListener("resize", debounce(() => this.render(), 200));
    this.render();
    this.load();
  },

  wireTheme() {
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("sopa.theme", next); } catch {}
      // os gráficos usam variáveis CSS e já acompanham o tema sozinhos
    });
  },

  wireRefresh() {
    document.getElementById("btn-refresh").addEventListener("click", () => this.load({ manual: true }));
    document.getElementById("btn-retry").addEventListener("click", () => this.load({ manual: true }));

    // "tempo real": relê a planilha periodicamente enquanto a aba está
    // visível, e na hora em que a pessoa volta para a aba
    setInterval(() => {
      if (!document.hidden) this.load();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden && this.loadedAt && Date.now() - this.loadedAt.getTime() > 60 * 1000) this.load();
    });
  },

  async load({ manual = false } = {}) {
    if (this.loading) return;
    this.loading = true;
    this.renderLoading();

    try {
      const { campaigns } = campaignsFromCSV(await fetchSheetCSV());
      const isFirstLoad = this.all.length === 0;
      this.all = campaigns;
      this.loadedAt = new Date();
      this.loadError = null;
      if (isFirstLoad) this.resetFilters();
      else this.populateFilterOptions();
      if (manual) showToast(`${fmtInt(campaigns.length)} campanhas atualizadas`);
    } catch (err) {
      console.error("Falha ao ler a planilha de campanhas:", err);
      this.loadError = err;
      // se já havia dados, continua mostrando a última leitura boa
      if (manual && this.all.length) showToast("Não foi possível atualizar — mostrando a última leitura", 3500);
    } finally {
      this.loading = false;
      this.renderLoading();
      this.render();
    }
  },

  renderLoading() {
    const btn = document.getElementById("btn-refresh");
    btn.disabled = this.loading;
    document.getElementById("btn-refresh-label").textContent = this.loading ? "Atualizando…" : "Atualizar";
  },

  /* --- filtros --- */

  wireFilters() {
    const on = (id, evt, fn) => document.getElementById(id).addEventListener(evt, fn);
    on("f-search", "input", debounce((e) => this.setFilter("search", e.target.value), 150));
    on("f-series", "change", (e) => this.setFilter("series", e.target.value));
    on("f-sender", "change", (e) => this.setFilter("sender", e.target.value));
    on("f-from", "change", (e) => this.setFilter("from", e.target.value));
    on("f-to", "change", (e) => this.setFilter("to", e.target.value));
    on("f-min-sent", "change", (e) => this.setFilter("minSent", Number(e.target.value)));
    on("f-hide-tests", "change", (e) => this.setFilter("hideTests", e.target.checked));
    on("f-exclude-mpp", "change", (e) => this.setFilter("excludeMpp", e.target.checked));
    on("btn-reset-filters", "click", () => {
      this.resetFilters();
      this.render();
    });
  },

  setFilter(key, value) {
    this.filters[key] = value;
    this.visibleRows = CAMP_PAGE_SIZE;
    this.render();
  },

  // (re)monta as opções a partir dos dados atuais, preservando a seleção —
  // chamado a cada atualização automática da planilha
  populateFilterOptions() {
    const seriesSel = document.getElementById("f-series");
    const seriesCounts = [...groupBy(this.all, (c) => c.series).entries()].sort((a, b) => b[1].length - a[1].length);
    seriesSel.innerHTML = `<option value="">Todas</option>` +
      seriesCounts.map(([s, items]) => `<option value="${campEscape(s)}">${campEscape(s)} (${items.length})</option>`).join("");
    seriesSel.value = this.filters.series;
    this.filters.series = seriesSel.value; // a série pode ter sumido da planilha

    const senderSel = document.getElementById("f-sender");
    const senders = [...new Set(this.all.map((c) => c.sender).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
    document.getElementById("f-sender-field").hidden = senders.length < 2;
    senderSel.innerHTML = `<option value="">Todos</option>` +
      senders.map((s) => `<option value="${campEscape(s)}">${campEscape(s)}</option>`).join("");
    senderSel.value = this.filters.sender;
    this.filters.sender = senderSel.value;

    const toInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const times = this.all.map((c) => c.sentAt.getTime());
    ["f-from", "f-to"].forEach((id) => {
      const el = document.getElementById(id);
      el.min = times.length ? toInput(new Date(Math.min(...times))) : "";
      el.max = times.length ? toInput(new Date(Math.max(...times))) : "";
    });
  },

  resetFilters() {
    this.filters = defaultFilters();
    this.visibleRows = CAMP_PAGE_SIZE;
    this.populateFilterOptions();

    document.getElementById("f-search").value = "";
    document.getElementById("f-series").value = "";
    document.getElementById("f-sender").value = "";
    document.getElementById("f-from").value = "";
    document.getElementById("f-to").value = "";
    document.getElementById("f-min-sent").value = "0";
    document.getElementById("f-hide-tests").checked = true;
    document.getElementById("f-exclude-mpp").checked = false;
  },

  applyFilters(list) {
    const f = this.filters;
    const q = normalizeText(f.search);
    const from = f.from ? new Date(f.from + "T00:00:00") : null;
    const to = f.to ? new Date(f.to + "T23:59:59") : null;
    return list.filter((c) => {
      if (f.hideTests && c.isTest) return false;
      if (f.series && c.series !== f.series) return false;
      if (f.sender && c.sender !== f.sender) return false;
      if (from && c.sentAt < from) return false;
      if (to && c.sentAt > to) return false;
      if (c.sent < f.minSent) return false;
      if (q && !normalizeText(c.name).includes(q) && !normalizeText(c.subject).includes(q)) return false;
      return true;
    });
  },

  /* --- render --- */

  render() {
    const hasData = this.all.length > 0;
    document.getElementById("camp-empty").hidden = hasData;
    document.getElementById("camp-content").hidden = !hasData;

    const sourceText = document.getElementById("camp-source-text");
    if (this.loadedAt) {
      const time = this.loadedAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      sourceText.textContent = this.loadError
        ? `Google Sheets · falha ao atualizar; dados de ${time}`
        : `Google Sheets · atualizado às ${time}`;
    } else {
      sourceText.textContent = "Google Sheets";
    }

    const summary = document.getElementById("camp-summary");
    if (!hasData) {
      const failed = Boolean(this.loadError) && !this.loading;
      document.querySelector(".camp-status").classList.toggle("is-error", failed);
      document.getElementById("btn-retry").hidden = !failed;
      document.getElementById("camp-status-title").textContent = failed
        ? "Não foi possível ler a planilha"
        : "Carregando dados da planilha…";
      document.getElementById("camp-status-text").textContent = failed
        ? "Confira se a planilha está compartilhada como “Qualquer pessoa com o link pode ver” e se a aba de campanhas não mudou de lugar."
        : "Os números são lidos direto do Google Sheets.";
      summary.textContent = failed ? "Sem dados no momento." : "Carregando dados da planilha de campanhas…";
      return;
    }

    const list = this.applyFilters(this.all);
    const empty = list.length === 0;
    document.getElementById("camp-noresults").hidden = !empty;
    document.getElementById("metric-grid").hidden = empty;
    document.getElementById("camp-charts").hidden = empty;
    document.getElementById("camp-result-bar").innerHTML =
      `<strong>${fmtInt(list.length)}</strong> de ${fmtInt(this.all.length)} campanhas no recorte`;
    if (empty) {
      summary.textContent = "Nenhuma campanha no recorte atual.";
      return;
    }

    const opts = { excludeMpp: this.filters.excludeMpp };
    const total = aggregate(list, opts);
    this.renderSummary(list, total);
    this.renderMetrics(list, total, opts);
    this.renderMonthly(list, opts);
    this.renderFunnel(list, total, opts);
    this.renderWeekday(list, opts);
    this.renderHour(list, opts);
    this.renderSectors(list, opts);
    this.renderTopClicks(list, opts);
    this.renderSeries(list, opts);
    this.renderAlerts(list, opts);
    this.renderTable(list, opts);
  },

  renderSummary(list, total) {
    const times = list.map((c) => c.sentAt.getTime());
    const first = new Date(Math.min(...times));
    const last = new Date(Math.max(...times));
    document.getElementById("camp-summary").textContent =
      `${fmtInt(total.n)} ${plural(total.n, "campanha", "campanhas")} entre ${fmtDate(first)} e ${fmtDate(last)}: ` +
      `${fmtInt(total.sent)} e-mails enviados, abertura média de ${fmtPct(total.openRate)} ` +
      `e cliques em ${fmtPct(total.clickRate)} dos e-mails entregues.`;
  },

  renderMetrics(list, total, opts) {
    const pctValue = (r) => NF_DEC1.format(r * 100);
    const tiles = [
      { value: fmtInt(total.n), label: "Campanhas enviadas" },
      { value: fmtInt(total.sent), label: "E-mails enviados" },
      { value: pctValue(total.deliveryRate), unit: "%", label: "Taxa de entrega" },
      {
        value: pctValue(total.openRate), unit: "%",
        label: opts.excludeMpp ? "Taxa de abertura (sem Apple MPP)" : "Taxa de abertura",
        ...periodTrend(list, opts, (a) => a.openRate),
      },
      { value: pctValue(total.clickRate), unit: "%", label: "Taxa de cliques", ...periodTrend(list, opts, (a) => a.clickRate) },
      { value: pctValue(total.ctor), unit: "%", label: "Cliques por abertura (CTOR)" },
      { value: pctValue(total.bounceRate), unit: "%", label: "Taxa de bounce", alert: total.bounceRate >= 0.02 },
      { value: fmtInt(total.unsubscribes), label: `Descadastros (${NF_DEC2.format(total.unsubRate * 100)}% dos entregues)` },
      { value: fmtInt(total.complaints), label: "Reclamações de spam", alert: total.complaints > 0 },
      { value: pctValue(total.mppShare), unit: "%", label: "Aberturas automáticas (Apple MPP)" },
    ];

    document.getElementById("metric-grid").innerHTML = tiles.map((t) => `
      <div class="metric-tile ${t.alert ? "is-alert" : ""}">
        <div class="metric-value-row">
          <span class="metric-value">${t.value}</span>
          ${t.unit ? `<span class="metric-unit">${t.unit}</span>` : ""}
          ${t.trend ? `<span class="metric-trend is-${t.trend}" title="${t.trendTitle}">${t.trend === "up" ? "▲" : t.trend === "down" ? "▼" : "—"} ${t.trendLabel}</span>` : ""}
        </div>
        <div class="metric-label">${t.label}</div>
      </div>
    `).join("");
  },

  renderMonthly(list, opts) {
    const months = monthGroups(list).map((m) => ({ ...m, agg: aggregate(m.items, opts) }));
    const campaignsLabel = (n) => `${n} ${plural(n, "campanha", "campanhas")}`;

    const volumeEl = document.getElementById("chart-volume");
    barChartVertical(volumeEl, months.map((m) => ({
      label: m.label,
      value: m.agg.n,
      tooltipValue: `${campaignsLabel(m.agg.n)} · ${fmtInt(m.agg.sent)} destinatários`,
    })), { formatValue: fmtInt });
    // com muitos meses o gráfico rola na horizontal — começa mostrando os mais recentes
    volumeEl.scrollLeft = volumeEl.scrollWidth;
    const peak = months.reduce((a, b) => (b.agg.n > a.agg.n ? b : a));
    setNote("panel-volume", `${peak.label} teve o maior número de envios do período: ${campaignsLabel(peak.agg.n)}, para ${fmtInt(peak.agg.sent)} destinatários.`);

    const rateSeries = (pick) => months.map((m) => ({
      label: m.label,
      value: Math.round(pick(m.agg) * 1000) / 10,
      tooltipValue: `${fmtPct(pick(m.agg))} · ${campaignsLabel(m.agg.n)}`,
    }));
    const bestOf = (pick) => months.reduce((a, b) => (pick(b.agg) > pick(a.agg) ? b : a));

    lineChart(document.getElementById("chart-open"), rateSeries((a) => a.openRate), { formatValue: fmtPctPoints });
    const bestOpen = bestOf((a) => a.openRate);
    setNote("panel-open", `Melhor mês: ${bestOpen.label}, com ${fmtPct(bestOpen.agg.openRate)} de abertura.`);

    lineChart(document.getElementById("chart-click"), rateSeries((a) => a.clickRate), { formatValue: fmtPctPoints });
    const bestClick = bestOf((a) => a.clickRate);
    setNote("panel-click", `Melhor mês: ${bestClick.label}, com ${fmtPct(bestClick.agg.clickRate)} de cliques.`);
  },

  // mesma lógica do volume mensal: conta campanhas (envios) por setor
  renderSectors(list, opts) {
    const container = document.getElementById("chart-sectors");
    // agrupa sem diferenciar maiúsculas/acentos ("TI" = "ti"), exibindo a grafia mais frequente
    const groups = groupBy(list.filter((c) => c.sector), (c) => normalizeText(c.sector));
    const ranked = [...groups.values()]
      .map((items) => {
        const spellings = groupBy(items, (c) => c.sector);
        const label = [...spellings.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
        return { label, agg: aggregate(items, opts) };
      })
      .sort((a, b) => b.agg.n - a.agg.n || b.agg.sent - a.agg.sent)
      .slice(0, 10);
    const unassigned = list.filter((c) => !c.sector).length;
    const unassignedNote = unassigned
      ? ` ${fmtInt(unassigned)} ${plural(unassigned, "campanha está", "campanhas estão")} sem setor na planilha e não ${plural(unassigned, "entra", "entram")} no ranking.`
      : "";

    if (!ranked.length) {
      container.innerHTML = `<p class="empty-note">Nenhuma campanha com setor preenchido no recorte.</p>`;
      setNote("panel-sectors", unassignedNote.trim());
      return;
    }

    const campaignsLabel = (n) => `${fmtInt(n)} ${plural(n, "campanha", "campanhas")}`;
    barChartHorizontal(container, ranked.map(({ label, agg }) => ({
      label: truncate(label, 18),
      fullLabel: campEscape(label),
      value: agg.n,
      tooltipValue: `${campaignsLabel(agg.n)} · ${fmtInt(agg.sent)} destinatários · ${fmtPct(agg.openRate)} de abertura`,
    })), { formatValue: fmtInt, barHeight: 18, gap: 8 });

    const top = ranked[0];
    const share = ratio(top.agg.n, list.length - unassigned);
    setNote("panel-sectors", `${top.label} lidera com ${campaignsLabel(top.agg.n)} (${fmtPct(share)} das campanhas com setor).${unassignedNote}`);
  },

  // mesma lógica do volume mensal: conta campanhas (envios), não destinatários —
  // cada etapa é o número de campanhas que teve ao menos uma entrega/abertura/clique
  renderFunnel(list, total, opts) {
    const opensOf = (c) => (opts.excludeMpp ? c.opens - c.mpp : c.opens);
    const steps = [
      { label: "Enviadas", value: list.length, people: total.sent, peopleLabel: "destinatários" },
      { label: "Com entregas", value: list.filter((c) => c.delivered > 0).length, people: total.delivered, peopleLabel: "e-mails entregues" },
      { label: opts.excludeMpp ? "Com aberturas (s/ MPP)" : "Com aberturas", value: list.filter((c) => opensOf(c) > 0).length, people: total.openBase, peopleLabel: "aberturas" },
      { label: "Com cliques", value: list.filter((c) => c.clicks > 0).length, people: total.clicks, peopleLabel: "cliques" },
    ];
    const el = document.getElementById("chart-funnel");
    barChartHorizontal(el, steps.map((s) => ({
      label: s.label,
      value: s.value,
      tooltipValue: `${fmtInt(s.value)} ${plural(s.value, "campanha", "campanhas")} · ${fmtPct(ratio(s.value, list.length))} das enviadas · ${fmtInt(s.people)} ${s.peopleLabel}`,
    })), { formatValue: fmtInt, labelWidth: opts.excludeMpp ? 170 : 120, padRight: 60 });

    const withClicks = steps[3].value;
    const noClicks = list.length - withClicks;
    let note = `Das ${fmtInt(list.length)} campanhas, ${fmtInt(withClicks)} (${fmtPct(ratio(withClicks, list.length))}) tiveram ao menos um clique`;
    note += noClicks > 0 ? `; ${fmtInt(noClicks)} não ${plural(noClicks, "teve", "tiveram")} nenhum.` : ".";
    if (!opts.excludeMpp && total.mppShare >= 0.1) {
      note += ` ${fmtPct(total.mppShare)} das aberturas são automáticas (Apple MPP); marque “Descontar aberturas Apple MPP” para estimar a abertura real.`;
    }
    setNote("panel-funnel", note);
  },

  renderRateBuckets(panelId, chartId, buckets, list, opts, what) {
    const data = buckets.map((b) => {
      const items = list.filter(b.test);
      const agg = aggregate(items, opts);
      return {
        label: b.label,
        value: Math.round(agg.openRate * 1000) / 10,
        n: agg.n,
        delivered: agg.delivered,
        tooltipValue: `${fmtPct(agg.openRate)} de abertura · ${agg.n} ${plural(agg.n, "campanha", "campanhas")}`,
      };
    });
    barChartVertical(document.getElementById(chartId), data, { formatValue: fmtPctPoints, height: 210 });

    // só compara faixas com amostra razoável
    const eligible = data.filter((d) => d.n >= 5 && d.delivered >= 500);
    if (eligible.length >= 2) {
      const best = eligible.reduce((a, b) => (b.value > a.value ? b : a));
      setNote(panelId, `Envios ${what} ${best.label} têm a maior abertura (${fmtPctPoints(best.value)}, ${best.n} campanhas).`);
    } else {
      setNote(panelId, "Ainda não há campanhas suficientes no recorte para comparar as faixas.");
    }
  },

  renderWeekday(list, opts) {
    const buckets = WEEKDAYS.map((w) => ({ label: w.label, test: (c) => c.sentAt.getDay() === w.day }));
    this.renderRateBuckets("panel-weekday", "chart-weekday", buckets, list, opts, "de");
  },

  renderHour(list, opts) {
    const buckets = HOUR_BUCKETS.map((b) => ({ label: b.label, test: (c) => b.test(c.sentAt.getHours()) }));
    this.renderRateBuckets("panel-hour", "chart-hour", buckets, list, opts, "na faixa");
  },

  renderTopClicks(list, opts) {
    const container = document.getElementById("chart-top");
    const ranked = list
      .filter((c) => c.delivered >= CAMP_TOP_MIN_DELIVERED)
      .map((c) => ({ c, agg: aggregate([c], opts) }))
      .sort((a, b) => b.agg.clickRate - a.agg.clickRate)
      .slice(0, 10);

    if (!ranked.length) {
      container.innerHTML = `<p class="empty-note">Nenhuma campanha com ${CAMP_TOP_MIN_DELIVERED}+ e-mails entregues no recorte.</p>`;
      setNote("panel-top", "");
      return;
    }

    const labelWidth = Math.min(260, Math.round((container.clientWidth || 600) * 0.42));
    const maxChars = Math.max(14, Math.floor(labelWidth / 7));
    barChartHorizontal(container, ranked.map(({ c, agg }) => ({
      label: truncate(c.name, maxChars),
      fullLabel: `${campEscape(c.name)} · ${fmtDate(c.sentAt)}`,
      value: Math.round(agg.clickRate * 1000) / 10,
      tooltipValue: `${fmtPct(agg.clickRate)} de cliques · ${fmtInt(agg.clicks)} de ${fmtInt(agg.delivered)} entregues`,
    })), { formatValue: fmtPctPoints, labelWidth, padRight: 60, barHeight: 22, gap: 10 });

    const top = ranked[0];
    setNote("panel-top", `“${top.c.name}” lidera, com ${fmtPct(top.agg.clickRate)} dos destinatários clicando (${fmtPct(top.agg.ctor)} de quem abriu).`);
  },

  renderSeries(list, opts) {
    const rows = [...groupBy(list, (c) => c.series).entries()]
      .map(([series, items]) => ({ series, agg: aggregate(items, opts) }))
      .sort((a, b) => b.agg.sent - a.agg.sent);

    document.getElementById("table-series").innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Série</th>
            <th class="num">Campanhas</th>
            <th class="num">Enviados</th>
            <th class="num">Abertura</th>
            <th class="num">Cliques</th>
            <th class="num">CTOR</th>
            <th class="num">Bounce</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(({ series, agg }) => `
            <tr>
              <td>${campEscape(series)}</td>
              <td class="num mono">${fmtInt(agg.n)}</td>
              <td class="num mono">${fmtInt(agg.sent)}</td>
              <td class="num mono">${fmtPct(agg.openRate)}</td>
              <td class="num mono">${fmtPct(agg.clickRate)}</td>
              <td class="num mono">${fmtPct(agg.ctor)}</td>
              <td class="num mono ${agg.bounceRate >= 0.02 ? "rate-bad" : ""}">${fmtPct(agg.bounceRate)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    const comparable = rows.filter((r) => r.series !== SERIES_FALLBACK && r.agg.n >= 3 && r.agg.delivered >= 500);
    if (comparable.length >= 2) {
      const bestClick = comparable.reduce((a, b) => (b.agg.clickRate > a.agg.clickRate ? b : a));
      setNote("panel-series", `Entre as séries recorrentes, ${bestClick.series} tem a maior taxa de cliques (${fmtPct(bestClick.agg.clickRate)}).`);
    } else {
      setNote("panel-series", "");
    }
  },

  renderAlerts(list, opts) {
    const flagged = list
      .map((c) => ({ c, agg: aggregate([c], opts) }))
      .filter(({ c, agg }) => c.complaints > 0 || (c.sent >= 50 && (agg.bounceRate >= 0.02 || agg.unsubRate >= 0.005)))
      .sort((a, b) => b.c.complaints - a.c.complaints || b.agg.bounceRate - a.agg.bounceRate)
      .slice(0, 15);

    const container = document.getElementById("table-alerts");
    if (!flagged.length) {
      container.innerHTML = `<p class="empty-note">Nenhum envio com bounce alto, descadastros altos ou reclamações de spam no recorte.</p>`;
      setNote("panel-alerts", "");
      return;
    }

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>Envio</th>
            <th>Campanha</th>
            <th class="num">Enviados</th>
            <th class="num">Bounce</th>
            <th class="num">Hard / soft</th>
            <th class="num">Descadastros</th>
            <th class="num">Reclamações</th>
          </tr>
        </thead>
        <tbody>
          ${flagged.map(({ c, agg }) => `
            <tr>
              <td class="mono nowrap">${fmtDateTime(c.sentAt)}</td>
              <td>${campEscape(c.name)}</td>
              <td class="num mono">${fmtInt(c.sent)}</td>
              <td class="num mono ${agg.bounceRate >= 0.02 ? "rate-bad" : ""}">${fmtPct(agg.bounceRate)}</td>
              <td class="num mono">${fmtInt(c.hardBounces)} / ${fmtInt(c.softBounces)}</td>
              <td class="num mono ${agg.unsubRate >= 0.005 ? "rate-bad" : ""}">${fmtInt(c.unsubscribes)}</td>
              <td class="num mono ${c.complaints > 0 ? "rate-bad" : ""}">${fmtInt(c.complaints)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    const hardTotal = flagged.reduce((s, { c }) => s + c.hardBounces, 0);
    setNote("panel-alerts", hardTotal > 0
      ? `${fmtInt(hardTotal)} ${plural(hardTotal, "endereço deu", "endereços deram")} hard bounce (endereço inexistente) nesses envios — removê-los da lista protege a reputação do remetente.`
      : "Os bounces desses envios são temporários (soft bounce): caixa cheia ou servidor indisponível.");
  },

  /* --- tabela completa (ordenável e paginada) --- */

  wireTables() {
    document.getElementById("table-all").addEventListener("click", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (th) {
        const key = th.dataset.sort;
        this.sort = this.sort.key === key
          ? { key, dir: this.sort.dir === "asc" ? "desc" : "asc" }
          : { key, dir: key === "name" || key === "series" ? "asc" : "desc" };
        this.render();
        return;
      }
      if (e.target.closest("#btn-more-campaigns")) {
        this.visibleRows += CAMP_PAGE_SIZE;
        this.render();
      }
    });
    document.getElementById("table-all").addEventListener("keydown", (e) => {
      const th = e.target.closest("th[data-sort]");
      if (th && (e.key === "Enter" || e.key === " ")) {
        e.preventDefault();
        th.click();
      }
    });
  },

  renderTable(list, opts) {
    const columns = [
      { key: "sentAt", label: "Envio", get: (r) => r.c.sentAt.getTime() },
      { key: "name", label: "Campanha", get: (r) => normalizeText(r.c.name) },
      { key: "series", label: "Série", get: (r) => normalizeText(r.c.series) },
      { key: "sent", label: "Enviados", num: true, get: (r) => r.c.sent },
      { key: "deliveryRate", label: "Entrega", num: true, get: (r) => r.agg.deliveryRate },
      { key: "openRate", label: "Abertura", num: true, get: (r) => r.agg.openRate },
      { key: "clickRate", label: "Cliques", num: true, get: (r) => r.agg.clickRate },
      { key: "ctor", label: "CTOR", num: true, get: (r) => r.agg.ctor },
      { key: "bounceRate", label: "Bounce", num: true, get: (r) => r.agg.bounceRate },
      { key: "unsubscribes", label: "Descad.", num: true, get: (r) => r.c.unsubscribes },
    ];
    const col = columns.find((c) => c.key === this.sort.key) || columns[0];
    const dir = this.sort.dir === "asc" ? 1 : -1;
    const rows = list
      .map((c) => ({ c, agg: aggregate([c], opts) }))
      .sort((a, b) => {
        const va = col.get(a), vb = col.get(b);
        return (va < vb ? -1 : va > vb ? 1 : 0) * dir || b.c.sentAt - a.c.sentAt;
      });
    const visible = rows.slice(0, this.visibleRows);

    const warn = `<span class="warn-mark" title="O arquivo de origem traz números inconsistentes nesta linha (ex.: mais aberturas que entregas); os valores foram limitados no cálculo">⚠</span>`;
    document.getElementById("table-all").innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            ${columns.map((c) => {
              const sorted = c.key === col.key;
              const ariaSort = sorted ? (this.sort.dir === "asc" ? "ascending" : "descending") : "none";
              const arrow = sorted ? (this.sort.dir === "asc" ? " ▲" : " ▼") : "";
              return `<th class="is-sortable ${c.num ? "num" : ""} ${sorted ? "is-sorted" : ""}" data-sort="${c.key}" tabindex="0" aria-sort="${ariaSort}">${c.label}${arrow}</th>`;
            }).join("")}
          </tr>
        </thead>
        <tbody>
          ${visible.map(({ c, agg }) => `
            <tr>
              <td class="mono nowrap">${fmtDateTime(c.sentAt)}</td>
              <td>${campEscape(c.name)}${c.inconsistent ? warn : ""}${c.subject ? `<span class="cell-sub" title="${campEscape(c.subject)}">${campEscape(c.subject)}</span>` : ""}</td>
              <td>${campEscape(c.series)}</td>
              <td class="num mono">${fmtInt(c.sent)}</td>
              <td class="num mono">${fmtPct(agg.deliveryRate)}</td>
              <td class="num mono">${fmtPct(agg.openRate)}</td>
              <td class="num mono">${fmtPct(agg.clickRate)}</td>
              <td class="num mono">${fmtPct(agg.ctor)}</td>
              <td class="num mono ${agg.bounceRate >= 0.02 && c.sent >= 50 ? "rate-bad" : ""}">${fmtPct(agg.bounceRate)}</td>
              <td class="num mono">${fmtInt(c.unsubscribes)}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
      ${rows.length > visible.length
        ? `<button type="button" class="load-more-row" id="btn-more-campaigns">Mostrar mais ${Math.min(CAMP_PAGE_SIZE, rows.length - visible.length)} de ${fmtInt(rows.length - visible.length)} restantes</button>`
        : ""}
    `;

    const inconsistent = list.filter((c) => c.inconsistent).length;
    setNote("panel-all", inconsistent
      ? `${inconsistent} ${plural(inconsistent, "campanha tem", "campanhas têm")} números inconsistentes no arquivo de origem (⚠) — os valores foram limitados para nenhuma taxa passar de 100%.`
      : "");
  },
};

/* --- helpers de página (equivalentes aos do index; esta página não carrega app.js/dashboard.js) --- */

function setNote(panelId, text) {
  const panel = document.getElementById(panelId);
  let note = panel.querySelector(".panel-note");
  if (!text) {
    if (note) note.remove();
    return;
  }
  if (!note) {
    note = document.createElement("p");
    note.className = "panel-note";
    panel.appendChild(note);
  }
  note.textContent = text;
}

function showToast(msg, ms = 2200) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("is-visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("is-visible"), ms);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

document.addEventListener("DOMContentLoaded", () => Campaigns.init());

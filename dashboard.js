/* =========================================================================
   SOPA — Análises: KPIs para o diretor + montagem dos painéis
   ========================================================================= */

function monthKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(iso) {
  const d = new Date(iso);
  const label = d.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
  return `${label}/${String(d.getFullYear()).slice(2)}`;
}

// "2026-10" → Date local do primeiro dia do mês
function monthStart(key) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1);
}

function addMonths(key, n) {
  const d = monthStart(key);
  d.setMonth(d.getMonth() + n);
  return monthKey(d);
}

function dayLabel(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function inRange(iso, range) {
  if (!iso) return false;
  const d = new Date(iso);
  return d >= range.from && d < range.to;
}

// presets do filtro de período: [meses atrás do início, meses atrás do fim]
const DASH_PERIODS = {
  "this-month": [0, 0],
  "last-month": [1, 1],
  "3m": [2, 0],
  "6m": [5, 0],
  "12m": [11, 0],
};

const DASH_FILTERS_KEY = "sopa.dashFilters";

function defaultDashFilters() {
  return { period: "all", from: "", to: "", assignee: "", sector: "", category: "", priority: "" };
}

const Dashboard = {
  filters: defaultDashFilters(),
  filtersWired: false,

  render() {
    const all = Store.all();
    if (!this.filtersWired) this.wireFilters();
    this.populateFilters(all);

    const f = this.filters;
    const base = all.filter((t) =>
      (!f.assignee || t.assignee === f.assignee) &&
      (!f.sector || t.requesterSector === f.sector) &&
      (!f.category || t.category === f.category) &&
      (!f.priority || t.priority === f.priority)
    );
    const range = this.range();
    // "tasks" = solicitações abertas no período; painéis de conclusão usam
    // "base" e filtram pela data de conclusão dentro do período
    const tasks = range ? base.filter((t) => inRange(t.createdAt, range)) : base;

    this.renderResultBar(tasks, all);
    this.renderMetrics(tasks, base, range);
    this.renderSummary(tasks, range);
    this.renderThroughput(base, range);
    this.renderPriority(tasks);
    this.renderAging(tasks);
    this.renderWorkload(tasks);
    this.renderTrend(base, range);
    this.renderTreemap(tasks, range);
    this.renderTopRequesters(tasks);
    this.renderTopSectors(tasks);
    this.renderMonthlyHistory(tasks, all, range);
    this.renderOverdueTable(tasks);

    document.getElementById("dash-updated-time").textContent =
      new Date().toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  },

  /* ---------------------------- filtros ---------------------------- */

  wireFilters() {
    this.filtersWired = true;
    try {
      const saved = JSON.parse(localStorage.getItem(DASH_FILTERS_KEY) || "null");
      if (saved) this.filters = { ...defaultDashFilters(), ...saved };
    } catch {}

    const bind = (id, key) => {
      document.getElementById(id).addEventListener("change", (e) => {
        this.filters[key] = e.target.value;
        if (key === "period" && e.target.value !== "custom") {
          this.filters.from = "";
          this.filters.to = "";
        }
        if (key === "from" || key === "to") {
          this.filters.period = "custom";
          if (this.filters.from && this.filters.to && this.filters.from > this.filters.to) {
            [this.filters.from, this.filters.to] = [this.filters.to, this.filters.from];
          }
        }
        this.saveFilters();
        this.render();
      });
    };
    bind("df-period", "period");
    bind("df-from", "from");
    bind("df-to", "to");
    bind("df-assignee", "assignee");
    bind("df-sector", "sector");
    bind("df-category", "category");
    bind("df-priority", "priority");

    document.getElementById("df-reset").addEventListener("click", () => {
      this.filters = defaultDashFilters();
      this.saveFilters();
      this.render();
    });
  },

  saveFilters() {
    try { localStorage.setItem(DASH_FILTERS_KEY, JSON.stringify(this.filters)); } catch {}
  },

  // meses disponíveis: do mês da solicitação mais antiga até o mês atual
  availableMonths(all) {
    const current = monthKey(new Date());
    const first = all.reduce((min, t) => {
      const k = t.createdAt ? monthKey(t.createdAt) : current;
      return k < min ? k : min;
    }, current);
    const months = [];
    for (let k = first; k <= current; k = addMonths(k, 1)) months.push(k);
    return months;
  },

  // mês inicial/final efetivos do filtro (presets viram meses concretos)
  periodMonths() {
    const f = this.filters;
    const months = this.months;
    const current = months[months.length - 1];
    if (f.period === "all") return [months[0], current];
    if (f.period === "year") return [`${current.slice(0, 4)}-01`, current];
    if (f.period === "custom") return [f.from || months[0], f.to || current];
    const [fromAgo, toAgo] = DASH_PERIODS[f.period] || [0, 0];
    return [addMonths(current, -fromAgo), addMonths(current, -toAgo)];
  },

  range() {
    if (this.filters.period === "all") return null;
    const [from, to] = this.periodMonths();
    return { from: monthStart(from), to: monthStart(addMonths(to, 1)) };
  },

  periodLabel() {
    if (this.filters.period === "all") return "todo o período";
    const [from, to] = this.periodMonths();
    const a = monthLabel(monthStart(from).toISOString());
    const b = monthLabel(monthStart(to).toISOString());
    return from === to ? a : `${a} a ${b}`;
  },

  populateFilters(all) {
    const f = this.filters;
    this.months = this.availableMonths(all);

    const fill = (id, options, value, emptyLabel) => {
      const el = document.getElementById(id);
      const values = options.map((o) => o.value);
      const html = (emptyLabel ? [`<option value="">${emptyLabel}</option>`] : [])
        .concat(options.map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.label)}</option>`))
        .join("");
      if (el.innerHTML !== html) el.innerHTML = html;
      el.value = values.includes(value) ? value : (emptyLabel ? "" : values[0] || "");
      return el.value;
    };

    const monthOptions = [...this.months].reverse().map((k) => ({ value: k, label: monthLabel(monthStart(k).toISOString()) }));
    if (f.from && !this.months.includes(f.from)) f.from = "";
    if (f.to && !this.months.includes(f.to)) f.to = "";
    document.getElementById("df-period").value = f.period;
    const [from, to] = this.periodMonths();
    fill("df-from", monthOptions, from);
    fill("df-to", monthOptions, to);

    const assignees = [...new Set([...ASSIGNEES, ...distinctValues(all, "assignee")])];
    f.assignee = fill("df-assignee", assignees.map((v) => ({ value: v, label: v })), f.assignee, "Todos");
    f.sector = fill("df-sector", distinctValues(all, "requesterSector").map((v) => ({ value: v, label: v })), f.sector, "Todos");
    f.category = fill("df-category", distinctValues(all, "category").map((v) => ({ value: v, label: v })), f.category, "Todas");
    f.priority = fill("df-priority", Object.entries(PRIORITIES).map(([v, p]) => ({ value: v, label: p.label })), f.priority, "Todas");
  },

  renderResultBar(tasks, all) {
    const filtered = this.filters.period !== "all" || this.filters.assignee || this.filters.sector ||
      this.filters.category || this.filters.priority;
    document.getElementById("dash-result-bar").innerHTML = filtered
      ? `<strong>${tasks.length}</strong> de <strong>${all.length}</strong> solicitações · abertas em ${escapeHtml(this.periodLabel())}`
      : `Exibindo todas as <strong>${all.length}</strong> solicitações`;
    document.getElementById("df-reset").hidden = !filtered;
  },

  /* ---------------------------- painéis ---------------------------- */

  renderMetrics(tasks, base, range) {
    const now = new Date();
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "concluido");
    const backlog = tasks.filter((t) => t.status === "aberto");
    const inProgress = tasks.filter((t) => t.status === "andamento");
    const active = tasks.filter((t) => t.status !== "concluido");
    const overdue = active.filter((t) => t.dueAt && new Date(t.dueAt) < now);
    const criticalOpen = active.filter((t) => t.priority === "alta");

    // arredonda para baixo: só mostra 100% quando for de fato 100% (nunca
    // esconde que ainda restam tarefas em aberto/andamento atrás de um
    // arredondamento otimista)
    const completionRate = total ? Math.floor((completed.length / total) * 100) : 0;

    const resolutionHours = completed
      .filter((t) => t.completedAt)
      .map((t) => businessHoursBetween(t.createdAt, t.completedAt));
    const avgResolutionHours = resolutionHours.length
      ? Math.round((resolutionHours.reduce((a, b) => a + b, 0) / resolutionHours.length) * 10) / 10
      : 0;

    const backlogAges = backlog.map((t) => (now - new Date(t.createdAt)) / 86400000);
    const avgBacklogAge = backlogAges.length ? Math.round(backlogAges.reduce((a, b) => a + b, 0) / backlogAges.length) : 0;

    const withDue = tasks.filter((t) => t.dueAt);
    const under24h = withDue.filter((t) => (new Date(t.dueAt) - new Date(t.createdAt)) / 3600000 < 24);
    const under24hPct = withDue.length ? Math.round((under24h.length / withDue.length) * 100) : 0;

    const pctDelta = (cur, prev) => prev === 0 ? (cur > 0 ? 100 : 0) : Math.round(((cur - prev) / prev) * 100);
    const done = base.filter((t) => t.status === "concluido" && t.completedAt);
    let throughputTile, comparisonTile;

    if (range) {
      // com período: média semanal de conclusões no período e comparação
      // com um intervalo de mesma duração imediatamente anterior
      const end = new Date(Math.min(range.to, now));
      const span = Math.max(end - range.from, 86400000);
      const weeks = Math.max(span / (7 * 86400000), 1);
      const doneInRange = done.filter((t) => inRange(t.completedAt, range)).length;
      throughputTile = { value: Math.round((doneInRange / weeks) * 10) / 10, unit: "/sem", label: "Média semanal de conclusões" };

      const prevRange = { from: new Date(range.from - span), to: range.from };
      const prevCount = base.filter((t) => inRange(t.createdAt, prevRange)).length;
      const delta = pctDelta(total, prevCount);
      comparisonTile = { value: (delta > 0 ? "+" : "") + delta, unit: "%", label: "Variação vs. período anterior" };
    } else {
      const last7 = done.filter((t) => (now - new Date(t.completedAt)) / 86400000 <= 7).length;
      const prev7 = done.filter((t) => {
        const d = (now - new Date(t.completedAt)) / 86400000;
        return d > 7 && d <= 14;
      }).length;
      const throughputDelta = pctDelta(last7, prev7);
      throughputTile = {
        value: last7, unit: "/sem", label: "Throughput semanal",
        trend: throughputDelta > 0 ? "up" : throughputDelta < 0 ? "down" : "flat",
        trendLabel: (throughputDelta > 0 ? "+" : "") + throughputDelta + "%",
      };

      // mês corrente (até hoje) vs. mesmo intervalo do mesmo mês no ano anterior
      const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const lastYearMonthStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
      const lastYearMonthCutoff = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate(), 23, 59, 59);
      const thisMonthCount = tasks.filter((t) => {
        const d = new Date(t.createdAt);
        return d >= thisMonthStart && d <= now;
      }).length;
      const lastYearMonthCount = tasks.filter((t) => {
        const d = new Date(t.createdAt);
        return d >= lastYearMonthStart && d <= lastYearMonthCutoff;
      }).length;
      const yoyDelta = pctDelta(thisMonthCount, lastYearMonthCount);
      comparisonTile = { value: (yoyDelta > 0 ? "+" : "") + yoyDelta, unit: "%", label: "Variação mensal vs. ano anterior" };
    }

    const tiles = [
      { value: total, unit: "", label: range ? "Solicitações no período" : "Total de solicitações" },
      { value: completionRate, unit: "%", label: "Taxa de conclusão" },
      { value: inProgress.length, unit: "", label: "Em andamento agora" },
      { value: overdue.length, unit: "", label: "Solicitações em atraso", alert: overdue.length > 0 },
      { value: avgResolutionHours, unit: "h", label: "Resolução média (horário útil)" },
      throughputTile,
      { value: criticalOpen.length, unit: "", label: "Críticas em aberto", alert: criticalOpen.length > 0 },
      { value: avgBacklogAge, unit: "d", label: "Idade média do backlog" },
      { value: under24hPct, unit: "%", label: "Prazo inferior a 24h", alert: under24hPct >= 30 },
      comparisonTile,
    ];

    const grid = document.getElementById("metric-grid");
    grid.innerHTML = tiles.map((t) => `
      <div class="metric-tile ${t.alert ? "is-alert" : ""}">
        <div class="metric-value-row">
          <span class="metric-value">${t.value}</span>
          ${t.unit ? `<span class="metric-unit">${t.unit}</span>` : ""}
          ${t.trend ? `<span class="metric-trend is-${t.trend}">${t.trend === "up" ? "▲" : t.trend === "down" ? "▼" : "—"} ${t.trendLabel || ""}</span>` : ""}
        </div>
        <div class="metric-label">${t.label}</div>
      </div>
    `).join("");
  },

  renderSummary(tasks, range) {
    const el = document.querySelector(".dash-sub");
    if (!el) return;
    const now = new Date();
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "concluido").length;
    const active = tasks.filter((t) => t.status !== "concluido");
    const overdue = active.filter((t) => t.dueAt && new Date(t.dueAt) < now).length;
    const rate = total ? Math.floor((completed / total) * 100) : 0;

    let sentence = range
      ? `${total} solicitações abertas em ${this.periodLabel()}, ${rate}% concluídas`
      : `${total} solicitações registradas, ${rate}% concluídas`;
    sentence += active.length
      ? `; ${active.length} ainda ${active.length === 1 ? "está ativa" : "estão ativas"}`
      : "";
    sentence += overdue > 0
      ? `, das quais ${overdue} ${overdue === 1 ? "está em atraso" : "estão em atraso"}.`
      : active.length ? ", sem atrasos no momento." : ".";
    el.textContent = sentence;
  },

  renderThroughput(tasks, range) {
    const now = new Date();
    const done = tasks.filter((t) => t.status === "concluido" && t.completedAt);
    const data = [];

    if (!range) {
      const weeks = 8;
      for (let w = weeks - 1; w >= 0; w--) {
        const start = w * 7;
        const end = start + 6;
        const count = done.filter((t) => {
          const d = (now - new Date(t.completedAt)) / 86400000;
          return d >= start && d <= end;
        }).length;
        const label = w === 0 ? "atual" : `-${w}sem`;
        data.push({ label, value: count, weeksAgo: w, partial: w === 0 });
      }
      setPanelHead("panel-throughput", "Conclusões por semana", "Solicitações finalizadas nas últimas 8 semanas");
    } else {
      const end = new Date(Math.min(range.to, now));
      const days = (end - range.from) / 86400000;
      if (days <= 92) {
        // semanas a partir do início do período; a última pode ser parcial
        for (let s = new Date(range.from); s < end; s.setDate(s.getDate() + 7)) {
          const wStart = new Date(s);
          const wEnd = new Date(s); wEnd.setDate(wEnd.getDate() + 7);
          const count = done.filter((t) => inRange(t.completedAt, { from: wStart, to: wEnd < range.to ? wEnd : range.to })).length;
          data.push({ label: dayLabel(wStart), value: count, tooltipValue: `${count} na semana de ${dayLabel(wStart)}`, partial: wEnd > now });
        }
        setPanelHead("panel-throughput", "Conclusões por semana", `Solicitações finalizadas em ${this.periodLabel()}`);
      } else {
        for (let k = monthKey(range.from); monthStart(k) < end; k = addMonths(k, 1)) {
          const count = done.filter((t) => monthKey(t.completedAt) === k).length;
          data.push({ label: monthLabel(monthStart(k).toISOString()), value: count, partial: k === monthKey(now) });
        }
        setPanelHead("panel-throughput", "Conclusões por mês", `Solicitações finalizadas em ${this.periodLabel()}`);
      }
    }
    barChartVertical(document.getElementById("chart-throughput"), data, { color: "var(--status-concluido)" });

    const total = data.reduce((s, d) => s + d.value, 0);
    const complete = data.filter((d) => !d.partial);
    if (!total) {
      setNote("panel-throughput", "Nenhuma solicitação concluída no período.");
    } else if (complete.length) {
      const peak = complete.reduce((a, b) => (b.value > a.value ? b : a));
      setNote("panel-throughput", range
        ? `${total} solicitações concluídas em ${this.periodLabel()} — pico em ${peak.label} (${peak.value}).`
        : `${total} solicitações concluídas nas últimas 8 semanas — pico há ${peak.weeksAgo} semana${peak.weeksAgo === 1 ? "" : "s"} (${peak.value}).`);
    } else {
      setNote("panel-throughput", `${total} solicitações concluídas no período.`);
    }
  },

  renderPriority(tasks) {
    const active = tasks.filter((t) => t.status !== "concluido");
    const order = ["alta", "media", "baixa"];
    const data = order.map((p) => ({
      label: PRIORITIES[p].label,
      segments: [
        { name: "Abertas", value: active.filter((t) => t.priority === p && t.status === "aberto").length, color: "var(--status-aberto)" },
        { name: "Em andamento", value: active.filter((t) => t.priority === p && t.status === "andamento").length, color: "var(--status-andamento)" },
      ],
    }));
    barChartHorizontalStacked(document.getElementById("chart-priority"), data);
    setLegend("panel-priority", [
      ["Abertas", "var(--status-aberto)"],
      ["Em andamento", "var(--status-andamento)"],
    ]);

    const altaCount = active.filter((t) => t.priority === "alta").length;
    setNote("panel-priority", active.length
      ? `${active.length} solicitaç${active.length === 1 ? "ão ativa" : "ões ativas"} no momento, sendo ${altaCount} de prioridade alta.`
      : "Nenhuma solicitação ativa no momento.");
  },

  renderAging(tasks) {
    const now = new Date();
    const backlog = tasks.filter((t) => t.status === "aberto");
    // faixas contíguas em dias corridos (fracionários) desde a criação —
    // usa < no limite superior para não deixar buracos entre faixas
    // (ex.: uma tarefa com 2.5 dias de idade precisa cair em algum lugar)
    const buckets = [
      { label: "0–2 dias", test: (d) => d < 3 },
      { label: "3–5 dias", test: (d) => d >= 3 && d < 6 },
      { label: "6–10 dias", test: (d) => d >= 6 && d < 11 },
      { label: "11–20 dias", test: (d) => d >= 11 && d < 21 },
      { label: "21+ dias", test: (d) => d >= 21 },
    ];
    const data = buckets.map((b) => ({
      label: b.label,
      value: backlog.filter((t) => b.test((now - new Date(t.createdAt)) / 86400000)).length,
    }));
    barChartHorizontal(document.getElementById("chart-aging"), data, { color: "var(--accent)" });

    const critical = data[data.length - 1];
    if (backlog.length === 0) {
      setNote("panel-aging", "Nenhuma solicitação aberta aguardando início.");
    } else if (critical.value > 0) {
      setNote("panel-aging", `${critical.value} solicitaç${critical.value === 1 ? "ão aberta" : "ões abertas"} há mais de 21 dias — atenção ao backlog mais antigo.`);
    } else {
      setNote("panel-aging", "Backlog saudável: nenhuma solicitação aberta há mais de 20 dias.");
    }
  },

  renderWorkload(tasks) {
    const data = ASSIGNEES.map((name) => {
      const mine = tasks.filter((t) => t.assignee === name);
      return {
        label: name.split(" ")[0],
        total: mine.length,
        segments: [
          { name: "Abertas", value: mine.filter((t) => t.status === "aberto").length, color: "var(--status-aberto)" },
          { name: "Em andamento", value: mine.filter((t) => t.status === "andamento").length, color: "var(--status-andamento)" },
          { name: "Concluídas", value: mine.filter((t) => t.status === "concluido").length, color: "var(--status-concluido)" },
        ],
      };
    }).sort((a, b) => b.total - a.total);

    barChartHorizontalStacked(document.getElementById("chart-workload"), data, { barHeight: 22, gap: 14 });
    setLegend("panel-workload", [
      ["Abertas", "var(--status-aberto)"],
      ["Em andamento", "var(--status-andamento)"],
      ["Concluídas", "var(--status-concluido)"],
    ]);

    if (data.length === 2 && data[1].total > 0) {
      const [top, bottom] = data;
      const diffPct = Math.round(((top.total - bottom.total) / bottom.total) * 100);
      setNote("panel-workload", `${top.label} tem ${diffPct}% mais solicitações do que ${bottom.label} (${top.total} vs. ${bottom.total}).`);
    } else {
      setNote("panel-workload", "");
    }
  },

  renderTrend(tasks, range) {
    const now = new Date();
    const done = tasks.filter((t) => t.status === "concluido" && t.completedAt);
    const data = [];

    if (!range) {
      const days = 30;
      let running = done.filter((t) => (now - new Date(t.completedAt)) / 86400000 > days - 1).length;
      for (let d = days - 1; d >= 0; d--) {
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0); dayStart.setDate(dayStart.getDate() - d);
        const dayEnd = new Date(dayStart); dayEnd.setDate(dayEnd.getDate() + 1);
        running += done.filter((t) => inRange(t.completedAt, { from: dayStart, to: dayEnd })).length;
        data.push({ label: dayLabel(dayStart), value: running });
      }
      lineChart(document.getElementById("chart-trend"), data, { color: "var(--accent)" });
      setPanelHead("panel-trend", "Ritmo de conclusão — 30 dias", "Total acumulado de solicitações concluídas");

      const totalInWindow = done.filter((t) => (now - new Date(t.completedAt)) / 86400000 <= days).length;
      const avgPerDay = Math.round((totalInWindow / days) * 10) / 10;
      setNote("panel-trend", `${totalInWindow} solicitações concluídas nos últimos 30 dias — média de ${avgPerDay} por dia.`);
      return;
    }

    // com período: acumulado desde o início do período, dia a dia
    const end = new Date(Math.min(range.to, now));
    let running = 0;
    for (let day = new Date(range.from); day < end; day.setDate(day.getDate() + 1)) {
      const dayStart = new Date(day);
      const dayEnd = new Date(day); dayEnd.setDate(dayEnd.getDate() + 1);
      const count = done.filter((t) => inRange(t.completedAt, { from: dayStart, to: dayEnd })).length;
      running += count;
      data.push({ label: dayLabel(dayStart), value: running, tooltipValue: `${running} acumuladas · ${count} no dia` });
    }
    lineChart(document.getElementById("chart-trend"), data, { color: "var(--accent)" });
    setPanelHead("panel-trend", "Ritmo de conclusão no período", `Total acumulado de solicitações concluídas em ${this.periodLabel()}`);

    const avgPerDay = Math.round((running / Math.max(data.length, 1)) * 10) / 10;
    setNote("panel-trend", `${running} solicitações concluídas em ${this.periodLabel()} — média de ${avgPerDay} por dia.`);
  },

  renderTreemap(tasks, range) {
    const counts = new Map();
    tasks.forEach((t) => counts.set(t.category, (counts.get(t.category) || 0) + 1));
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 15).map(([label, value]) => ({ label, value }));
    const restTotal = sorted.slice(15).reduce((s, [, v]) => s + v, 0);
    if (restTotal > 0) top.push({ label: "Outros", value: restTotal });
    treemapChart(document.getElementById("chart-treemap"), top, { color: "var(--accent)" });
    setPanelHead("panel-treemap", "Itens mais solicitados", `Total por categoria — ${range ? this.periodLabel() : "histórico completo"}`);

    if (sorted.length) {
      const [topLabel, topValue] = sorted[0];
      const pct = Math.round((topValue / tasks.length) * 100);
      setNote("panel-treemap", `"${topLabel}" é a categoria mais recorrente, com ${topValue} solicitações (${pct}% do ${range ? "período" : "total histórico"}).`);
    } else {
      setNote("panel-treemap", "Nenhuma solicitação no período e filtros selecionados.");
    }
  },

  renderTopRequesters(tasks) {
    const counts = new Map();
    tasks.forEach((t) => counts.set(t.requesterName, (counts.get(t.requesterName) || 0) + 1));
    const data = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([label, value]) => ({ label, value }));
    barChartHorizontal(document.getElementById("chart-top-requesters"), data, { color: "var(--accent)" });

    if (data.length) {
      const [first, second] = data;
      setNote("panel-top-requesters", second
        ? `${first.label} lidera com ${first.value} solicitações, ${first.value - second.value} a mais que ${second.label}.`
        : `${first.label} é quem mais solicitou, com ${first.value} solicitações.`);
    } else {
      setNote("panel-top-requesters", "Nenhuma solicitação no período e filtros selecionados.");
    }
  },

  renderTopSectors(tasks) {
    const bySector = new Map();
    tasks.forEach((t) => {
      if (!bySector.has(t.requesterSector)) bySector.set(t.requesterSector, []);
      bySector.get(t.requesterSector).push(t);
    });
    const top5 = [...bySector.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .slice(0, 5);

    const data = top5.map(([sector, list]) => ({
      label: sector,
      segments: [
        { name: "Alta", value: list.filter((t) => t.priority === "alta").length, color: "var(--priority-alta)" },
        { name: "Média", value: list.filter((t) => t.priority === "media").length, color: "var(--priority-media)" },
        { name: "Baixa", value: list.filter((t) => t.priority === "baixa").length, color: "var(--priority-baixa)" },
      ],
    }));
    barChartHorizontalStacked(document.getElementById("chart-top-sectors"), data, { barHeight: 24, gap: 16 });
    setLegend("panel-top-sectors", [
      ["Alta", "var(--priority-alta)"],
      ["Média", "var(--priority-media)"],
      ["Baixa", "var(--priority-baixa)"],
    ]);

    if (top5.length) {
      const [topSector, topList] = top5[0];
      const topAlta = topList.filter((t) => t.priority === "alta").length;
      setNote("panel-top-sectors", `${topSector} lidera em volume (${topList.length}) entre os top 5 setores, com ${topAlta} solicitaç${topAlta === 1 ? "ão" : "ões"} de prioridade alta.`);
    } else {
      setNote("panel-top-sectors", "Nenhuma solicitação no período e filtros selecionados.");
    }
  },

  renderMonthlyHistory(tasks, all, range) {
    // sem período: últimos 7 meses; com período: todos os meses do período
    const current = monthKey(new Date());
    const [from, to] = range ? this.periodMonths() : [addMonths(current, -6), current];
    const data = [];
    for (let k = from; k <= to; k = addMonths(k, 1)) {
      const count = tasks.filter((t) => monthKey(t.createdAt) === k).length;
      data.push({ label: monthLabel(monthStart(k).toISOString()), value: count, partial: k === current });
    }
    const chartEl = document.getElementById("chart-monthly");
    barChartVertical(chartEl, data, { color: "var(--accent)" });
    chartEl.scrollLeft = chartEl.scrollWidth;
    setPanelHead("panel-monthly", "Histórico mensal de abertura",
      range ? `Solicitações abertas por mês — ${this.periodLabel()}` : "Solicitações abertas por mês — últimos 7 meses");

    const complete = data.filter((d) => !d.partial);
    if (complete.length && complete.some((d) => d.value > 0)) {
      const peak = complete.reduce((a, b) => (b.value > a.value ? b : a));
      const avg = Math.round(complete.reduce((s, d) => s + d.value, 0) / complete.length);
      setNote("panel-monthly", complete.length > 1
        ? `${peak.label} foi o mês com mais aberturas no período (${peak.value}) — média de ${avg} por mês.`
        : `${peak.value} solicitações abertas em ${peak.label}.`);
    } else if (!data.some((d) => d.value > 0)) {
      setNote("panel-monthly", "Nenhuma solicitação aberta no período e filtros selecionados.");
    } else if (data.length) {
      const last = data[data.length - 1];
      setNote("panel-monthly", `${last.value} solicitações abertas em ${last.label} até agora.`);
    } else {
      setNote("panel-monthly", "");
    }
  },

  renderOverdueTable(tasks) {
    const now = new Date();
    const overdue = tasks
      .filter((t) => t.status !== "concluido" && t.dueAt && new Date(t.dueAt) < now)
      .map((t) => ({ ...t, hoursLate: Math.round((now - new Date(t.dueAt)) / 3600000) }))
      .sort((a, b) => b.hoursLate - a.hoursLate);

    const container = document.getElementById("table-overdue");
    if (overdue.length === 0) {
      container.innerHTML = `<p class="empty-note">Nenhuma solicitação em atraso — operação em dia.</p>`;
      setNote("panel-overdue", "");
      return;
    }

    const statusMap = Object.fromEntries(STATUSES.map((s) => [s.id, s]));

    container.innerHTML = `
      <table class="data-table">
        <thead>
          <tr>
            <th>ID</th>
            <th>Solicitação</th>
            <th>Setor</th>
            <th>Prioridade</th>
            <th>Status</th>
            <th>Atraso</th>
          </tr>
        </thead>
        <tbody>
          ${overdue.map((t) => `
            <tr>
              <td class="mono">${t.code}</td>
              <td>${escapeHtml(t.title)}</td>
              <td>${escapeHtml(t.requesterSector)}</td>
              <td><span class="tag"><span class="tag-dot" style="background:${PRIORITIES[t.priority].color}"></span>${PRIORITIES[t.priority].label}</span></td>
              <td><span class="tag"><span class="tag-dot" style="background:${statusMap[t.status].color}"></span>${statusMap[t.status].label}</span></td>
              <td class="mono">${t.hoursLate < 24 ? t.hoursLate + "h" : Math.round(t.hoursLate / 24) + "d"}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    `;

    const worst = overdue[0];
    const worstLabel = worst.hoursLate < 24 ? `${worst.hoursLate}h` : `${Math.round(worst.hoursLate / 24)}d`;
    setNote("panel-overdue", `${overdue.length} solicitaç${overdue.length === 1 ? "ão" : "ões"} em atraso — a mais antiga (${worst.code}) está atrasada há ${worstLabel}.`);
  },
};

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

function setPanelHead(panelId, title, subtitle) {
  const head = document.querySelector(`#${panelId} .panel-head`);
  if (!head) return;
  head.querySelector("h2").textContent = title;
  head.querySelector("p").textContent = subtitle;
}

function setLegend(panelId, items) {
  const panel = document.getElementById(panelId);
  let legend = panel.querySelector(".legend");
  if (!legend) {
    legend = document.createElement("div");
    legend.className = "legend";
    panel.appendChild(legend);
  }
  legend.innerHTML = items.map(([label, color]) =>
    `<span class="legend-item"><span class="legend-swatch" style="background:${color}"></span>${label}</span>`
  ).join("");
}

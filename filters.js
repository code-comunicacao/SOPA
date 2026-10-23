/* =========================================================================
   SOPA — painel lateral de filtros do quadro
   ========================================================================= */

const Filters = {
  state: {
    search: "",
    priorities: new Set(),
    assignee: "",
    sector: "",
    category: "",
    deadline: "all", // all | overdue | 24h | week
    onlyAttachments: false,
    dateFrom: "",
    dateTo: "",
  },

  isActive() {
    const s = this.state;
    return !!s.search || s.priorities.size || s.assignee || s.sector || s.category ||
      s.deadline !== "all" || s.onlyAttachments || s.dateFrom || s.dateTo;
  },

  clear() {
    this.state = {
      search: "",
      priorities: new Set(),
      assignee: "",
      sector: "",
      category: "",
      deadline: "all",
      onlyAttachments: false,
      dateFrom: "",
      dateTo: "",
    };
    this.render();
    Board.render();
  },

  knownSectors() {
    return distinctValues(Store.all(), "requesterSector");
  },

  knownCategories() {
    return distinctValues(Store.all(), "category");
  },

  apply(tasks) {
    const s = this.state;
    const q = s.search.trim().toLowerCase();
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const in7d = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const from = s.dateFrom ? new Date(s.dateFrom + "T00:00:00") : null;
    const to = s.dateTo ? new Date(s.dateTo + "T23:59:59") : null;

    return tasks.filter((t) => {
      if (q && !(t.title.toLowerCase().includes(q) || t.code.toLowerCase().includes(q))) return false;
      if (s.priorities.size && !s.priorities.has(t.priority)) return false;
      if (s.assignee && t.assignee !== s.assignee) return false;
      if (s.sector && t.requesterSector !== s.sector) return false;
      if (s.category && t.category !== s.category) return false;
      if (s.onlyAttachments && !(t.attachments && t.attachments.length)) return false;

      if (from || to) {
        const created = new Date(t.createdAt);
        if (from && created < from) return false;
        if (to && created > to) return false;
      }

      if (s.deadline !== "all") {
        if (!t.dueAt) return false;
        const due = new Date(t.dueAt);
        if (s.deadline === "overdue") {
          if (!(due < now && t.status !== "concluido")) return false;
        } else if (s.deadline === "24h") {
          if (!(due >= now && due <= in24h && t.status !== "concluido")) return false;
        } else if (s.deadline === "week") {
          if (!(due >= now && due <= in7d && t.status !== "concluido")) return false;
        }
      }
      return true;
    });
  },

  toggle(setName, value) {
    const set = this.state[setName];
    if (set.has(value)) set.delete(value);
    else set.add(value);
  },

  render() {
    const el = document.getElementById("filters-panel");
    if (!el) return;
    const s = this.state;

    const checkGroup = (title, options, setName, labelFn) => `
      <fieldset class="filter-group">
        <legend>${title}</legend>
        ${options.length === 0 ? `<p class="filter-empty">Nenhuma opção ainda</p>` : options.map((opt) => {
          const value = opt;
          const checked = s[setName].has(value) ? "checked" : "";
          const label = labelFn ? labelFn(opt) : opt;
          return `
            <label class="filter-check">
              <input type="checkbox" data-filter-set="${setName}" value="${escapeAttr(value)}" ${checked} />
              <span>${escapeHtml(label)}</span>
            </label>`;
        }).join("")}
      </fieldset>`;

    const selectGroup = (title, options, stateKey, allLabel, labelFn) => `
      <label class="filter-select-field">
        <span>${title}</span>
        <select data-filter-select="${stateKey}">
          <option value="">${allLabel}</option>
          ${options.map((opt) => {
            const value = opt;
            const label = labelFn ? labelFn(opt) : opt;
            return `<option value="${escapeAttr(value)}" ${s[stateKey] === value ? "selected" : ""}>${escapeHtml(label)}</option>`;
          }).join("")}
        </select>
      </label>`;

    el.innerHTML = `
      <div class="filter-head">
        <h2>Filtros</h2>
        ${this.isActive() ? `<button type="button" class="link-btn" id="btn-clear-filters">Limpar</button>` : ""}
      </div>

      <label class="filter-search">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11L14.5 14.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
        <input type="text" id="filter-search-input" placeholder="Buscar por título ou ID" value="${escapeAttr(s.search)}" />
      </label>

      ${selectGroup("Responsável", ASSIGNEES, "assignee", "Todos")}
      ${selectGroup("Setor solicitante", this.knownSectors(), "sector", "Todos")}
      ${selectGroup("Categoria", this.knownCategories(), "category", "Todas")}

      <fieldset class="filter-group">
        <legend>Período</legend>
        <div class="filter-date-row">
          <label class="filter-date-field">
            <span>De</span>
            <input type="date" id="filter-date-from" value="${escapeAttr(s.dateFrom)}" />
          </label>
          <label class="filter-date-field">
            <span>Até</span>
            <input type="date" id="filter-date-to" value="${escapeAttr(s.dateTo)}" />
          </label>
        </div>
      </fieldset>

      <fieldset class="filter-group">
        <legend>Prazo</legend>
        ${[
          ["all", "Todas"],
          ["overdue", "Atrasadas"],
          ["24h", "Vencem em 24h"],
          ["week", "Vencem esta semana"],
        ].map(([value, label]) => `
          <label class="filter-check">
            <input type="radio" name="filter-deadline" value="${value}" ${s.deadline === value ? "checked" : ""} />
            <span>${label}</span>
          </label>`).join("")}
      </fieldset>

      ${checkGroup("Prioridade", Object.keys(PRIORITIES), "priorities", (k) => PRIORITIES[k].label)}

      <label class="filter-check filter-check-solo">
        <input type="checkbox" id="filter-attachments" ${s.onlyAttachments ? "checked" : ""} />
        <span>Somente com anexo</span>
      </label>
    `;

    el.querySelector("#filter-search-input").addEventListener("input", (e) => {
      this.state.search = e.target.value;
      Board.render();
      this.syncClearButton();
    });

    el.querySelectorAll("select[data-filter-select]").forEach((select) => {
      select.addEventListener("change", (e) => {
        this.state[e.target.dataset.filterSelect] = e.target.value;
        Board.render();
        this.syncClearButton();
      });
    });

    el.querySelector("#filter-date-from").addEventListener("change", (e) => {
      this.state.dateFrom = e.target.value;
      Board.render();
      this.syncClearButton();
    });
    el.querySelector("#filter-date-to").addEventListener("change", (e) => {
      this.state.dateTo = e.target.value;
      Board.render();
      this.syncClearButton();
    });

    el.querySelectorAll('input[name="filter-deadline"]').forEach((input) => {
      input.addEventListener("change", (e) => {
        this.state.deadline = e.target.value;
        Board.render();
        this.syncClearButton();
      });
    });

    el.querySelectorAll("input[data-filter-set]").forEach((input) => {
      input.addEventListener("change", (e) => {
        this.toggle(e.target.dataset.filterSet, e.target.value);
        Board.render();
        this.syncClearButton();
      });
    });

    el.querySelector("#filter-attachments").addEventListener("change", (e) => {
      this.state.onlyAttachments = e.target.checked;
      Board.render();
      this.syncClearButton();
    });

    const clearBtn = el.querySelector("#btn-clear-filters");
    if (clearBtn) clearBtn.addEventListener("click", () => this.clear());
  },

  syncClearButton() {
    const head = document.querySelector(".filter-head");
    if (!head) return;
    let btn = head.querySelector("#btn-clear-filters");
    if (this.isActive() && !btn) {
      btn = document.createElement("button");
      btn.type = "button";
      btn.className = "link-btn";
      btn.id = "btn-clear-filters";
      btn.textContent = "Limpar";
      btn.addEventListener("click", () => this.clear());
      head.appendChild(btn);
    } else if (!this.isActive() && btn) {
      btn.remove();
    }
  },
};

function escapeAttr(str) {
  return String(str).replace(/"/g, "&quot;");
}

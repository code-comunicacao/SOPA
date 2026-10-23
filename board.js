/* =========================================================================
   SOPA — quadro de solicitações: renderização + drag & drop
   ========================================================================= */

const Board = {
  dragTaskId: null,
  pageSize: 40,
  visibleCounts: {},

  render() {
    const board = document.getElementById("board");
    board.innerHTML = "";

    const allTasks = Store.all();
    const tasks = Filters.apply(allTasks);
    const maxCount = Math.max(1, ...STATUSES.map((s) => tasks.filter((t) => t.status === s.id).length));

    this.renderResultBar(allTasks.length, tasks.length);

    STATUSES.forEach((status) => {
      const columnTasks = tasks
        .filter((t) => t.status === status.id)
        .sort(status.id === "concluido"
          ? (a, b) => new Date(b.completedAt || b.createdAt) - new Date(a.completedAt || a.createdAt)
          : (a, b) => (a.order ?? 0) - (b.order ?? 0));

      const visible = this.visibleCounts[status.id] || this.pageSize;
      const shownTasks = columnTasks.slice(0, visible);
      const remaining = columnTasks.length - shownTasks.length;

      const col = document.createElement("div");
      col.className = "column";
      col.dataset.status = status.id;

      const ticks = Array.from({ length: 8 }, (_, i) => {
        const filled = i < Math.round((columnTasks.length / maxCount) * 8);
        return `<span class="tick ${filled ? "is-filled" : ""}" style="--tick-color:${status.color}"></span>`;
      }).join("");

      col.innerHTML = `
        <div class="column-head">
          <div class="column-title">
            <span class="column-dot" style="background:${status.color}"></span>
            ${status.label}
          </div>
          <span class="column-count mono">${columnTasks.length}</span>
        </div>
        <div class="column-ticks">${ticks}</div>
        <div class="card-list" data-status="${status.id}"></div>
        ${remaining > 0 ? `<button class="load-more-row" type="button" data-status="${status.id}">Carregar mais (${remaining} restantes)</button>` : ""}
        <button class="add-task-row" type="button" data-status="${status.id}">+ nova solicitação</button>
      `;

      const list = col.querySelector(".card-list");
      if (shownTasks.length === 0) {
        list.innerHTML = `<p class="column-empty">Nenhuma solicitação aqui</p>`;
      } else {
        shownTasks.forEach((task) => list.appendChild(this.buildCard(task)));
      }

      this.wireDropZone(list, status.id);

      const loadMoreBtn = col.querySelector(".load-more-row");
      if (loadMoreBtn) {
        loadMoreBtn.addEventListener("click", () => {
          this.visibleCounts[status.id] = visible + this.pageSize;
          this.render();
        });
      }

      col.querySelector(".add-task-row").addEventListener("click", () => {
        App.openModal(null, status.id);
      });

      board.appendChild(col);
    });
  },

  renderResultBar(total, shown) {
    const bar = document.getElementById("board-result-bar");
    if (!bar) return;
    if (shown === total) {
      bar.textContent = `${total} solicitações`;
    } else {
      bar.innerHTML = `<strong>${shown}</strong> de ${total} solicitações — <button type="button" id="clear-filters-inline" class="link-btn">limpar filtros</button>`;
      const btn = document.getElementById("clear-filters-inline");
      if (btn) btn.addEventListener("click", () => Filters.clear());
    }
  },

  buildCard(task) {
    const el = document.createElement("div");
    el.className = "task-card";
    el.draggable = true;
    el.dataset.id = task.id;

    const priority = PRIORITIES[task.priority];
    const overdue = task.dueAt && task.status !== "concluido" && new Date(task.dueAt) < new Date();
    const attachCount = (task.attachments || []).length;
    const resolutionHours = task.status === "concluido" && task.completedAt
      ? businessHoursBetween(task.createdAt, task.completedAt)
      : null;

    el.innerHTML = `
      <span class="priority-bar" style="background:${priority.color}" title="Prioridade ${priority.label}"></span>
      <div class="task-head">
        <span class="task-code mono">${task.code}</span>
        <span class="task-category">${escapeHtml(task.category)}</span>
      </div>
      <div class="task-title">${escapeHtml(task.title)}</div>
      ${task.description ? `<div class="task-desc">${escapeHtml(task.description)}</div>` : ""}
      ${task.link ? `<a class="task-link" href="${escapeAttr(task.link)}" target="_blank" rel="noopener noreferrer">${linkIcon()}<span>${escapeHtml(task.link)}</span></a>` : ""}
      <div class="task-requester">
        Solicitado por <strong>${escapeHtml(task.requesterName)}</strong> · ${escapeHtml(task.requesterSector)}
      </div>
      <div class="task-meta">
        <span class="task-assignee">
          <span class="avatar">${initials(task.assignee)}</span>
          ${task.assignee.split(" ")[0]}
        </span>
        <span class="task-meta-right">
          ${resolutionHours !== null ? `<span class="resolution-chip mono" title="Resolvida em ${resolutionHours.toFixed(1)}h úteis (07h–17h, dias úteis)">${clockIcon()}${formatResolutionTime(resolutionHours)}</span>` : ""}
          ${attachCount ? `<span class="attach-chip" title="${attachCount} anexo(s)">${clipIcon()}${attachCount}</span>` : ""}
          ${task.dueAt ? `<span class="task-due mono ${overdue ? "is-overdue" : ""}">${formatDateTimeShort(task.dueAt)}</span>` : ""}
        </span>
      </div>
    `;

    el.addEventListener("click", () => App.openModal(task.id));

    const linkEl = el.querySelector(".task-link");
    if (linkEl) linkEl.addEventListener("click", (e) => e.stopPropagation());

    el.addEventListener("dragstart", (e) => {
      this.dragTaskId = task.id;
      el.classList.add("is-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
    });
    el.addEventListener("dragend", () => {
      el.classList.remove("is-dragging");
      this.dragTaskId = null;
    });

    return el;
  },

  wireDropZone(list, statusId) {
    list.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      list.closest(".column").classList.add("is-dragover");

      const after = this.getDragAfterElement(list, e.clientY);
      const dragging = document.querySelector(".task-card.is-dragging");
      if (!dragging) return;
      const empty = list.querySelector(".column-empty");
      if (empty) empty.remove();
      if (after == null) {
        list.appendChild(dragging);
      } else {
        list.insertBefore(dragging, after);
      }
    });

    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget)) {
        list.closest(".column").classList.remove("is-dragover");
      }
    });

    list.addEventListener("drop", (e) => {
      e.preventDefault();
      list.closest(".column").classList.remove("is-dragover");
      const id = this.dragTaskId || e.dataTransfer.getData("text/plain");
      if (!id) return;

      Store.setStatus(id, statusId);

      const reordered = [...list.querySelectorAll(".task-card")].map((cardEl, i) => {
        const t = Store.get(cardEl.dataset.id);
        if (t) t.order = i;
        return t;
      }).filter(Boolean);
      Store.saveOrder(reordered);

      this.render();
      if (typeof Dashboard !== "undefined") Dashboard.render();
    });
  },

  getDragAfterElement(container, y) {
    const cards = [...container.querySelectorAll(".task-card:not(.is-dragging)")];
    return cards.reduce(
      (closest, card) => {
        const box = card.getBoundingClientRect();
        const offset = y - box.top - box.height / 2;
        if (offset < 0 && offset > closest.offset) {
          return { offset, element: card };
        }
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  },
};

function clipIcon() {
  return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M11 4.5L5.5 10a2 2 0 102.83 2.83L14 7.17a3.5 3.5 0 10-4.95-4.95L3.5 7.75" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function clockIcon() {
  return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.2" stroke="currentColor" stroke-width="1.4"/><path d="M8 4.6V8l2.6 1.6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function linkIcon() {
  return `<svg width="11" height="11" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M6.5 9.5L9.5 6.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M7.8 4.3l.9-.9a2.6 2.6 0 013.9 3.9l-.9.9M8.2 11.7l-.9.9a2.6 2.6 0 01-3.9-3.9l.9-.9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

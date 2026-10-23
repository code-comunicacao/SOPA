/* =========================================================================
   SOPA — app shell: abas, modal, anexos, wiring
   ========================================================================= */

const App = {
  editingId: null,
  editingAttachments: [],

  async init() {
    this.wireTheme();
    this.wireTabs();
    this.wireModal();
    window.addEventListener("resize", debounce(() => {
      if (document.getElementById("view-dashboard").classList.contains("is-active")) {
        Dashboard.render();
      }
    }, 200));

    this.showLoading(true);
    try {
      await Store.load();
    } catch (e) {
      console.error(e);
      showToast("Não foi possível carregar os dados. Verifique sua conexão e recarregue a página.");
    }
    this.showLoading(false);

    this.populateStaticSelects();
    this.wireExport();
    Filters.render();
    Board.render();
  },

  showLoading(isLoading) {
    const board = document.getElementById("board");
    if (isLoading) {
      board.innerHTML = `<p class="board-loading">Carregando solicitações…</p>`;
    }
  },

  wireTheme() {
    document.getElementById("theme-toggle").addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme");
      const next = current === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("sopa.theme", next);
    });
  },

  wireExport() {
    document.getElementById("btn-export").addEventListener("click", () => {
      const tasks = Filters.apply(Store.all());
      if (!tasks.length) {
        showToast("Nenhuma solicitação para exportar");
        return;
      }
      downloadCSV(buildTasksCSV(tasks), `sopa-solicitacoes-${isoDateStamp()}.csv`);
      const scoped = Filters.isActive() ? ` (filtro aplicado)` : "";
      showToast(`${tasks.length} solicitações exportadas${scoped}`);
    });
  },

  populateStaticSelects() {
    const categorySel = document.getElementById("task-category");
    const categories = distinctValues(Store.all(), "category");
    categorySel.innerHTML = categories.map((c) => `<option value="${escapeAttr(c)}">${escapeHtml(c)}</option>`).join("");

    const sectorList = document.getElementById("sector-suggestions");
    const sectors = distinctValues(Store.all(), "requesterSector");
    sectorList.innerHTML = sectors.map((s) => `<option value="${escapeAttr(s)}"></option>`).join("");

    const assigneeSel = document.getElementById("task-assignee");
    assigneeSel.innerHTML = ASSIGNEES.map((a) => `<option value="${escapeAttr(a)}">${escapeHtml(a)}</option>`).join("");

    const statusSel = document.getElementById("task-status");
    statusSel.innerHTML = STATUSES.map((s) => `<option value="${s.id}">${escapeHtml(s.label)}</option>`).join("");
  },

  wireTabs() {
    document.querySelectorAll(".tab-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll(".tab-btn").forEach((b) => {
          b.classList.remove("is-active");
          b.setAttribute("aria-selected", "false");
        });
        btn.classList.add("is-active");
        btn.setAttribute("aria-selected", "true");

        const view = btn.dataset.view;
        document.querySelectorAll(".view").forEach((v) => v.classList.remove("is-active"));
        document.getElementById(`view-${view}`).classList.add("is-active");

        if (view === "dashboard") Dashboard.render();
      });
    });
  },

  wireModal() {
    const backdrop = document.getElementById("modal-backdrop");
    const form = document.getElementById("task-form");

    document.getElementById("btn-new-task").addEventListener("click", () => this.openModal(null, "aberto"));
    document.getElementById("modal-close").addEventListener("click", () => this.closeModal());
    document.getElementById("btn-cancel-task").addEventListener("click", () => this.closeModal());
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) this.closeModal();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && backdrop.classList.contains("is-open")) this.closeModal();
    });

    document.getElementById("task-attachment-input").addEventListener("change", async (e) => {
      const files = [...e.target.files];
      e.target.value = "";

      for (const file of files) {
        const placeholder = { name: file.name, size: Math.max(1, Math.round(file.size / 1024)), uploading: true };
        this.editingAttachments.push(placeholder);
        this.renderAttachmentList();

        const path = `${this.currentTaskId}/${uid()}-${file.name}`;
        const { error } = await sbClient.storage.from("attachments").upload(path, file);
        const idx = this.editingAttachments.indexOf(placeholder);
        if (error) {
          console.error("Falha ao enviar anexo:", error);
          showToast(`Falha ao enviar "${file.name}"`);
          if (idx !== -1) this.editingAttachments.splice(idx, 1);
        } else {
          const { data } = sbClient.storage.from("attachments").getPublicUrl(path);
          if (idx !== -1) this.editingAttachments[idx] = { name: file.name, size: placeholder.size, path, url: data.publicUrl };
        }
        this.renderAttachmentList();
      }
    });

    document.getElementById("btn-delete-task").addEventListener("click", () => {
      if (!this.editingId) return;
      const paths = this.editingAttachments.map((a) => a.path).filter(Boolean);
      if (paths.length) sbClient.storage.from("attachments").remove(paths).catch(() => {});
      Store.remove(this.editingId);
      this.closeModal(true);
      Filters.render();
      Board.render();
      showToast("Solicitação excluída");
      if (document.getElementById("view-dashboard").classList.contains("is-active")) Dashboard.render();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = this.currentTaskId;
      const dueAt = combineDateTime(
        document.getElementById("task-due-date").value,
        document.getElementById("task-due-time").value
      );
      const task = {
        id,
        code: this.editingId ? Store.get(id).code : "",
        title: document.getElementById("task-title").value.trim(),
        description: document.getElementById("task-desc").value.trim(),
        link: document.getElementById("task-link").value.trim(),
        category: document.getElementById("task-category").value,
        requesterName: document.getElementById("task-requester-name").value.trim(),
        requesterSector: document.getElementById("task-requester-sector").value.trim(),
        assignee: document.getElementById("task-assignee").value,
        priority: document.getElementById("task-priority").value,
        status: document.getElementById("task-status").value,
        dueAt,
        createdAt: this.editingId ? Store.get(id).createdAt : nowISO(),
        completedAt: this.editingId ? Store.get(id).completedAt : null,
        attachments: [...this.editingAttachments],
      };
      if (!task.title || !task.requesterName) return;

      const wasEditing = this.editingId;
      const submitBtn = form.querySelector('button[type="submit"]');
      submitBtn.disabled = true;
      await Store.upsert(task);
      submitBtn.disabled = false;

      this.closeModal(true);
      Filters.render();
      Board.render();
      showToast(wasEditing ? "Solicitação atualizada" : "Solicitação criada");
      if (document.getElementById("view-dashboard").classList.contains("is-active")) Dashboard.render();
    });
  },

  openModal(taskId, defaultStatus) {
    this.editingId = taskId;
    this.currentTaskId = taskId || uid();
    this.attachmentsAtOpen = [];
    const backdrop = document.getElementById("modal-backdrop");
    const title = document.getElementById("modal-title");
    const codeEl = document.getElementById("modal-code");
    const deleteBtn = document.getElementById("btn-delete-task");

    if (taskId) {
      const task = Store.get(taskId);
      title.textContent = "Editar solicitação";
      codeEl.textContent = task.code;
      deleteBtn.style.display = "";
      document.getElementById("task-id").value = task.id;
      document.getElementById("task-title").value = task.title;
      document.getElementById("task-desc").value = task.description || "";
      document.getElementById("task-link").value = task.link || "";
      document.getElementById("task-category").value = task.category;
      document.getElementById("task-requester-name").value = task.requesterName;
      document.getElementById("task-requester-sector").value = task.requesterSector;
      document.getElementById("task-assignee").value = task.assignee;
      document.getElementById("task-priority").value = task.priority;
      document.getElementById("task-status").value = task.status;
      document.getElementById("task-due-date").value = toDateInputValue(task.dueAt);
      document.getElementById("task-due-time").value = toTimeInputValue(task.dueAt) || "17:00";
      this.editingAttachments = [...(task.attachments || [])];
      this.attachmentsAtOpen = this.editingAttachments.map((a) => a.path).filter(Boolean);
    } else {
      title.textContent = "Nova solicitação";
      codeEl.textContent = "atribuído ao salvar";
      deleteBtn.style.display = "none";
      document.getElementById("task-form").reset();
      document.getElementById("task-id").value = "";
      document.getElementById("task-category").value = "Card";
      document.getElementById("task-requester-sector").value = "";
      document.getElementById("task-status").value = defaultStatus || "aberto";
      document.getElementById("task-priority").value = "media";
      document.getElementById("task-due-time").value = "17:00";
      this.editingAttachments = [];
    }

    this.renderAttachmentList();
    backdrop.classList.add("is-open");
    setTimeout(() => document.getElementById("task-title").focus(), 50);
  },

  renderAttachmentList() {
    const list = document.getElementById("attachment-list");
    if (this.editingAttachments.length === 0) {
      list.innerHTML = `<p class="attachment-empty">Nenhum anexo</p>`;
      return;
    }
    list.innerHTML = this.editingAttachments.map((a, i) => `
      <span class="attachment-chip ${a.uploading ? "is-uploading" : ""}">
        ${clipIcon()}
        ${a.url
          ? `<a class="attachment-chip-name" href="${escapeAttr(a.url)}" data-download-name="${escapeAttr(a.name)}">${escapeHtml(a.name)}</a>`
          : `<span class="attachment-chip-name is-unavailable" title="${a.uploading ? "Enviando…" : "Arquivo original não disponível (anexo importado da planilha, antes do upload real existir)"}">${escapeHtml(a.name)}${a.uploading ? " · enviando…" : ""}</span>`}
        <span class="attachment-chip-size mono">${a.size}kb</span>
        <button type="button" class="attachment-remove" data-index="${i}" aria-label="Remover anexo">×</button>
      </span>
    `).join("");

    list.querySelectorAll("a.attachment-chip-name[data-download-name]").forEach((link) => {
      link.addEventListener("click", async (e) => {
        e.preventDefault();
        const url = link.getAttribute("href");
        const name = link.dataset.downloadName;
        try {
          const res = await fetch(url);
          if (!res.ok) throw new Error("resposta não-ok ao baixar anexo");
          const blob = await res.blob();
          const blobUrl = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = blobUrl;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);
        } catch (err) {
          console.error("Falha ao baixar anexo, abrindo em nova aba:", err);
          window.open(url, "_blank");
        }
      });
    });

    list.querySelectorAll(".attachment-remove").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const idx = Number(btn.dataset.index);
        const a = this.editingAttachments[idx];
        this.editingAttachments.splice(idx, 1);
        this.renderAttachmentList();
        if (a.path) {
          const { error } = await sbClient.storage.from("attachments").remove([a.path]);
          if (error) console.error("Falha ao remover anexo do armazenamento:", error);
        }
      });
    });
  },

  closeModal(saved) {
    document.getElementById("modal-backdrop").classList.remove("is-open");
    if (!saved) {
      // descarta arquivos enviados durante esta edição que nunca chegaram a
      // ser salvos na tarefa (cancelar, fechar, Esc)
      const orphaned = this.editingAttachments.filter((a) => a.path && !this.attachmentsAtOpen.includes(a.path));
      if (orphaned.length) {
        sbClient.storage.from("attachments").remove(orphaned.map((a) => a.path)).catch(() => {});
      }
    }
    this.editingId = null;
    this.editingAttachments = [];
    this.attachmentsAtOpen = [];
  },
};

function showToast(msg) {
  const toast = document.getElementById("toast");
  toast.textContent = msg;
  toast.classList.add("is-visible");
  clearTimeout(showToast._t);
  showToast._t = setTimeout(() => toast.classList.remove("is-visible"), 2200);
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function csvEscape(value) {
  const str = value === null || value === undefined ? "" : String(value);
  if (/[",\n\r]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function buildTasksCSV(tasks) {
  const headers = ["ID", "Título", "Descrição", "Link", "Categoria", "Solicitante", "Setor", "Responsável", "Prioridade", "Status", "Criado em", "Prazo", "Concluído em", "Anexos"];
  const statusLabels = Object.fromEntries(STATUSES.map((s) => [s.id, s.label]));
  const lines = [headers.map(csvEscape).join(",")];
  tasks.forEach((t) => {
    lines.push([
      t.code,
      t.title,
      t.description || "",
      t.link || "",
      t.category,
      t.requesterName,
      t.requesterSector,
      t.assignee,
      PRIORITIES[t.priority] ? PRIORITIES[t.priority].label : t.priority,
      statusLabels[t.status] || t.status,
      formatDateTimeShort(t.createdAt),
      t.dueAt ? formatDateTimeShort(t.dueAt) : "",
      t.completedAt ? formatDateTimeShort(t.completedAt) : "",
      (t.attachments || []).length,
    ].map(csvEscape).join(","));
  });
  return lines.join("\r\n");
}

function downloadCSV(csvContent, filename) {
  const bom = String.fromCharCode(0xfeff);
  const blob = new Blob([bom + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function isoDateStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

document.addEventListener("DOMContentLoaded", () => App.init());

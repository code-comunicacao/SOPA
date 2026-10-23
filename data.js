/* =========================================================================
   SOPA — Solicitações Organizadas para Atendimento
   Data layer: modelo de solicitação + persistência compartilhada via
   Supabase (banco Postgres). Todas as pessoas com o link leem e gravam
   na mesma base — não há login/autenticação.
   ========================================================================= */

const SUPABASE_URL = "https://altojgnuxojpxojvrzjt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_75cGoTmFLO7aXq-mLUfOdQ_JZ8KC2W4";
const sbClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const CODE_PREFIX = "SOPA";

const STATUSES = [
  { id: "aberto",     label: "Abertas",       color: "var(--status-aberto)" },
  { id: "andamento",  label: "Em Andamento",  color: "var(--status-andamento)" },
  { id: "concluido",  label: "Concluídas",    color: "var(--status-concluido)" },
];

const PRIORITIES = {
  alta:  { label: "Alta",  color: "var(--priority-alta)" },
  media: { label: "Média", color: "var(--priority-media)" },
  baixa: { label: "Baixa", color: "var(--priority-baixa)" },
};

const ASSIGNEES = ["Iron Santos", "Lauren Schneider"];

function initials(name) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

function uid() {
  return "t" + Math.random().toString(36).slice(2, 10);
}

function nowISO() {
  return new Date().toISOString();
}

function distinctValues(tasks, field) {
  return [...new Set(tasks.map((t) => t[field]).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR"));
}

function formatDateShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function formatTimeShort(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDateTimeShort(iso) {
  if (!iso) return "";
  return `${formatDateShort(iso)} ${formatTimeShort(iso)}`;
}

function toDateInputValue(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toTimeInputValue(iso) {
  if (!iso) return "";
  return formatTimeShort(iso);
}

function combineDateTime(dateStr, timeStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = (timeStr || "17:00").split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  return dt.toISOString();
}

/* --- mapeamento entre o formato do app (camelCase) e as colunas do
   Postgres (snake_case) --- */
function rowToTask(r) {
  return {
    id: r.id,
    code: r.code,
    title: r.title,
    description: r.description || "",
    link: r.link || "",
    category: r.category,
    requesterName: r.requester_name,
    requesterSector: r.requester_sector,
    assignee: r.assignee,
    priority: r.priority,
    status: r.status,
    dueAt: r.due_at,
    createdAt: r.created_at,
    completedAt: r.completed_at,
    attachments: r.attachments || [],
    order: r.order,
  };
}

function taskToRow(t) {
  return {
    id: t.id,
    code: t.code,
    title: t.title,
    description: t.description || "",
    link: t.link || "",
    category: t.category,
    requester_name: t.requesterName,
    requester_sector: t.requesterSector,
    assignee: t.assignee,
    priority: t.priority,
    status: t.status,
    due_at: t.dueAt,
    created_at: t.createdAt,
    completed_at: t.completedAt,
    attachments: t.attachments || [],
    order: t.order ?? null,
    updated_at: nowISO(),
  };
}

const Store = {
  tasks: [],

  async load() {
    // o Postgrest limita cada resposta (1000 linhas por padrão) — pagina
    // até esgotar, para nunca truncar a base silenciosamente
    const PAGE_SIZE = 1000;
    let all = [];
    let from = 0;
    while (true) {
      const { data, error } = await sbClient
        .from("tasks")
        .select("*")
        .order("created_at", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);
      if (error) {
        console.error("Falha ao carregar tarefas do Supabase:", error);
        this.tasks = all.map(rowToTask);
        return;
      }
      all = all.concat(data);
      if (data.length < PAGE_SIZE) break;
      from += PAGE_SIZE;
    }
    this.tasks = all.map(rowToTask);
  },

  all() {
    return this.tasks;
  },

  get(id) {
    return this.tasks.find((t) => t.id === id);
  },

  // grava otimista: atualiza a cópia local (UI reage na hora) e envia ao
  // Supabase em seguida, para que todo mundo com o link veja a mudança.
  // O código (SOPA-####) de tarefas novas é atribuído pelo próprio banco
  // (trigger + sequence), não adivinhado no navegador — evita que duas
  // pessoas criando tarefas ao mesmo tempo recebam o mesmo código.
  async upsert(task) {
    const idx = this.tasks.findIndex((t) => t.id === task.id);
    const isNew = idx === -1;
    if (isNew) {
      task.code = "";
      task.createdAt = task.createdAt || nowISO();
      this.tasks.push(task);
    } else {
      const prevStatus = this.tasks[idx].status;
      if (prevStatus !== "concluido" && task.status === "concluido" && !task.completedAt) {
        task.completedAt = nowISO();
      }
      if (task.status !== "concluido") {
        task.completedAt = null;
      }
      task.code = this.tasks[idx].code;
      task.createdAt = this.tasks[idx].createdAt;
      this.tasks[idx] = task;
    }

    const { data, error } = await sbClient.from("tasks").upsert(taskToRow(task)).select().single();
    if (error) {
      console.error("Falha ao salvar solicitação:", error);
      showToast("Não foi possível salvar a solicitação. Tente novamente.");
      return;
    }
    if (isNew) {
      const savedIdx = this.tasks.findIndex((t) => t.id === task.id);
      if (savedIdx !== -1) this.tasks[savedIdx].code = data.code;
    }
  },

  async remove(id) {
    this.tasks = this.tasks.filter((t) => t.id !== id);

    const { error } = await sbClient.from("tasks").delete().eq("id", id);
    if (error) console.error("Falha ao excluir solicitação:", error);
  },

  async setStatus(id, status) {
    const task = this.get(id);
    if (!task) return;
    if (status === "concluido" && task.status !== "concluido") {
      task.completedAt = nowISO();
    }
    if (status !== "concluido") {
      task.completedAt = null;
    }
    task.status = status;

    const { error } = await sbClient
      .from("tasks")
      .update({ status: task.status, completed_at: task.completedAt, updated_at: nowISO() })
      .eq("id", id);
    if (error) console.error("Falha ao mudar status:", error);
  },

  // persiste a ordem de arraste dentro de uma coluna (chamado após drag & drop)
  async saveOrder(tasksWithOrder) {
    const rows = tasksWithOrder.map((t) => ({ id: t.id, order: t.order, updated_at: nowISO() }));
    const { error } = await sbClient.from("tasks").upsert(rows, { onConflict: "id" });
    if (error) console.error("Falha ao salvar ordem:", error);
  },
};

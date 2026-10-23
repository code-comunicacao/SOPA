/* =========================================================================
   SOPA — calendário útil: feriados nacionais (fixos + móveis) e cálculo
   de minutos úteis (07:00–17:00, seg–sex, exceto feriados)
   ========================================================================= */

const BUSINESS_START_HOUR = 7;
const BUSINESS_END_HOUR = 17;

function easterSunday(year) {
  // Algoritmo de Gauss (anônimo gregoriano)
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const _holidayCache = new Map();

function holidaysForYear(year) {
  if (_holidayCache.has(year)) return _holidayCache.get(year);

  const easter = easterSunday(year);
  const fixed = [
    [0, 1],   // Confraternização Universal
    [3, 21],  // Tiradentes
    [4, 1],   // Dia do Trabalho
    [8, 7],   // Independência do Brasil
    [9, 12],  // Nossa Senhora Aparecida
    [10, 2],  // Finados
    [10, 15], // Proclamação da República
    [10, 20], // Consciência Negra
    [11, 25], // Natal
  ].map(([m, d]) => new Date(year, m, d));

  const movable = [
    addDays(easter, -48), // Carnaval (segunda)
    addDays(easter, -47), // Carnaval (terça)
    addDays(easter, -2),  // Sexta-feira Santa
    addDays(easter, 60),  // Corpus Christi
  ];

  const set = new Set([...fixed, ...movable].map(dateKey));
  _holidayCache.set(year, set);
  return set;
}

function isHoliday(date) {
  return holidaysForYear(date.getFullYear()).has(dateKey(date));
}

function isBusinessDay(date) {
  const day = date.getDay();
  return day !== 0 && day !== 6 && !isHoliday(date);
}

/**
 * Minutos úteis entre duas datas, considerando apenas 07:00–17:00,
 * de segunda a sexta, excluindo feriados nacionais.
 */
function businessMinutesBetween(startISO, endISO) {
  const start = new Date(startISO);
  const end = new Date(endISO);
  if (!(end > start)) return 0;

  let minutes = 0;
  let cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const lastDay = new Date(end.getFullYear(), end.getMonth(), end.getDate());

  while (cursor <= lastDay) {
    if (isBusinessDay(cursor)) {
      const open = new Date(cursor);
      open.setHours(BUSINESS_START_HOUR, 0, 0, 0);
      const close = new Date(cursor);
      close.setHours(BUSINESS_END_HOUR, 0, 0, 0);

      const segStart = start > open ? start : open;
      const segEnd = end < close ? end : close;
      if (segEnd > segStart) minutes += (segEnd - segStart) / 60000;
    }
    cursor = addDays(cursor, 1);
  }
  return minutes;
}

function businessHoursBetween(startISO, endISO) {
  return businessMinutesBetween(startISO, endISO) / 60;
}

/**
 * Formats a business-hours duration for compact display: hours below two
 * business days (< 20h), business days above that (1 day = 10h, 07h–17h).
 */
function formatResolutionTime(hours) {
  if (hours < 20) {
    const v = hours < 10 ? hours.toFixed(1) : Math.round(hours);
    return `${v}h`;
  }
  const days = hours / 10;
  const v = days < 10 ? days.toFixed(1) : Math.round(days);
  return `${v}d`;
}

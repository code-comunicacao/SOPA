/* =========================================================================
   SOPA — SVG chart primitives (no external chart library, no pie/donut)
   Every mark (bar / point / cell) shows a floating tooltip on hover.
   ========================================================================= */

const SVGNS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}) {
  const el = document.createElementNS(SVGNS, tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

/* --- shared floating tooltip, reused by every chart mark --- */
const ChartTooltip = {
  el: null,
  ensure() {
    if (this.el) return this.el;
    const el = document.createElement("div");
    el.className = "chart-tooltip";
    document.body.appendChild(el);
    this.el = el;
    return el;
  },
  show(evt, html) {
    const el = this.ensure();
    el.innerHTML = html;
    el.classList.add("is-visible");
    this.move(evt);
  },
  move(evt) {
    if (!this.el) return;
    const pad = 16;
    const rect = this.el.getBoundingClientRect();
    let x = evt.clientX + pad;
    let y = evt.clientY + pad;
    if (x + rect.width > window.innerWidth - 8) x = evt.clientX - rect.width - pad;
    if (y + rect.height > window.innerHeight - 8) y = evt.clientY - rect.height - pad;
    this.el.style.transform = `translate(${x}px, ${y}px)`;
  },
  hide() {
    if (this.el) this.el.classList.remove("is-visible");
  },
};

function wireTooltip(el, html) {
  el.addEventListener("mouseenter", (e) => ChartTooltip.show(e, html));
  el.addEventListener("mousemove", (e) => ChartTooltip.move(e));
  el.addEventListener("mouseleave", () => ChartTooltip.hide());
}

function tooltipHTML(title, value) {
  return `<div class="chart-tooltip-title">${title}</div><div class="chart-tooltip-value">${value}</div>`;
}

/**
 * Vertical bar chart. data: [{ label, value }]
 */
function barChartVertical(container, data, { color = "var(--accent)", height = 220, valueSuffix = "" } = {}) {
  container.innerHTML = "";
  const width = Math.max(container.clientWidth || 560, data.length * 56);
  const padTop = 26, padBottom = 30, padLeft = 8, padRight = 8;
  const max = Math.max(1, ...data.map((d) => d.value));
  const innerH = height - padTop - padBottom;
  const barW = ((width - padLeft - padRight) / data.length) * 0.56;
  const gap = ((width - padLeft - padRight) / data.length);

  const svg = svgEl("svg", { class: "chart", width, height, viewBox: `0 0 ${width} ${height}` });

  [0.25, 0.5, 0.75, 1].forEach((f) => {
    const y = padTop + innerH * (1 - f);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: padLeft, x2: width - padRight, y1: y, y2: y }));
  });

  data.forEach((d, i) => {
    const x = padLeft + i * gap + (gap - barW) / 2;
    const h = max === 0 ? 0 : (d.value / max) * innerH;
    const y = padTop + innerH - h;

    svg.appendChild(svgEl("rect", {
      class: "bar", x, y, width: barW, height: Math.max(h, 1.5),
      rx: 3, fill: color,
    }));

    const label = svgEl("text", { class: "value-label", x: x + barW / 2, y: y - 8, "text-anchor": "middle", "font-size": 12 });
    label.textContent = d.value + valueSuffix;
    svg.appendChild(label);

    const cat = svgEl("text", { x: x + barW / 2, y: height - 10, "text-anchor": "middle", "font-size": 11 });
    cat.textContent = d.label;
    svg.appendChild(cat);

    const hit = svgEl("rect", { class: "hit-area", x, y: padTop, width: barW, height: innerH, fill: "transparent" });
    wireTooltip(hit, tooltipHTML(d.label, d.value + valueSuffix));
    svg.appendChild(hit);
  });

  svg.appendChild(svgEl("line", { class: "axis-line", x1: padLeft, x2: width - padRight, y1: padTop + innerH, y2: padTop + innerH }));

  container.appendChild(svg);
}

/**
 * Horizontal bar chart. data: [{ label, value }]
 */
function barChartHorizontal(container, data, { color = "var(--accent)", barHeight = 26, gap = 14, maxOverride = null } = {}) {
  container.innerHTML = "";
  const width = Math.max(container.clientWidth || 560, 320);
  const labelW = 132;
  const padRight = 46;
  const rowH = barHeight + gap;
  const height = data.length * rowH + 10;
  const max = maxOverride ?? Math.max(1, ...data.map((d) => d.value));
  const innerW = width - labelW - padRight;

  const svg = svgEl("svg", { class: "chart", width, height, viewBox: `0 0 ${width} ${height}` });

  data.forEach((d, i) => {
    const y = i * rowH + 6;
    const w = max === 0 ? 0 : (d.value / max) * innerW;

    const label = svgEl("text", { x: labelW - 12, y: y + barHeight / 2 + 4, "text-anchor": "end", "font-size": 12 });
    label.textContent = d.label;
    svg.appendChild(label);

    svg.appendChild(svgEl("rect", { x: labelW, y, width: innerW, height: barHeight, rx: 4, fill: "var(--rule)" }));
    svg.appendChild(svgEl("rect", { class: "bar", x: labelW, y, width: Math.max(w, 2), height: barHeight, rx: 4, fill: color }));

    const val = svgEl("text", { class: "value-label", x: labelW + Math.max(w, 2) + 10, y: y + barHeight / 2 + 4, "font-size": 12 });
    val.textContent = d.value;
    svg.appendChild(val);

    const hit = svgEl("rect", { class: "hit-area", x: labelW, y: i * rowH, width: innerW, height: rowH, fill: "transparent" });
    wireTooltip(hit, tooltipHTML(d.label, d.value));
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/**
 * Stacked horizontal bar chart. data: [{ label, segments: [{ value, color, name? }] }]
 */
function barChartHorizontalStacked(container, data, { barHeight = 24, gap = 16 } = {}) {
  container.innerHTML = "";
  const width = Math.max(container.clientWidth || 560, 320);
  const labelW = 132;
  const padRight = 50;
  const rowH = barHeight + gap;
  const height = data.length * rowH + 10;
  const totals = data.map((d) => d.segments.reduce((s, seg) => s + seg.value, 0));
  const max = Math.max(1, ...totals);
  const innerW = width - labelW - padRight;

  const svg = svgEl("svg", { class: "chart", width, height, viewBox: `0 0 ${width} ${height}` });

  data.forEach((d, i) => {
    const y = i * rowH + 6;
    const label = svgEl("text", { x: labelW - 12, y: y + barHeight / 2 + 4, "text-anchor": "end", "font-size": 12 });
    label.textContent = d.label;
    svg.appendChild(label);

    let cursor = labelW;
    d.segments.forEach((seg) => {
      const w = max === 0 ? 0 : (seg.value / max) * innerW;
      if (w > 0) {
        const rect = svgEl("rect", { class: "bar", x: cursor, y, width: w, height: barHeight, fill: seg.color });
        wireTooltip(rect, tooltipHTML(`${d.label} · ${seg.name || "Total"}`, seg.value));
        svg.appendChild(rect);
      }
      cursor += w;
    });

    const total = totals[i];
    const totalEl = svgEl("text", { class: "value-label", x: cursor + 10, y: y + barHeight / 2 + 4, "font-size": 12 });
    totalEl.textContent = total;
    svg.appendChild(totalEl);
  });

  container.appendChild(svg);
}

/**
 * Line/area chart. data: [{ label, value }]
 */
function lineChart(container, data, { color = "var(--accent)", height = 200 } = {}) {
  container.innerHTML = "";
  const width = Math.max(container.clientWidth || 560, 480);
  const padTop = 20, padBottom = 26, padLeft = 8, padRight = 8;
  const innerH = height - padTop - padBottom;
  const innerW = width - padLeft - padRight;
  const max = Math.max(1, ...data.map((d) => d.value));
  const stepX = innerW / (data.length - 1 || 1);

  const points = data.map((d, i) => {
    const x = padLeft + i * stepX;
    const y = padTop + innerH - (d.value / max) * innerH;
    return [x, y];
  });

  const svg = svgEl("svg", { class: "chart", width, height, viewBox: `0 0 ${width} ${height}` });

  [0.5, 1].forEach((f) => {
    const y = padTop + innerH * (1 - f);
    svg.appendChild(svgEl("line", { class: "grid-line", x1: padLeft, x2: width - padRight, y1: y, y2: y }));
  });

  const areaPath = "M" + points.map((p) => p.join(",")).join(" L") +
    ` L${points[points.length - 1][0]},${padTop + innerH} L${points[0][0]},${padTop + innerH} Z`;
  const gradId = "grad-" + Math.random().toString(36).slice(2, 8);
  const defs = svgEl("defs");
  const grad = svgEl("linearGradient", { id: gradId, x1: 0, y1: 0, x2: 0, y2: 1 });
  grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": color, "stop-opacity": 0.32 }));
  grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": color, "stop-opacity": 0 }));
  defs.appendChild(grad);
  svg.appendChild(defs);

  svg.appendChild(svgEl("path", { d: areaPath, fill: `url(#${gradId})` }));

  const linePath = "M" + points.map((p) => p.join(",")).join(" L");
  svg.appendChild(svgEl("path", { d: linePath, fill: "none", stroke: color, "stroke-width": 2, "stroke-linejoin": "round", "stroke-linecap": "round" }));

  points.forEach(([x, y], i) => {
    if (data.length > 20 && i % 3 !== 0 && i !== data.length - 1) return;
    svg.appendChild(svgEl("circle", { cx: x, cy: y, r: 2.5, fill: color }));
  });

  // sparse x labels
  const labelEvery = Math.ceil(data.length / 8);
  data.forEach((d, i) => {
    if (i % labelEvery !== 0 && i !== data.length - 1) return;
    const t = svgEl("text", { x: points[i][0], y: height - 6, "text-anchor": "middle", "font-size": 10.5 });
    t.textContent = d.label;
    svg.appendChild(t);
  });

  // generous invisible hit circles so every point is easy to hover
  points.forEach(([x, y], i) => {
    const hit = svgEl("circle", { class: "hit-area", cx: x, cy: y, r: 10, fill: "transparent" });
    wireTooltip(hit, tooltipHTML(data[i].label, data[i].value));
    svg.appendChild(hit);
  });

  container.appendChild(svg);
}

/**
 * Squarified treemap layout (Bruls/Huizing/van Wijk). items: [{..., value}]
 * sorted descending by value. Returns items enriched with x/y/w/h in the
 * given box.
 */
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, d) => s + d.value, 0);
  if (total <= 0 || !items.length) return [];
  const scale = (w * h) / total;
  const results = [];
  let remaining = items.map((d) => ({ ...d, area: d.value * scale }));
  let rx = x, ry = y, rw = w, rh = h;

  const worstRatio = (row, side) => {
    const areas = row.map((d) => d.area);
    const sum = areas.reduce((a, b) => a + b, 0);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    if (sum === 0 || min === 0) return Infinity;
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  while (remaining.length) {
    const side = Math.min(rw, rh);
    let row = [remaining[0]];
    let rowArea = row[0].area;
    let bestRatio = worstRatio(row, side);
    let i = 1;
    while (i < remaining.length) {
      const testRow = row.concat(remaining[i]);
      const ratio = worstRatio(testRow, side);
      if (ratio <= bestRatio) {
        row = testRow;
        rowArea += remaining[i].area;
        bestRatio = ratio;
        i++;
      } else break;
    }

    const rowLength = rowArea / side;
    let offset = 0;
    if (rw >= rh) {
      row.forEach((d) => {
        const itemH = d.area / rowLength;
        results.push({ ...d, x: rx, y: ry + offset, w: rowLength, h: itemH });
        offset += itemH;
      });
      rx += rowLength;
      rw -= rowLength;
    } else {
      row.forEach((d) => {
        const itemW = d.area / rowLength;
        results.push({ ...d, x: rx + offset, y: ry, w: itemW, h: rowLength });
        offset += itemW;
      });
      ry += rowLength;
      rh -= rowLength;
    }
    remaining = remaining.slice(row.length);
  }

  return results;
}

/**
 * Treemap chart. data: [{ label, value }]. Rectangle area ∝ value; color
 * intensity also tracks value (same-hue scale). Labels shown when the
 * rectangle is large enough; exact count always available via tooltip.
 */
function treemapChart(container, data, { color = "var(--accent)", height = 340 } = {}) {
  container.innerHTML = "";
  const width = Math.max(container.clientWidth || 560, 320);
  const items = [...data].filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
  const maxVal = Math.max(1, ...items.map((d) => d.value));
  const rects = squarify(items, 0, 0, width, height);

  const wrap = document.createElement("div");
  wrap.className = "treemap";
  wrap.style.width = width + "px";
  wrap.style.height = height + "px";

  rects.forEach((r) => {
    const cell = document.createElement("div");
    cell.className = "treemap-cell";
    const t = r.value / maxVal;
    const pct = Math.round(t * 55 + 45);
    cell.style.background = `color-mix(in oklch, ${color} ${pct}%, var(--intensity-base))`;
    cell.style.left = r.x + "px";
    cell.style.top = r.y + "px";
    cell.style.width = Math.max(r.w - 2, 0) + "px";
    cell.style.height = Math.max(r.h - 2, 0) + "px";

    if (r.w > 90 && r.h > 46) {
      cell.innerHTML = `<span class="treemap-label">${escapeHtml(r.label)}</span><span class="treemap-value mono">${r.value}</span>`;
    } else if (r.w > 32 && r.h > 20) {
      cell.innerHTML = `<span class="treemap-value mono">${r.value}</span>`;
    }

    wireTooltip(cell, tooltipHTML(r.label, `${r.value} solicitaç${r.value === 1 ? "ão" : "ões"}`));
    wrap.appendChild(cell);
  });

  container.appendChild(wrap);
}

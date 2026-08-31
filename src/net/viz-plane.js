(function (global) {
  "use strict";

  function num(n, d) {
    const v = Number(n);
    return Number.isFinite(v) ? v : d;
  }

  function parseRows(data) {
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (_) { data = []; }
    }
    if (!Array.isArray(data)) return [];
    return data.map((row, i) => {
      if (row == null) return { label: String(i), value: 0 };
      if (typeof row === "number") return { label: String(i), value: row };
      return {
        label: String(row.label != null ? row.label : row.name != null ? row.name : row.x != null ? row.x : i),
        value: num(row.value != null ? row.value : row.y != null ? row.y : row.count, 0),
      };
    });
  }

  function linear(domain, range) {
    const d0 = domain[0], d1 = domain[1] || d0 + 1;
    const r0 = range[0], r1 = range[1];
    return function (v) {
      const t = (v - d0) / (d1 - d0 || 1);
      return r0 + t * (r1 - r0);
    };
  }

  function svgWrap(inner, w, h, title) {
    return (
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + w + " " + h + '" width="100%" style="max-width:560px;display:block">' +
      (title ? '<text x="16" y="22" fill="#c8c8c8" font-size="13" font-family="Inter,sans-serif">' + esc(title) + "</text>" : "") +
      inner +
      "</svg>"
    );
  }

  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function barChart(rows, title) {
    const w = 560, h = 260, l = 44, r = 16, t = title ? 36 : 16, b = 36;
    const max = Math.max(1, ...rows.map((d) => d.value));
    const x = function (i) { return l + (i * (w - l - r)) / Math.max(rows.length, 1); };
    const bw = Math.max(4, ((w - l - r) / Math.max(rows.length, 1)) * 0.68);
    const y = linear([0, max], [h - b, t]);
    let g = '<line x1="' + l + '" y1="' + t + '" x2="' + l + '" y2="' + (h - b) + '" stroke="#333"/>';
    g += '<line x1="' + l + '" y1="' + (h - b) + '" x2="' + (w - r) + '" y2="' + (h - b) + '" stroke="#333"/>';
    rows.forEach((d, i) => {
      const bh = (h - b) - y(d.value);
      g += '<rect x="' + (x(i) + 4) + '" y="' + y(d.value) + '" width="' + bw + '" height="' + Math.max(0, bh) + '" fill="#ededed" opacity=".88"/>';
      g += '<text x="' + (x(i) + 4 + bw / 2) + '" y="' + (h - b + 14) + '" fill="#666" font-size="10" text-anchor="middle" font-family="Inter,sans-serif">' + esc(d.label).slice(0, 10) + "</text>";
    });
    return svgWrap(g, w, h, title);
  }

  function lineChart(rows, title) {
    const w = 560, h = 260, l = 44, r = 16, t = title ? 36 : 16, b = 36;
    const max = Math.max(1, ...rows.map((d) => d.value));
    const min = Math.min(0, ...rows.map((d) => d.value));
    const x = linear([0, Math.max(rows.length - 1, 1)], [l, w - r]);
    const y = linear([min, max], [h - b, t]);
    const pts = rows.map((d, i) => x(i) + "," + y(d.value)).join(" ");
    let g = '<line x1="' + l + '" y1="' + t + '" x2="' + l + '" y2="' + (h - b) + '" stroke="#333"/>';
    g += '<line x1="' + l + '" y1="' + (h - b) + '" x2="' + (w - r) + '" y2="' + (h - b) + '" stroke="#333"/>';
    g += '<polyline fill="none" stroke="#ededed" stroke-width="1.6" points="' + pts + '"/>';
    rows.forEach((d, i) => {
      g += '<circle cx="' + x(i) + '" cy="' + y(d.value) + '" r="2.4" fill="#ededed"/>';
    });
    return svgWrap(g, w, h, title);
  }

  function pieChart(rows, title) {
    const w = 560, h = 260, cx = 150, cy = 140, R = 78;
    const sum = rows.reduce((s, d) => s + Math.abs(d.value), 0) || 1;
    let a = -Math.PI / 2;
    let g = "";
    rows.forEach((d, i) => {
      const slice = (Math.abs(d.value) / sum) * Math.PI * 2;
      const a2 = a + slice;
      const large = slice > Math.PI ? 1 : 0;
      const x1 = cx + Math.cos(a) * R, y1 = cy + Math.sin(a) * R;
      const x2 = cx + Math.cos(a2) * R, y2 = cy + Math.sin(a2) * R;
      const op = (0.35 + (i % 5) * 0.13).toFixed(2);
      g += '<path d="M ' + cx + " " + cy + " L " + x1 + " " + y1 + " A " + R + " " + R + " 0 " + large + " 1 " + x2 + " " + y2 + ' Z" fill="#ededed" opacity="' + op + '"/>';
      g += '<text x="280" y="' + (48 + i * 18) + '" fill="#aaa" font-size="12" font-family="Inter,sans-serif">' + esc(d.label) + "  " + d.value + "</text>";
      a = a2;
    });
    return svgWrap(g, w, h, title);
  }

  function renderChart(spec) {
    spec = spec || {};
    const rows = parseRows(spec.data || spec.rows || spec.values);
    if (!rows.length) return { ok: false, error: "data required [{label,value}]" };
    const type = String(spec.type || spec.kind || "bar").toLowerCase();
    const title = spec.title || "";
    const svg = type === "line" ? lineChart(rows, title) : type === "pie" ? pieChart(rows, title) : barChart(rows, title);
    if (typeof appendMsg === "function") {
      try { appendMsg(svg, "chart"); } catch (_) {}
    }
    return { ok: true, type: type === "line" || type === "pie" ? type : "bar", n: rows.length };
  }

  global.renderChart = renderChart;
  global.vizPlaneStatus = function () {
    return { engine: "scale+svg", types: ["bar", "line", "pie"] };
  };
})(typeof window !== "undefined" ? window : globalThis);

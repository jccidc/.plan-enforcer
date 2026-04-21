const DEFAULT_SVG_PALETTE = Object.freeze({
  bgStart: '#0d1117',
  bgEnd: '#161b22',
  panel: '#1c2128',
  panelAlt: '#11161c',
  border: '#30363d',
  text: '#e6edf3',
  muted: '#8b949e',
  quiet: '#6e7681',
  accent: '#8957e5',
  accentSoft: '#7c6cff',
  pe: '#3fb950',
  gsd: '#58a6ff',
  sp: '#d29922'
});

const BENCHMARK_CARD_LAYOUT = Object.freeze([
  { x: 40, y: 160, width: 540, height: 230, key: 'execution' },
  { x: 620, y: 160, width: 540, height: 230, key: 'carryover' },
  { x: 40, y: 430, width: 540, height: 240, key: 'planning' },
  { x: 620, y: 430, width: 540, height: 240, key: 'runtime' }
]);

const BENCHMARK_SERIES = Object.freeze({
  execution: {
    eyebrow: 'Execution parity',
    title: 'Bounded work is not problem.',
    caption: 'Small phased benchmark: all three finish bounded work.',
    max: 24,
    rows: [
      { label: 'Plan Enforcer', value: 24, accent: 'pe' },
      { label: 'GSD', value: 24, accent: 'gsd' },
      { label: 'Superpowers', value: 24, accent: 'sp' }
    ]
  },
  carryover: {
    eyebrow: 'Carryover moat',
    title: 'Repaired-contract preservation separates.',
    caption: 'H through L and resume pressure. Same ask, harder truth.',
    max: 172,
    rows: [
      { label: 'Plan Enforcer', value: 172, accent: 'pe' },
      { label: 'GSD', value: 122, accent: 'gsd' },
      { label: 'Superpowers', value: 125, accent: 'sp' }
    ]
  },
  planning: {
    eyebrow: 'Planning ambiguity',
    title: 'Competitive, not blanket best.',
    caption: 'Fair claim: competitive authorship, not universal win.',
    max: 3,
    rows: [
      { label: 'PE', value: 3, accent: 'pe' },
      { label: 'GSD', value: 2, accent: 'gsd' },
      { label: 'SP', value: 2, accent: 'sp' }
    ]
  },
  runtime: {
    eyebrow: 'Large trust runtime',
    title: 'Large phased work stays respectable.',
    caption: 'Lower is better. All three still finish 98 / 98.',
    max: 125.1,
    min: 80,
    rows: [
      { label: 'Plan Enforcer', value: 92.87, text: '92m 52s', accent: 'pe' },
      { label: 'GSD', value: 116.82, text: '116m 49s', accent: 'gsd' },
      { label: 'Superpowers', value: 125.1, text: '125m 06s', accent: 'sp' }
    ],
    summary: '98 / 98 for all three on 14-phase trust pack'
  }
});

function normalizeMarkdown(markdown) {
  return String(markdown || '').replace(/\r\n/g, '\n');
}

function stripOuterDividers(markdown) {
  const lines = normalizeMarkdown(markdown).split('\n');
  while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  while (lines.length > 0 && lines[0].trim() === '---') {
    lines.shift();
    while (lines.length > 0 && lines[0].trim() === '') lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === '---') {
    lines.pop();
    while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  }
  return lines.join('\n').trim();
}

function slugifySectionTitle(title, fallback) {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || `section-${fallback}`;
}

function extractSectionAssets(markdown) {
  const hits = [];
  const seen = new Set();
  const regex = /docs\/assets\/([a-z0-9-]+\.svg)/gi;
  for (const match of normalizeMarkdown(markdown).matchAll(regex)) {
    const name = match[1];
    if (!seen.has(name)) {
      seen.add(name);
      hits.push(name);
    }
  }
  return hits;
}

function parseReadmeSections(markdown) {
  const text = normalizeMarkdown(markdown);
  const headings = [...text.matchAll(/^##\s+(.+)$/gm)];
  const sections = [];
  const usedIds = new Set();

  function uniqueId(title, fallbackIndex) {
    let base = slugifySectionTitle(title, fallbackIndex);
    let candidate = base;
    let index = 2;
    while (usedIds.has(candidate)) {
      candidate = `${base}-${index}`;
      index += 1;
    }
    usedIds.add(candidate);
    return candidate;
  }

  if (headings.length === 0) {
    const heroOnly = stripOuterDividers(text);
    if (!heroOnly) return [];
    return [{
      id: 'hero',
      title: 'Hero',
      markdown: heroOnly,
      heading: '',
      assets: extractSectionAssets(heroOnly),
      enabled: true
    }];
  }

  const hero = stripOuterDividers(text.slice(0, headings[0].index));
  if (hero) {
    sections.push({
      id: 'hero',
      title: 'Hero',
      markdown: hero,
      heading: '',
      assets: extractSectionAssets(hero),
      enabled: true
    });
    usedIds.add('hero');
  }

  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index];
    const next = headings[index + 1];
    const title = current[1].trim();
    const chunk = stripOuterDividers(text.slice(current.index, next ? next.index : text.length));
    sections.push({
      id: uniqueId(title, index + 1),
      title,
      markdown: chunk,
      heading: `## ${title}`,
      assets: extractSectionAssets(chunk),
      enabled: true
    });
  }

  return sections;
}

function buildReadmeMarkdown(sections, options = {}) {
  const includeDividers = options.includeDividers !== false;
  const chunks = [];

  for (const section of sections || []) {
    if (section && section.enabled === false) continue;
    const chunk = stripOuterDividers(section && section.markdown);
    if (chunk) chunks.push(chunk);
  }

  if (chunks.length === 0) return '';
  return `${chunks.join(includeDividers ? '\n\n---\n\n' : '\n\n')}\n`;
}

function extractHexColors(svgContent) {
  const matches = normalizeMarkdown(svgContent).match(/#[0-9a-fA-F]{6}\b/g) || [];
  const seen = new Set();
  const ordered = [];
  for (const color of matches) {
    const normalized = color.toLowerCase();
    if (!seen.has(normalized)) {
      seen.add(normalized);
      ordered.push(normalized);
    }
  }
  return ordered;
}

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function isHexColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || ''));
}

function applyColorOverrides(svgContent, overrides = {}) {
  const entries = Object.entries(overrides)
    .filter(([from, to]) => isHexColor(from) && isHexColor(to))
    .map(([from, to]) => [from.toLowerCase(), to.toLowerCase()]);

  let output = normalizeMarkdown(svgContent);
  entries.forEach(([from], index) => {
    output = output.replace(new RegExp(escapeRegExp(from), 'gi'), `__PLAYGROUND_COLOR_${index}__`);
  });
  entries.forEach(([, to], index) => {
    output = output.replace(new RegExp(`__PLAYGROUND_COLOR_${index}__`, 'g'), to);
  });
  return output;
}

function normalizePalette(palette = {}) {
  const output = { ...DEFAULT_SVG_PALETTE };
  for (const [key, value] of Object.entries(palette || {})) {
    if (key in output && isHexColor(value)) output[key] = value.toLowerCase();
  }
  return output;
}

function formatValue(row, max, kind) {
  if (row.text) return row.text;
  if (kind === 'runtime') return `${row.value.toFixed(1)}m`;
  return `${row.value} / ${max}`;
}

function scaleValue(value, min, max, width) {
  if (max <= min) return 0;
  return Math.max(0, Math.min(width, ((value - min) / (max - min)) * width));
}

function renderHorizontalSeriesRows(rows, options) {
  const {
    chartType,
    startX,
    startY,
    rowGap,
    trackWidth,
    max,
    min = 0,
    palette,
    kind
  } = options;

  return rows.map((row, index) => {
    const y = startY + index * rowGap;
    const accent = palette[row.accent] || palette.pe;
    const width = kind === 'runtime'
      ? scaleValue(row.value, min, max, trackWidth)
      : scaleValue(row.value, 0, max, trackWidth);
    const label = `
      <text x="22" y="${y + 12}" class="sans label">${row.label}</text>
      <text x="492" y="${y + 12}" class="sans value" text-anchor="end">${formatValue(row, max, kind)}</text>
    `;

    if (chartType === 'lollipops') {
      return `
        ${label}
        <line x1="${startX}" y1="${y}" x2="${startX + trackWidth}" y2="${y}" stroke="${palette.border}" stroke-width="4" stroke-linecap="round"/>
        <circle cx="${startX + width}" cy="${y}" r="9" fill="${accent}" stroke="${palette.panelAlt}" stroke-width="3"/>
      `;
    }

    if (chartType === 'dots') {
      const dots = 12;
      const filled = Math.max(0, Math.min(dots, Math.round(((kind === 'runtime' ? (row.value - min) / (max - min) : row.value / max) || 0) * dots)));
      const circles = Array.from({ length: dots }, (_, dotIndex) => {
        const cx = startX + (dotIndex * trackWidth) / (dots - 1);
        const fill = dotIndex < filled ? accent : palette.border;
        return `<circle cx="${cx}" cy="${y}" r="6" fill="${fill}"/>`;
      }).join('');
      return `${label}${circles}`;
    }

    return `
      ${label}
      <rect x="${startX}" y="${y - 10}" width="${trackWidth}" height="16" rx="8" fill="${palette.panelAlt}" stroke="${palette.border}" stroke-width="1"/>
      <rect x="${startX}" y="${y - 10}" width="${width}" height="16" rx="8" fill="${accent}"/>
    `;
  }).join('');
}

function renderPlanningRows(chartType, palette) {
  const rows = BENCHMARK_SERIES.planning.rows;
  if (chartType === 'bars') {
    return rows.map((row, index) => {
      const cardX = 60 + (index * 128);
      const cardWidth = 96;
      const height = 110;
      const barHeight = 18 + (row.value / 3) * 38;
      const barY = 220 - barHeight;
      return `
        <rect x="${cardX}" y="130" width="${cardWidth}" height="${height}" rx="10" fill="${palette.panelAlt}" stroke="${palette.border}" stroke-width="1"/>
        <text x="${cardX + 48}" y="156" class="sans value" text-anchor="middle">${row.value} / 3</text>
        <rect x="${cardX + 24}" y="${barY}" width="48" height="${barHeight}" rx="8" fill="${palette[row.accent]}"/>
        <text x="${cardX + 48}" y="262" class="sans small" text-anchor="middle">${row.label}</text>
      `;
    }).join('');
  }

  return `
    <text x="40" y="110" class="sans label">Scenario B stage score</text>
    ${renderHorizontalSeriesRows(rows, {
      chartType,
      startX: 210,
      startY: 156,
      rowGap: 42,
      trackWidth: 250,
      max: 3,
      palette,
      kind: 'planning'
    })}
  `;
}

function buildBenchmarkSummarySvg(options = {}) {
  const chartType = ['bars', 'lollipops', 'dots'].includes(options.chartType)
    ? options.chartType
    : 'bars';
  const palette = normalizePalette(options.palette);
  const title = options.title || 'What benchmark actually says.';
  const subtitle = options.subtitle || 'Execution is credible. Planning is competitive. Carryover is repeated moat.';

  const execution = BENCHMARK_SERIES.execution;
  const carryover = BENCHMARK_SERIES.carryover;
  const runtime = BENCHMARK_SERIES.runtime;

  return `<svg width="1200" height="760" viewBox="0 0 1200 760" xmlns="http://www.w3.org/2000/svg" role="img" aria-labelledby="title desc" data-chart-type="${chartType}">
  <title id="title">Plan Enforcer benchmark summary</title>
  <desc id="desc">Benchmark summary showing execution parity, carryover moat, planning ambiguity, and large trust runtime.</desc>

  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="760" gradientUnits="userSpaceOnUse">
      <stop offset="0" stop-color="${palette.bgStart}"/>
      <stop offset="1" stop-color="${palette.bgEnd}"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="160%">
      <feDropShadow dx="0" dy="6" stdDeviation="10" flood-color="#000" flood-opacity="0.4"/>
    </filter>
    <style>
      .sans { font-family: "IBM Plex Sans", "Segoe UI", Arial, sans-serif; }
      .mono { font-family: "IBM Plex Mono", "Cascadia Code", Consolas, monospace; }
      .eyebrow { font-size: 13px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase; fill: ${palette.muted}; }
      .title { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; fill: ${palette.text}; }
      .subtitle { font-size: 14px; font-weight: 500; fill: ${palette.muted}; }
      .step-num { font-size: 11px; font-weight: 700; fill: ${palette.accent}; letter-spacing: 0.1em; text-transform: uppercase; }
      .step-title { font-size: 18px; font-weight: 700; fill: ${palette.text}; }
      .label { font-size: 12px; font-weight: 600; fill: ${palette.text}; }
      .small { font-size: 11px; font-weight: 500; fill: ${palette.muted}; }
      .value { font-size: 12px; font-weight: 700; fill: ${palette.text}; }
      .big { font-size: 26px; font-weight: 700; fill: ${palette.text}; }
      .card { fill: ${palette.panel}; stroke: ${palette.border}; stroke-width: 1.5; }
      .card-active { fill: ${palette.panel}; stroke: ${palette.accent}; stroke-width: 1.5; }
      .footer { font-size: 11px; font-weight: 500; fill: ${palette.quiet}; }
    </style>
  </defs>

  <rect width="1200" height="760" fill="url(#bg)"/>

  <text x="60" y="54" class="sans eyebrow">Benchmark summary</text>
  <text x="60" y="84" class="sans title">${escapeXml(title)}</text>
  <text x="60" y="108" class="sans subtitle">${escapeXml(subtitle)}</text>

  <g transform="translate(${BENCHMARK_CARD_LAYOUT[0].x}, ${BENCHMARK_CARD_LAYOUT[0].y})">
    <rect width="${BENCHMARK_CARD_LAYOUT[0].width}" height="${BENCHMARK_CARD_LAYOUT[0].height}" rx="10" class="card" filter="url(#shadow)"/>
    <text x="22" y="34" class="sans step-num">${execution.eyebrow}</text>
    <text x="22" y="62" class="sans step-title">${execution.title}</text>
    <line x1="22" y1="76" x2="518" y2="76" stroke="${palette.border}" stroke-width="1"/>
    ${renderHorizontalSeriesRows(execution.rows, {
      chartType,
      startX: 150,
      startY: 104,
      rowGap: 32,
      trackWidth: 330,
      max: execution.max,
      palette,
      kind: 'execution'
    })}
    <text x="22" y="204" class="sans small">${execution.caption}</text>
  </g>

  <g transform="translate(${BENCHMARK_CARD_LAYOUT[1].x}, ${BENCHMARK_CARD_LAYOUT[1].y})">
    <rect width="${BENCHMARK_CARD_LAYOUT[1].width}" height="${BENCHMARK_CARD_LAYOUT[1].height}" rx="10" class="card-active" filter="url(#shadow)"/>
    <text x="22" y="34" class="sans step-num">${carryover.eyebrow}</text>
    <text x="22" y="62" class="sans step-title">${carryover.title}</text>
    <line x1="22" y1="76" x2="518" y2="76" stroke="${palette.border}" stroke-width="1"/>
    ${renderHorizontalSeriesRows(carryover.rows, {
      chartType,
      startX: 180,
      startY: 104,
      rowGap: 36,
      trackWidth: 300,
      max: carryover.max,
      palette,
      kind: 'carryover'
    })}
    <text x="22" y="212" class="sans small">${carryover.caption}</text>
  </g>

  <g transform="translate(${BENCHMARK_CARD_LAYOUT[2].x}, ${BENCHMARK_CARD_LAYOUT[2].y})">
    <rect width="${BENCHMARK_CARD_LAYOUT[2].width}" height="${BENCHMARK_CARD_LAYOUT[2].height}" rx="10" class="card" filter="url(#shadow)"/>
    <text x="22" y="34" class="sans step-num">${BENCHMARK_SERIES.planning.eyebrow}</text>
    <text x="22" y="62" class="sans step-title">${BENCHMARK_SERIES.planning.title}</text>
    <line x1="22" y1="76" x2="518" y2="76" stroke="${palette.border}" stroke-width="1"/>
    ${renderPlanningRows(chartType, palette)}
    <text x="40" y="290" class="sans small">Interpretation, plan, and review under ambiguity.</text>
    <text x="40" y="306" class="sans small">${BENCHMARK_SERIES.planning.caption}</text>
  </g>

  <g transform="translate(${BENCHMARK_CARD_LAYOUT[3].x}, ${BENCHMARK_CARD_LAYOUT[3].y})">
    <rect width="${BENCHMARK_CARD_LAYOUT[3].width}" height="${BENCHMARK_CARD_LAYOUT[3].height}" rx="10" class="card" filter="url(#shadow)"/>
    <text x="22" y="34" class="sans step-num">${runtime.eyebrow}</text>
    <text x="22" y="62" class="sans step-title">${runtime.title}</text>
    <line x1="22" y1="76" x2="518" y2="76" stroke="${palette.border}" stroke-width="1"/>
    <text x="22" y="104" class="sans label">Lower is better</text>
    ${renderHorizontalSeriesRows(runtime.rows, {
      chartType,
      startX: 170,
      startY: 138,
      rowGap: 32,
      trackWidth: 300,
      max: runtime.max,
      min: runtime.min,
      palette,
      kind: 'runtime'
    })}
    <text x="22" y="236" class="sans big">98 / 98</text>
    <text x="140" y="234" class="sans small">for all three on 14-phase trust pack</text>
  </g>

  <text x="60" y="720" class="sans footer">Read proof docs for details. Playground can swap chart encoding, then save real SVG file.</text>
</svg>
`;
}

function escapeXml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

module.exports = {
  DEFAULT_SVG_PALETTE,
  applyColorOverrides,
  buildBenchmarkSummarySvg,
  buildReadmeMarkdown,
  extractHexColors,
  extractSectionAssets,
  isHexColor,
  normalizePalette,
  parseReadmeSections,
  stripOuterDividers
};

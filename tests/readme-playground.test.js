const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  applyColorOverrides,
  buildBenchmarkSummarySvg,
  buildReadmeMarkdown,
  extractHexColors,
  parseReadmeSections
} = require('../src/readme-playground');

describe('readme playground helpers', () => {
  it('parses README into hero and top-level sections', () => {
    const markdown = [
      '# Demo',
      '',
      'Hero copy.',
      '',
      '---',
      '',
      '## First',
      '',
      'Alpha',
      '',
      '---',
      '',
      '## Second',
      '',
      'Beta',
      ''
    ].join('\n');

    const sections = parseReadmeSections(markdown);

    assert.deepEqual(
      sections.map((section) => section.title),
      ['Hero', 'First', 'Second']
    );
    assert.equal(sections[0].markdown.includes('---'), false);
    assert.equal(sections[1].markdown, '## First\n\nAlpha');
  });

  it('rebuilds README markdown with dividers', () => {
    const markdown = buildReadmeMarkdown([
      { markdown: '# Demo', enabled: true },
      { markdown: '## One\n\nAlpha', enabled: true },
      { markdown: '## Two\n\nBeta', enabled: false },
      { markdown: '## Three\n\nGamma', enabled: true }
    ]);

    assert.equal(
      markdown,
      '# Demo\n\n---\n\n## One\n\nAlpha\n\n---\n\n## Three\n\nGamma\n'
    );
  });

  it('extracts unique SVG colors and remaps them safely', () => {
    const svg = '<svg><rect fill="#ABCDEF"/><circle stroke="#abcdef"/><path fill="#123456"/></svg>';
    const colors = extractHexColors(svg);

    assert.deepEqual(colors, ['#abcdef', '#123456']);
    assert.equal(
      applyColorOverrides(svg, {
        '#abcdef': '#000000',
        '#123456': '#ffffff'
      }),
      '<svg><rect fill="#000000"/><circle stroke="#000000"/><path fill="#ffffff"/></svg>'
    );
  });

  it('builds benchmark summary svg with chosen chart type and palette', () => {
    const svg = buildBenchmarkSummarySvg({
      chartType: 'dots',
      palette: {
        accent: '#ff00aa',
        pe: '#00ff88'
      }
    });

    assert.match(svg, /data-chart-type="dots"/);
    assert.match(svg, /#ff00aa/i);
    assert.match(svg, /#00ff88/i);
  });
});

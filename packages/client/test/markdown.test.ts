import { describe, expect, it } from 'vitest';
import { renderMarkdown } from '../src/notes/markdown.js';

const INJECTION_CORPUS = [
  '<script>alert(1)</script>',
  '<img src="x" onerror="alert(1)">',
  '<svg onload="alert(1)">',
  '<iframe src="https://evil.example"></iframe>',
  '<object data="https://evil.example/x.swf"></object>',
  '<embed src="https://evil.example/x.swf">',
  '<style>body { display: none; }</style>',
  '<form action="https://evil.example"><input type="text"></form>',
  '<a href="https://ok.example" onclick="alert(1)">click</a>',
  '<details open ontoggle="alert(1)">x</details>',
  '[click](javascript:alert(1))',
  '[click](JaVaScRiPt:alert(1))',
  '[click](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg)',
  '[click](vbscript:msgbox(1))',
  '![alt](https://evil.example/tracker.png)',
  '![alt](data:image/png;base64,iVBORw0KGgo)',
  '[x](https://ok.example "t")'
];

describe('markdown preview', () => {
  it('renders headings and emphasis', () => {
    const html = renderMarkdown('# Title\n\nHello *world*');
    expect(html).toContain('<h1>');
    expect(html).toContain('<em>world</em>');
  });

  it('blocks every injection payload in the corpus', () => {
    for (const payload of INJECTION_CORPUS) {
      const html = renderMarkdown(payload);
      expect(html).not.toContain('<script');
      expect(html).not.toMatch(/<[^>]+\son\w+\s*=/i);
      expect(html).not.toContain('javascript:');
      expect(html).not.toContain('vbscript:');
      expect(html).not.toContain('data:text/html');
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<object');
      expect(html).not.toContain('<embed');
      expect(html).not.toContain('<style');
      expect(html).not.toContain('<form');
      expect(html).not.toContain('<svg');
    }
  });

  it('never emits image elements so remote art cannot beacon', () => {
    for (const payload of [
      '![alt](https://evil.example/tracker.png)',
      '![alt](data:image/png;base64,iVBORw0KGgo)',
      '<img src="https://evil.example/x.png">'
    ]) {
      const html = renderMarkdown(payload);
      expect(html).not.toContain('<img');
    }
  });

  it('treats raw html as text', () => {
    const html = renderMarkdown('Hello <b>bold</b> world');
    expect(html).not.toContain('<b>');
    expect(html).toContain('bold');
  });

  it('keeps safe links with hardened rel', () => {
    const html = renderMarkdown('[ok](https://ok.example)');
    expect(html).toContain('href="https://ok.example"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('keeps mailto links', () => {
    const html = renderMarkdown('[mail](mailto:a@b.c)');
    expect(html).toContain('href="mailto:a@b.c"');
  });
});

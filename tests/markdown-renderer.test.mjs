// @ts-nocheck
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderMarkdownToFragment } from '../src/lib/markdown-renderer.js';

/**
 * Minimal DOM shim for markdown renderer tests.
 */
class FakeNode {}

class FakeText extends FakeNode {
  /** @param {string} text */
  constructor(text) {
    super();
    this.textContent = text;
  }
}

class FakeElement extends FakeNode {
  /** @param {string} [name] */
  constructor(name = 'el') {
    super();
    this.name = name;
    /** @type {FakeNode[]} */
    this.childNodes = [];
    /** @type {FakeElement|null} */
    this.parentNode = null;
    /** @type {Record<string, string>} */
    this.attributes = {};
    /** @type {Record<string, string>} */
    this.style = {};
    this.className = '';
  }

  classList = {
    _set: new Set(),
    add(className) { this._set.add(className); },
    remove(className) { this._set.delete(className); },
    contains(className) { return this._set.has(className); },
    toggle(className) { 
      if (this._set.has(className)) this._set.delete(className);
      else this._set.add(className);
    },
    get length() { return this._set.size; },
    *[Symbol.iterator]() { yield* this._set; }
  };

  /** @param {FakeNode} node */
  appendChild(node) {
    if (node instanceof FakeDocumentFragment) {
      // Expand fragment children
      for (const child of node.childNodes) {
        this.appendChild(child);
      }
      return node;
    }
    if (node instanceof FakeElement) node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  /** @param {FakeNode} node */
  contains(node) {
    if (node === this) return true;
    return this.childNodes.includes(node);
  }

  querySelector(selector) {
    // Simple selector matching: tag name, .class, [attr]
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        let match = false;
        if (selector === child.name.toLowerCase()) match = true;
        else if (selector.startsWith('.') && child.classList.has(selector.slice(1))) match = true;
        else if (selector.startsWith('[') && selector.includes(child.className)) match = true;
        if (match) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    /** @type {FakeElement[]} */
    const results = [];
    const search = (node) => {
      if (node instanceof FakeElement) {
        const match = selector === node.name.toLowerCase() ||
          (selector.startsWith('.') && node.classList.has(selector.slice(1))) ||
          (selector.startsWith('[') && selector.includes(node.className));
        if (match) results.push(node);
        for (const child of node.childNodes) search(child);
      }
    };
    search(this);
    return results;
  }

  getElementsByTagName(tagName) {
    /** @type {FakeElement[]} */
    const results = [];
    const search = (node) => {
      if (node instanceof FakeElement) {
        if (node.name.toLowerCase() === tagName.toLowerCase()) results.push(node);
        for (const child of node.childNodes) search(child);
      }
    };
    search(this);
    return results;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent ?? '').join('');
  }

  set textContent(value) {
    this.childNodes = [new FakeText(value)];
  }

  getAttributeNames() {
    return Object.keys(this.attributes);
  }
}

class FakeDocumentFragment extends FakeNode {
  constructor() {
    super();
    /** @type {FakeNode[]} */
    this.childNodes = [];
  }

  appendChild(node) {
    if (node instanceof FakeDocumentFragment) {
      // Expand fragment children
      for (const child of node.childNodes) {
        this.appendChild(child);
      }
      return node;
    }
    if (node instanceof FakeElement) node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  get childElementCount() {
    return this.childNodes.filter((n) => n instanceof FakeElement).length;
  }

  get textContent() {
    return this.childNodes.map((n) => n.textContent ?? '').join('');
  }

  querySelector(selector) {
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        if (selector === child.name.toLowerCase()) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
    }
    return null;
  }

  querySelectorAll(selector) {
    /** @type {FakeElement[]} */
    const results = [];
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        const found = child.querySelectorAll(selector);
        results.push(...found);
      }
    }
    return results;
  }

  getElementsByTagName(tagName) {
    /** @type {FakeElement[]} */
    const results = [];
    for (const child of this.childNodes) {
      if (child instanceof FakeElement) {
        const found = child.getElementsByTagName(tagName);
        results.push(...found);
      }
    }
    return results;
  }
}

function installDom() {
  globalThis.Node = /** @type {any} */ (FakeNode);
  globalThis.DocumentFragment = /** @type {any} */ (FakeDocumentFragment);
  globalThis.document = /** @type {any} */ ({
    body: new FakeElement('body'),
    activeElement: null,
    createElement: (name) => new FakeElement(name),
    createTextNode: (text) => new FakeText(text),
  });
}

beforeEach(() => {
  installDom();
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Node');
  Reflect.deleteProperty(globalThis, 'DocumentFragment');
  Reflect.deleteProperty(globalThis, 'document');
});

describe('renderMarkdownToFragment (safe markdown subset, DOM nodes only)', () => {
  it('renders headings', () => {
    const frag = renderMarkdownToFragment('# H1\n## H2\n### H3');
    const h1 = frag.getElementsByTagName('h1');
    const h2 = frag.getElementsByTagName('h2');
    const h3 = frag.getElementsByTagName('h3');
    expect(h1).toHaveLength(1);
    expect(h2).toHaveLength(1);
    expect(h3).toHaveLength(1);
    expect(h1[0].textContent).toBe('H1');
    expect(h2[0].textContent).toBe('H2');
    expect(h3[0].textContent).toBe('H3');
  });

  it('renders paragraphs', () => {
    const frag = renderMarkdownToFragment('Hello world\n\nSecond paragraph');
    const paragraphs = frag.getElementsByTagName('p');
    expect(paragraphs).toHaveLength(2);
    expect(paragraphs[0].textContent).toBe('Hello world');
    expect(paragraphs[1].textContent).toBe('Second paragraph');
  });

  it('renders bold and italic', () => {
    const frag = renderMarkdownToFragment('**bold** and *italic*');
    expect(frag.textContent).toBe('bold and italic');
    const strong = frag.querySelectorAll('strong');
    const em = frag.querySelectorAll('em');
    expect(strong.length + em.length).toBeGreaterThan(0);
  });

  it('renders unordered lists', () => {
    const frag = renderMarkdownToFragment('- item 1\n- item 2\n  - nested');
    const lists = frag.getElementsByTagName('ul');
    expect(lists.length).toBeGreaterThanOrEqual(1);
    const items = frag.getElementsByTagName('li');
    expect(items.length).toBe(3);
    expect(items[0].textContent).toBe('item 1');
    expect(items[1].textContent).toBe('item 2');
    expect(items[2].textContent).toBe('nested');
  });

  it('renders ordered lists', () => {
    const frag = renderMarkdownToFragment('1. first\n2. second');
    const ol = frag.querySelector('ol');
    expect(ol).not.toBeNull();
    const items = frag.getElementsByTagName('li');
    expect(items.length).toBe(2);
  });

  it('renders blockquotes', () => {
    const frag = renderMarkdownToFragment('> quoted text');
    const blockquote = frag.querySelector('blockquote');
    expect(blockquote).not.toBeNull();
    expect(blockquote.textContent).toBe('quoted text');
  });

  it('renders fenced code blocks', () => {
    const frag = renderMarkdownToFragment('```js\nconst x = 1;\n```');
    const pre = frag.querySelector('pre');
    expect(pre).not.toBeNull();
    const code = frag.querySelector('code');
    expect(code).not.toBeNull();
    expect(code.textContent).toBe('const x = 1;');
  });

  it('renders inline code', () => {
    const frag = renderMarkdownToFragment('Use `const x = 1` here');
    const code = frag.querySelector('code');
    expect(code).not.toBeNull();
    expect(code.textContent).toBe('const x = 1');
  });

  it('renders tables', () => {
    const frag = renderMarkdownToFragment('| A | B |\n|---|---|\n| 1 | 2 |');
    const table = frag.querySelector('table');
    expect(table).not.toBeNull();
    const rows = frag.getElementsByTagName('tr');
    expect(rows.length).toBe(2);
    const cells = frag.getElementsByTagName('td');
    const headers = frag.getElementsByTagName('th');
    // 2 headers (th) + 2 data cells (td) = 4
    expect(cells.length + headers.length).toBe(4);
  });

  it('renders links as plain text (no href, no click)', () => {
    const frag = renderMarkdownToFragment('[link](https://example.com)');
    const a = frag.querySelector('a');
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBeNull();
    expect(a.textContent).toBe('link (https://example.com)');
  });

  it('does not execute script tags (treats as text)', () => {
    const frag = renderMarkdownToFragment('<script>alert(1)</script>');
    // Markdown renderer treats HTML as literal text, doesn't parse it
    expect(frag.querySelector('script')).toBeNull();
    expect(frag.textContent).toContain('<script>');
  });

  it('strips onerror handlers', () => {
    const frag = renderMarkdownToFragment('<img src=x onerror=alert(1)>');
    expect(frag.querySelector('img')).toBeNull();
  });

  it('strips javascript: links', () => {
    const frag = renderMarkdownToFragment('[click](javascript:alert(1))');
    const a = frag.querySelector('a');
    expect(a).not.toBeNull();
    // The parser extracts url up to ')', so it gets 'javascript:alert(1'
    expect(a.textContent).toBe('click (javascript:alert(1)');
    expect(a.getAttribute('href')).toBeNull();
  });

  it('refuses oversized input (> 512 KB)', () => {
    const large = 'x'.repeat(513 * 1024);
    expect(() => renderMarkdownToFragment(large)).toThrow();
  });

  it('accepts input at exactly 512 KB', () => {
    const exact = 'x'.repeat(512 * 1024);
    expect(() => renderMarkdownToFragment(exact)).not.toThrow();
  });

  it('handles empty input', () => {
    const frag = renderMarkdownToFragment('');
    expect(frag.childElementCount).toBe(0);
  });

  it('handles markdown with only whitespace', () => {
    const frag = renderMarkdownToFragment('   \n\n  ');
    expect(frag.childElementCount).toBe(0);
  });

  it('nested formatting in list items', () => {
    const frag = renderMarkdownToFragment('- **bold item**\n- *italic item*');
    const items = frag.getElementsByTagName('li');
    expect(items.length).toBe(2);
    expect(items[0].querySelector('strong')).not.toBeNull();
    expect(items[1].querySelector('em')).not.toBeNull();
  });

  it('fenced code with info string preserved as class', () => {
    const frag = renderMarkdownToFragment('```muse\nprompt text\n```');
    const code = frag.querySelector('code');
    expect(code.classList.contains('language-muse')).toBe(true);
  });

  it('horizontal rule', () => {
    const frag = renderMarkdownToFragment('---\ncontent');
    const hr = frag.querySelector('hr');
    expect(hr).not.toBeNull();
  });
});
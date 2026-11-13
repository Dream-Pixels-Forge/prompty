import { afterEach, describe, expect, it } from 'vitest';
import { mount } from '../src/popup/dom.js';

/**
 * Minimal DOM stand-in. `replaceChildren` deliberately throws when a focused
 * child is still attached — that is Chrome's behaviour, and the bug mount()
 * has to avoid.
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
    this.focused = false;
    this.blurCalls = 0;
  }

  /** @param {FakeNode} node */
  appendChild(node) {
    if (node instanceof FakeElement) node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }

  /** @param {FakeNode} node */
  contains(node) {
    if (node === this) return true;
    return this.childNodes.includes(node);
  }

  replaceChildren() {
    if (this.childNodes.some((n) => n instanceof FakeElement && n.focused)) {
      throw new Error(
        "NotFoundError: The node to be removed is no longer a child of this node. Perhaps it was moved in a 'blur' event handler?",
      );
    }
    for (const n of this.childNodes) {
      if (n instanceof FakeElement) n.parentNode = null;
    }
    this.childNodes = [];
  }

  blur() {
    this.blurCalls += 1;
    this.focused = false;
    const doc = /** @type {any} */ (globalThis.document);
    if (doc.activeElement === this) doc.activeElement = null;
  }
}

const body = new FakeElement('body');

/** @param {FakeElement|null} activeElement */
function installDom(activeElement) {
  globalThis.Node = /** @type {any} */ (FakeNode);
  globalThis.document = /** @type {any} */ ({
    body,
    activeElement,
    /** @param {string} text */
    createTextNode: (text) => new FakeText(text),
  });
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Node');
  Reflect.deleteProperty(globalThis, 'document');
});

/** @param {FakeElement} el */
const asElement = (el) => /** @type {any} */ (el);

describe('mount', () => {
  it('blurs a focused descendant before replacing children', () => {
    const root = new FakeElement('view');
    const select = new FakeElement('duration');
    select.focused = true;
    root.appendChild(select);
    installDom(select);

    expect(() => mount(asElement(root), 'replacement')).not.toThrow();
    expect(select.blurCalls).toBe(1);
    expect(select.focused).toBe(false);
    expect(root.childNodes).toHaveLength(1);
    expect(/** @type {any} */ (root.childNodes[0]).textContent).toBe('replacement');
  });

  it('leaves focus outside the mounted subtree alone', () => {
    const root = new FakeElement('view');
    const search = new FakeElement('search');
    search.focused = true;
    installDom(search);

    mount(asElement(root), 'item');

    expect(search.blurCalls).toBe(0);
    expect(search.focused).toBe(true);
    expect(root.childNodes).toHaveLength(1);
  });

  it('does not blur the mounted element itself', () => {
    const root = new FakeElement('view');
    root.focused = true;
    installDom(root);

    expect(() => mount(asElement(root), 'item')).not.toThrow();
    expect(root.blurCalls).toBe(0);
  });
});

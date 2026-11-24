/**
 * Safe markdown renderer — builds DOM nodes with textContent only.
 * No innerHTML, no remote images, no HTML passthrough.
 * Subset: headings, paragraphs, bold/italic, lists, tables, blockquotes,
 * fenced code, inline code, links (as text), horizontal rules.
 *
 * SECURITY.md: never uses innerHTML or third-party sanitizer.
 * MAX_DOCUMENT_SIZE enforcement at the call site.
 */

import { MAX_DOCUMENT_SIZE } from './documents.js';

/**
 * @param {string} markdown
 * @returns {DocumentFragment}
 */
export function renderMarkdownToFragment(markdown) {
  if (!markdown || typeof markdown !== 'string') {
    return new DocumentFragment();
  }
  if (markdown.length > MAX_DOCUMENT_SIZE) {
    throw new Error('Markdown exceeds maximum size (512 KB)');
  }

  const frag = new DocumentFragment();
  const lines = markdown.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Fenced code blocks
    if (line.startsWith('```')) {
      const { element, nextIndex } = parseFencedCode(lines, i);
      frag.appendChild(element);
      i = nextIndex;
      continue;
    }

    // Horizontal rule
    if (line.match(/^(-{3,}|\*{3,}|_{3,})$/)) {
      frag.appendChild(document.createElement('hr'));
      i++;
      continue;
    }

    // Headings
    const headingMatch = line.match(/^(#{1,6})\s+(.*)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();
      const h = document.createElement(`h${level}`);
      h.textContent = text;
      frag.appendChild(h);
      i++;
      continue;
    }

    // Blockquotes
    if (line.startsWith('>')) {
      const { element, nextIndex } = parseBlockquote(lines, i);
      frag.appendChild(element);
      i = nextIndex;
      continue;
    }

    // Lists (unordered or ordered)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const { element, nextIndex } = parseList(lines, i);
      frag.appendChild(element);
      i = nextIndex;
      continue;
    }

    // Tables
    if (line.includes('|') && i + 1 < lines.length && lines[i + 1].match(/^\s*\|?\s*[:-|-]+\s*\|/)) {
      const { element, nextIndex } = parseTable(lines, i);
      frag.appendChild(element);
      i = nextIndex;
      continue;
    }

    // Paragraph (non-empty line)
    if (line.trim() !== '') {
      const { element, nextIndex } = parseParagraph(lines, i);
      frag.appendChild(element);
      i = nextIndex;
      continue;
    }

    // Empty line - skip
    i++;
  }

  return frag;
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ element: HTMLElement, nextIndex: number }}
 */
function parseFencedCode(lines, start) {
  const infoString = lines[start].slice(3).trim().toLowerCase();
  const contentLines = [];
  let i = start + 1;
  while (i < lines.length && !lines[i].startsWith('```')) {
    contentLines.push(lines[i]);
    i++;
  }
  // i is now at closing ``` or end of lines
  const pre = document.createElement('pre');
  const code = document.createElement('code');
  if (infoString) {
    code.classList.add(`language-${infoString}`);
  }
  // Remove trailing empty line if present
  while (contentLines.length > 0 && contentLines[contentLines.length - 1] === '') {
    contentLines.pop();
  }
  code.textContent = contentLines.join('\n');
  pre.appendChild(code);
  return { element: pre, nextIndex: i + 1 }; // skip closing ```
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ element: HTMLElement, nextIndex: number }}
 */
function parseBlockquote(lines, start) {
  const blockquote = document.createElement('blockquote');
  let i = start;
  while (i < lines.length && lines[i].startsWith('>')) {
    const content = lines[i].slice(1).trim();
    if (content) {
      const p = document.createElement('p');
      p.appendChild(parseInline(content));
      blockquote.appendChild(p);
    }
    i++;
  }
  return { element: blockquote, nextIndex: i };
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ element: HTMLElement, nextIndex: number }}
 */
function parseList(lines, start) {
  const firstMatch = lines[start].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
  if (!firstMatch) return { element: document.createElement('ul'), nextIndex: start + 1 };

  const indent = firstMatch[1].length;
  const isOrdered = /^\d+\.$/.test(firstMatch[2]);
  const listEl = document.createElement(isOrdered ? 'ol' : 'ul');

  let i = start;
  while (i < lines.length) {
    const match = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(.*)$/);
    if (!match) break;
    if (match[1].length < indent) break; // less indented = end of this list
    if (match[1].length > indent) {
      // nested list - handled recursively if needed, for now just treat as continuation
    }

    const li = document.createElement('li');
    li.appendChild(parseInline(match[3]));
    listEl.appendChild(li);
    i++;
  }

  return { element: listEl, nextIndex: i };
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ element: HTMLElement, nextIndex: number }}
 */
function parseTable(lines, start) {
  const table = document.createElement('table');
  let i = start;

  // Parse header row
  const headerCells = parseTableRow(lines[i]);
  if (headerCells.length > 0) {
    const thead = document.createElement('thead');
    const tr = document.createElement('tr');
    for (const cell of headerCells) {
      const th = document.createElement('th');
      th.appendChild(parseInline(cell));
      tr.appendChild(th);
    }
    thead.appendChild(tr);
    table.appendChild(thead);
  }
  i++;

  // Skip separator row
  i++;

  // Parse data rows
  const tbody = document.createElement('tbody');
  while (i < lines.length && lines[i].includes('|')) {
    const cells = parseTableRow(lines[i]);
    if (cells.length === 0) break;
    const tr = document.createElement('tr');
    for (const cell of cells) {
      const td = document.createElement('td');
      td.appendChild(parseInline(cell));
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
    i++;
  }
  table.appendChild(tbody);

  return { element: table, nextIndex: i };
}

/**
 * @param {string} line
 * @returns {string[]}
 */
function parseTableRow(line) {
  // Remove leading/trailing pipes
  const cleaned = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return cleaned.split('|').map((c) => c.trim());
}

/**
 * @param {string[]} lines
 * @param {number} start
 * @returns {{ element: HTMLElement, nextIndex: number }}
 */
function parseParagraph(lines, start) {
  const paragraphLines = [];
  let i = start;
  while (i < lines.length && lines[i].trim() !== '') {
    // Stop at block-level elements
    if (
      lines[i].startsWith('```') ||
      lines[i].match(/^#{1,6}\s+/) ||
      lines[i].startsWith('>') ||
      lines[i].match(/^(\s*)([-*+]|\d+\.)\s+/) ||
      lines[i].match(/^(-{3,}|\*{3,}|_{3,})$/)
    ) {
      break;
    }
    paragraphLines.push(lines[i]);
    i++;
  }
  const p = document.createElement('p');
  p.appendChild(parseInline(paragraphLines.join(' ')));
  return { element: p, nextIndex: i };
}

/**
 * Parse inline formatting: **bold**, *italic*, `code`, [link](url)
 * Returns a DocumentFragment with styled children.
 * @param {string} text
 * @returns {DocumentFragment}
 */
function parseInline(text) {
  const frag = new DocumentFragment();

  // Tokenize the text by inline patterns
  // Order matters: code first (to not parse formatting inside), then bold/italic, then links
  const tokens = tokenizeInline(text);

  for (const token of tokens) {
    if (token.type === 'text') {
      frag.appendChild(document.createTextNode(token.content));
    } else if (token.type === 'code') {
      const code = document.createElement('code');
      code.textContent = token.content;
      frag.appendChild(code);
    } else if (token.type === 'bold') {
      const strong = document.createElement('strong');
      strong.appendChild(parseInline(token.content)); // nested
      frag.appendChild(strong);
    } else if (token.type === 'italic') {
      const em = document.createElement('em');
      em.appendChild(parseInline(token.content)); // nested
      frag.appendChild(em);
    } else if (token.type === 'link') {
      const a = document.createElement('a');
      // Links shown as text only - no href, no click
      a.textContent = `${token.content} (${token.url})`;
      a.style.color = 'inherit';
      a.style.textDecoration = 'none';
      a.style.pointerEvents = 'none';
      frag.appendChild(a);
    }
  }

  return frag;
}

/**
 * @param {string} text
 * @returns {{ type: string, content: string, url?: string }[]}
 */
function tokenizeInline(text) {
  /** @type {{ type: string, content: string, url?: string }[]} */
  const tokens = [];

  // Regex to match inline elements in order of precedence:
  // 1. `code` (backticks)
  // 2. **bold** (double asterisk)
  // 3. *italic* (single asterisk, not surrounded by another *)
  // 4. [link](url)
  // 5. plain text

  // We'll use a simple state machine approach
  let pos = 0;
  const len = text.length;

  while (pos < len) {
    // Inline code: `code`
    if (text[pos] === '`') {
      const end = text.indexOf('`', pos + 1);
      if (end !== -1) {
        const content = text.slice(pos + 1, end);
        if (content) tokens.push({ type: 'code', content });
        pos = end + 1;
        continue;
      }
    }

    // Bold: **text**
    if (text.slice(pos, pos + 2) === '**') {
      const end = text.indexOf('**', pos + 2);
      if (end !== -1) {
        const content = text.slice(pos + 2, end);
        if (content) tokens.push({ type: 'bold', content });
        pos = end + 2;
        continue;
      }
    }

    // Italic: *text* (but not **)
    if (text[pos] === '*' && text.slice(pos, pos + 2) !== '**') {
      const end = text.indexOf('*', pos + 1);
      if (end !== -1) {
        const content = text.slice(pos + 1, end);
        if (content) tokens.push({ type: 'italic', content });
        pos = end + 1;
        continue;
      }
    }

    // Link: [text](url)
    if (text[pos] === '[') {
      const bracketEnd = text.indexOf(']', pos + 1);
      if (bracketEnd !== -1) {
        const parenStart = text.indexOf('(', bracketEnd + 1);
        if (parenStart !== -1 && parenStart === bracketEnd + 1) {
          const parenEnd = text.indexOf(')', parenStart + 1);
          if (parenEnd !== -1) {
            const content = text.slice(pos + 1, bracketEnd);
            const url = text.slice(parenStart + 1, parenEnd);
            if (content) tokens.push({ type: 'link', content, url });
            pos = parenEnd + 1;
            continue;
          }
        }
      }
    }

    // Plain text - accumulate until next special char
    let nextSpecial = len;
    for (const ch of ['`', '*', '[']) {
      const idx = text.indexOf(ch, pos);
      if (idx !== -1 && idx < nextSpecial) nextSpecial = idx;
    }
    if (nextSpecial === pos) {
      // Current char is a special char but no closing delimiter found
      // Treat it as literal text and advance by 1
      tokens.push({ type: 'text', content: text[pos] });
      pos++;
    } else {
      const content = text.slice(pos, nextSpecial);
      if (content) tokens.push({ type: 'text', content });
      pos = nextSpecial;
    }
  }

  return tokens;
}
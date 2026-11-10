/**
 * G5 — word-level diff for prompt version compare. Pure; no DOM.
 * Tokens are words, single punctuation marks and whitespace runs, so every
 * diff re-joins exactly to both inputs.
 */

/**
 * @typedef {{ op: 'same'|'add'|'del', text: string }} DiffOp
 */

/** Above this many tokens per side, skip LCS (O(n·m)) and diff coarsely. */
const MAX_TOKENS = 2000;

/**
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  return String(text ?? '').match(/\s+|[\p{L}\p{N}_'’/.-]+|[^\s]/gu) ?? [];
}

/**
 * Word-level diff of `before` → `after`.
 * @param {string} before
 * @param {string} after
 * @returns {DiffOp[]}
 */
export function diffWords(before, after) {
  const a = tokenize(before);
  const b = tokenize(after);

  // Trim the common prefix/suffix first: cheap, and most edits are local.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }

  /** @type {DiffOp[]} */
  const ops = [];
  /** @param {DiffOp['op']} op @param {string} text */
  const push = (op, text) => {
    if (text === '') return;
    const last = ops[ops.length - 1];
    if (last && last.op === op) last.text += text;
    else ops.push({ op, text });
  };

  push('same', a.slice(0, start).join(''));
  const midA = a.slice(start, endA);
  const midB = b.slice(start, endB);

  if (midA.length > MAX_TOKENS || midB.length > MAX_TOKENS) {
    // Coarse fallback: the whole changed middle as one replacement.
    push('del', midA.join(''));
    push('add', midB.join(''));
  } else {
    // LCS table over the changed middle.
    const n = midA.length;
    const m = midB.length;
    const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        table[i][j] =
          midA[i] === midB[j]
            ? table[i + 1][j + 1] + 1
            : Math.max(table[i + 1][j], table[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (midA[i] === midB[j]) {
        push('same', midA[i]);
        i++;
        j++;
      } else if (table[i + 1][j] >= table[i][j + 1]) {
        push('del', midA[i++]);
      } else {
        push('add', midB[j++]);
      }
    }
    while (i < n) push('del', midA[i++]);
    while (j < m) push('add', midB[j++]);
  }

  push('same', a.slice(endA).join(''));
  return phrase(ops);
}

/**
 * Readability pass: whitespace that merely separates two changes becomes part
 * of the change, and each run of changes is grouped as "all deleted, then all
 * added". "tracks backward" → "pulls back on a slow dolly" reads as one edit
 * instead of word confetti. Both sides still re-join exactly.
 * @param {DiffOp[]} ops
 * @returns {DiffOp[]}
 */
function phrase(ops) {
  /** @type {DiffOp[]} */
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i].op === 'same') {
      out.push({ ...ops[i] });
      i++;
      continue;
    }
    let del = '';
    let add = '';
    while (i < ops.length) {
      const o = ops[i];
      if (o.op === 'del') del += o.text;
      else if (o.op === 'add') add += o.text;
      else if (/^\s+$/.test(o.text) && ops[i + 1] && ops[i + 1].op !== 'same') {
        del += o.text;
        add += o.text;
      } else break;
      i++;
    }
    // Whitespace both sides share at the edges isn't a change: give it back
    // to the unchanged text so highlights hug the words.
    const lead = del && add ? sharedWhitespace(del, add, 'start') : '';
    const trail =
      del && add ? sharedWhitespace(del.slice(lead.length), add.slice(lead.length), 'end') : '';
    if (lead) pushSame(out, lead);
    const cut = (/** @type {string} */ t) => t.slice(lead.length, t.length - trail.length);
    if (del) out.push({ op: 'del', text: lead || trail ? cut(del) : del });
    if (add) out.push({ op: 'add', text: lead || trail ? cut(add) : add });
    if (trail) pushSame(out, trail);
  }
  // Merge same-runs split by the trimming above.
  /** @type {DiffOp[]} */
  const merged = [];
  for (const o of out) {
    if (o.text === '') continue;
    const last = merged[merged.length - 1];
    if (last && last.op === o.op) last.text += o.text;
    else merged.push(o);
  }
  return merged;
}

/**
 * @param {DiffOp[]} out
 * @param {string} text
 */
function pushSame(out, text) {
  const last = out[out.length - 1];
  if (last && last.op === 'same') last.text += text;
  else out.push({ op: 'same', text });
}

/**
 * Longest whitespace run both strings share at their start or end.
 * @param {string} a
 * @param {string} b
 * @param {'start'|'end'} edge
 * @returns {string}
 */
function sharedWhitespace(a, b, edge) {
  const re = edge === 'start' ? /^\s+/ : /\s+$/;
  const wa = a.match(re)?.[0] ?? '';
  const wb = b.match(re)?.[0] ?? '';
  let n = 0;
  while (n < wa.length && n < wb.length) {
    const ca = edge === 'start' ? wa[n] : wa[wa.length - 1 - n];
    const cb = edge === 'start' ? wb[n] : wb[wb.length - 1 - n];
    if (ca !== cb) break;
    n++;
  }
  // Never empty a side entirely.
  n = Math.min(n, a.length - 1, b.length - 1);
  if (n <= 0) return '';
  return edge === 'start' ? wa.slice(0, n) : wa.slice(wa.length - n);
}

/**
 * Split a diff into the two columns of a side-by-side compare.
 * @param {DiffOp[]} ops
 * @returns {{ before: DiffOp[], after: DiffOp[] }}
 */
export function sides(ops) {
  return {
    before: ops.filter((o) => o.op !== 'add'),
    after: ops.filter((o) => o.op !== 'del'),
  };
}

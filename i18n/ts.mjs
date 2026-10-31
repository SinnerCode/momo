// Finds Chinese UI strings in frontend/src and web/index.html, and rewrites them from i18n/en.json.
//   node i18n/ts.mjs extract <repo>          -> JSON units on stdout
//   node i18n/ts.mjs apply <repo> <en.json>  -> rewrites <repo> in place (run on a copy)
// A string in a matching position (===, switch, Set/Map, includes, keys, literal types…) is
// "unsafe": it is data, so it stays Chinese at every frontend site unless listed in allow.txt.
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';

const [mode, repoArg, catalogPath] = process.argv.slice(2);
const repo = resolve(repoArg);
const { parseSync } = createRequire(join(repo, 'frontend/package.json'))('oxc-parser');
const CJK = /[㐀-鿿豈-﫿　-〿＀-￯]/;
const HAN = /[㐀-鿿豈-﫿]/;
// The fork's own name (Peach's name policy): only the standalone word, never peach-*, Peach.app, X-Peach-*.
const BRAND = /(?<![-_./\w])Peach(?![-_./]?\w)/g;
const brand = text => text.replace(BRAND, 'Momo');
const hasBrand = text => new RegExp(BRAND.source).test(text);
const TRANSPARENT = new Set(['ArrayExpression', 'ConditionalExpression', 'LogicalExpression', 'ParenthesizedExpression',
  'TSAsExpression', 'TSSatisfiesExpression', 'TSNonNullExpression', 'SequenceExpression', 'SpreadElement']);
const MATCH_METHODS = new Set(['includes', 'startsWith', 'endsWith', 'indexOf', 'lastIndexOf', 'split', 'replace',
  'replaceAll', 'match', 'matchAll', 'search', 'test', 'has', 'get', 'delete', 'localeCompare', 'hasOwn',
  'hasOwnProperty', 'getAttribute', 'querySelector', 'querySelectorAll', 'closest', 'matches']);
const MATCH_CALLEES = new Set(['RegExp', 'Set', 'Map', 'WeakMap', 'WeakSet']);
const COMPARE = new Set(['===', '!==', '==', '!=', 'in', '<', '>', '<=', '>=']);

function files(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files(path, out);
    else if (/\.(m?js|tsx?)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) out.push(path);
  }
  return out;
}

const calleeName = callee => callee?.type === 'Identifier' ? callee.name
  : callee?.type === 'MemberExpression' && !callee.computed ? callee.property.name : '';

// Climb through wrappers that pass a value through, then judge the position it lands in.
// 'compare': equality, switch, key or literal type — internal state, consistent if every site changes.
// 'match': substring, regex, Set/Map lookup — may parse outside text, so it always stays.
function unsafe(node, parents) {
  let child = node;
  let i = parents.length - 1;
  while (i >= 0 && TRANSPARENT.has(parents[i].type) && !(parents[i].type === 'ConditionalExpression' && parents[i].test === child)) {
    child = parents[i--];
  }
  const at = parents[i];
  if (!at) return false;
  switch (at.type) {
    case 'BinaryExpression': return COMPARE.has(at.operator) && 'compare';
    case 'SwitchCase': return at.test === child && 'compare';
    case 'Property': case 'PropertyDefinition': case 'MethodDefinition': case 'TSPropertySignature':
      return at.key === child && 'compare';
    case 'MemberExpression':
      if (at.property === child) return 'compare';
      return !at.computed && MATCH_METHODS.has(at.property.name) && 'match';
    case 'TSLiteralType': case 'TSEnumMember': return 'compare';
    case 'CallExpression': case 'NewExpression': {
      if (at.callee === child) return 'match';
      const name = calleeName(at.callee);
      if (MATCH_CALLEES.has(name) || MATCH_METHODS.has(name)) return 'match';
      return name === 'set' && at.arguments[0] === child && 'compare';
    }
    default: return false;
  }
}

function templateUnit(node, source) {
  if (node.quasis.some(q => q.value.cooked == null)) return null;
  const text = node.quasis.map((q, n) => (n ? `{$${n - 1}}` : '') + q.value.cooked).join('');
  return HAN.test(node.quasis.map(q => q.value.cooked).join('')) ? text : null;
}

const jsxCollapse = raw => raw.split(/\r?\n/).map(line => line.trim()).filter(Boolean).join(' ');
const escapeTemplate = text => text.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
const escapeJsxText = text => text.replace(/[{}<>]/g, c => ({ '{': '&#123;', '}': '&#125;', '<': '&lt;', '>': '&gt;' })[c]);
const escapeJsxAttr = text => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

function scanFile(path, source, emit) {
  const parsed = parseSync(path, source);
  if (parsed.errors.length) throw new Error(`${path}: ${parsed.errors[0].message}`);
  const parents = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    const parent = parents.at(-1);
    if (node.type === 'ImportDeclaration' || node.type === 'ExportAllDeclaration'
      || (node.type === 'ExportNamedDeclaration' && node.source)) return;
    if (node.type === 'TaggedTemplateExpression') return;
    // brandOnly: English text that names Peach; renamed, never sent to DeepL.
    if (node.type === 'Literal' && typeof node.value === 'string' && (HAN.test(node.value) || hasBrand(node.value))) {
      emit({ kind: parent?.type === 'JSXAttribute' ? 'jsxattr' : 'string', node, text: node.value,
        unsafe: unsafe(node, parents), brandOnly: !HAN.test(node.value) });
    } else if (node.type === 'TemplateLiteral') {
      const text = templateUnit(node, source);
      const plain = node.quasis.every(q => q.value.cooked != null) && node.quasis.map((q, n) => (n ? `{$${n - 1}}` : '') + q.value.cooked).join('');
      if (text != null) emit({ kind: 'template', node, text, unsafe: unsafe(node, parents) });
      else if (plain && hasBrand(plain)) emit({ kind: 'template', node, text: plain, unsafe: unsafe(node, parents), brandOnly: true });
    } else if (node.type === 'JSXText' && (HAN.test(node.value) || hasBrand(node.value))) {
      emit({ kind: 'jsxtext', node, text: jsxCollapse(node.value), unsafe: false, brandOnly: !HAN.test(node.value) });
    }
    parents.push(node);
    for (const [key, child] of Object.entries(node)) if (key !== 'parent' && key !== 'comments') walk(child);
    parents.pop();
  };
  walk(parsed.program);
}

// toLocaleString('zh-CN') etc. format dates the Chinese way; the English build formats them as en-US.
const localeFix = source => source.replace(/(toLocale(?:Date|Time)?String\(\s*)(['"])zh-CN\2/g, '$1$2en-US$2');

// Splices edits into source[lo, hi). An edit's value may be a function of `render`, so a template
// keeps its own translated inner strings: nested edits are rendered inside, never applied twice.
function rewrite(source, edits, lo = 0, hi = source.length) {
  const inside = edits.filter(e => e.start >= lo && e.end <= hi).sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '', at = lo;
  for (const edit of inside) {
    if (edit.start < at) continue;
    const render = (s, e) => rewrite(source, edits.filter(x => x !== edit), s, e);
    out += source.slice(at, edit.start) + (typeof edit.value === 'function' ? edit.value(render) : edit.value);
    at = edit.end;
  }
  return out + source.slice(at, hi);
}

function replacement(unit, en, source) {
  const { node, kind } = unit;
  if (kind === 'jsxtext') {
    const lead = node.value.match(/^\s*/)[0], trail = node.value.match(/\s*$/)[0];
    return escapeJsxText(lead.includes('\n') ? ' ' : lead) + escapeJsxText(en) + (trail.includes('\n') ? ' ' : trail);
  }
  if (kind === 'jsxattr') return `"${escapeJsxAttr(en)}"`;
  if (kind === 'string') return JSON.stringify(en);
  return render => {
    const expressions = node.expressions.map(e => render(e.start, e.end));
    const parts = en.split(/\{\$(\d+)\}/);
    let out = '`';
    for (let n = 0; n < parts.length; n++) out += n % 2 ? '${' + expressions[Number(parts[n])] + '}' : escapeTemplate(parts[n]);
    return out + '`';
  };
}

// web/index.html: text between tags and attribute values.
const HTML_TEXT = /(>|^)([^<>]*[㐀-鿿][^<>]*)(?=<|$)/gm;
const HTML_ATTR = /(\s(?:title|alt|aria-label|placeholder|content)=")([^"]*[㐀-鿿][^"]*)(")/g;

function htmlUnits(source) {
  const units = [];
  const body = source.replace(/<!--[\s\S]*?-->/g, m => ' '.repeat(m.length)).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, m => ' '.repeat(m.length));
  for (const m of body.matchAll(HTML_ATTR)) units.push({ start: m.index + m[1].length, end: m.index + m[1].length + m[2].length, text: m[2], attr: true });
  for (const m of body.matchAll(HTML_TEXT)) {
    const text = m[2].trim();
    if (!text || text.startsWith('!')) continue;
    const at = m.index + m[1].length + m[2].indexOf(text);
    units.push({ start: at, end: at + text.length, text });
  }
  return units;
}
const escapeHtml = (text, attr) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, attr ? '&quot;' : '"');

const sources = files(join(repo, 'frontend/src'));
const indexHtml = join(repo, 'web/index.html');

if (mode === 'extract') {
  const units = [];
  for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    scanFile(path, source, unit => unit.brandOnly || units.push({ text: unit.text, unsafe: unit.unsafe, kind: unit.kind,
      at: `${relative(repo, path)}:${source.slice(0, unit.node.start).split('\n').length}` }));
  }
  for (const unit of htmlUnits(readFileSync(indexHtml, 'utf8'))) units.push({ text: unit.text, unsafe: false, kind: 'html', at: 'web/index.html' });
  process.stdout.write(JSON.stringify(units));
} else if (mode === 'apply') {
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  // A string matched as data at any frontend site stays Chinese at every site, so values and
  // comparisons agree; allow.txt lifts that for reviewed UI words (their matching sites still stay).
  const allow = new Map(readFileSync(join(repo, 'i18n/allow.txt'), 'utf8').split('\n')
    .filter(l => l && !l.startsWith('#')).map(l => { const [text, ...only] = l.split('\t'); return [text, only]; }));
  // Frontend-only state strings (only 'compare' sites, not a backend string) translate at every site.
  const backend = new Set(JSON.parse(readFileSync(join(repo, 'i18n/backend-strings.json'), 'utf8')));
  const matched = new Set();
  for (const path of sources) scanFile(path, readFileSync(path, 'utf8'), u => { if (u.unsafe === 'match') matched.add(u.text); });
  const frontendOnly = text => !backend.has(text) && !matched.has(text);
  const data = new Set();
  for (const path of sources) scanFile(path, readFileSync(path, 'utf8'), u => {
    if (u.unsafe && !u.brandOnly && !allow.has(u.text) && !frontendOnly(u.text)) data.add(u.text);
  });
  let changed = 0, kept = 0;
  for (const path of sources) {
    const source = readFileSync(path, 'utf8');
    const edits = [];
    const file = relative(repo, path);
    scanFile(path, source, unit => {
      const en = unit.brandOnly ? unit.text : catalog[unit.text];
      const only = allow.get(unit.text);
      const blocked = unit.unsafe && !(unit.kind !== 'jsxtext' && !unit.brandOnly && frontendOnly(unit.text) && !allow.has(unit.text));
      if (blocked || data.has(unit.text) || (only?.length && !only.includes(file)) || en == null) { kept++; return; }
      edits.push({ start: unit.node.start, end: unit.node.end, value: replacement(unit, brand(en), source) });
    });
    const next = localeFix(rewrite(source, edits));
    if (next !== source) { writeFileSync(path, next); changed += edits.length; }
  }
  const html = readFileSync(indexHtml, 'utf8');
  const edits = htmlUnits(html).filter(u => catalog[u.text] != null)
    .map(u => ({ start: u.start, end: u.end, value: escapeHtml(brand(catalog[u.text]), u.attr) }));
  writeFileSync(indexHtml, rewrite(html, edits).replace(/<html lang="zh-CN"/, '<html lang="en"'));
  console.error(`ts: translated ${changed + edits.length}, kept ${kept}`);
} else {
  console.error('usage: ts.mjs extract|apply <repo> [en.json]');
  process.exit(2);
}

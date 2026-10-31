"""Finds Chinese UI strings in src/peach and rewrites them from i18n/en.json.

  python3 i18n/py.py extract <repo>          -> JSON units on stdout
  python3 i18n/py.py apply <repo> <en.json>  -> rewrites <repo> in place (run on a copy)

Docstrings are skipped. A string in a matching position (comparison, dict key, subscript, set,
regex or str-method argument, constant tuple/list, dict with Chinese keys) is "unsafe": it is
data, so translate.py never translates it anywhere.
"""
import ast
import base64
import json
import re
import sys
from pathlib import Path

HAN = re.compile(r'[\u3400-\u9fff\uf900-\ufaff]')
# The fork's own name (Peach's name policy): only the standalone word, never peach-*, Peach.app, X-Peach-*.
BRAND = re.compile(r'(?<![-_./\w])Peach(?![-_./]?\w)')


def brand(text):
    return BRAND.sub('Momo', text)
TRANSPARENT = (ast.List, ast.Tuple, ast.IfExp, ast.BoolOp, ast.Starred)
MATCH_CALLS = {
    'compile', 'search', 'match', 'fullmatch', 'sub', 'subn', 'split', 'rsplit', 'findall', 'finditer', 'escape',
    'startswith', 'endswith', 'replace', 'find', 'rfind', 'index', 'rindex', 'count', 'strip', 'lstrip', 'rstrip',
    'removeprefix', 'removesuffix', 'partition', 'rpartition', 'translate', 'maketrans', 'get', 'pop', 'setdefault',
    'set', 'frozenset', 'fromkeys', 'select', 'select_one', 'find_all', 'xpath', 'css', 'cssselect', 'execute',
    'executemany', 'executescript', 'getattr', 'hasattr', 'isinstance', 'casefold', 'lower', 'upper',
}


def call_name(func):
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return ''


def has_cjk_key(node):
    return any(isinstance(k, ast.Constant) and isinstance(k.value, str) and HAN.search(k.value) for k in node.keys)


def unsafe(node, parents):
    child, i = node, len(parents) - 1
    while i >= 0 and isinstance(parents[i], TRANSPARENT) and not (isinstance(parents[i], ast.IfExp) and parents[i].test is child):
        child, i = parents[i], i - 1
    at = parents[i] if i >= 0 else None
    if isinstance(at, (ast.Compare, ast.Set, ast.Subscript, ast.MatchValue, ast.match_case)):
        return True
    if isinstance(at, ast.Dict):
        return child in at.keys or has_cjk_key(at)
    if isinstance(at, ast.Attribute):
        return at.attr not in ('join', 'format')
    if isinstance(at, ast.keyword):
        call = parents[i - 1]
        return call_name(call.func) in MATCH_CALLS or at.arg in ('string', 'text')
    if isinstance(at, ast.Call):
        return at.func is child or call_name(at.func) in MATCH_CALLS
    if isinstance(at, (ast.Assign, ast.AnnAssign)) and child is not node:
        targets = at.targets if isinstance(at, ast.Assign) else [at.target]
        return any(isinstance(t, ast.Name) and t.id.isupper() for t in targets)
    return False


def docstrings(tree):
    found = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)):
            for stmt in node.body:
                if isinstance(stmt, ast.Expr) and isinstance(stmt.value, (ast.Constant, ast.JoinedStr)):
                    found.add(id(stmt.value))
    return found


def joined_text(node):
    parts, n = [], 0
    for value in node.values:
        if isinstance(value, ast.Constant):
            parts.append(value.value)
        else:
            parts.append('{$%d}' % n)
            n += 1
    return ''.join(parts)


def field_source(value):
    conversion = '' if value.conversion == -1 else '!' + chr(value.conversion)
    spec = ':' + fstring_body(value.format_spec) if value.format_spec else ''
    return '{' + ast.unparse(value.value) + conversion + spec + '}'


def escape_fstring_text(text):
    return text.replace('\\', '\\\\').replace('"', '\\"').replace('\n', '\\n').replace('\r', '\\r') \
        .replace('{', '{{').replace('}', '}}')


def fstring_body(node):
    return ''.join(escape_fstring_text(v.value) if isinstance(v, ast.Constant) else field_source(v) for v in node.values)


def scan(source):
    tree = ast.parse(source)
    skip = docstrings(tree)
    units, parents = [], []

    def walk(node):
        if id(node) in skip or isinstance(node, (ast.Import, ast.ImportFrom)):
            return
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and HAN.search(node.value):
            if not isinstance(parents[-1] if parents else None, (ast.JoinedStr, ast.FormattedValue)):
                units.append({'node': node, 'text': node.value, 'unsafe': unsafe(node, parents)})
            return
        if isinstance(node, ast.JoinedStr):
            if any(isinstance(v, ast.Constant) and HAN.search(v.value) for v in node.values):
                units.append({'node': node, 'text': joined_text(node), 'unsafe': unsafe(node, parents)})
        parents.append(node)
        for child in ast.iter_child_nodes(node):
            walk(child)
        parents.pop()

    walk(tree)
    return units


def replacement(unit, en, span, render):
    """New literal source. f-string fields keep their own source, with nested edits rendered in."""
    node = unit['node']
    if isinstance(node, ast.Constant):
        return repr(en).encode()

    def field(value):
        conversion = b'' if value.conversion == -1 else b'!' + chr(value.conversion).encode()
        spec = b':' + fstring_body(value.format_spec).encode() if value.format_spec else b''
        return b'{' + render(*span(value.value)) + conversion + spec + b'}'

    fields = [v for v in node.values if isinstance(v, ast.FormattedValue)]
    out, pieces = b'f"', re.split(r'\{\$(\d+)\}', en)
    for n, piece in enumerate(pieces):
        out += field(fields[int(piece)]) if n % 2 else escape_fstring_text(piece).encode()
    return out + b'"'


def rewrite(data, edits, lo, hi):
    inside = sorted((e for e in edits if e[0] >= lo and e[1] <= hi), key=lambda e: (e[0], -e[1]))
    out, at = b'', lo
    for edit in inside:
        start, end, build = edit
        if start < at:
            continue
        others = [e for e in edits if e is not edit]
        out += data[at:start] + build(lambda s, e: rewrite(data, others, s, e))
        at = end
    return out + data[at:hi]


def byte_offsets(source):
    starts, total = [0], 0
    for line in source.encode().splitlines(keepends=True):
        total += len(line)
        starts.append(total)
    return starts


def files(repo):
    yield from sorted((repo / 'src/peach').rglob('*.py'))
    yield repo / 'tools/amane-bridge/bridge.py'


# Media source registry shared by Python and the frontend; only its display fields translate (`id` is the key).
SOURCES_JSON = 'resources/media-sources.json'
SOURCE_FIELDS = ('name', 'label')


def main():
    mode, repo = sys.argv[1], Path(sys.argv[2]).resolve()
    sources = json.loads((repo / SOURCES_JSON).read_text(encoding='utf-8'))
    if mode == 'extract':
        out = []
        for path in files(repo):
            for unit in scan(path.read_text(encoding='utf-8')):
                out.append({'text': unit['text'], 'unsafe': unit['unsafe'], 'kind': 'py',
                            'at': f"{path.relative_to(repo)}:{unit['node'].lineno}"})
        out += [{'text': row[f], 'unsafe': False, 'kind': 'json', 'at': SOURCES_JSON}
                for row in sources for f in SOURCE_FIELDS if HAN.search(row[f])]
        json.dump(out, sys.stdout, ensure_ascii=False)
        return
    catalog = json.loads(Path(sys.argv[3]).read_text(encoding='utf-8'))
    # A string matched as data anywhere in Python stays Chinese everywhere in Python.
    data = {u['text'] for path in files(repo) for u in scan(path.read_text(encoding='utf-8')) if u['unsafe']}
    catalog = {k: v for k, v in catalog.items() if k not in data}
    # allow.txt "text<TAB>file…" limits a word to those files, here as in ts.mjs.
    only = {text: files_ for text, *files_ in (l.split('\t') for l in
            (repo / 'i18n/allow.txt').read_text(encoding='utf-8').splitlines() if l and not l.startswith('#')) if files_}
    changed = kept = 0
    for path in files(repo):
        source = path.read_text(encoding='utf-8')
        starts, data, edits = byte_offsets(source), source.encode(), []
        span = lambda n: (starts[n.lineno - 1] + n.col_offset, starts[n.end_lineno - 1] + n.end_col_offset)
        file = str(path.relative_to(repo))
        for unit in scan(source):
            en = catalog.get(unit['text'])
            if unit['unsafe'] or en is None or file not in only.get(unit['text'], [file]):
                kept += 1
                continue
            edits.append((*span(unit['node']), lambda render, unit=unit, en=brand(en): replacement(unit, en, span, render)))
        if path.name == 'web_state.py':
            png = base64.b64encode((repo / 'i18n/brand/momo-logo-64.png').read_bytes()).decode()
            svg = ('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
                   f'<image width="64" height="64" href="data:image/png;base64,{png}"/></svg>')
            for node in ast.parse(source).body:
                if isinstance(node, ast.Assign) and any(getattr(t, 'id', '') == 'FAVICON' for t in node.targets):
                    edits.append((*span(node.value), lambda render, svg=svg: repr(svg).encode()))
        data = rewrite(data, edits, 0, len(data))
        if edits:
            text = data.decode()
            ast.parse(text, filename=str(path))
            path.write_text(text, encoding='utf-8')
            changed += len(edits)
    for row in sources:
        for f in SOURCE_FIELDS:
            if row[f] in catalog:
                row[f], changed = brand(catalog[row[f]]), changed + 1
    (repo / SOURCES_JSON).write_text(json.dumps(sources, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'py: translated {changed}, kept {kept}', file=sys.stderr)


if __name__ == '__main__':
    main()

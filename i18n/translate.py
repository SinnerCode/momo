"""Fills i18n/en.json with DeepL translations of every safe Chinese string in the repo.

  python3 i18n/translate.py [--dry-run]

Reads the DeepL key from ~/.secrets/deepl-api-key (or DEEPL_API_KEY). Only strings missing from
en.json are sent, so a re-run after an upstream merge costs only the new strings. Strings whose
placeholders or tags do not survive translation go to i18n/failed.json and stay Chinese.
"""
import html
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parent
API = 'https://api-free.deepl.com/v2'
CONTEXT = ('User interface text of Peach, a self-hosted video library manager for Japanese adult videos: '
           'media folders, scanning, scraping metadata from sites, actresses, studios, tags, covers, playback, '
           'downloads and settings. Keep it short and plain like app UI copy.')
TOKEN = re.compile(r'\{\$\d+\}|\{[A-Za-z_][A-Za-z0-9_.]*(?:[!:][^{}]*)?\}|\{\d*\}'
                   r'|%(?:\([A-Za-z_]+\))?[-+ #0]*\d*(?:\.\d+)?[sdifrx]')
TAG = re.compile(r'</?[A-Za-z][^<>]*>')
WRAPPED = re.compile(r'<x>(.*?)</x>', re.S)


def key():
    value = os.environ.get('DEEPL_API_KEY') or (Path.home() / '.secrets/deepl-api-key').read_text().strip()
    return 'DeepL-Auth-Key ' + value


def call(path, fields, method='POST'):
    data = urllib.parse.urlencode(fields, doseq=True).encode() if fields is not None else None
    request = urllib.request.Request(f'{API}/{path}', data=data, method=method, headers={'Authorization': key()})
    with urllib.request.urlopen(request, timeout=120) as response:
        body = response.read()
    return json.loads(body) if body else None


def strings():
    ts = json.loads(subprocess.run(['node', HERE / 'ts.mjs', 'extract', REPO], check=True, capture_output=True).stdout)
    py = json.loads(subprocess.run([sys.executable, '-I', HERE / 'py.py', 'extract', REPO], check=True,
                                   capture_output=True).stdout)
    units = ts + py
    allow = {l.split('\t')[0] for l in (HERE / 'allow.txt').read_text(encoding='utf-8').splitlines()
             if l and not l.startswith('#')}
    # ts.mjs translates a frontend-only data string at every site at once, so it stays consistent;
    # it needs the backend strings to know which are frontend-only (the web build has no Python).
    backend = sorted({u['text'] for u in py})
    (HERE / 'backend-strings.json').write_text(json.dumps(backend, ensure_ascii=False, indent=0) + '\n', encoding='utf-8')
    matched = {u['text'] for u in ts if u['unsafe'] == 'match'}
    frontend_only = {u['text'] for u in ts} - set(backend) - matched
    unsafe = {u['text'] for u in units if u['unsafe']} - allow - frontend_only
    return sorted({u['text'] for u in units} - unsafe)


def is_html(text):
    return bool(TAG.search(text))


def encode(text):
    """XML/HTML payload with placeholders wrapped in <x>, which DeepL leaves alone."""
    if is_html(text):
        parts = re.split(r'(</?[A-Za-z][^<>]*>)', text)
        return ''.join(p if n % 2 else TOKEN.sub(lambda m: f'<x>{m[0]}</x>', p) for n, p in enumerate(parts))
    out, last = [], 0
    for m in TOKEN.finditer(text):
        out += [html.escape(text[last:m.start()], quote=False), f'<x>{html.escape(m[0], quote=False)}</x>']
        last = m.end()
    return ''.join(out + [html.escape(text[last:], quote=False)])


def decode(text, source):
    if is_html(source):
        return WRAPPED.sub(lambda m: m[1], text)
    return html.unescape(WRAPPED.sub(lambda m: m[1], text))


def valid(source, result):
    same = lambda pattern: sorted(pattern.findall(source)) == sorted(pattern.findall(result))
    tags = lambda s: [re.match(r'</?([A-Za-z]+)', t)[1] for t in TAG.findall(s)]
    return bool(result.strip()) and same(TOKEN) and sorted(tags(source)) == sorted(tags(result)) \
        and source.count('\n') == result.count('\n')


def edges(text):
    core = text.strip()
    start = text.find(core) if core else 0
    return text[:start], text[start + len(core):]


def translate(batch, glossary, tag_handling):
    out = translate_core([t.strip() for t in batch], glossary, tag_handling)
    return [edges(s)[0] + r.strip() + edges(s)[1] for s, r in zip(batch, out)]


def translate_core(batch, glossary, tag_handling):
    fields = {'text': [encode(t) for t in batch], 'source_lang': 'ZH', 'target_lang': 'EN-US',
              'tag_handling': tag_handling, 'ignore_tags': 'x', 'preserve_formatting': '1',
              'split_sentences': 'nonewlines', 'context': CONTEXT, 'glossary_id': glossary}
    out = [decode(t['text'], s) for t, s in zip(call('translate', fields)['translations'], batch)]
    # Glossary terms come back lowercase; a string that starts a label or sentence starts upper.
    return [r[0].upper() + r[1:] if r[:1].islower() and re.match(r'[㐀-鿿]', s) else r for r, s in zip(out, batch)]


def main():
    catalog_path, failed_path = HERE / 'en.json', HERE / 'failed.json'
    catalog = json.loads(catalog_path.read_text(encoding='utf-8')) if catalog_path.exists() else {}
    wanted = strings()
    catalog = {k: v for k, v in catalog.items() if k in set(wanted)}
    # --retranslate WORD: drop entries containing WORD, e.g. after changing its glossary line.
    if '--retranslate' in sys.argv:
        word = sys.argv[sys.argv.index('--retranslate') + 1]
        catalog = {k: v for k, v in catalog.items() if word not in k}
    # manual.json: hand translations for strings DeepL cannot keep intact; they always win.
    manual_path = HERE / 'manual.json'
    if manual_path.exists():
        catalog.update({k: v for k, v in json.loads(manual_path.read_text(encoding='utf-8')).items() if k in set(wanted)})
    missing = [t for t in wanted if t not in catalog]
    print(f'{len(wanted)} safe strings, {len(missing)} to translate, {sum(map(len, missing))} characters')
    if '--dry-run' in sys.argv:
        return
    save = lambda: catalog_path.write_text(json.dumps(dict(sorted(catalog.items())), ensure_ascii=False, indent=0) + '\n',
                                           encoding='utf-8')
    if not missing:
        save()
        return
    entries = (HERE / 'glossary.tsv').read_text(encoding='utf-8')
    glossary = call('glossaries', {'name': 'peach-en', 'source_lang': 'zh', 'target_lang': 'en',
                                   'entries': entries, 'entries_format': 'tsv'})['glossary_id']
    failed = {}
    try:
        for mode in ('xml', 'html'):
            group = [t for t in missing if is_html(t) == (mode == 'html')]
            for start in range(0, len(group), 50):
                batch = group[start:start + 50]
                for source, result in zip(batch, translate(batch, glossary, mode)):
                    if valid(source, result):
                        catalog[source] = result
                    else:
                        failed[source] = result
                print(f'{mode}: {min(start + 50, len(group))}/{len(group)}', flush=True)
                save()
    finally:
        call(f'glossaries/{glossary}', None, method='DELETE')
    failed_path.write_text(json.dumps(failed, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    print(f'translated {len(missing) - len(failed)}, failed {len(failed)} -> {failed_path.name}')


if __name__ == '__main__':
    main()

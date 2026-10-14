import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { JSDOM } from 'jsdom';
import { assignmentTitle } from '../src/blackbaud/assignment-title.ts';

const fixtures: JSDOM[] = [];

function page() {
  const dom = new JSDOM('<main><button>Native action</button></main>');
  fixtures.push(dom);
  return dom.window.document;
}

afterEach(() => {
  for (const dom of fixtures.splice(0)) dom.window.close();
});

test('plain assignment titles normalize whitespace without requiring a global document', () => {
  assert.equal(assignmentTitle(' \n Read the next chapter\t and answer questions \r\n '), 'Read the next chapter and answer questions');
  assert.equal(assignmentTitle('Comparison: a < b && c > d'), 'Comparison: a < b && c > d');
  for (const value of [null, undefined, 42, true, {}, []]) assert.equal(assignmentTitle(value), '');
});

test('a rich whole-title span becomes plain text with numeric punctuation decoded', () => {
  const document = page();
  const value = '<span style="font-weight: 400;">Read Example&#8211;&#8220;The Distant Shore&#8221; (class handout)</span>';
  assert.equal(assignmentTitle(value, document), 'Read Example–“The Distant Shore” (class handout)');
});

test('recognized whole-title wrappers and nested inline formatting yield plain title text', () => {
  const document = page();
  for (const tag of ['span', 'p', 'div', 'b', 'strong', 'em', 'i', 'u', 's', 'font', 'small', 'sub', 'sup', 'mark', 'code']) {
    assert.equal(assignmentTitle(`<${tag}>Read <strong>chapter one</strong></${tag}>`, document), 'Read chapter one', tag);
  }
});

test('comparison operators, generic types, unknown tags and mixed inline prose remain literal', () => {
  const document = page();
  for (const value of ['Array<T>', 'std::vector<T>', 'Use List<Thing> in the example', 'if (a < b && c > d)',
    'Use <span>text</span> in HTML', 'Read <strong>chapter one</strong> now', '<span>start</span> literal example <span>end</span>',
    '<custom-element>Example</custom-element>', 'Write <span>']) {
    assert.equal(assignmentTitle(value, document), value, value);
  }
});

test('explicit entities decode once without interpreting the resulting code or missing semicolons', () => {
  const document = page();
  assert.equal(assignmentTitle('Read A &amp; B &#8212; &#x201C;Example&#x201D; &nbsp;today', document), 'Read A & B — “Example” today');
  assert.equal(assignmentTitle('&lt;span&gt;code&lt;/span&gt;', document), '<span>code</span>');
  assert.equal(assignmentTitle('&amp;lt;span&amp;gt;code&amp;lt;/span&amp;gt;', document), '&lt;span&gt;code&lt;/span&gt;');
  assert.equal(assignmentTitle('<code>&lt;span&gt;code&lt;/span&gt;</code>', document), '<span>code</span>');
  assert.equal(assignmentTitle('Use Array<T> &amp; Map<K,V>', document), 'Use Array<T> & Map<K,V>');
  assert.equal(assignmentTitle('Use &notebook and &copy variables', document), 'Use &notebook and &copy variables');
  assert.equal(assignmentTitle('Compare &notebook &amp; &copy variables', document), 'Compare &notebook & &copy variables');
  assert.equal(assignmentTitle('Use &notebook; and &unknown; with &amp;', document), 'Use &notebook; and &unknown; with &');
  assert.equal(assignmentTitle('<span>Use &notebook; with &amp;</span>', document), 'Use &notebook; with &');
  assert.equal(assignmentTitle('&quot; &lt;img onerror=&quot;active()&quot;&gt;', document), '" <img onerror="active()">');
});

test('rich title parsing discards active content and leaves the live document untouched', () => {
  const document = page();
  const before = document.documentElement.outerHTML;
  const value = '<span onclick="window.titleExecuted=true">Read<script>window.titleExecuted=true</script><style>hidden style</style><img src="https://files.example.org/pixel" onerror="window.titleExecuted=true"><iframe src="https://files.example.org/frame">frame content</iframe><form>form content<input value="hidden"></form><template>template content</template> chapter</span>';
  assert.equal(assignmentTitle(value, document), 'Read chapter');
  assert.equal(document.documentElement.outerHTML, before);
  assert.equal((document.defaultView as Window & { titleExecuted?: boolean } | null)?.titleExecuted, undefined);
  assert.equal(document.querySelector('script, style, img, iframe, form, template'), null);
});

test('rich block and line-break boundaries separate words before whitespace normalization', () => {
  const document = page();
  assert.equal(assignmentTitle('<div><p>Read</p><p>chapter<br>one</p><div>and answer</div> questions</div>', document), 'Read chapter one and answer questions');
  assert.equal(assignmentTitle('<span>Read<div>chapter</div>next</span>', document), 'Read chapter next');
  assert.equal(assignmentTitle('<span> \n Read&nbsp;&nbsp;chapter\t two \r\n </span>', document), 'Read chapter two');
});

test('title limits apply after formatting and entity decoding', () => {
  const document = page();
  const longAttributes = 'font-weight:400;'.repeat(50);
  assert.equal(assignmentTitle(`<span style="${longAttributes}">Example reading</span>`, document, 7), 'Example');
  assert.equal(assignmentTitle('<span>&#65;&#66;&#67;&#68;&#69;&#70;</span>', document, 4), 'ABCD');
  assert.equal(assignmentTitle(`<strong>${'X'.repeat(350)}</strong>`, document).length, 300);
  assert.equal(assignmentTitle('Plain title', undefined, 5), 'Plain');
});

test('empty formatted titles and discarded-only content remain empty for caller fallback', () => {
  const document = page();
  for (const value of ['', ' \n ', '<span></span>', '<p>&nbsp;</p>', '<div><script>active</script><img src="/pixel"></div>']) {
    assert.equal(assignmentTitle(value, document), '', value);
  }
});

'use strict';
// SPEC 12.10: html-validate passes on every built HTML page, with the repository config .htmlvalidate.json.
//
// .htmlvalidate.json is JSON, which has no comments, so the reasons for its rule changes live here:
//   extends html-validate:recommended  - the required base (SPEC 12.10)
//   extends html-validate:document     - adds rules for full documents: heading-level (one h1, no skipped
//                                        levels), missing-doctype, no-missing-references, input-missing-label,
//                                        require-sri. Nothing is disabled by it.
//   prefer-native-element: exclude "region" - SPEC section 8 prescribes div#cookie-consent[role=region]
//                                        for the consent banner; the rule would demand <section> instead.
//   require-sri: target "crossorigin"  - SRI is required only for third-party resources (there must be none
//                                        in the HTML). Local CSS/JS carry a ?v=<hash> (SPEC section 6) and
//                                        need no integrity attribute.
// No rule is switched off.
const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { HtmlValidate, StaticConfigLoader } = require('html-validate');
const { expectNone } = require('../lib/checks');
const S = require('../lib/site');

const CONFIG_FILE = path.join(S.ROOT, '.htmlvalidate.json');

function loadConfig() {
  assert.ok(fs.existsSync(CONFIG_FILE), `missing ${CONFIG_FILE}`);
  return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
}

describe('10. HTML validity (html-validate with .htmlvalidate.json)', () => {
  test('.htmlvalidate.json extends html-validate:recommended and switches no rule off', () => {
    const config = loadConfig();
    const ext = Array.isArray(config.extends) ? config.extends : [config.extends];
    assert.ok(ext.includes('html-validate:recommended'), `extends is ${JSON.stringify(config.extends)}`);
    const off = Object.entries(config.rules || {}).filter(([, v]) => v === 'off' || v === 0 || (Array.isArray(v) && (v[0] === 'off' || v[0] === 0)));
    expectNone(off.map(([k]) => k), 'rules switched off (document the reason in tests/static/html-validate.test.js first)');
  });

  test('every HTML file in app/ passes html-validate', async () => {
    const config = loadConfig();
    const htmlvalidate = new HtmlValidate(new StaticConfigLoader(config));
    const files = S.appHtmlFiles().filter((f) => !f.rel.startsWith('img/'));
    assert.ok(files.length > 0, `no HTML files in ${S.APP_DIR}`);
    const problems = [];
    const byRule = new Map();
    const byFile = new Map();
    for (const f of files) {
      const report = await htmlvalidate.validateString(fs.readFileSync(f.abs, 'utf8'), f.rel);
      for (const result of report.results) {
        for (const m of result.messages) {
          if (m.severity < 2) continue;
          problems.push(`${f.rel}:${m.line}:${m.column} ${m.ruleId}: ${m.message}`);
          byRule.set(m.ruleId, (byRule.get(m.ruleId) || 0) + 1);
          byFile.set(f.rel, (byFile.get(f.rel) || 0) + 1);
        }
      }
    }
    if (problems.length) {
      const rules = [...byRule].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r} x${n}`).join(', ');
      const filesSummary = `${byFile.size} of ${files.length} files have errors`;
      expectNone(problems, `html-validate errors; ${filesSummary}; by rule: ${rules}`);
    }
  });
});

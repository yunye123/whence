// PLAN v2 §5.3.2. Fixed migration ceiling; checks never regenerate it. W4-C: --mode forbid.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import postcss from 'postcss';
import { parseSync } from 'rolldown/experimental';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = {
  "deprecated token|styles|6034ff15161b584a0c17": 19,
  "deprecated token|styles|5cabd586b6867cf84810": 42,
  "deprecated token|styles|00d21828224c39fbeec5": 34,
  "deprecated token|styles|aae088542f9cbcf2881a": 11,
  "deprecated token|styles|1e5272a2830dffb521c9": 4,
  "deprecated token|styles|9c14413e7360fa526696": 3,
  "deprecated token|styles|02e854c39aef287a1ef5": 5,
  "deprecated token|styles|73309fa504157021e875": 1,
  "card shadow|styles|df7f42962b4a82a037a9": 1,
  "card shadow|styles|df7f42962b4a82a037a9|layers": 8,
  "card shadow|styles|df7f42962b4a82a037a9|blurred": 4,
  "deprecated token|styles|288d1fbbb0e5420567d4": 38,
  "deprecated token|styles|e553e52d513624d3ca7a": 6,
  "card shadow|styles|1091d30d23ebf7a811f6": 1,
  "card shadow|styles|1091d30d23ebf7a811f6|layers": 2,
  "card shadow|styles|1091d30d23ebf7a811f6|blurred": 1,
  "card shadow|styles|d688084a7568793b839c": 1,
  "card shadow|styles|d688084a7568793b839c|layers": 1,
  "card shadow|styles|d688084a7568793b839c|blurred": 1,
  "card shadow|styles|24addf9bc00ff7e4705a": 1,
  "card shadow|styles|24addf9bc00ff7e4705a|layers": 1,
  "card shadow|styles|24addf9bc00ff7e4705a|blurred": 1,
  "deprecated token|styles|9744fd77c7283329dafb": 14,
  "card shadow|styles|8618251d20122ae720a9": 1,
  "card shadow|styles|8618251d20122ae720a9|layers": 1,
  "card shadow|styles|8618251d20122ae720a9|blurred": 1,
  "card shadow|styles|b9045cef8f83d7e0471d": 1,
  "card shadow|styles|b9045cef8f83d7e0471d|layers": 1,
  "card shadow|styles|b9045cef8f83d7e0471d|blurred": 1,
  "card shadow|styles|4bb1349357275f8ba88d": 1,
  "card shadow|styles|4bb1349357275f8ba88d|layers": 1,
  "card shadow|styles|4bb1349357275f8ba88d|blurred": 1,
  "deprecated token|styles|f16ae9803ffd33599812": 19,
  "card shadow|styles|d8ee487005e37eb8d375": 1,
  "card shadow|styles|d8ee487005e37eb8d375|layers": 4,
  "card shadow|styles|d8ee487005e37eb8d375|blurred": 1,
  "deprecated token|styles|9451aefc31fc71380b83": 3,
  "deprecated token|styles|ca3577df4e04a647fdcd": 9,
  "deprecated token|styles|42a8f08b1ec049f4c9ea": 2,
  "card shadow|styles|7715419c8b0084f123e7": 1,
  "card shadow|styles|7715419c8b0084f123e7|layers": 6,
  "card shadow|styles|7715419c8b0084f123e7|blurred": 2,
  "deprecated token|styles|759d3a943a2d1bc29ad0": 4,
  "deprecated token|styles|2c32775fd64e1345a79c": 7,
  "deprecated token|styles|3a1ac8d0ea09e8db1469": 3,
  "deprecated token|styles|084904c3d6c5385b07fd": 1,
  "deprecated token|styles|f75974cf353fbe8bc4d1": 1,
  "raw color|styles|9c7e091869a26cbe1f03": 1,
  "raw color|styles|4c2db890f9181485d8a8": 1,
  "raw color|styles|f2c9f0248b4af2c00402": 1,
  "deprecated token|styles|3553504653b78a146309": 2,
  "deprecated token|styles|5ed92668831af1622e92": 1,
  "deprecated token|styles|616c0877b9c14cfaa98b": 1,
  "deprecated token|styles|a2642c5a6410759e1b3a": 1,
  "deprecated token|styles|d9aab7e114bf5cec404f": 1,
  "deprecated token|styles|770e4c8910511bb9dad1": 1,
  "deprecated token|styles|84d1d2b8fe4c52169a3b": 1,
  "deprecated token|styles|91eca788c96098b08563": 1,
  "raw color|styles|9281322595f79fe0189e": 1,
  "raw color|styles|f09029fa48d35f18f3e7": 1,
  "raw color|styles|2c31f9a34cdc261483d2": 1,
  "raw color|styles|1ef9429a3afcac29b5ea": 1,
  "raw color|styles|c9d7bd337e86fac40cb2": 1,
  "raw color|styles|71d617a095e8aa9ad253": 1,
  "raw color|styles|2f12cb6a81596e1a30cd": 1,
  "raw color|styles|234b5057bf58bd003747": 1,
  "raw color|styles|6b3ef27c096d5e0be520": 1,
  "raw color|styles|e1da2e06d4e9843dc63a": 1,
  "raw color|styles|d89016c50b10cd6b3b0a": 1,
  "raw color|styles|41ac79965188c03e4db0": 1,
  "raw color|styles|ad530e133aee97a1823c": 1,
  "raw color|styles|387df2b6f2b20c7f3bda": 1,
  "raw color|styles|f3f73a31771ba76ef8be": 1,
  "raw color|styles|b31039c2740d04e78c3c": 1,
  "raw color|styles|2cbbda688097f2bc3421": 1,
  "raw color|styles|52aab391d4fbe3e777ec": 1,
  "raw color|legacy|d0f3f43a34a2090e568c": 1,
  "important|legacy|4f2ed000e07a18aac7d9": 1,
  "raw color|legacy|4767b2c51c659c6ca389": 3,
  "important|legacy|9e8865482e2f1dbe8874": 1,
  "raw color|legacy|2558b8820c58c51d29d9": 1,
  "important|legacy|5b028495cdaace7f1275": 1,
  "raw color|legacy|52dc4254145781006763": 1,
  "raw color|legacy|fdba2c29f85a00a4c7f3": 1,
  "raw color|legacy|4088ddda75b25cd6c756": 1,
  "raw color|legacy|39bf758e83d9d859ee47": 1,
  "raw color|legacy|0b42df2728ea23241afb": 1,
  "raw color|legacy|9c66c3b2cf9729511de8": 1,
  "raw color|legacy|8afceec2aebfa4fc36e7": 1,
  "raw color|legacy|ab73bf554df34f4338d9": 1,
  "raw color|legacy|c65c7543c465d707a1ef": 1,
  "important|legacy|b282f3d69d2c414bccea": 1,
  "raw color|legacy|1db506fe9ea667741b99": 4,
  "raw color|legacy|cd90375af8945feddc81": 1,
  "raw color|legacy|801e78c5cefed14062b4": 1,
  "raw color|legacy|67e50e184e3e17eb039e": 1,
  "raw color|legacy|33731b1631a32a85e4bf": 1,
  "raw color|legacy|aed858978973a5bf56ab": 1,
  "important|legacy|4773d57dd15c2ac5a1ef": 1,
  "raw color|legacy|29f0c3bc7b17df7c499c": 1,
  "raw color|legacy|b2ea9d121cac03f1b70f": 1,
  "raw color|legacy|c2a3668ad8e981841921": 1,
  "raw color|legacy|baa2c727c3ceccfc4c7b": 1,
  "raw color|legacy|9b210b20a06461a9d196": 1,
  "raw color|legacy|7b051fbc95791404409d": 1,
  "raw color|legacy|2083c766431719d02809": 1,
  "raw color|legacy|f6887a95ae74ef72feff": 1,
  "raw color|legacy|c7d62b073ff6c80f9126": 1,
  "important|legacy|b1d89078c5278c315878": 1,
  "raw color|legacy|7a7ceb2b8ff0b3b6bf33": 1,
  "important|legacy|02abf162862bfb110730": 1,
  "raw color|legacy|614fbc39f94cd2e36f81": 1,
  "important|legacy|7fb39a3939d0229017fa": 1,
  "raw color|legacy|89a7884eef982b9caa3d": 1,
  "raw color|legacy|53f6831f5306270e791f": 1,
  "raw color|legacy|8ce7e2ae4826a001a082": 1,
  "raw color|legacy|3340f1b6c51c77dec792": 1,
  "important|legacy|4e914b79b9234e25a552": 1,
  "raw color|legacy|86f46e52ee54488a1f61": 1,
  "raw color|legacy|4fd093e134b9e16e4b54": 1,
  "raw color|legacy|cc99410cf9d99615a289": 1,
  "raw color|legacy|4fd0cd00be3b9076f2df": 2,
  "raw color|legacy|6ea22569899daab6ab5d": 1,
  "raw color|legacy|0865289415a8c5410db6": 27,
  "raw color|legacy|0bf8cb1975f10c664577": 1,
  "raw color|legacy|abbaa8fdb98dbb7db539": 2,
  "raw color|legacy|321550eb86cd143761b9": 1,
  "raw color|legacy|ae6939a62500b37702f4": 1,
  "raw color|legacy|8e622df94fc6e9558a0a": 1,
  "raw color|legacy|d043dce5e56eb302b988": 2,
  "raw color|legacy|2779dbc39a806245940b": 1,
  "raw color|legacy|2b33bafc16e52ae93383": 2,
  "raw color|legacy|bd7010fe4e636d56c3e5": 1,
  "raw color|legacy|859dce04f1de1988042d": 1,
  "raw color|legacy|3795d0aaf4d5c3641a06": 1,
  "raw color|legacy|e0ebfa6bc2819b40e12d": 1,
  "raw color|legacy|018be85522c945f98d95": 1,
  "raw color|legacy|7e1dc4fea3982f299a4f": 1,
  "raw color|legacy|1f71e8899b1c28e5fcaf": 2,
  "raw color|legacy|b010380689b64c6d4df6": 1,
  "raw color|legacy|d0ef23707833d3a3b565": 1,
  "raw color|legacy|38ee2349212da7f0b3cb": 1,
  "raw color|legacy|bfb5aa1ee8b74e4a3868": 1,
  "raw color|legacy|a77dfd4ed17d4d4eaecf": 1,
  "important|legacy|a258d4209ebce378101d": 1,
  "raw color|legacy|3b4136c0c63bffd1827d": 2,
  "raw color|legacy|efaed9f6fab272fc2fec": 1,
  "raw color|legacy|03843e72bc7426505c8e": 1,
  "raw color|legacy|918fd0d0feafef14b2d3": 1,
  "raw color|legacy|f71fb6f62e615f2f6832": 1,
  "raw color|legacy|9583672ee86b7dc88600": 1,
  "raw color|legacy|875e6a8c4b0de8b5acd5": 1,
  "raw color|legacy|fc09ac5c434c804c0047": 1,
  "raw color|legacy|5e6dc37d01bece2b3165": 1,
  "raw color|legacy|3d7b2de3ad02ad164cb1": 1,
  "raw color|legacy|cf13d120e837cbaf3c9e": 1,
  "raw color|legacy|39ba017cee8a0fa51132": 1,
  "raw color|legacy|15afaef790ec6ca127a4": 1,
  "raw color|legacy|e86582bd83f7409330bd": 1,
  "raw color|legacy|cece246c2e990842e87c": 1,
  "important|legacy|283f3df3244149d34611": 1,
  "raw color|legacy|19b2289ef6d5b9853ce2": 3,
  "raw color|legacy|35029035759d84935b67": 2,
  "raw color|legacy|d3d4c8a40d283484a53e": 3,
  "raw color|legacy|ab618493a3e58a5cd7b0": 1,
  "raw color|legacy|431cced9b7e7106e2ed4": 1,
  "raw color|legacy|e226799ba5b0a3d0fead": 1,
  "raw color|legacy|024c10cbcfb995fc60c7": 1,
  "raw color|legacy|3cf46cd7e299e857cbff": 1,
  "raw color|legacy|6608d0487333f1ecdf65": 1,
  "raw color|legacy|c8f6eaca0fc4bdd92fec": 1,
  "raw color|legacy|2040e4139a49bd996376": 1,
  "raw color|legacy|d80034482a6d1218e4ce": 1,
  "raw color|legacy|030b1945f8f967609c7c": 2,
  "raw color|legacy|0072b2284c329aaa249e": 5,
  "raw color|legacy|5af7233e0d61ebb124f7": 2,
  "raw color|legacy|03af0bab1eb86fda894d": 2,
  "raw color|legacy|89e5ec4a2691d2c1cd91": 1,
  "raw color|legacy|8b143b9c8018c1ad2247": 1,
  "raw color|legacy|48748b8ceb5096430467": 1,
  "raw color|legacy|f95d05d43ec4c5c62100": 1,
  "raw color|legacy|90e74bf7c662434a5379": 1,
  "raw color|legacy|734883252226d823655b": 1,
  "raw color|legacy|7b8d4530011bc6b8a840": 1,
  "raw color|legacy|97f93962cd459f993e0a": 1,
  "raw color|legacy|279d26de91d611b6aeed": 1,
  "raw color|legacy|45c3052dec8b4ab2f6dc": 1,
  "raw color|legacy|a23a39ccd92c871ca9e0": 1,
  "raw color|legacy|22c3cbe06ee5daa1c2c3": 1,
  "raw color|legacy|3813011053505f3f0f43": 1,
  "raw color|legacy|7517f93822e47167bd47": 1,
  "raw color|legacy|81bc5a75dd286c48bffe": 1,
  "raw color|legacy|d2a02a7540d474e99401": 1,
  "raw color|legacy|15aa9be551f4b45ac4e0": 1,
  "raw color|legacy|9fbe24cc4f920db53570": 1,
  "raw color|legacy|e865fadf2ce6ffb6c718": 1,
  "raw color|legacy|99f5d8daaa7835a65699": 1,
  "raw color|legacy|c5b7bd157095a1d426c5": 1,
  "important|legacy|bb87de456fe22db5d548": 1,
  "raw color|legacy|ac9434904355a67437b9": 1,
  "important|legacy|37871f45076c16c53869": 1,
  "important|legacy|b2d8398c8d478b1f2702": 1,
  "raw color|legacy|c572d36fc35b3f2d59a6": 2,
  "important|legacy|15f7d8c5bb3db433de06": 1,
  "raw color|legacy|a8339e0b711331f24949": 1,
  "important|legacy|a1c399adcd0401f5f989": 1,
  "important|legacy|3265d383b0a8b3d2c80f": 1,
  "raw color|legacy|7ded39d309e268a195e5": 1,
  "raw color|legacy|3616f94928b50a110223": 1,
  "raw color|legacy|0fb91c73a5ed7066e287": 1,
  "font below 12px|legacy|2aae33ab09d85cd92aed": 1,
  "important|legacy|1d9a3b741b6c5b9348cf": 1,
  "important|legacy|24a04c21d810f55a7571": 1,
  "font below 12px|legacy|24ee84bffa1100b087fb": 1,
  "font below 12px|legacy|f6249e63fdd5cf2da7d1": 1
}; // Captured once from f2697b8; do not regenerate during checks.
const deprecated = /^(?:--bg-(?:surface|paper|elevated|contextbar)|--source-.+|--p-cyan-.+|--light-(?:fg|wash)|--trace-(?:walk|head|lift)|--canvas-(?:grid-major|grid-minor|lamp|vignette))$/;
const colorLiteral = /#[\da-f]{3,8}\b|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/gi;
const legacyFiles = ['style', 'cards', 'canvas-selection-tools', 'snap-guides', 'directory-recovery', 'inspector', 'board-library', 'theme', 'workspace-search', 'x-import-panel'].map(n => `src/${n}.css`);
const stripComments = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\r\n]/g, ' '));
const fingerprint = s => createHash('sha256').update(s).digest('hex').slice(0, 20);
// Accent authorization requires both a file and a selector; aliases are traced too.
const accents = {
  zhu: {
    cards: /^\.field-card(?:--(?:quote|draft|link|video))?(?:\.is-lit-source|\s+\.(?:field-card__(?:citation|footnote|ref|link-icon|line-play)|provenance-tag))|^\.field-card--quote(?:::before|\s+\.field-card__rule)/,
    edges: /^\.field-edge(?:--citation|--writing|--cite)|^\.field-citation/,
    trace: /^\.(?:field-trace|trace-|field-edge.*is-trac)|^\.is-trace/,
    sidebar: /^\.library-icon\.quote(?:::|\s)/,
    'inspector-reading': /^\.(?:reading-used.*(?:icon|svg)|inspector-reading.*(?:provenance|source-icon))/,
    'inspector-writing': /^\.(?:draft-source.*(?:line|connector)|draft-margin.*(?:line|connector)|draft-footnote.*(?:circle|number))/,
    'provenance-tag': /^\.provenance-tag/,
    tag: /^\.(?:stamp(?:--mini)?(?:__[\w-]+)?|tag(?:--stamp(?:-mini)?)?(?:__[\w-]+)?|tag-btn)(?=[\s.:#>+~[]|$)/,
  },
  hl: {
    cards: /^\.field-card--(?:video|article|link)\s+.*(?:mark|field-card__(?:line|segment|excerpt|rail|tick))/,
    'inspector-video': /^\.(?:inspector-transcript|transcript|video-timeline).*?(?:mark|is-used|is-excerpt|quoted|excerpt)/,
    'inspector-reading': /^\.(?:inspector-reading-body|reading-body).*?(?:mark|is-used|is-excerpt)/,
  },
};
function accentAllowed(file, selector, kind, prop, value) {
  // Source-only native underline uses the same approved highlight ink.
  if (kind === 'hl' && prop === 'text-decoration-color' && value === 'var(--hl)') {
    const sourceMarks = {
      'src/styles/features/cards/folder.css': ['.field-card--article .field-card__folder-paragraph mark', '.field-card--link .field-card__folder-paragraph mark'],
      'src/styles/features/inspector-reading.css': ['.inspector-reading-body mark.inspector-source-highlight[aria-label="摘录原文"]', '.inspector-reading-body .reading-trace.is-excerpt'],
    };
    if (sourceMarks[file]?.includes(selector)) return true;
  }
  // PLAN §2.9: watching source marks and its index→manuscript provenance chain.
  // Each exception names one paint operation, never the prose or entire panel.
  if (file === 'src/styles/features/inspector-video.css') {
    const watch = {
      '.watch-rail--marks > i.is-used': ['hl', 'background', 'var(--hl)'],
      '.watch-origin__quote': ['zhu', 'border-top', '2px solid var(--zhu)'],
      '.watch-origin__thread line': ['zhu', 'stroke', 'var(--zhu)'],
      '.watch-origin__paragraph': ['zhu', 'border', '1.5px solid var(--zhu)'],
      '.watch-origin__row.is-written .watch-origin__thread::before': ['zhu', 'border-left', '1.5px dashed var(--zhu)'],
    };
    const operation = watch[selector];
    if (operation) return kind === operation[0] && prop === operation[1] && value === operation[2];
  }
  if (file === 'src/styles/features/cards/quote.css' && ['.field-card--quote .field-card__head', '.field-card--quote .field-card__surface > .field-card__header'].includes(selector)) {
    return kind === 'zhu' && prop === 'border-bottom' && value === 'calc(1px / var(--z-tier, 1)) solid var(--zhu)';
  }
  if (file === 'src/styles/features/cards/quote-lod-02.css') {
    if (selector === '.field-card .field-card__overview--quote') return kind === 'zhu' && prop === 'border-top' && value === '1px solid var(--zhu)';
    if (selector === '.field-card .field-card__overview-tag') return kind === 'zhu' && prop === 'border' && value === '1px solid var(--zhu)';
  }
  // PLAN §2.9: authorize the manuscript index rules, paragraph ring and
  // source connector as exact paint operations, without red prose/controls.
  if (file === 'src/styles/features/inspector-writing.css') {
    const manuscript = {
      '.draft-picker__item': ['border-top', '1px solid var(--zhu)'],
      '.draft-source-card': ['border-top', '1px solid var(--zhu)'],
      '.inspector--writing-expanded .draft-editor .cm-para-start.is-cited-paragraph::before': ['box-shadow', 'inset 0 0 0 1px var(--zhu)'],
      '.draft-margin__stitch': ['stroke', 'var(--zhu)'],
    };
    const operation = manuscript[selector];
    if (operation) return kind === 'zhu' && prop === operation[0] && value === operation[1];
  }
  if (file === 'src/styles/features/outline.css') {
    return kind === 'zhu' && (
      selector === '.outline-ref__paragraph::before' && prop === 'border' ||
      selector === '.outline-refs--loose > li' && prop === 'border-top'
    );
  }
  // Welcome illustrations reproduce source marks, citation stamps and paragraph
  // rings. Authorize their exact paint operations, not the whole illustration.
  if (file === 'src/styles/features/welcome.css') {
    const welcome = {
      zhu: {
        '.wl-thread--used': ['stroke'],
        '.wl-quote__head': ['border-bottom'],
        '.wl-stamp': ['border'],
        '.wl-stamp__icon': ['border-right', 'fill'],
        '.wl-draft__paragraph': ['border'],
      },
      hl: { '.wl-video__source mark': ['background'] },
    };
    return welcome[kind]?.[selector]?.includes(prop) ?? false;
  }
  const surface = file.includes('/features/cards/') ? 'cards' : file.includes('/features/inspector-video/') ? 'inspector-video' : file.includes('/features/inspector-writing/') ? 'inspector-writing' : file.includes('/features/inspector-reading/') ? 'inspector-reading' : path.posix.basename(file, '.css');
  const rule = accents[kind][surface];
  if (!rule?.test(selector)) return false;
  return kind === 'zhu'
    ? /^(?:--[\w-]+|border(?:-.+)?|outline(?:-.+)?|background(?:-.+)?|box-shadow|stroke|fill)$/.test(prop)
    : /^(?:background(?:-.+)?|fill|--[\w-]+)$/.test(prop);
}
export function analyzeStyles(sources, { mode = 'ratchet', baseline = BASELINE } = {}) {
  if (!['ratchet', 'forbid'].includes(mode)) throw new Error(`Unknown mode: ${mode}`);
  const issues = [], counts = {}, trees = new Map(), definitions = new Map();
  function issue(file, node, rule, detail, debt = false, identity = detail) {
    // W1-E moves identical rules between files. Preserve the total ceiling for
    // the modern/legacy family while retaining file/line diagnostics. New debt
    // signatures still fail; removal never licenses a different literal/selector.
    const scope = debt ? (legacyFiles.includes(file) ? 'legacy' : 'styles') : file;
    const key = `${rule}|${scope}|${fingerprint(identity)}`;
    if (debt) counts[key] = (counts[key] ?? 0) + 1;
    issues.push({ file, line: node?.source?.start?.line ?? 1, rule, detail, debt, key });
    return key;
  }
  for (const [file, text] of Object.entries(sources)) if (file.endsWith('.css')) {
    try {
      const tree = postcss.parse(stripComments(text), { from: file }); trees.set(file, tree);
      tree.walkDecls(d => { if (d.prop.startsWith('--')) { const values = definitions.get(d.prop) ?? new Set(); values.add(d.value); definitions.set(d.prop, values); } });
    } catch (e) { issue(file, null, 'CSS parse', String(e)); }
  }
  function expand(value, seen = new Set()) {
    const m = /var\((--[\w-]+)(?:,\s*([^()]*))?\)/.exec(value);
    if (!m) return [value];
    if (seen.has(m[1])) return [value.replace(m[0], 'UNRESOLVED')];
    const next = new Set([...seen, m[1]]);
    return [...(definitions.get(m[1]) ?? new Set([m[2] ?? 'UNRESOLVED']))]
      .flatMap(v => expand(v, next).flatMap(resolved => expand(value.replace(m[0], resolved), seen))).slice(0, 128);
  }
  function usesAccent(value, kind, seen = new Set()) {
    return [...value.matchAll(/var\((--[\w-]+)/g)].some(m => m[1] === `--${kind}` || m[1] === `--${kind}-wash` ||
      !seen.has(m[1]) && [...(definitions.get(m[1]) ?? [])].some(v => usesAccent(v, kind, new Set([...seen, m[1]]))));
  }
  function shadowMetrics(value, seen = new Set()) {
    if (value.trim() === 'none') return { layers: 0, blurred: 0, unresolved: false };
    let layers = 0, blurred = 0, unresolved = false;
    for (const layer of postcss.list.split(value, ',', false)) {
      const m = /^var\((--[\w-]+)(?:,\s*([^()]*))?\)$/.exec(layer.trim());
      if (m) {
        const values = definitions.get(m[1]) ?? (m[2] ? new Set([m[2]]) : null);
        if (!values || seen.has(m[1])) { unresolved = true; continue; }
        const variants = [...values].map(v => shadowMetrics(v, new Set([...seen, m[1]])));
        // Maxima bound every possible state without enumerating a Cartesian product.
        layers += Math.max(...variants.map(v => v.layers)); blurred += Math.max(...variants.map(v => v.blurred));
        unresolved ||= variants.some(v => v.unresolved);
      } else {
        layers++;
        // Resolve length tokens independently, avoiding a Cartesian expansion of
        // color/shadow variants. CSS lengths can use rem/em and viewport units too.
        const lengths = postcss.list.space(layer).map(term => expand(term)).filter(values => {
          unresolved ||= values.some(v => v.includes('UNRESOLVED'));
          return values.some(v => /^(?:-?(?:\d*\.)?\d+(?:[a-z]+)?$|(?:calc|min|max|clamp)\()/i.test(v));
        });
        if (lengths.length >= 3 && lengths[2].some(v => !Number.isFinite(parseFloat(v)) || parseFloat(v) > 0)) blurred++;
      }
    }
    return { layers, blurred, unresolved };
  }
  for (const [file, tree] of trees) {
    const legacy = legacyFiles.includes(file), dir = /^src\/styles\/(tokens|base|layout|components|features)\//.exec(file)?.[1];
    const marker = file.endsWith('/semantic.css') ? sources[file].search(/\/\*[^*]*11\./) : -1;
    const sectionLine = marker < 0 ? Infinity : sources[file].slice(0, marker).split('\n').length;
    if (dir) for (const node of tree.nodes) {
      // W1-E keeps this relocated dialog rule in its original cascade layer.
      const expected = file.endsWith('/base/reset.css') ? 'reset' : file === 'src/styles/features/export-dialog-frame.css' ? 'components' : dir;
      if (node.type !== 'comment' && !(node.type === 'atrule' && node.name === 'layer' && node.nodes && [expected, 'states', 'utilities'].includes(node.params.trim()))) issue(file, node, '@layer', `Expected @layer ${expected} (or states/utilities)`);
    }
    if (file === 'src/styles/index.css') tree.walkAtRules('import', n => {
      if (/export-cover(?:\/|\\|\b)/.test(n.params)) issue(file, n, 'cover import', n.params);
      for (const f of legacyFiles) if (n.params.includes(`../${path.posix.basename(f)}`) && !/layer\(legacy\)/.test(n.params)) issue(file, n, 'legacy layer', n.params);
    });
    tree.walkAtRules(n => { if (/prefers-color-scheme/.test(n.params) && !legacy && !file.includes('/tokens/')) issue(file, n, 'dark selector', n.params); });
    tree.walkRules(n => { if (/data-theme/.test(n.selector) && !legacy && !file.includes('/tokens/')) issue(file, n, 'dark selector', n.selector); });
    tree.walkDecls(d => {
      const selector = d.parent.type === 'rule' ? d.parent.selector : '', identity = `${selector}|${d.prop}|${d.value}`;
      const ancestors = []; for (let n = d.parent; n; n = n.parent) ancestors.push(n);
      const reduced = ancestors.some(n => n.type === 'atrule' && n.name === 'media' && /prefers-reduced-motion\s*:\s*reduce/.test(n.params));
      for (const m of d.value.matchAll(/var\((--[\w-]+)/g)) if (deprecated.test(m[1])) issue(file, d, 'deprecated token', m[1], true, m[1]);
      if (d.important && !reduced) issue(file, d, 'important', identity, legacy);
      // Preserve the approved semantic color; the one backdrop maps its alpha to
      // an 8-bit paint value. This exact expression cannot license other RGB use.
      const approvedModalPaint = file === 'src/styles/components/dialog.css' && selector === '.modal-backdrop'
        && d.prop === 'background-color'
        && d.value === 'rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))';
      if (!approvedModalPaint && !file.endsWith('/primitives.css')) for (const m of d.value.matchAll(file.includes('/tokens/') ? /#[\da-f]{3,8}\b/gi : colorLiteral)) issue(file, d, 'raw color', `${d.prop}: ${m[0]}`, true, `${d.prop}|${m[0]}`);
      if (!file.includes('/tokens/') && !legacy && /var\(--p-/.test(d.value)) issue(file, d, 'primitive token', identity);
      if (d.source.start.line >= sectionLine && (/[#]|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i.test(d.value) || /(?:color|background|border|fill|stroke|shadow)|var\(--(?:bg|fg|p-|zhu|hl)/.test(identity))) issue(file, d, 'section 11 color', identity);
      const welcomeDrop = file === 'src/styles/features/welcome.css' && /^(?:drop-shadow\([^;]+\)\s*)+$/.test(d.value);
      // Human-approved B exception is restricted to one backdrop and its exact
      // length token. Card blur, arbitrary selectors and token aliases still fail.
      const approvedModalBlur = file === 'src/styles/components/dialog.css' && selector === '.modal-backdrop'
        && d.prop === 'backdrop-filter' && d.value === 'blur(var(--modal-backdrop-blur))'
        && expand(d.value).every(v => /^blur\((?:6\.6|3)px\)$/.test(v));
      if (!approvedModalBlur && ((/^(?:-webkit-)?(?:backdrop-)?filter$/.test(d.prop) && d.value !== 'none' && !welcomeDrop) || d.prop === 'mix-blend-mode' && d.value !== 'normal' || /\bblur\(/.test(d.value))) issue(file, d, 'effect', identity);
      if (d.prop === 'font-size' && !/^max\(\s*var\(--fs-xs\)/.test(d.value) && expand(d.value).some(v => [...v.matchAll(/(?<![\w.-])(?:\d*\.)?\d+px\b/g)].some(m => parseFloat(m[0]) < 12))) issue(file, d, 'font below 12px', identity, true);
      if (d.prop === 'box-shadow' && /\.field-card(?=__|--|[^\w-]|$)/.test(selector)) {
        const { layers, blurred, unresolved } = shadowMetrics(d.value);
        const descendant = /\.field-card__[\w-]+/.test(selector) || postcss.list.split(selector, ',').some(s => {
          const card = /\.field-card(?:--[\w-]+)?(?=[^\w-]|$)/.exec(s);
          const rest = card ? s.slice(card.index + card[0].length).replace(/\([^)]*\)|\[[^\]]*\]/g, '') : '';
          return /[>+~]|\s+[\w.#[:]/.test(rest);
        });
        if (layers > 4 || blurred > (descendant ? 0 : 2)) {
          const key = issue(file, d, 'card shadow', `${identity} (${layers} layers, ${blurred} blurred)`, true, identity);
          counts[`${key}|layers`] = Math.max(counts[`${key}|layers`] ?? 0, layers);
          counts[`${key}|blurred`] = Math.max(counts[`${key}|blurred`] ?? 0, blurred);
        }
        if (unresolved) issue(file, d, 'unresolved card shadow', identity);
      }
      if (!file.includes('/tokens/')) for (const kind of ['zhu', 'hl']) if (usesAccent(d.value, kind) && (!selector || !postcss.list.split(selector, ',').every(s => accentAllowed(file, s.trim(), kind, d.prop, d.value)))) issue(file, d, 'accent whitelist', `${kind}: ${identity}`);
    });
  }
  for (const [file, text] of Object.entries(sources)) if (/^src\/(?:canvas|cards|shell)\/.*\.tsx$/.test(file)) {
    const parsed = parseSync(file, text);
    if (parsed.errors.length) issue(file, null, 'TSX parse', JSON.stringify(parsed.errors));
    function visit(n) {
      if (!n || typeof n !== 'object') return;
      const name = n.name?.name ?? n.key?.name ?? n.key?.value;
      if (n.type === 'JSXAttribute' && name === 'filter' || n.type === 'JSXOpeningElement' && name === 'feGaussianBlur' || n.type === 'Property' && ['mixBlendMode', 'backdropFilter', 'filter'].includes(name)) issue(file, { source: { start: { line: text.slice(0, n.start).split('\n').length } } }, 'TSX effect', text.slice(n.start, n.end));
      for (const value of Object.values(n)) if (Array.isArray(value)) value.forEach(visit); else if (value && typeof value === 'object') visit(value);
    }
    visit(parsed.program);
  }
  const ground = [...(definitions.get('--bg-canvas') ?? [])][0];
  const resolved = ground ? expand(ground)[0] : '';
  const colors = /^light-dark\(\s*(#[\da-f]{6})\s*,\s*(#[\da-f]{6})\s*\)$/i.exec(resolved);
  if (!colors) issue('src/styles/tokens/semantic.css', null, 'boot ground', `Cannot resolve --bg-canvas: ${resolved}`);
  else for (const [i, theme] of ['light', 'dark'].entries()) {
    const html = stripComments(sources['index.html'] ?? ''), native = sources['native/window-appearance.ts'] ?? '', expected = colors[i + 1].toLowerCase();
    const meta = [...html.matchAll(/<meta\b[^>]+>/g)].find(m => /name=["']theme-color/.test(m[0]) && m[0].includes(`prefers-color-scheme: ${theme}`));
    const actual = /content=["'](#[\da-f]{6})/i.exec(meta?.[0] ?? '')?.[1]?.toLowerCase();
    const css = theme === 'light' ? /html\s*\{\s*background:\s*(#[\da-f]{6})/i : /html\[data-theme=["']dark["']\]\s*\{\s*background:\s*(#[\da-f]{6})/i;
    const windowColor = new RegExp(`${theme}:\\s*['"](#[\\da-f]{6})`, 'i').exec(native)?.[1]?.toLowerCase();
    if (actual !== expected || css.exec(html)?.[1]?.toLowerCase() !== expected || windowColor !== expected) issue('index.html', null, 'boot ground', `${theme}: expected ${expected} in meta, inline background and WINDOW_GROUND`);
  }
  return { problems: issues.filter(i => !i.debt || mode === 'forbid' || counts[i.key] > (baseline[i.key] ?? 0) ||
    i.rule === 'card shadow' && (counts[`${i.key}|layers`] > (baseline[`${i.key}|layers`] ?? 0) || counts[`${i.key}|blurred`] > (baseline[`${i.key}|blurred`] ?? 0))), counts, debt: issues.filter(i => i.debt) };
}
export async function sourcesAt(directory) {
  const sources = {};
  async function walk(dir) {
    for (const e of await fs.readdir(path.join(directory, dir), { withFileTypes: true })) {
      const f = `${dir}/${e.name}`;
      if (e.isDirectory()) await walk(f); else if (/\.(css|tsx)$/.test(f)) sources[f] = await fs.readFile(path.join(directory, f), 'utf8');
    }
  }
  await walk('src/styles'); for (const dir of ['src/canvas', 'src/cards', 'src/shell']) await walk(dir);
  for (const f of [...legacyFiles, 'index.html', 'native/window-appearance.ts']) sources[f] = await fs.readFile(path.join(directory, f), 'utf8');
  return sources;
}
export function selfTest() {
  const check = (sources, options = {}) => analyzeStyles(sources, { baseline: {}, ...options });
  const fixture = {
    'src/styles/tokens/primitives.css': '@layer tokens {:root {--p-ground:#D2D1CE;--p-dark:#1A1917}}',
    'src/styles/tokens/semantic.css': '@layer tokens {:root {--bg-canvas:light-dark(var(--p-ground),var(--p-dark));--shadow-test:0 0 0 1px var(--ink),0 2px 3px var(--ink);--ink:var(--bg-canvas);--zhu:var(--p-ground);--hl:var(--p-ground);--modal-backdrop-blur:6.6px}}',
    'index.html': '<meta name="theme-color" content="#D2D1CE" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#1A1917" media="(prefers-color-scheme: dark)"><style>html {background:#D2D1CE}html[data-theme="dark"] {background:#1A1917}</style>',
    'native/window-appearance.ts': "const WINDOW_GROUND={light:'#D2D1CE',dark:'#1A1917'};",
  };
  const cases = [
    ['comment ignored', 'features/test.css', '@layer features {/*\n.bad {filter:blur(2px);color:#fff}\n*/.ok {filter:none}}', null],
    ['line preserved', 'features/test.css', '/*\n comment\n*/\n@layer features {.bad {filter:blur(2px)}}', 'effect'],
    ['base raw hex', 'base/test.css', '@layer base {.bad {color:#abc}}', 'raw color'],
    ['semantic raw hex', 'tokens/test.css', '@layer tokens {:root {--oops:#fff}}', 'raw color'],
    ['missing layer', 'features/test.css', '.bad {color:var(--fg-1)}', '@layer'],
    ['reduced motion', 'base/test.css', '@layer base {@media (prefers-reduced-motion:reduce){.ok {animation:none!important}}}', null],
    ['important after media', 'base/test.css', '@layer base {@media (prefers-reduced-motion:reduce){.ok {animation:none!important}}.bad {color:var(--fg-1)!important}}', 'important'],
    ['backdrop', 'components/test.css', '@layer components {.bad {backdrop-filter:blur(3px)}}', 'effect'],
    ['approved modal blur', 'components/dialog.css', '@layer components {.modal-backdrop {backdrop-filter:blur(var(--modal-backdrop-blur))}}', null],
    ['modal blur wrong selector', 'components/dialog.css', '@layer components {.modal {backdrop-filter:blur(var(--modal-backdrop-blur))}}', 'effect'],
    ['modal blur wrong file', 'features/test.css', '@layer features {.modal-backdrop {backdrop-filter:blur(var(--modal-backdrop-blur))}}', 'effect'],
    ['modal blur wrong property', 'components/dialog.css', '@layer components {.modal-backdrop {filter:blur(var(--modal-backdrop-blur))}}', 'effect'],
    ['modal blur literal bypass', 'components/dialog.css', '@layer components {.modal-backdrop {backdrop-filter:blur(6.6px)}}', 'effect'],
    ['modal blur token escalation', 'components/dialog.css', '@layer components {:root {--modal-backdrop-blur:60px}.modal-backdrop {backdrop-filter:blur(var(--modal-backdrop-blur))}}', 'effect'],
    ['approved modal paint', 'components/dialog.css', '@layer components {.modal-backdrop {background-color:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))}}', null],
    ['modal paint wrong selector', 'components/dialog.css', '@layer components {.modal {background-color:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))}}', 'raw color'],
    ['modal paint wrong file', 'components/test.css', '@layer components {.modal-backdrop {background-color:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))}}', 'raw color'],
    ['modal paint wrong property', 'components/dialog.css', '@layer components {.modal-backdrop {background:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))}}', 'raw color'],
    ['modal paint wrong denominator', 'components/dialog.css', '@layer components {.modal-backdrop {background-color:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 256))}}', 'raw color'],
    ['modal paint changed alpha', 'components/dialog.css', '@layer components {.modal-backdrop {background-color:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255 + .1))}}', 'raw color'],
    ['modal paint changed channels', 'components/dialog.css', '@layer components {.modal-backdrop {background-color:rgb(from var(--bg-scrim) 0 g b / calc(round(nearest, alpha * 255, 1) / 255))}}', 'raw color'],
    ['modal paint token alias', 'components/dialog.css', '@layer components {:root {--paint:rgb(from var(--bg-scrim) r g b / calc(round(nearest, alpha * 255, 1) / 255))}.modal-backdrop {background-color:var(--paint)}}', 'raw color'],
    ['watch excerpt band', 'features/inspector-video.css', '@layer features {.watch-rail--marks > i.is-used {background:var(--hl)}}', null],
    ['watch quote rule', 'features/inspector-video.css', '@layer features {.watch-origin__quote {border-top:2px solid var(--zhu)}}', null],
    ['watch provenance line', 'features/inspector-video.css', '@layer features {.watch-origin__thread line {stroke:var(--zhu)}}', null],
    ['watch cited paragraph ring', 'features/inspector-video.css', '@layer features {.watch-origin__paragraph {border:1.5px solid var(--zhu)}}', null],
    ['watch vertical provenance', 'features/inspector-video.css', '@layer features {.watch-origin__row.is-written .watch-origin__thread::before {border-left:1.5px dashed var(--zhu)}}', null],
    ['watch quote red prose', 'features/inspector-video.css', '@layer features {.watch-origin__quote {color:var(--zhu)}}', 'accent whitelist'],
    ['watch ring red fill', 'features/inspector-video.css', '@layer features {.watch-origin__paragraph {background:var(--zhu)}}', 'accent whitelist'],
    ['watch ring exaggerated', 'features/inspector-video.css', '@layer features {.watch-origin__paragraph {border:8px solid var(--zhu)}}', 'accent whitelist'],
    ['watch provenance wrong file', 'features/test.css', '@layer features {.watch-origin__thread line {stroke:var(--zhu)}}', 'accent whitelist'],
    ['watch yellow body', 'features/inspector-video.css', '@layer features {.watch-origin__quote {background:var(--hl)}}', 'accent whitelist'],
    ['welcome drop shadow', 'features/welcome.css', '@layer features {.ok {filter:drop-shadow(0 2px 3px var(--fg-1))}}', null],
    ['welcome blur', 'features/welcome.css', '@layer features {.bad {filter:blur(2px)}}', 'effect'],
    ['mix blend', 'features/test.css', '@layer features {.bad {mix-blend-mode:multiply}}', 'effect'],
    ['deprecated growth', 'features/test.css', '@layer features {.bad {color:var(--source-fg)}}', 'deprecated token'],
    ['small font', 'features/test.css', '@layer features {.bad {font-size:11px}}', 'font below 12px'],
    ['safe max font', 'features/test.css', '@layer features {.ok {font-size:max(var(--fs-xs), 10px)}}', null],
    ['inner token shadow', 'features/test.css', '@layer features {.field-card .field-card__body {box-shadow:var(--shadow-test)}}', 'card shadow'],
    ['arbitrary descendant shadow', 'features/test.css', '@layer features {.field-card > div {box-shadow:0 0 3px}}', 'card shadow'],
    ['computed blur', 'features/test.css', '@layer features {.field-card > div {box-shadow:0 0 calc(4px)}}', 'card shadow'],
    ['non-pixel blur', 'features/test.css', '@layer features {.field-card > div {box-shadow:0 0 .2rem}}', 'card shadow'],
    ['inline length token blur', 'features/test.css', '@layer features {:root {--blur-test:3px}.field-card > div {box-shadow:0 0 var(--blur-test) var(--ink)}}', 'card shadow'],
    ['nested small font', 'features/test.css', '@layer features {.bad {font-size:calc(11px)}}', 'font below 12px'],
    ['five shadow layers', 'features/test.css', '@layer features {.field-card::before {box-shadow:0 0 0,0 0 0,0 0 0,0 0 0,0 0 0}}', 'card shadow'],
    ['three blurred layers', 'features/test.css', '@layer features {.field-card::before {box-shadow:0 0 2px,0 0 2px,0 0 2px}}', 'card shadow'],
    ['red stamp', 'features/cards.css', '@layer features {.field-card .provenance-tag {border-color:var(--zhu)}}', null],
    ['red text', 'features/cards.css', '@layer features {.field-card .provenance-tag {color:var(--zhu)}}', 'accent whitelist'],
    ['red alias bypass', 'features/test.css', '@layer features {:root {--cheat:var(--zhu)}.bad {color:var(--cheat)}}', 'accent whitelist'],
    ['yellow draft', 'features/cards.css', '@layer features {.field-card--draft mark {background:var(--hl)}}', 'accent whitelist'],
    ['yellow source', 'features/cards.css', '@layer features {.field-card--video mark {background:var(--hl)}}', null],
    ['article source underline', 'features/cards/folder.css', '@layer features {.field-card--article .field-card__folder-paragraph mark {text-decoration-color:var(--hl)}}', null],
    ['link source underline', 'features/cards/folder.css', '@layer features {.field-card--link .field-card__folder-paragraph mark {text-decoration-color:var(--hl)}}', null],
    ['reading excerpt underline', 'features/inspector-reading.css', '@layer features {.inspector-reading-body mark.inspector-source-highlight[aria-label="摘录原文"] {text-decoration-color:var(--hl)}}', null],
    ['reading trace underline', 'features/inspector-reading.css', '@layer features {.inspector-reading-body .reading-trace.is-excerpt {text-decoration-color:var(--hl)}}', null],
    ['source underline wrong file', 'features/test.css', '@layer features {.field-card--article .field-card__folder-paragraph mark {text-decoration-color:var(--hl)}}', 'accent whitelist'],
    ['source underline wrong selector', 'features/cards/folder.css', '@layer features {.field-card--draft .field-card__folder-paragraph mark {text-decoration-color:var(--hl)}}', 'accent whitelist'],
    ['source underline wrong property', 'features/cards/folder.css', '@layer features {.field-card--article .field-card__folder-paragraph mark {color:var(--hl)}}', 'accent whitelist'],
    ['source underline unmarked reading', 'features/inspector-reading.css', '@layer features {.inspector-reading-body mark.inspector-source-highlight {text-decoration-color:var(--hl)}}', 'accent whitelist'],
    ['outline paragraph ring', 'features/outline.css', '@layer features {.outline-ref__paragraph::before {border:1px solid var(--zhu)}}', null],
    ['outline loose index rule', 'features/outline.css', '@layer features {.outline-refs--loose > li {border-top:2px solid var(--zhu)}}', null],
    ['outline red text', 'features/outline.css', '@layer features {.outline-ref__paragraph::before {color:var(--zhu)}}', 'accent whitelist'],
    ['outline yellow body', 'features/outline.css', '@layer features {.outline-section {background:var(--hl)}}', 'accent whitelist'],
    ['writing picker index rule', 'features/inspector-writing.css', '@layer features {.draft-picker__item {border-top:1px solid var(--zhu)}}', null],
    ['writing source index rule', 'features/inspector-writing.css', '@layer features {.draft-source-card {border-top:1px solid var(--zhu)}}', null],
    ['writing cited paragraph ring', 'features/inspector-writing.css', '@layer features {.inspector--writing-expanded .draft-editor .cm-para-start.is-cited-paragraph::before {box-shadow:inset 0 0 0 1px var(--zhu)}}', null],
    ['writing margin connector', 'features/inspector-writing.css', '@layer features {.draft-margin__stitch {stroke:var(--zhu)}}', null],
    ['writing red prose', 'features/inspector-writing.css', '@layer features {.draft-source-card {color:var(--zhu)}}', 'accent whitelist'],
    ['writing exaggerated ring', 'features/inspector-writing.css', '@layer features {.inspector--writing-expanded .draft-editor .cm-para-start.is-cited-paragraph::before {box-shadow:inset 0 0 0 8px var(--zhu)}}', 'accent whitelist'],
    ['writing index wrong file', 'features/test.css', '@layer features {.draft-picker__item {border-top:1px solid var(--zhu)}}', 'accent whitelist'],
    ['writing index descendant', 'features/inspector-writing.css', '@layer features {.draft-picker__item .child {border-top:1px solid var(--zhu)}}', 'accent whitelist'],
    ['writing yellow paper', 'features/inspector-writing.css', '@layer features {.draft-source-card {background:var(--hl)}}', 'accent whitelist'],
    ['quote index head rule', 'features/cards/quote.css', '@layer features {.field-card--quote .field-card__head {border-bottom:calc(1px / var(--z-tier, 1)) solid var(--zhu)}}', null],
    ['quote index direct header rule', 'features/cards/quote.css', '@layer features {.field-card--quote .field-card__surface > .field-card__header {border-bottom:calc(1px / var(--z-tier, 1)) solid var(--zhu)}}', null],
    ['quote far top rule', 'features/cards/quote-lod-02.css', '@layer features {.field-card .field-card__overview--quote {border-top:1px solid var(--zhu)}}', null],
    ['quote far stamp silhouette', 'features/cards/quote-lod-02.css', '@layer features {.field-card .field-card__overview-tag {border:1px solid var(--zhu)}}', null],
    ['quote red header text', 'features/cards/quote.css', '@layer features {.field-card--quote .field-card__head {color:var(--zhu)}}', 'accent whitelist'],
    ['quote far exaggerated border', 'features/cards/quote-lod-02.css', '@layer features {.field-card .field-card__overview-tag {border:8px solid var(--zhu)}}', 'accent whitelist'],
    ['quote far red text', 'features/cards/quote-lod-02.css', '@layer features {.field-card .field-card__overview--quote {color:var(--zhu)}}', 'accent whitelist'],
    ['quote far yellow paper', 'features/cards/quote-lod-02.css', '@layer features {.field-card .field-card__overview--quote {background:var(--hl)}}', 'accent whitelist'],
    ['quote far stamp wrong file', 'features/cards/quote.css', '@layer features {.field-card .field-card__overview-tag {border:1px solid var(--zhu)}}', 'accent whitelist'],
    ['welcome cited thread', 'features/welcome.css', '@layer features {.wl-thread--used {stroke:var(--zhu)}}', null],
    ['welcome quote rule', 'features/welcome.css', '@layer features {.wl-quote__head {border-bottom:1px solid var(--zhu)}}', null],
    ['welcome stamp border', 'features/welcome.css', '@layer features {.wl-stamp {border:1px solid var(--zhu)}}', null],
    ['welcome stamp separator', 'features/welcome.css', '@layer features {.wl-stamp__icon {border-right:1px solid var(--zhu)}}', null],
    ['welcome stamp icon', 'features/welcome.css', '@layer features {.wl-stamp__icon {fill:var(--zhu)}}', null],
    ['welcome paragraph ring', 'features/welcome.css', '@layer features {.wl-draft__paragraph {border:1px solid var(--zhu)}}', null],
    ['welcome source mark', 'features/welcome.css', '@layer features {.wl-video__source mark {background:var(--hl)}}', null],
    ['welcome red text', 'features/welcome.css', '@layer features {.wl-stamp {color:var(--zhu)}}', 'accent whitelist'],
    ['welcome red paint property', 'features/welcome.css', '@layer features {.wl-thread--used {background:var(--zhu)}}', 'accent whitelist'],
    ['welcome yellow entry', 'features/welcome.css', '@layer features {.wl-entry {background:var(--hl)}}', 'accent whitelist'],
    ['welcome non-source mark', 'features/welcome.css', '@layer features {.wl-draft mark {background:var(--hl)}}', 'accent whitelist'],
    ['welcome selector in another file', 'features/test.css', '@layer features {.wl-stamp {border:1px solid var(--zhu)}}', 'accent whitelist'],
    ['welcome nested stamp selector', 'features/welcome.css', '@layer features {.wl-stamp .child {border:1px solid var(--zhu)}}', 'accent whitelist'],
    ['welcome red alias text', 'features/welcome.css', '@layer features {:root {--cheat:var(--zhu)}.wl-stamp {color:var(--cheat)}}', 'accent whitelist'],
    ['cover import', 'index.css', '@import "../export-cover/cover.css";', 'cover import'],
  ];
  assert.deepEqual(check(fixture).problems, []);
  for (const [name, f, value, expected] of cases) {
    const result = check({ ...fixture, [`src/styles/${f}`]: value });
    if (expected) assert.ok(result.problems.some(p => p.rule === expected), `${name}: must fail (${expected})`); else assert.deepEqual(result.problems, [], name);
    if (name === 'line preserved') assert.equal(result.problems.find(p => p.rule === 'effect').line, 4);
    console.log(`PASS ${name}: ${expected ? 'rejected' : 'accepted'}`);
  }
  for (const value of ['<svg filter="url(#blur)"/>', '<feGaussianBlur/>', '<div style={{mixBlendMode:"multiply"}}/>']) assert.ok(check({ ...fixture, 'src/cards/Test.tsx': `const X=()=>${value};` }).problems.some(p => p.rule === 'TSX effect'));
  assert.deepEqual(check({ ...fixture, 'src/cards/Test.tsx': '// <feGaussianBlur/>\nconst X=()=> <div/>;' }).problems, []);
  assert.ok(check({ ...fixture, 'native/window-appearance.ts': "const ground={light:'#FFFFFF',dark:'#1A1917'}" }).problems.some(p => p.rule === 'boot ground'));
  assert.ok(check({ ...fixture, 'src/styles/tokens/semantic.css': fixture['src/styles/tokens/semantic.css'] + '\n/* 11. */\n@layer tokens {:root {--oops:var(--bg-canvas)}}' }).problems.some(p => p.rule === 'section 11 color'));
  const debt = { ...fixture, 'src/styles/features/test.css': '@layer features {.bad {color:var(--source-fg)}}' }, baseline = check(debt).counts;
  assert.equal(check(debt, { baseline }).problems.length, 0);
  assert.ok(check({ ...debt, 'src/styles/features/test.css': debt['src/styles/features/test.css'].replace('}}', ';background:var(--source-fg)}}') }, { baseline }).problems.length);
  assert.ok(check(debt, { baseline, mode: 'forbid' }).problems.length);
  const moved = { ...fixture, 'src/styles/features/cards/base.css': debt['src/styles/features/test.css'] };
  assert.deepEqual(check(moved, { baseline }).problems, []);
  assert.ok(check({ ...moved, 'src/styles/features/cards/video.css': debt['src/styles/features/test.css'] }, { baseline }).problems.length);
  const shadowDebt = { ...fixture, 'src/styles/features/cards/base.css': '@layer features {.field-card > div {box-shadow:var(--shadow-test)}}' };
  const shadowBaseline = check(shadowDebt).counts;
  assert.ok(check({ ...shadowDebt, 'src/styles/tokens/semantic.css': fixture['src/styles/tokens/semantic.css'].replace('--shadow-test:', '--shadow-test:0 0 2px var(--ink),') }, { baseline: shadowBaseline }).problems.some(p => p.rule === 'card shadow'));
  console.log('PASS TSX/boot/section11/ratchet/forbid mutations');
  return cases.length + 12;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--self-test')) console.log(`check-css-tokens: self-test ${selfTest()} passed`);
  else {
    const index = process.argv.indexOf('--mode'), fixture = process.argv.indexOf('--fixture');
    const sources = fixture < 0 ? await sourcesAt(root) : JSON.parse(await fs.readFile(process.argv[fixture + 1], 'utf8'));
    const result = analyzeStyles(sources, { mode: index < 0 ? 'ratchet' : process.argv[index + 1] });
    if (process.argv.includes('--print-baseline')) console.log(JSON.stringify(result.counts, null, 2));
    else if (result.problems.length) { console.error(`check-css-tokens: ${result.problems.length} problem(s)\n${result.problems.map(p => `${p.file}:${p.line} [${p.rule}] ${p.detail}`).join('\n')}`); process.exitCode = 1; }
    else console.log(`check-css-tokens: ok (${result.debt.length} existing migration occurrences; baseline f2697b8)`);
  }
}

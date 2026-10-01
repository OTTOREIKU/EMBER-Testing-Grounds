// HTML injection, the sink half (2026-09-28). Most of the UI is HTML strings
// handed to innerHTML, so the question for every ${...} in a template that
// holds markup is: can this carry text a player, a file or the other side
// wrote? A unit's label, a squad's name, a log line or a refusal reason (both
// quote labels), a note, a username - any of those must pass through the
// page's escape helper. This reads the whole program with the TypeScript
// checker and fails on any such interpolation that is not escaped.
//
// "Tainted" is judged by name, which is deliberately broad: a value that only
// looks like one (a constant called label) is cheaper to wrap in esc() than
// to argue about, and escaping plain text never changes what is drawn.
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ts = require(path.join(APP, 'node_modules/typescript'));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}\n       want ${w}, got ${g}`); }
};

console.log('HTML sinks\n');

const cfg = ts.readConfigFile(path.join(APP, 'tsconfig.json'), ts.sys.readFile);
const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, APP);
const program = ts.createProgram(parsed.fileNames, parsed.options);
const checker = program.getTypeChecker();

const ESC = /^(esc|escapeHtml|escAttr|attr)$/;
const HTMLISH = /<[a-zA-Z!/]|\b[a-z-]+=["']/;
const TAINT = /\.label\b|\blabel\b|squadLabel\b|squadName\b|sideNames|\.log\b|\blogs?\b|\bwhy\b|\breason\b|username|displayName|\bnote\b|\.note\b|\.name\b(?!\.(?:en|zh))/;
const SOURCES = /^(squadLabel|squadName)$/;

const strip = (e) => {
  while (e && (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))) e = e.expression;
  return e;
};
const calleeName = (e) => {
  if (!ts.isCallExpression(e)) return null;
  const c = e.expression;
  return ts.isIdentifier(c) ? c.text : ts.isPropertyAccessExpression(c) ? c.name.text : null;
};
function safeType(t) {
  if (t.flags & (ts.TypeFlags.NumberLike | ts.TypeFlags.BooleanLike | ts.TypeFlags.BigIntLike | ts.TypeFlags.Undefined | ts.TypeFlags.Null | ts.TypeFlags.Void | ts.TypeFlags.Never | ts.TypeFlags.StringLiteral | ts.TypeFlags.EnumLike)) return true;
  return t.isUnion() && t.types.every(safeType);
}
const isHtmlTemplate = (e) => ts.isTemplateExpression(e)
  ? HTMLISH.test([e.head.text, ...e.templateSpans.map((s) => s.literal.text)].join(''))
  : (ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) && HTMLISH.test(e.text);

function declOf(e) {
  let sym = checker.getSymbolAtLocation(e);
  if (sym && sym.flags & ts.SymbolFlags.Alias) sym = checker.getAliasedSymbol(sym);
  return sym?.valueDeclaration ?? sym?.declarations?.[0];
}
function returnsOf(fn) {
  if (!fn.body) return [];
  if (!ts.isBlock(fn.body)) return [fn.body];
  const out = [];
  const walk = (n) => {
    if (n !== fn && ts.isFunctionLike(n)) return;
    if (ts.isReturnStatement(n) && n.expression) out.push(n.expression);
    ts.forEachChild(n, walk);
  };
  walk(fn.body);
  return out;
}

// The names an expression reads, leaving out any function or template inside
// it: `rows.map((r) => `...${esc(r.label)}...`).join('')` reads `rows`, not
// `label`, and it is the callback's own template that answers for the label.
function shallow(e) {
  e = strip(e);
  if (!e) return '';
  if (ts.isIdentifier(e) || e.kind === ts.SyntaxKind.ThisKeyword) return e.getText();
  if (ts.isPropertyAccessExpression(e)) return `${shallow(e.expression)}.${e.name.text}`;
  if (ts.isElementAccessExpression(e)) return `${shallow(e.expression)}[${shallow(e.argumentExpression)}]`;
  if (ts.isCallExpression(e)) return `${shallow(e.expression)}(${e.arguments.map(shallow).join(',')})`;
  if (ts.isFunctionLike(e) || ts.isTemplateExpression(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isStringLiteral(e)) return '';
  if (ts.isBinaryExpression(e)) return `${shallow(e.left)} ${shallow(e.right)}`;
  if (ts.isConditionalExpression(e)) return `${shallow(e.whenTrue)} ${shallow(e.whenFalse)}`;
  if (ts.isArrayLiteralExpression(e)) return e.elements.map(shallow).join(',');
  return '';
}
const inlineFn = (e) => { e = strip(e); return e && (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) ? e : null; };

// Is the array this chain walks built from player text? Followed back through
// map/filter/reverse chains, consts and `?? []` fallbacks to where it starts:
// `entries.map(...).reverse()` walks `entries`, which is `t.log ?? []`.
function chainTainted(x, seen) {
  x = strip(x);
  for (let i = 0; i < 20 && x; i++) {
    if (TAINT.test(shallow(x))) return true;
    if (ts.isCallExpression(x) && ts.isPropertyAccessExpression(x.expression)
      && /^(map|flatMap|filter|reverse|slice|sort|concat|flat)$/.test(x.expression.name.text)) { x = strip(x.expression.expression); continue; }
    if (ts.isBinaryExpression(x) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(x.operatorToken.kind)) { x = strip(x.left); continue; }
    if (ts.isIdentifier(x)) {
      const d = declOf(x);
      if (d && ts.isVariableDeclaration(d) && d.initializer) { x = strip(d.initializer); continue; }
      return !!d && paramTainted(d, seen);
    }
    return false;
  }
  return false;
}
// A callback's parameter (or a name destructured from it) holds whatever the
// array it walks holds: `t.log.map((l) => ...)` hands every log line to `l`.
function paramTainted(d, seen) {
  let n = d;
  while (n && (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))) n = n.parent;
  if (!n || !ts.isParameter(n)) return false;
  const fn = n.parent;
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn)) || fn.parameters[0] !== n) return false;
  const call = fn.parent;
  if (!call || !ts.isCallExpression(call) || !ts.isPropertyAccessExpression(call.expression)
    || !/^(map|flatMap|forEach|filter|find|some|every)$/.test(call.expression.name.text)) return false;
  if (seen.has(call)) return false;
  seen.add(call);
  return chainTainted(call.expression.expression, seen);
}

// Does this expression, as written, put raw tainted text into the markup?
// Escaped calls, safe types and markup built by our own templates do not; the
// pieces of a conditional or a fallback are judged one by one; a const is
// judged by what it holds, a callback or a local function by what it returns.
function leaks(e, seen = new Set()) {
  e = strip(e);
  if (!e || seen.has(e)) return false;
  seen.add(e);
  const name = calleeName(e);
  if (name && ESC.test(name)) return false;
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return false;
  if (ts.isTemplateExpression(e)) return isHtmlTemplate(e) ? false : e.templateSpans.some((s) => leaks(s.expression, seen));
  if (ts.isConditionalExpression(e)) return leaks(e.whenTrue, seen) || leaks(e.whenFalse, seen);
  if (ts.isBinaryExpression(e) && [ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(e.operatorToken.kind)) return leaks(e.left, seen) || leaks(e.right, seen);
  if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return leaks(e.right, seen);
  if (ts.isArrayLiteralExpression(e)) return e.elements.some((x) => leaks(x, seen));
  if (safeType(checker.getTypeAtLocation(e))) return false;
  if (ts.isIdentifier(e)) {
    const d = declOf(e);
    if (d && ts.isVariableDeclaration(d) && d.initializer && (d.parent.flags & ts.NodeFlags.Const) && !inlineFn(d.initializer)) {
      return leaks(d.initializer, seen);
    }
    if (d && paramTainted(d, seen)) return true;
    return TAINT.test(e.text);
  }
  if (ts.isCallExpression(e)) {
    // An immediately called function, and array chains: judge the callback,
    // whose own template answers for each element.
    const iife = inlineFn(e.expression);
    if (iife) return returnsOf(iife).some((r) => leaks(r, seen));
    if (ts.isIdentifier(e.expression) && e.expression.text === 'String') return e.arguments.some((a) => leaks(a, seen));
    if (ts.isPropertyAccessExpression(e.expression)) {
      const method = e.expression.name.text;
      const target = e.expression.expression;
      if (/^(map|flatMap)$/.test(method) && inlineFn(e.arguments[0])) return returnsOf(inlineFn(e.arguments[0])).some((r) => leaks(r, seen));
      if (/^(join|filter|slice|concat|reverse|sort|trim|toUpperCase|toLowerCase|replace)$/.test(method)) return leaks(target, seen) || e.arguments.some((a) => !inlineFn(a) && leaks(a, seen));
    }
    // The functions that ARE the names: whatever they return is player text.
    if (ts.isIdentifier(e.expression) && SOURCES.test(e.expression.text)) return true;
    // A method read off something tainted (t.label.at(0), sq.name.slice(1)).
    if (ts.isPropertyAccessExpression(e.expression) && TAINT.test(shallow(e.expression.expression))) return true;
    // Any other local function: judged by what it returns, not by its name or
    // its arguments (a helper that escapes what it is given is fine).
    let d = declOf(e.expression);
    if (d && ts.isVariableDeclaration(d) && d.initializer) d = inlineFn(d.initializer);
    if (d && ts.isFunctionLike(d) && d.body) return returnsOf(d).some((r) => leaks(r, seen));
    return TAINT.test(shallow(e.expression));
  }
  if (TAINT.test(shallow(e))) return true;
  // A field read off a tainted callback parameter (`e.text` of a log entry).
  let base = e;
  while (base && (ts.isPropertyAccessExpression(base) || ts.isElementAccessExpression(base))) base = strip(base.expression);
  if (base && ts.isIdentifier(base)) {
    const d = declOf(base);
    if (d && paramTainted(d, seen)) return true;
  }
  return false;
}

// ---------- the attribute rule (security audit W6, 2026-10-01) ----------
// The names above catch a label or a log line anywhere. Inside an ATTRIBUTE
// the bar is higher, because the wire cleaner (safetext.ts cleanStrings) takes
// out brackets and leaves quotes: any string read off a value that arrived
// from a peer, a file or the server could close the attribute it is printed
// into, whatever it is called. So such a string is printed into an attribute
// only through the escaper, at the place it is printed.
//
// Judged by what is PRINTED: both branches of a conditional, both sides of a
// fallback or a join, a call's arguments. A value that is only compared
// (`state.map === m.id ? ' sel' : ''`) prints nothing of itself.
const WIRE = /^(GameState|Token|ScriptState|RoundState|LogEntry|Marker|SmokeGroup|MineState|SavedSquad|MechPreset|MechLoadout|NetRoom|NetView|RolledDie|Account|AdminUser|AdminInvite|LeaderPlayer|LeaderSquad|MyRecord|CardStat|FactionStat|StatsSummary|SquadEntry|GameReport|Collection|HeldCard)$/;
const WIRE_FILE = /\/src\/commands\.ts$/;
function wireOwner(n) {
  const sym = checker.getSymbolAtLocation(n.name);
  for (const d of sym?.declarations ?? []) {
    let owner = d.parent;
    while (owner && !ts.isInterfaceDeclaration(owner) && !ts.isTypeAliasDeclaration(owner)) owner = owner.parent;
    const name = owner?.name?.text ?? '';
    if (WIRE.test(name) || WIRE_FILE.test(d.getSourceFile().fileName.replace(/\\/g, '/'))) return name || 'Command';
  }
  return null;
}
function printedRaw(e, seen = new Set()) {
  e = strip(e);
  if (!e || seen.has(e)) return [];
  seen.add(e);
  if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e) || ts.isNumericLiteral(e)) return [];
  if (ts.isConditionalExpression(e)) return [...printedRaw(e.whenTrue, seen), ...printedRaw(e.whenFalse, seen)];
  if (ts.isBinaryExpression(e)) {
    const k = e.operatorToken.kind;
    if ([ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.PlusToken].includes(k)) return [...printedRaw(e.left, seen), ...printedRaw(e.right, seen)];
    return k === ts.SyntaxKind.AmpersandAmpersandToken ? printedRaw(e.right, seen) : [];
  }
  if (ts.isTemplateExpression(e)) return e.templateSpans.flatMap((s) => printedRaw(s.expression, seen));
  if (ts.isCallExpression(e)) {
    const name = calleeName(e);
    if (name && ESC.test(name)) return [];
    if (safeType(checker.getTypeAtLocation(e))) return [];
    const recv = ts.isPropertyAccessExpression(e.expression) ? printedRaw(e.expression.expression, seen) : [];
    return [...recv, ...e.arguments.flatMap((a) => (ts.isFunctionLike(a) ? [] : printedRaw(a, seen)))];
  }
  if (safeType(checker.getTypeAtLocation(e))) return [];
  if (ts.isIdentifier(e)) {
    const d = declOf(e);
    return d && ts.isVariableDeclaration(d) && d.initializer && (d.parent.flags & ts.NodeFlags.Const) ? printedRaw(d.initializer, seen) : [];
  }
  if (ts.isPropertyAccessExpression(e)) {
    const owner = wireOwner(e);
    return owner ? [`${owner}.${e.name.text}`] : [];
  }
  return ts.isElementAccessExpression(e) ? printedRaw(e.expression, seen) : [];
}
// Whether the text before an interpolation leaves it inside a quoted
// attribute value of the tag it sits in.
function insideAttribute(before) {
  const lt = before.lastIndexOf('<');
  if (lt < before.lastIndexOf('>')) return false;
  let quote = null;
  for (const m of before.slice(lt).matchAll(/([\w:-]+)\s*=\s*(["'])|(["'])/g)) {
    if (quote) { if (!m[1] && m[3] === quote) quote = null; }
    else if (m[1]) quote = m[2];
  }
  return !!quote;
}
const attrFound = [];
let attrSpans = 0;

const found = [];
function visit(sf, node) {
  if (ts.isTemplateExpression(node) && isHtmlTemplate(node)) {
    for (const span of node.templateSpans) if (leaks(span.expression)) found.push([sf, span.expression]);
    let before = node.head.text;
    for (const span of node.templateSpans) {
      if (insideAttribute(before)) {
        attrSpans++;
        const raw = [...new Set(printedRaw(span.expression))];
        if (raw.length) attrFound.push([sf, span.expression, raw]);
      }
      before += `\u0000${span.literal.text}`;
    }
  }
  if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsToken, ts.SyntaxKind.PlusEqualsToken].includes(node.operatorToken.kind)
    && ts.isPropertyAccessExpression(node.left) && /^(innerHTML|outerHTML)$/.test(node.left.name.text) && leaks(node.right)) found.push([sf, node.right]);
  if (ts.isCallExpression(node) && calleeName(node) === 'insertAdjacentHTML' && node.arguments[1] && leaks(node.arguments[1])) found.push([sf, node.arguments[1]]);
  ts.forEachChild(node, (c) => visit(sf, c));
}
let files = 0;
for (const sf of program.getSourceFiles()) {
  const f = sf.fileName.replace(/\\/g, '/');
  if (f.includes('/node_modules/') || f.endsWith('.d.ts') || !/\/app\/(src|pad)\//.test(f)) continue;
  files++;
  visit(sf, sf);
}
check('the whole client was read', files > 70, true);
const where = found.map(([sf, e]) => `${path.relative(APP, sf.fileName).replace(/\\/g, '/')}:${sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1} ${e.getText(sf).replace(/\s+/g, ' ').slice(0, 90)}`);
check('no label, squad name, log line, reason, note or username reaches markup unescaped', where, []);

const attrWhere = attrFound.map(([sf, e, raw]) => `${path.relative(APP, sf.fileName).replace(/\\/g, '/')}:${sf.getLineAndCharacterOfPosition(e.getStart(sf)).line + 1} ${e.getText(sf).replace(/\s+/g, ' ').slice(0, 70)} <- ${raw.join(', ')}`);
check('the attributes were read too', attrSpans > 900, true);
check('no string off the game state, a command, a saved build or a server record is printed into an attribute unescaped', attrWhere, []);

// A typed password is never written into markup (security audit W7): as a
// value="" attribute it sat in the page's HTML, where anything that reads the
// DOM finds it. A password box is drawn empty, and a page that redraws puts
// the typed text back as the field's value PROPERTY (pad.ts render).
{
  const boxes = [];
  const helped = [];
  for (const sf of program.getSourceFiles()) {
    const f = sf.fileName.replace(/\\/g, '/');
    if (f.includes('/node_modules/') || f.endsWith('.d.ts') || !/\/app\/(src|pad)\//.test(f)) continue;
    const rel = path.relative(APP, sf.fileName).replace(/\\/g, '/');
    const lineOf = (at) => sf.getLineAndCharacterOfPosition(at).line + 1;
    for (const m of sf.text.matchAll(/<input\b[^>]*>/g)) {
      if (/type="password"/.test(m[0])) boxes.push({ at: `${rel}:${lineOf(m.index)}`, value: /\bvalue\s*=/.test(m[0]) });
    }
    // A box built by a helper that takes the type as text (multiplayer.ts
    // field): nothing may be passed after 'password', where extra attributes go.
    const walk = (node) => {
      if (ts.isCallExpression(node)) {
        const at = node.arguments.findIndex((a) => ts.isStringLiteral(a) && a.text === 'password');
        if (at >= 0 && /field$/i.test(calleeName(node) ?? '')) helped.push({ at: `${rel}:${lineOf(node.getStart(sf))}`, extra: node.arguments.length > at + 1 });
      }
      ts.forEachChild(node, walk);
    };
    walk(sf);
  }
  check('every password box in the apps was found', [boxes.length >= 4, helped.length >= 2], [true, true]);
  check('none of them carries what was typed in its markup',
    [...boxes.filter((b) => b.value), ...helped.filter((h) => h.extra)].map((x) => x.at), []);
  const pad = program.getSourceFiles().find((sf) => sf.fileName.replace(/\\/g, '/').endsWith('/app/pad/pad.ts')).text;
  check('the pad puts a typed password back as the value of the field, after it is drawn',
    /root\.innerHTML = screen === 'signin'[\s\S]{0,700}\['pad-pass', form\.pass\], \['pad-rpass', form\.rpass\][\s\S]{0,200}box\.value = typed/.test(pad), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

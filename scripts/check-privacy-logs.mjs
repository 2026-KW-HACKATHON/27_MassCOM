#!/usr/bin/env node

import { createRequire } from 'node:module';
import { readdirSync, readFileSync } from 'node:fs';
import { extname, join, relative, resolve } from 'node:path';

const toolRoot = resolve(new URL('..', import.meta.url).pathname);
const scanRoot = resolve(process.argv[2] ?? toolRoot);
const require = createRequire(import.meta.url);
let ts;
for (const candidate of [
  join(scanRoot, 'apps/api/node_modules/typescript'),
  join(scanRoot, 'apps/mobile/node_modules/typescript'),
  join(toolRoot, 'apps/api/node_modules/typescript'),
  join(toolRoot, 'apps/mobile/node_modules/typescript'),
]) {
  try {
    ts = require(candidate);
    break;
  } catch (error) {
    if (error?.code !== 'MODULE_NOT_FOUND') throw error;
  }
}
if (!ts) {
  console.error('privacy log scan requires installed TypeScript dependencies');
  process.exit(1);
}

const extensions = new Set(['.ts', '.tsx', '.js', '.jsx']);
const ignoredDirectories = new Set(['node_modules', 'dist', 'build']);
const baseForbidden = new Set([
  'accountId', 'customerAccountId', 'createdByAccountId', 'merchantReference',
  'claim', 'claimToken', 'token', 'signature', 'password', 'secret', 'privateKey',
  'mnemonic', 'recoveryPhrase', 'address',
]);
const apiForbidden = new Set(['error', 'caught', 'message', 'stack', 'cause']);
const loggerMethods = new Set(['log', 'error', 'warn', 'info', 'debug']);

function sourceFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!ignoredDirectories.has(entry.name)) files.push(...sourceFiles(join(directory, entry.name)));
    } else if (entry.isFile() && extensions.has(extname(entry.name))) {
      files.push(join(directory, entry.name));
    }
  }
  return files;
}

function staticMemberPath(node) {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) {
    const parent = staticMemberPath(node.expression);
    return parent && [...parent, node.name.text];
  }
  if (ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression)) {
    const parent = staticMemberPath(node.expression);
    return parent && [...parent, node.argumentExpression.text];
  }
  return null;
}

function isDirectLogger(expression) {
  const path = staticMemberPath(expression);
  return (
    path?.length === 2 && path[0] === 'console' && loggerMethods.has(path[1])
  ) || (
    path?.length === 3 && path[0] === 'process' && path[1] === 'stderr' && path[2] === 'write'
  );
}

function isApprovedSafeMetadata(node) {
  return ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'safeErrorMetadata'
    && node.arguments.length >= 2
    && node.arguments.length <= 3
    && ts.isStringLiteralLike(node.arguments[0]);
}

function appendAlias(aliases, name, source) {
  const existing = aliases.get(name) ?? [];
  existing.push(source);
  aliases.set(name, existing);
}

function collectBindingAliases(name, initializer, propertyNames, aliases, tainted = false) {
  if (ts.isIdentifier(name)) {
    appendAlias(aliases, name.text, { initializer, propertyNames, tainted });
    return;
  }
  for (const element of name.elements) {
    if (ts.isOmittedExpression(element)) continue;
    const propertyName = element.propertyName && (
      ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName)
    ) ? element.propertyName.text : ts.isIdentifier(element.name) ? element.name.text : '';
    collectBindingAliases(
      element.name,
      initializer,
      propertyName === '' ? propertyNames : [...propertyNames, propertyName],
      aliases,
      tainted,
    );
  }
}

function fileLeaks(file) {
  const sourceFile = ts.createSourceFile(
    file,
    readFileSync(file, 'utf8'),
    ts.ScriptTarget.Latest,
    true,
    extname(file).includes('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics?.length) {
    throw new Error(`privacy log scan could not parse ${relative(scanRoot, file)}`);
  }

  const isApiFile = relative(scanRoot, file).startsWith('apps/api/');
  const aliases = new Map();
  function collectAliases(node) {
    if (ts.isVariableDeclaration(node) && node.initializer) {
      collectBindingAliases(node.name, node.initializer, [], aliases);
    } else if (
      ts.isBinaryExpression(node)
      && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(node.left)
    ) {
      appendAlias(aliases, node.left.text, {
        initializer: node.right,
        propertyNames: [],
        tainted: false,
      });
    }
    if (node.parameters) {
      for (const parameter of node.parameters) {
        collectBindingAliases(parameter.name, undefined, [], aliases, isApiFile);
      }
    }
    ts.forEachChild(node, collectAliases);
  }
  collectAliases(sourceFile);

  const forbidden = new Set(baseForbidden);
  if (isApiFile) {
    for (const name of apiForbidden) forbidden.add(name);
  }

  function expressionIsLogger(expression, visiting = new Set()) {
    if (isDirectLogger(expression)) return true;
    if (!ts.isIdentifier(expression) || visiting.has(expression.text)) return false;
    const nextVisiting = new Set(visiting).add(expression.text);
    return (aliases.get(expression.text) ?? []).some(
      (alias) => alias.initializer && expressionIsLogger(alias.initializer, nextVisiting),
    );
  }

  function isSensitive(node, visiting = new Set()) {
    if (isApprovedSafeMetadata(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node)) {
      return false;
    }
    if (ts.isIdentifier(node)) {
      if (forbidden.has(node.text)) return true;
      const aliasSources = aliases.get(node.text);
      if (!aliasSources || visiting.has(node.text)) return false;
      const nextVisiting = new Set(visiting).add(node.text);
      return aliasSources.some((alias) => alias.tainted
        || alias.propertyNames.some((name) => forbidden.has(name))
        || (alias.initializer && isSensitive(alias.initializer, nextVisiting)));
    }
    if (ts.isPropertyAccessExpression(node)) {
      return forbidden.has(node.name.text) || isSensitive(node.expression, visiting);
    }
    if (ts.isElementAccessExpression(node)) {
      return (
        ts.isStringLiteralLike(node.argumentExpression)
        && forbidden.has(node.argumentExpression.text)
      ) || isSensitive(node.expression, visiting) || isSensitive(node.argumentExpression, visiting);
    }
    let sensitive = false;
    ts.forEachChild(node, (child) => {
      if (!sensitive && isSensitive(child, visiting)) sensitive = true;
    });
    return sensitive;
  }

  let leaks = false;
  function inspect(node) {
    if (
      ts.isCallExpression(node)
      && expressionIsLogger(node.expression)
      && node.arguments.some((argument) => isSensitive(argument))
    ) leaks = true;
    if (!leaks) ts.forEachChild(node, inspect);
  }
  inspect(sourceFile);
  return leaks;
}

let findingCount = 0;
for (const file of sourceFiles(join(scanRoot, 'apps'))) {
  if (fileLeaks(file)) {
    console.error(`possible sensitive log arguments in ${relative(scanRoot, file)}`);
    findingCount += 1;
  }
}
if (findingCount > 0) {
  console.error(`privacy log scan failed: ${findingCount} file(s) require review`);
  process.exit(1);
}

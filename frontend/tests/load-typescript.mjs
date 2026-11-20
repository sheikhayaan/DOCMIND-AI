import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import ts from 'typescript';

const root = path.resolve(import.meta.dirname, '..');

// Loads the project's TypeScript directly using the existing compiler, with no added test packages.
export function loadTypeScript(relative, mocks = {}, cache = new Map()) {
  const filename = path.resolve(root, relative);
  if (cache.has(filename)) return cache.get(filename).exports;
  const source = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  cache.set(filename, mod);
  const nativeRequire = createRequire(filename);
  // Resolves local aliases, styles, and deliberate provider mocks for offline unit tests.
  const requireLocal = (specifier) => {
    if (Object.hasOwn(mocks, specifier)) return mocks[specifier];
    if (specifier.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (specifier === 'server-only') return {};
    if (specifier.startsWith('@/') || specifier.startsWith('.')) {
      const base = specifier.startsWith('@/') ? path.join(root, specifier.slice(2)) : path.resolve(path.dirname(filename), specifier);
      const target = ['.ts', '.tsx', ''].map((extension) => `${base}${extension}`).find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
      if (target) return loadTypeScript(path.relative(root, target), mocks, cache);
    }
    return nativeRequire(specifier);
  };
  new Function('require', 'module', 'exports', compiled)(requireLocal, mod, mod.exports);
  return mod.exports;
}

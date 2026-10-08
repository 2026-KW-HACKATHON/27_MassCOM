import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath, URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

test('FullScreenModal passes the no-animation choice to the native modal', () => {
  const source = read('./full-screen-modal.tsx');
  const exports: Record<string, unknown> = {};
  runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, {
    exports,
    require: (name: string) => {
      if (name === 'react/jsx-runtime') return { jsx: (type: unknown, props: unknown) => ({ type, props }) };
      if (name === 'react-native') return { Dimensions: { get: () => ({ height: 800 }) }, Modal: 'Modal', Platform: { OS: 'android' }, View: 'View', useWindowDimensions: () => ({ height: 800 }) };
      if (name === 'react-native-safe-area-context') return { SafeAreaProvider: 'SafeAreaProvider' };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  const render = exports.FullScreenModal as (props: Record<string, unknown>) => { type: string; props: Record<string, unknown> };
  const modal = render({ visible: true, animationType: 'none', onRequestClose: () => {}, children: 'album' });
  assert.equal(modal.type, 'Modal');
  assert.equal(modal.props.animationType, 'none');
});

for (const path of ['../screens/coin-shop/index.tsx', '../screens/coin-collection/index.tsx']) {
  test(`${path} registration modal follows the live motion preference`, () => {
    const source = read(path);
    const file = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let animation: ts.Expression | undefined;
    function visit(node: ts.Node) {
      if (ts.isJsxElement(node) && node.openingElement.tagName.getText(file) === 'FullScreenModal'
        && node.getText(file).includes('<RegistrationAlbum')) {
        const attribute = node.openingElement.attributes.properties.find((property) => ts.isJsxAttribute(property) && property.name.getText(file) === 'animationType');
        if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isJsxExpression(attribute.initializer)) {
          animation = attribute.initializer.expression;
        }
      }
      ts.forEachChild(node, visit);
    }
    visit(file);
    assert.match(source, /const motionEnabled = useMotionEnabled\(\)/);
    assert.ok(animation, 'registration modal must receive an animation expression');
    const choose = new Function('motionEnabled', `return (${animation.getText(file)});`) as (enabled: boolean) => string;
    assert.equal(choose(true), 'slide');
    assert.equal(choose(false), 'none');
  });
}

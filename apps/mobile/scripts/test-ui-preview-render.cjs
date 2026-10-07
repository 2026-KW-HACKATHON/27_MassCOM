// Node SSR smoke: actual React Native Web components, not a browser or visual test.
const { buildSync } = require("esbuild");
const { resolve } = require("node:path");
const { createRequire } = require("node:module");
const root = resolve(__dirname, "..");
  const result = buildSync({
    absWorkingDir: root,
    stdin: {
      contents: `
        import { createElement as h } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server';
        import assert from 'node:assert/strict';
        import { PreviewContext } from './src/ui-preview/components';
        import { SocialScreens } from './src/ui-preview/social-screens';
        import { CommerceScreens } from './src/ui-preview/commerce-screens';
        import { PlayScreens } from './src/ui-preview/play-screens';
        import { AccountScreens } from './src/ui-preview/account-screens';
        import { initialPreviewState } from './src/ui-preview/model';
        import { screenCatalog } from './src/ui-preview/catalog';
        import { newGame } from './src/ui-preview/game-model';
        const errors = [];
        const originalError = console.error;
        console.error = (...args) => { errors.push(args.join(' ')); originalError(...args); };
        const noop = () => {};
        function render(id, state, coin = 'c2') {
          const [board, panel] = id.split('-').map(Number);
          const component = board <= 6 ? SocialScreens : board <= 14 ? CommerceScreens : board <= 17 ? PlayScreens : AccountScreens;
          const game = board === 16 ? panel + 1 : 0;
          const context = {
            state, draft: state.room, selection: { store:'cafe', coin, friend:'하루', item:'sofa', neighbor:'mocha', game, ticket:0, mail:'gift-sora' },
            choose:noop, update:noop, go:noop, back:noop, toast:noop, setDraft:noop, reset:noop,
            startGame:noop, openCatalog:noop, gameSession:newGame(game), gameAction:noop, quitGame:noop,
          };
          return renderToStaticMarkup(h(PreviewContext.Provider, {value:context}, h(component, {board,panel})));
        }
        const base = initialPreviewState();
        for (const {id,title} of screenCatalog) {
          const html = render(id, base);
          assert.ok(html.length > 100, id + ': empty screen');
          assert.ok(!html.includes('undefined') && !html.includes('NaN'), id + ': invalid content');
          console.log('PASS ' + id + ' ' + title);
        }
        const empty = {...base, tickets:{cafe:0,bakery:0,food:0}};
        const home = render('00-0', empty);
        assert.ok(home.includes('보유한 뽑기권이 없어요'));
        assert.ok(!home.includes('뽑기권 0장'));
        assert.ok(render('11-1', base, 'missing').includes('리롤할 코인이 없어요'));
        const locked = initialPreviewState(); locked.coins[1].nft = 'pending';
        assert.ok(render('11-1', locked).includes('NFT 발급 중이거나 받은 코인'));
        console.error = originalError;
        assert.deepEqual(errors, [], 'React render errors');
        console.log('PASS 67 screen renders + empty tickets / missing coin / NFT lock states');
      `,
      resolveDir: root,
      loader: "tsx",
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    external: ["react", "react-dom/server", "react/jsx-runtime", "react-native-web"],
    alias: {
      "react-native": "react-native-web",
      "react-native-svg": "react-native-svg/lib/commonjs/elements.web.js",
    },
    // Static file URLs only: this checks JSX rendering, not image pixels/loading.
    loader: { ".png": "file" },
    assetNames: "assets/[name]-[hash]",
    outfile: resolve(root, ".render-test-memory.cjs"),
    write: false,
  });
  const js = result.outputFiles.find((f) => f.path.endsWith(".cjs")).text;
  const requireFromMobile = createRequire(resolve(root, "package.json"));
  const Module = require("node:module");
  const mod = new Module(resolve(root, "render.cjs"));
  mod.filename = resolve(root, "render.cjs");
  mod.paths = Module._nodeModulePaths(root);
  mod.require = requireFromMobile;
  mod._compile(js, mod.filename);

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";

const filename = fileURLToPath(new URL("../../scripts/start-ui-preview.cjs", import.meta.url));
function launch() {
  const child = new EventEmitter();
  const processMock = {
    execPath: "node", argv: ["node", filename, "--clear"], exitCode: undefined as number | undefined,
    env: { CI: "1", APP_VARIANT: "production", EXPO_PUBLIC_API_URL: "https://api.masscom.kr" },
  };
  let captured: { args: string[]; options: { env: Record<string, string>; cwd: string } } | undefined;
  const fakeRequire = Object.assign((name: string) => {
    if (name === "node:child_process") return { spawn: (_command: string, args: string[], options: NonNullable<typeof captured>["options"]) => {
      captured = { args, options }; return child;
    } };
    if (name === "node:path") return { resolve };
    throw new Error(`Unexpected module ${name}`);
  }, { resolve: () => "expo-cli" });
  runInNewContext(readFileSync(filename, "utf8"), {
    require: fakeRequire, process: processMock, __dirname: dirname(filename), console: { error() {} },
  });
  return { child, processMock, captured: captured! };
}

test("미리보기 실행기는 상속된 CI를 제거하고 개발 watcher와 loopback 격리를 유지한다", () => {
  const { captured, processMock } = launch();
  assert.equal(captured.options.env.CI, undefined);
  assert.equal(processMock.env.CI, "1", "부모 프로세스의 환경은 바꾸지 않는다");
  assert.equal(captured.options.env.BROWSER, "none");
  assert.equal(captured.options.env.APP_VARIANT, "development");
  assert.equal(captured.options.env.EXPO_NO_DOTENV, "1");
  assert.equal(captured.options.env.MASSCOM_UI_PREVIEW, "1");
  assert.equal(captured.options.env.EXPO_PUBLIC_API_URL, "http://127.0.0.1:3999");
  assert.ok(captured.args.includes("--localhost"));
  assert.ok(captured.args.includes("8091"));
  assert.ok(captured.args.includes("--clear"));
});

test("미리보기 실행 실패와 종료 코드를 호출자에게 전달한다", () => {
  const failed = launch();
  failed.child.emit("error", new Error("test failure"));
  assert.equal(failed.processMock.exitCode, 1);
  const exited = launch();
  exited.child.emit("exit", 7);
  assert.equal(exited.processMock.exitCode, 7);
});

const { spawn } = require("node:child_process");
const { resolve } = require("node:path");
const cli = require.resolve("expo/bin/cli");
const environment = { ...process.env };
// CI mode disables Metro's file watcher and can keep serving an old UI bundle.
// Suppress automatic browser launch without disabling development refresh.
delete environment.CI;
const child = spawn(
  process.execPath,
  [
    cli,
    "start",
    "--web",
    "--localhost",
    "--port",
    process.env.MASSCOM_UI_PORT || "8091",
    ...process.argv.slice(2),
  ],
  {
    cwd: resolve(__dirname, ".."),
    stdio: "inherit",
    env: {
      ...environment,
      BROWSER: "none",
      APP_VARIANT: "development",
      MASSCOM_UI_PREVIEW: "1",
      EXPO_NO_DOTENV: "1",
      EXPO_PUBLIC_API_URL: "http://127.0.0.1:3999",
    },
  },
);
child.on("error", (error) => {
  console.error(`로컬 미리보기 서버를 시작하지 못했어요: ${error.message}`);
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});

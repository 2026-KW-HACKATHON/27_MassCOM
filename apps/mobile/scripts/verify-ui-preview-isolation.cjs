// Local export verification only: does not sign, install, upload, or deploy an app.
const { execFileSync, spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { mkdirSync, readFileSync, readdirSync, writeFileSync } = require("node:fs");
const { resolve, join } = require("node:path");
const assert = require("node:assert/strict");
const mobile = resolve(__dirname, "..");
const repo = resolve(mobile, "../..");
const output = resolve(repo, ".tmp/ui-preview-qa", `isolation-${Date.now()}`);
mkdirSync(output, { recursive: true });
const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
const dirty = !!execFileSync("git", ["status", "--porcelain"], { cwd: repo, encoding: "utf8" }).trim();
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? files(join(dir, entry.name)) : [join(dir, entry.name)]);
}
const artHashes = new Set(files(resolve(mobile, "assets/images/ui-preview")).map((f) => digest(readFileSync(f))));
const results = [];
for (const variant of ["production", "showcase"]) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(EXPO_PUBLIC_|MASSCOM_|APP_VARIANT$)/.test(key)));
  Object.assign(env, {
    CI: "1", EXPO_NO_DOTENV: "1", APP_VARIANT: variant,
    // Deliberately enable the flag: a release-like variant must still reject it.
    MASSCOM_UI_PREVIEW: "1", MASSCOM_BUILD_SOURCE_COMMIT: commit,
    EXPO_PUBLIC_API_URL: variant === "production" ? "https://api.masscom.kr" : "https://demo-api.masscom.kr",
    ...(variant === "showcase" ? { MASSCOM_SHOWCASE_GOOGLE_WEB_CLIENT_ID: "123-previewtest.apps.googleusercontent.com" } : {}),
  });
  const destination = join(output, variant);
  const built = spawnSync(process.execPath, [require.resolve("expo/bin/cli"), "export", "--platform", "android", "--no-bytecode", "--clear", "--max-workers", "2", "--output-dir", destination],
    { cwd: mobile, env, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  writeFileSync(join(output, `${variant}.log`), `${built.stdout ?? ""}\n${built.stderr ?? ""}`);
  assert.equal(built.status, 0, `${variant} export failed; ${join(output, `${variant}.log`)}`);
  const exported = files(destination);
  const bundles = exported.filter((f) => /\.(js|hbc)$/.test(f));
  assert.ok(bundles.length, "no bundles found");
  for (const file of exported) {
    const data = readFileSync(file);
    assert.ok(!artHashes.has(digest(data)), `${variant}: preview art leaked: ${file}`);
    if (bundles.includes(file)) {
      for (const marker of ["masscom:mint-ui-preview:v1", "로컬 테스트 · 67개 화면 보기", "테스트 시작 마일리지"])
        assert.ok(!data.includes(Buffer.from(marker)), `${variant}: preview code leaked: ${marker}`);
    }
  }
  const result = { variant, status: "PASS", bundleCount: bundles.length, files: exported.length, previewAssetMatches: 0 };
  results.push(result);
  console.log(JSON.stringify(result));
}
writeFileSync(join(output, "summary.json"), JSON.stringify({ commit, dirty, results, scope: "Android JavaScript export only; not signed or installed" }, null, 2));
console.log(`Evidence: ${output}`);

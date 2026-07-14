"use strict";

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const REQUIRED_EXECUTION_PACKAGE_PATHS = Object.freeze([
  "lib/commands/execute.js",
  "lib/execution-custody/README.md",
  "lib/execution-custody/agent-custody.js",
  "lib/execution-custody/agent-process.js",
  "lib/execution-custody/attempt.js",
  "lib/execution-custody/change-artifact.js",
  "lib/execution-custody/constants.js",
  "lib/execution-custody/controller-process.js",
  "lib/execution-custody/controller.js",
  "lib/execution-custody/custody-export.js",
  "lib/execution-custody/custody-replay.js",
  "lib/execution-custody/execute.js",
  "lib/execution-custody/execution-bindings.js",
  "lib/execution-custody/git-ops.js",
  "lib/execution-custody/implement.js",
  "lib/execution-custody/portable-verifier.js",
  "lib/execution-custody/support.js",
  "lib/execution-custody/terminal-evidence.js",
]);


const FORBIDDEN_PACKAGE_PATTERNS = Object.freeze([
  /^internal(\/|$)/,
  /^scripts(\/|$)/,
  /^\.agents(\/|$)/,
  /^\.meta-harness\/local(\/|$)/,
  /^\.meta-harness\/snapshots(\/|$)/,
  /^\.meta-harness\/expert-packets(\/|$)/,
  /^\.meta-harness\/workers(\/|$)/,
  /^\.meta-harness\/runs(\/|$)/,
  /^\.env($|\/|\.)/i,
  /(^|\/)secrets?($|[.\-/])/i,
  /(^|\/)credentials?($|[.\-/])/i,
  /(^|\/).*\.pem$/i,
  /(^|\/).*\.key$/i,
  /(^|\/).*\.p12$/i,
  /(^|\/).*\.pfx$/i,
  /(^|\/)id_rsa$/i,
  /(^|\/)id_ed25519$/i,
  /(^|\/).*\.secret$/i,
  /(^|\/).*\.token$/i,
  /(^|\/)\.npmrc(\.|$)/i,
  /^provider-config(\/|$)/,
  /^runtime(\/|$)/,
  /^data(\/|$)/,
  /^demo(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)__pycache__(\/|$)/,
  /(^|\/).*\.pyc$/i,
]);

function toSlash(value) { return String(value).split(path.sep).join("/"); }
function isPlainObject(value) { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function isNonEmptyString(value) { return typeof value === "string" && value.trim().length > 0; }
function writeText(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf8");
}
function check(id, name, status, reason = "", nextAction = "", options = {}) {
  return {
    id,
    name,
    status,
    reason,
    next_action: nextAction,
    required_for_local: Boolean(options.requiredForLocal),
    required_for_release: options.requiredForRelease !== false,
    ...(options.details === undefined ? {} : { details: options.details }),
  };
}
function pass(id, name, reason = "", options = {}) { return check(id, name, "pass", reason, "", options); }
function fail(id, name, reason, nextAction, options = {}) { return check(id, name, "fail", reason, nextAction, options); }
function skip(id, name, reason, nextAction = "", options = {}) { return check(id, name, "skip", reason, nextAction, options); }
function badPackageInfo(info, id, name, action) {
  if (!info.exists) return fail(id, name, "package.json missing", "Add package.json before release checking", { requiredForLocal: true });
  if (info.error) return fail(id, name, `package.json is invalid JSON: ${info.error.message}`, action || "Fix package.json", { requiredForLocal: true });
  return null;
}

function npmInvocation(args) {
  const npmExecPath = process.env.npm_execpath;
  const bundledNpmCli = path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  if (npmExecPath && fs.existsSync(npmExecPath)) return { command: process.execPath, args: [npmExecPath, ...args] };
  if (fs.existsSync(bundledNpmCli)) return { command: process.execPath, args: [bundledNpmCli, ...args] };
  return { command: process.platform === "win32" ? "npm.cmd" : "npm", args };
}
function runNpm(args, options = {}) {
  const invocation = npmInvocation(args);
  const result = spawnSync(invocation.command, invocation.args, {
    cwd: options.cwd,
    env: options.env || process.env,
    encoding: "utf8",
    shell: process.platform === "win32" && invocation.command === "npm.cmd",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: options.timeout || 60_000,
    maxBuffer: 20 * 1024 * 1024,
  });
  return { ...result, command: invocation.command, args: invocation.args };
}
function commandSummary(result) {
  const stderr = String(result.stderr || "").trim();
  const stdout = String(result.stdout || "").trim();
  return stderr || stdout || result.error?.message || `exit ${result.status}`;
}
function parsePackJson(stdout) {
  const data = JSON.parse(stdout);
  const pack = Array.isArray(data) ? data[0] : data;
  if (!isPlainObject(pack)) throw new Error("pack JSON did not contain an object");
  const files = Array.isArray(pack.files) ? pack.files : [];
  return { pack, files: files.map((file) => String(file.path || "")) };
}

function canonicalPackagePath(value) {
  let normalized = String(value || "").replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith("/")) return { ok: false, original: value, reason: "absolute package path" };
  normalized = normalized.replace(/^\.\//, "");
  if (normalized.startsWith("package/")) normalized = normalized.slice("package/".length);
  if (!normalized || normalized === ".") return { ok: false, original: value, reason: "empty package path" };
  const segments = normalized.split("/");
  if (segments.some((segment) => segment === ".." || segment === "")) return { ok: false, original: value, reason: "unsafe package path segment" };
  const posix = path.posix.normalize(normalized);
  if (posix.startsWith("../") || posix === ".." || posix.startsWith("/")) return { ok: false, original: value, reason: "unsafe normalized package path" };
  return { ok: true, original: value, path: posix };
}
function canonicalizePackagePaths(paths) {
  const invalid = [];
  const canonical = [];
  for (const item of paths) {
    const normalized = canonicalPackagePath(item);
    if (!normalized.ok) invalid.push(normalized);
    else canonical.push(normalized.path);
  }
  return { invalid, paths: Array.from(new Set(canonical)).sort((left, right) => left.localeCompare(right)) };
}
function forbiddenPackagePaths(paths) {
  return paths.filter((item) => FORBIDDEN_PACKAGE_PATTERNS.some((pattern) => pattern.test(item.toLowerCase())));
}

function isolatedNpmEnv(root) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (/^(NODE_AUTH_TOKEN|NPM_TOKEN|NPM_CONFIG__AUTH|NPM_CONFIG_.*TOKEN|NPM_CONFIG_.*PASSWORD|NPM_CONFIG_.*USERNAME)$/i.test(key)) {
      delete env[key];
    }
  }
  const home = path.join(root, "home");
  const cache = path.join(root, "npm-cache");
  const userconfig = path.join(root, "empty-npmrc");
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(cache, { recursive: true });
  writeText(userconfig, "");
  env.HOME = home;
  env.USERPROFILE = home;
  env.npm_config_cache = cache;
  env.NPM_CONFIG_CACHE = cache;
  env.npm_config_userconfig = userconfig;
  env.NPM_CONFIG_USERCONFIG = userconfig;
  return { env, home, cache, userconfig, removed_auth_env: true };
}
function cleanupDirs(dirs) {
  const errors = [];
  for (const dir of dirs) {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (error) { errors.push(`${dir}: ${error.message}`); }
  }
  return errors;
}
function installedPackageBinary(projectRoot, pkg) {
  if (isNonEmptyString(pkg.bin)) return path.join(projectRoot, "node_modules", ...String(pkg.name).split("/"), pkg.bin);
  const entries = Object.entries(isPlainObject(pkg.bin) ? pkg.bin : {});
  if (entries.length === 0) return null;
  return path.join(projectRoot, "node_modules", ...String(pkg.name).split("/"), String(entries[0][1]));
}

function localPackageChecks(packageInfo, lifecycleCheck, ids) {
  const bad = badPackageInfo(packageInfo, ids.packDryRun, "pack-dry-run", "Fix package.json before package dry-run eligibility");
  const options = { requiredForLocal: true, requiredForRelease: false };
  if (bad) return [{ ...bad, required_for_release: false }];
  if (lifecycleCheck.status !== "pass") return [fail(ids.packDryRun, "pack-dry-run", "blocked lifecycle scripts make package dry-run unsafe", "Remove blocked lifecycle scripts before running pack dry-run", options)];
  if (!Array.isArray(packageInfo.pkg.files) || packageInfo.pkg.files.length === 0) return [fail(ids.packDryRun, "pack-dry-run", "package files allowlist missing", "Add package.json files allowlist before package dry-run", options)];
  return [
    pass(ids.packDryRun, "pack-dry-run", "eligible for package dry-run; local mode does not execute pack", { ...options, details: { evidence_kind: "read_only_eligibility" } }),
    skip(ids.forbiddenPath, "forbidden-package-paths", "package path scan runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.tarballPathCanon, "tarball-path-canonicalization", "tarball path canonicalization runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.packEquiv, "pack-equivalence", "dry-run/actual pack equivalence runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.tempNpmEnv, "temp-npm-env", "temporary npm environment is created in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.smokeIgnoreScripts, "smoke-ignore-scripts", "tarball smoke install runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.tarballSmoke, "tarball-smoke", "tarball smoke install runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
    skip(ids.cliSmoke, "cli-smoke", "installed CLI smoke runs in publish mode", "Run release check --publish --json", { requiredForLocal: false }),
  ];
}

function publishPackageChecks(targetRoot, packageInfo, lifecycleCheck, ids) {
  const bad = badPackageInfo(packageInfo, ids.packDryRun, "pack-dry-run", "Fix package.json before package dry-run");
  if (bad) return [{ ...bad, required_for_local: false }];
  if (lifecycleCheck.status !== "pass") {
    return [fail(ids.packDryRun, "pack-dry-run", "blocked lifecycle scripts make package dry-run unsafe", "Remove blocked lifecycle scripts before running pack dry-run", { requiredForLocal: false })];
  }

  const executionBoundaryRequired = packageInfo.pkg.name === "meta-harness";
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "meta-harness-release-pack-"));
  const packDir = path.join(tempRoot, "pack");
  const projectRoot = path.join(tempRoot, "smoke-project");
  fs.mkdirSync(packDir, { recursive: true });
  fs.mkdirSync(projectRoot, { recursive: true });
  const checks = [];
  let dry = null;
  let actual = null;
  let tarballPath = null;
  const envInfo = isolatedNpmEnv(path.join(tempRoot, "npm-env"));

  try {
    const dryRun = runNpm(["pack", "--dry-run", "--json", "--ignore-scripts"], { cwd: targetRoot, env: envInfo.env, timeout: 60_000 });
    if (dryRun.error || dryRun.status !== 0) {
      checks.push(fail(ids.packDryRun, "pack-dry-run", `npm pack --dry-run failed: ${commandSummary(dryRun)}`, "Fix package metadata and package contents before release", { requiredForLocal: false }));
      return checks;
    }
    try {
      dry = parsePackJson(dryRun.stdout);
      checks.push(pass(ids.packDryRun, "pack-dry-run", "npm pack --dry-run --json --ignore-scripts succeeded", { requiredForLocal: false, details: { file_count: dry.files.length } }));
    } catch (error) {
      checks.push(fail(ids.packDryRun, "pack-dry-run", `npm pack dry-run JSON parse failed: ${error.message}`, "Inspect npm pack dry-run output", { requiredForLocal: false }));
      return checks;
    }

    const dryCanon = canonicalizePackagePaths(dry.files);
    if (dryCanon.invalid.length > 0) {
      checks.push(fail(ids.tarballPathCanon, "tarball-path-canonicalization", `invalid package paths: ${dryCanon.invalid.map((item) => `${item.original} (${item.reason})`).join(", ")}`, "Fix package path generation before release", { requiredForLocal: false, details: { invalid: dryCanon.invalid } }));
    } else {
      checks.push(pass(ids.tarballPathCanon, "tarball-path-canonicalization", "dry-run package paths canonicalize safely", { requiredForLocal: false, details: { file_count: dryCanon.paths.length } }));
    }
    const leaks = forbiddenPackagePaths(dryCanon.paths);
    const missingExecutionPaths = executionBoundaryRequired
      ? REQUIRED_EXECUTION_PACKAGE_PATHS.filter(
        (requiredPath) => !dryCanon.paths.includes(requiredPath),
      )
      : [];
    const unexpectedExecutionPaths = executionBoundaryRequired
      ? dryCanon.paths.filter(
        (packagePath) => packagePath.startsWith("lib/execution-custody/")
          && !REQUIRED_EXECUTION_PACKAGE_PATHS.includes(packagePath),
      )
      : [];
    if (leaks.length > 0 || missingExecutionPaths.length > 0 || unexpectedExecutionPaths.length > 0) {
      checks.push(fail(
        ids.forbiddenPath,
        "forbidden-package-paths",
        [
          leaks.length > 0 ? `forbidden package paths included: ${leaks.join(", ")}` : "",
          missingExecutionPaths.length > 0
            ? `required execution runtime missing: ${missingExecutionPaths.join(", ")}`
            : "",
          unexpectedExecutionPaths.length > 0
            ? `unexpected execution runtime paths included: ${unexpectedExecutionPaths.join(", ")}`
            : "",
        ].filter(Boolean).join("; "),
        "Update package contents to include only the supported installed execution boundary",
        {
          requiredForLocal: false,
          details: { leaks, missing_execution_paths: missingExecutionPaths, unexpected_execution_paths: unexpectedExecutionPaths },
        },
      ));
    } else {
      checks.push(pass(
        ids.forbiddenPath,
        "forbidden-package-paths",
        "package includes the complete installed execution runtime and excludes local state, credentials, private operator paths, source-only roots, demos, and dependency trees",
        { requiredForLocal: false, details: { file_count: dryCanon.paths.length } },
      ));
    }

    const packed = runNpm(["pack", "--json", "--pack-destination", packDir, "--ignore-scripts"], { cwd: targetRoot, env: envInfo.env, timeout: 60_000 });
    if (packed.error || packed.status !== 0) {
      checks.push(fail(ids.packEquiv, "pack-equivalence", `npm pack actual tarball failed: ${commandSummary(packed)}`, "Fix package generation before release", { requiredForLocal: false }));
      return checks;
    }
    try {
      actual = parsePackJson(packed.stdout);
      tarballPath = path.join(packDir, actual.pack.filename);
      if (!fs.existsSync(tarballPath)) tarballPath = path.join(packDir, `${packageInfo.pkg.name.replace(/^@/, "").replace(/\//g, "-")}-${packageInfo.pkg.version}.tgz`);
    } catch (error) {
      checks.push(fail(ids.packEquiv, "pack-equivalence", `npm pack actual JSON parse failed: ${error.message}`, "Inspect npm pack output", { requiredForLocal: false }));
      return checks;
    }

    let actualFileSource = "npm-pack-json";
    let actualFiles = actual.files;
    const tarList = spawnSync("tar", ["-tzf", tarballPath], { encoding: "utf8", shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    if (tarList.status === 0 && !tarList.error) {
      actualFileSource = "tar-tzf";
      actualFiles = String(tarList.stdout || "").split(/\r?\n/).filter(Boolean);
    }
    const actualCanon = canonicalizePackagePaths(actualFiles);
    if (actualCanon.invalid.length > 0) {
      checks.push(fail(ids.tarballPathCanon, "tarball-path-canonicalization", `invalid actual tarball paths: ${actualCanon.invalid.map((item) => `${item.original} (${item.reason})`).join(", ")}`, "Fix actual package tarball path generation", { requiredForLocal: false, details: { invalid: actualCanon.invalid } }));
    }
    const missing = dryCanon.paths.filter((item) => !actualCanon.paths.includes(item));
    const added = actualCanon.paths.filter((item) => !dryCanon.paths.includes(item));
    if (missing.length > 0 || added.length > 0) {
      checks.push(fail(ids.packEquiv, "pack-equivalence", "dry-run packlist differs from actual tarball", "Investigate npm pack drift before release", { requiredForLocal: false, details: { missing, added, actual_file_source: actualFileSource } }));
      return checks;
    }
    checks.push(pass(ids.packEquiv, "pack-equivalence", "dry-run packlist matches actual tarball", { requiredForLocal: false, details: { file_count: dryCanon.paths.length, actual_file_source: actualFileSource } }));

    checks.push(pass(ids.tempNpmEnv, "temp-npm-env", "npm pack/install smoke uses isolated HOME, USERPROFILE, cache, userconfig, and auth-token-stripped environment", { requiredForLocal: false, details: { home: toSlash(envInfo.home), cache: toSlash(envInfo.cache), userconfig: toSlash(envInfo.userconfig), removed_auth_env: true } }));
    checks.push(pass(ids.smokeIgnoreScripts, "smoke-ignore-scripts", "tarball smoke install uses --ignore-scripts", { requiredForLocal: false, details: { ignore_scripts: true } }));

    const init = runNpm(["init", "-y"], { cwd: projectRoot, env: envInfo.env, timeout: 30_000 });
    if (init.error || init.status !== 0) {
      checks.push(fail(ids.tarballSmoke, "tarball-smoke", `npm init failed in smoke project: ${commandSummary(init)}`, "Fix temp npm environment setup", { requiredForLocal: false }));
      return checks;
    }
    const install = runNpm(["install", "--ignore-scripts", tarballPath], { cwd: projectRoot, env: envInfo.env, timeout: 90_000 });
    if (install.error || install.status !== 0) {
      checks.push(fail(ids.tarballSmoke, "tarball-smoke", `tarball install failed: ${commandSummary(install)}`, "Fix installability of packed tarball", { requiredForLocal: false }));
      return checks;
    }
    const installedPackageRoot = path.join(
      projectRoot,
      "node_modules",
      ...String(packageInfo.pkg.name).split("/"),
    );
    const missingInstalledPaths = executionBoundaryRequired
      ? REQUIRED_EXECUTION_PACKAGE_PATHS.filter(
        (requiredPath) => !fs.existsSync(path.join(installedPackageRoot, ...requiredPath.split("/"))),
      )
      : [];
    const forbiddenInstalledRoots = executionBoundaryRequired
      ? [".git", "internal", "scripts", ".agents"].filter(
        (name) => fs.existsSync(path.join(installedPackageRoot, name)),
      )
      : [];
    if (missingInstalledPaths.length > 0 || forbiddenInstalledRoots.length > 0) {
      checks.push(fail(
        ids.tarballSmoke,
        "tarball-smoke",
        "installed package execution boundary is incomplete or contains source-only/private roots",
        "Fix the npm package contents before release",
        {
          requiredForLocal: false,
          details: {
            missing_execution_paths: missingInstalledPaths,
            forbidden_installed_roots: forbiddenInstalledRoots,
          },
        },
      ));
      return checks;
    }
    checks.push(pass(
      ids.tarballSmoke,
      "tarball-smoke",
      executionBoundaryRequired
        ? "packed tarball installs with --ignore-scripts and contains exactly the supported execution runtime without .git, internal, scripts, or .agents"
        : "packed tarball installs into an isolated temp project with --ignore-scripts",
      { requiredForLocal: false, details: { tarball: path.basename(tarballPath) } },
    ));

    const binPath = installedPackageBinary(projectRoot, packageInfo.pkg);
    if (!binPath || !fs.existsSync(binPath)) {
      checks.push(fail(ids.cliSmoke, "cli-smoke", "installed package binary is missing", "Ensure package bin points to a published file", { requiredForLocal: false, details: { expected: binPath ? toSlash(binPath) : null } }));
      return checks;
    }
    let smoke;
    if (executionBoundaryRequired) {
      const resolutionMonitorPath = path.join(projectRoot, "resolution-monitor.cjs");
      writeText(resolutionMonitorPath, [
        '"use strict";',
        'const Module = require("node:module");',
        'const path = require("node:path");',
        'const installRoot = path.resolve(process.env.META_HARNESS_INSTALL_ROOT);',
        'const original = Module._resolveFilename;',
        'Module._resolveFilename = function(request, parent, isMain, options) {',
        '  const resolved = original.call(this, request, parent, isMain, options);',
        '  if (typeof resolved === "string" && path.isAbsolute(resolved)) {',
        '    const normalized = path.resolve(resolved);',
        '    const underInstall = normalized === installRoot || normalized.startsWith(`${installRoot}${path.sep}`);',
        '    if (!underInstall && normalized !== __filename) {',
        '      throw new Error(`installed startup resolved outside package: ${normalized}`);',
        '    }',
        '  }',
        '  return resolved;',
        '};',
        "",
      ].join("\n"));
      smoke = spawnSync(
        process.execPath,
        ["--require", resolutionMonitorPath, binPath, "--help"],
        {
          cwd: projectRoot,
          encoding: "utf8",
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
          env: { ...envInfo.env, META_HARNESS_INSTALL_ROOT: installedPackageRoot },
        },
      );
    } else {
      smoke = spawnSync(process.execPath, [binPath, "--help"], {
        cwd: projectRoot,
        encoding: "utf8",
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        env: envInfo.env,
      });
    }
    if (smoke.error || smoke.status !== 0) {
      checks.push(fail(ids.cliSmoke, "cli-smoke", `installed CLI smoke failed: ${commandSummary(smoke)}`, "Fix package bin entry, packaged runtime imports, or installed-only module resolution", { requiredForLocal: false }));
      return checks;
    }
    const expectedUsage = "meta-harness execute --request <absolute-path> [--json]";
    const usageCount = executionBoundaryRequired
      ? String(smoke.stdout || "").split(expectedUsage).length - 1
      : null;
    if (executionBoundaryRequired && usageCount !== 1) {
      checks.push(fail(
        ids.cliSmoke,
        "cli-smoke",
        `installed help must contain the execute usage exactly once; observed ${usageCount}`,
        "Register exactly one canonical execute command with no alias",
        { requiredForLocal: false, details: { execute_usage_count: usageCount } },
      ));
      return checks;
    }
    checks.push(pass(
      ids.cliSmoke,
      "cli-smoke",
      executionBoundaryRequired
        ? "installed CLI starts from packaged modules only and exposes the exact execute command once"
        : "installed CLI starts successfully from the packed tarball",
      {
        requiredForLocal: false,
        details: {
          bin: toSlash(path.relative(projectRoot, binPath)),
          ...(executionBoundaryRequired
            ? { execute_usage_count: usageCount, installed_only_resolution: true }
            : {}),
        },
      },
    ));
    return checks;
  } finally {
    const cleanupErrors = cleanupDirs([tempRoot]);
    if (cleanupErrors.length > 0) {
      checks.push(fail(ids.tempNpmEnv, "temp-npm-env", `temporary release artifacts cleanup failed: ${cleanupErrors.join("; ")}`, "Remove temp release artifacts manually", { requiredForLocal: false, details: { cleanup: "fail", errors: cleanupErrors } }));
    }
  }
}

function packageReleaseChecks(targetRoot, packageInfo, lifecycleCheck, publishMode, ids) {
  return publishMode ? publishPackageChecks(targetRoot, packageInfo, lifecycleCheck, ids) : localPackageChecks(packageInfo, lifecycleCheck, ids);
}


module.exports = {
  canonicalPackagePath,
  commandSummary,
  forbiddenPackagePaths,
  packageReleaseChecks,
  runNpm,
};

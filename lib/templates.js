"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, fileExists } = require("./paths");
const crypto = require("node:crypto");

const TEMPLATE_ROOT = path.resolve(__dirname, "..", "templates");

function templateFiles() {
  const files = [];
  for (const category of ["skills", "contracts"]) {
    const categoryDir = path.join(TEMPLATE_ROOT, category);
    if (!fileExists(categoryDir)) {
      continue;
    }
    for (const filename of fs.readdirSync(categoryDir).sort()) {
      const source = path.join(categoryDir, filename);
      if (fs.statSync(source).isFile()) {
        files.push({ category, filename, source });
      }
    }
  }
  return files;
}

function copyPackagedTemplates(destinationRoot, overwrite = true) {
  const backupRoot = destinationRoot + "_backup";
  if (fs.existsSync(backupRoot)) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }

  const backupExists = fs.existsSync(destinationRoot);
  if (backupExists) {
    fs.renameSync(destinationRoot, backupRoot);
  }

  fs.mkdirSync(destinationRoot, { recursive: true });

  const copied = [];
  const manifestTemplates = [];

  try {
    for (const template of templateFiles()) {
      const relative = path.join(template.category, template.filename).split(path.sep).join("/");
      const destination = path.join(destinationRoot, relative);

      if (backupExists && !overwrite) {
        const backupFile = path.join(backupRoot, relative);
        if (fs.existsSync(backupFile)) {
          ensureDir(path.dirname(destination));
          fs.copyFileSync(backupFile, destination);
          const content = fs.readFileSync(destination, "utf8");
          const normalized = content.replace(/\r\n/g, "\n");
          const hash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
          manifestTemplates.push({
            source_path: path.join("templates", relative).split(path.sep).join("/"),
            installed_path: path.relative(process.cwd(), destination).split(path.sep).join("/"),
            content_hash: hash
          });
          continue;
        }
      }

      ensureDir(path.dirname(destination));
      const content = fs.readFileSync(template.source, "utf8");
      const normalized = content.replace(/\r\n/g, "\n");
      fs.writeFileSync(destination, normalized, "utf8");

      const hash = crypto.createHash("sha256").update(normalized, "utf8").digest("hex");
      copied.push(relative);
      manifestTemplates.push({
        source_path: path.join("templates", relative).split(path.sep).join("/"),
        installed_path: path.relative(process.cwd(), destination).split(path.sep).join("/"),
        content_hash: hash
      });
    }

    const manifestWithoutHash = {
      schema_version: "2.0.0",
      generated_at: new Date().toISOString(),
      template_count: manifestTemplates.length,
      hash_algorithm: "sha256",
      line_ending_normalization: "LF",
      templates: manifestTemplates.sort((a, b) => a.source_path.localeCompare(b.source_path)),
    };

    const manifestHash = crypto.createHash("sha256").update(JSON.stringify(manifestWithoutHash)).digest("hex");
    const manifest = {
      ...manifestWithoutHash,
      manifest_hash: manifestHash
    };

    const manifestPath = path.join(destinationRoot, "manifest.json");
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

    if (fs.existsSync(backupRoot)) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
    }

    return copied;
  } catch (error) {
    if (fs.existsSync(destinationRoot)) {
      fs.rmSync(destinationRoot, { recursive: true, force: true });
    }
    if (backupExists && fs.existsSync(backupRoot)) {
      fs.renameSync(backupRoot, destinationRoot);
    }
    throw error;
  }
}

module.exports = { copyPackagedTemplates, templateFiles };

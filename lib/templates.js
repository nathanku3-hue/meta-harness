"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { ensureDir, fileExists } = require("./paths");

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
  const copied = [];
  for (const template of templateFiles()) {
    const relative = path.join(template.category, template.filename);
    const destination = path.join(destinationRoot, relative);
    if (fileExists(destination) && !overwrite) {
      continue;
    }
    ensureDir(path.dirname(destination));
    fs.copyFileSync(template.source, destination);
    copied.push(path.relative(destinationRoot, destination).split(path.sep).join("/"));
  }
  return copied;
}

module.exports = { copyPackagedTemplates, templateFiles };

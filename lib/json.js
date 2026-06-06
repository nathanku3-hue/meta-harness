"use strict";

const { ConfigError } = require("./errors");
const { fileExists, readText, writeText, writeJsonAtomic } = require("./paths");

function readJsonFile(targetPath, fallback) {
  if (!fileExists(targetPath)) {
    return fallback;
  }
  try {
    return JSON.parse(readText(targetPath));
  } catch (error) {
    throw new ConfigError(`invalid JSON in ${targetPath}`, { cause: error });
  }
}

function writeJsonFile(targetPath, value) {
  writeJsonAtomic(targetPath, value);
}

module.exports = { readJsonFile, writeJsonFile };

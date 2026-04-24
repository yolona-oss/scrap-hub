#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");

const target = process.argv[2];
if (!target) {
    console.error("usage: create-cmd-node <target-dir>");
    process.exit(2);
}

// Normalize + validate the target path. Refuse to scaffold into:
//   - an absolute path containing null bytes (defense-in-depth)
//   - an existing non-empty directory
// The validation is intentionally strict because create-cmd-node runs with
// the user's fs permissions and an attacker who controls the target arg
// could otherwise overwrite arbitrary files.
if (target.includes("\0")) {
    console.error("target path may not contain null bytes");
    process.exit(2);
}
const resolvedTarget = path.resolve(target);
if (fs.existsSync(resolvedTarget)) {
    const entries = fs.readdirSync(resolvedTarget);
    if (entries.length > 0) {
        console.error(`target directory is not empty: ${resolvedTarget}`);
        process.exit(2);
    }
}

const templateDir = path.resolve(__dirname, "..", "template");

function copyDir(src, dest) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const sp = path.join(src, entry.name);
        const dp = path.join(dest, entry.name);
        if (entry.isDirectory()) {
            copyDir(sp, dp);
        } else if (entry.isFile()) {
            fs.copyFileSync(sp, dp);
        }
    }
}

copyDir(templateDir, resolvedTarget);

// Substitute {{NAME}} tokens in package.json with the directory basename.
// We only rewrite package.json — every other template file references the
// name only through runtime env vars (NODE_ID etc.), not through hardcoded
// strings.
const pkgPath = path.join(resolvedTarget, "package.json");
if (fs.existsSync(pkgPath)) {
    const raw = fs.readFileSync(pkgPath, "utf8");
    const name = path.basename(resolvedTarget).replace(/[^a-zA-Z0-9_-]/g, "-");
    fs.writeFileSync(pkgPath, raw.replace(/\{\{NAME\}\}/g, name));
}

console.log(`Created cmd-node scaffold at ${resolvedTarget}`);
console.log("");
console.log("Next steps:");
console.log(`  cd ${target}`);
console.log("  npm install");
console.log("  npm run build");
console.log("");
console.log("Then provision this node with the hub operator:");
console.log("  cmd-hub node-add <name> --auto-activate");
console.log("");
console.log("Paste the returned nodeId/token into .env and run:");
console.log("  node build/src/index.js");

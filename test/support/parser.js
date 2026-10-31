import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";
import { parseCst } from "./cst.js";

const buildTimeoutMs = 60_000;
const parseTimeoutMs = 30_000;

let runner;
let runtime;
let library;

before(() => {
  runner = createTreeSitter();
  runtime = runner.directory;
  library = join(
    runtime,
    process.platform === "win32" ? "json.dll" : "json.so",
  );
  const result = runner.run(["build", "--output", library, root], {
    timeout: buildTimeoutMs,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

after(() => {
  runner?.close();
});

function trees(stdout, path) {
  const parsed = [];
  let lines = [];
  for (const line of stdout.split("\n")) {
    if (
      line.startsWith(path) &&
      /^[ \t]+Parse:[ \t]/.test(line.slice(path.length))
    ) {
      parsed.push(lines.join("\n"));
      lines = [];
    } else if (!/^[ \t]*Edit:[ \t]/.test(line)) {
      lines.push(line);
    }
  }
  return parsed;
}

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const edit of edits) {
    const { byte, deleteBytes, insert } = edit;
    const description = JSON.stringify(edit);
    assert.ok(
      Number.isSafeInteger(byte) && byte >= 0,
      `invalid byte offset: ${description}`,
    );
    assert.ok(
      Number.isSafeInteger(deleteBytes) && deleteBytes >= 0,
      `invalid deletion length: ${description}`,
    );
    assert.equal(typeof insert, "string", `invalid insertion: ${description}`);
    assert.ok(
      byte <= bytes.length && deleteBytes <= bytes.length - byte,
      `edit exceeds ${bytes.length} source bytes: ${description}`,
    );
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

function parse(source, edits = []) {
  const directory = mkdtempSync(join(runtime, "input-"));
  try {
    const path = join(directory, "input.json");
    writeFileSync(path, source);
    const args = [
      "parse",
      "--encoding",
      "utf8",
      "--cst",
      "--time",
      "--lib-path",
      library,
      "--lang-name",
      "json",
      path,
    ];
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      bytes = applyEdits(bytes, [{ byte, deleteBytes, insert }]);
      args.push("--edits", `${byte} ${deleteBytes} ${insert}`);
    }
    const repeated = edits.length === 0;
    if (repeated) args.push(path);
    const result = runner.run(args, { timeout: parseTimeoutMs });
    assert.ifError(result.error);
    assert.ok(result.status === 0 || result.status === 1, result.stderr);
    const parsed = trees(result.stdout, path);
    assert.equal(
      parsed.length,
      repeated ? 2 : 1,
      result.stdout + result.stderr,
    );
    if (repeated) {
      assert.equal(parsed[1], parsed[0], "a repeated fresh parse must match");
    }
    const cst = parsed[0];
    const tree = parseCst(cst, bytes);
    if (!tree.hasError)
      assert.equal(result.status, 0, result.stdout + result.stderr);
    return tree;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function assertIncrementalEqualsFresh(initial, edits, source) {
  try {
    assert.deepEqual(
      applyEdits(initial, edits),
      Buffer.from(source),
      "edited input differs",
    );
    const fresh = parse(source);
    const incremental = parse(initial, edits);
    if (!fresh.hasError) {
      assert.equal(incremental.hasError, false, incremental.cst);
      assert.deepEqual(incremental.nodes, fresh.nodes);
    }
    return incremental;
  } catch (error) {
    if (error instanceof Error)
      error.message += `\n${JSON.stringify({ initial, edits, source })}`;
    throw error;
  }
}

function assertEditHistory({ source, edits }) {
  for (let count = 1; count <= edits.length; count++) {
    const history = edits.slice(0, count);
    assertIncrementalEqualsFresh(source, history, applyEdits(source, history));
  }
}

export { applyEdits, assertEditHistory, assertIncrementalEqualsFresh, parse };

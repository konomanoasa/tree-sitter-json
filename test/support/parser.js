import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, grammars, root } from "../../scripts/tree-sitter.js";

let runner;
let runtime;
const libraries = new Map();

before(() => {
  runner = createTreeSitter();
  runtime = runner.directory;
  for (const { name, path } of grammars) {
    const library = join(
      runtime,
      `${name}${process.platform === "win32" ? ".dll" : ".so"}`,
    );
    const result = runner.run(
      ["build", "--output", library, join(root, path)],
      { timeout: 60000 },
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    libraries.set(name, library);
  }
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

function publicNodes(cst, bytes) {
  const starts = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === 10) starts.push(index + 1);
  }
  const nodes = [];
  const ancestors = [];
  for (const line of cst.split("\n")) {
    const position = /^([0-9]+):([0-9]+) +- +([0-9]+):([0-9]+) +/.exec(line);
    if (!position) continue;
    const body = line.slice(position[0].length);
    const match =
      /^(([a-z_0-9]+): )?•?([a-z_0-9]+|ERROR|MISSING|"([^"\\]|\\.)*")/.exec(
        body,
      );
    if (!match) continue;
    const depth = position[0].length + (body.startsWith("•") ? 1 : 0);
    while (ancestors.length && ancestors.at(-1).depth >= depth) ancestors.pop();
    const parent = ancestors.at(-1)?.index ?? null;
    if (match[3] === "ERROR" || match[3] === "MISSING") {
      ancestors.push({ depth, index: parent });
      continue;
    }
    const named = !match[3].startsWith('"');
    const start = starts[Number(position[1])] + Number(position[2]);
    const end = starts[Number(position[3])] + Number(position[4]);
    nodes.push({
      kind: named ? match[3] : JSON.parse(match[3]),
      named,
      field: match[2] ?? null,
      parent,
      start,
      end,
    });
    ancestors.push({ depth, index: nodes.length - 1 });
  }
  return nodes;
}

function issues(nodes, cst) {
  return nodes.flatMap((node, index) => {
    if (node.kind !== "syntax_issue") return [];
    const outcome = nodes[index + 1];
    const reason = nodes[index + 2];
    assert.equal(node.field, "issue", cst);
    assert.equal(outcome.parent, index);
    assert.equal(reason.parent, index + 1);
    assert.ok(["invalid_syntax", "incomplete_syntax"].includes(outcome.kind));
    assert.deepEqual(
      [outcome.start, outcome.end, reason.start, reason.end],
      [node.start, node.end, node.start, node.end],
    );
    return [
      [
        nodes[node.parent].kind,
        outcome.kind,
        reason.kind,
        node.start,
        node.end,
      ],
    ];
  });
}

function parse(source, edits = [], language = "json") {
  const library = libraries.get(language);
  assert.ok(library, `unknown grammar: ${language}`);
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
      language,
      path,
    ];
    let bytes = Buffer.from(source);
    for (const { byte, deleteBytes, insert } of edits) {
      bytes = applyEdits(bytes, [{ byte, deleteBytes, insert }]);
      args.push("--edits", `${byte} ${deleteBytes} ${insert}`);
    }
    const repeated = edits.length === 0;
    if (repeated) args.push(path);
    const result = runner.run(args, { timeout: 30000 });
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
    const root =
      /^[0-9]+:[0-9]+ +- +([0-9]+):([0-9]+) +•?(json_text|ERROR)( |\n|$)/.exec(
        cst,
      );
    assert.ok(root, cst);
    let row = 0;
    for (const byte of bytes) if (byte === 10) row += 1;
    assert.deepEqual(
      root.slice(1, 3).map(Number),
      [row, bytes.length - bytes.lastIndexOf(10) - 1],
      "root must reach the edited source end",
    );
    const nodes = publicNodes(cst, bytes);
    return {
      cst,
      nodes,
      issues: issues(nodes, cst),
      // CLI status misses hidden missing tokens.
      hasError: /^[^ \t\r\n]+[ \t]+-[ \t]+[^ \t\r\n]+[ \t]+•/.test(cst),
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

export { applyEdits, parse };

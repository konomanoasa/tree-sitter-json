import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import { parseCst } from "./support/cst.js";
import { parse } from "./support/parser.js";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    assert.ok(
      attributes.every((attribute) => [":cst", ":error"].includes(attribute)),
      name,
    );
    assert.ok(attributes.length <= 1, name);
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const hasError = attributes.includes(":error");
    if (hasError)
      assert.equal(
        parts[1].trim(),
        "",
        `${name}: error cases have no expected tree`,
      );
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source, hasError });
  }
  return cases;
}

for (const file of readdirSync(join(root, "test/corpus")).sort()) {
  const cases = parseCorpus(
    readFileSync(join(root, "test/corpus", file), "utf8"),
  );
  for (const { name, source, hasError } of cases) {
    test(`fresh artifact determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(tree.hasError, hasError, tree.cst);
    });
  }
}

test("corpus reader preserves BOM, NUL, whitespace and input line endings", () => {
  const text = [
    "==================\nEmpty\n:error\n==================\n\n---\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\r\n1\n\n\n---\nexpected\n\n",
    "==================\nNUL\n:error\n==================\n\0=\0\n---\n\n",
    "==================\nFinal CR\n==================\n1\r\r\n---\nexpected\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "", hasError: true },
    { name: "Layout", source: "\uFEFF \t\r\n1\n\n", hasError: false },
    { name: "NUL", source: "\0=\0", hasError: true },
    { name: "Final CR", source: "1\r", hasError: false },
  ]);
});

test("CST readers identify native recovery and keep its complete trace", () => {
  const tree = parseCst(
    '0:0 - 0:1   •json_text\n0:0 - 0:1     •ERROR\n0:0 - 0:1       "["\n0:1 - 0:1       MISSING: "]"',
    "[",
  );
  assert.equal(tree.hasError, true);
  assert.match(tree.cst, /MISSING: "]"/);
  assert.deepEqual(tree.nodes, []);
  assert.throws(() => parseCst("0:0 - 0:1   json_text", "[]"), /source end/);
});

test("normal leaves cover each non-layout source byte once with fields and UTF-8 ranges", () => {
  const source = Buffer.from('{"é":\r\n"😀\\n","é":-12.3E+4}');
  const tree = parse(source);
  assert.equal(tree.hasError, false);
  const coverage = new Uint8Array(source.length);
  const parents = new Set(tree.nodes.map(({ parent }) => parent));
  for (const [index, node] of tree.nodes.entries()) {
    if (!parents.has(index)) {
      for (let byte = node.start; byte < node.end; byte++) coverage[byte] += 1;
    }
  }
  for (const [byte, count] of coverage.entries()) {
    assert.equal(
      count,
      source[byte] === 0x0d || source[byte] === 0x0a ? 0 : 1,
      `byte ${byte}`,
    );
  }
  assert.deepEqual(
    tree.nodes
      .filter(({ field }) => field === "name")
      .map(({ start, end }) => source.subarray(start, end).toString()),
    ['"é"', '"é"'],
  );
  assert.deepEqual(
    tree.nodes
      .filter(({ kind }) => kind === "unescaped")
      .map(({ start, end }) => source.subarray(start, end).toString()),
    ["é", "😀", "é"],
  );
});

test("public metadata contains only the JSON nodes and required member fields", () => {
  const types = JSON.parse(
    readFileSync(join(root, "src/node-types.json"), "utf8"),
  );
  assert.deepEqual(
    types
      .filter(({ named }) => named)
      .map(({ type }) => type)
      .sort(),
    [
      "array",
      "char",
      "digit",
      "digit1_9",
      "e",
      "exp",
      "frac",
      "hexdig",
      "int",
      "json_text",
      "member",
      "number",
      "object",
      "string",
      "unescaped",
      "value",
    ],
  );
  const member = types.find(({ type }) => type === "member");
  assert.deepEqual(member.fields, {
    name: {
      multiple: false,
      required: true,
      types: [{ type: "string", named: true }],
    },
    value: {
      multiple: false,
      required: true,
      types: [{ type: "value", named: true }],
    },
  });
  assert.deepEqual(types.find(({ type }) => type === "json_text").children, {
    multiple: false,
    required: true,
    types: [{ type: "value", named: true }],
  });
});

test("decoding failures at every syntax boundary remain errors instead of U+FFFD", () => {
  const source = Buffer.from('{"a":[true,false,null,12.3e+4,"\\u1234"]}');
  for (let byte = 0; byte <= source.length; byte++) {
    const input = Buffer.concat([
      source.subarray(0, byte),
      Buffer.from([0xff, 0x80]),
      source.subarray(byte),
    ]);
    assert.equal(parse(input).hasError, true, `byte ${byte}`);
  }
  const tree = parse('"�"');
  assert.equal(tree.hasError, false);
  assert.deepEqual(
    tree.nodes
      .filter(({ kind }) => kind === "unescaped")
      .map(({ start, end }) => [start, end]),
    [[1, 4]],
  );
});

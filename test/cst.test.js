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
    for (const attribute of attributes) {
      assert.equal(
        attribute,
        ":cst",
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source });
  }
  return cases;
}

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source } of entries) {
    test(`corpus source coverage, issue ownership and fresh determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(tree.hasError, false, tree.cst);
    });
  }
}

test("corpus inputs retain BOM, NUL, whitespace and line endings", () => {
  const text = [
    "==================\nEmpty\n==================\n\n---\n(json_text)\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\v\f\r\n1\n\n\n---\nignored output\n\n",
    "==================\nNUL\n:cst\n==================\n",
    "\0=\0\n---\nignored output\n\n",
    "==================\nFinal CR\n:cst\n==================\n",
    "1\r\r\n---\nignored output\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "" },
    { name: "Layout", source: "\uFEFF \t\v\f\r\n1\n\n" },
    { name: "NUL", source: "\0=\0" },
    { name: "Final CR", source: "1\r" },
  ]);
});

test("corpus input reader rejects unsupported conditions and framing", () => {
  for (const text of [
    "not a corpus file",
    "==================\nUnclosed header\n",
    "==================\nSkipped\n:skip\n==================\n1\n---\n",
    "==================\nNo separator\n==================\n1\n",
  ]) {
    assert.throws(() => parseCorpus(text), { code: "ERR_ASSERTION" }, text);
  }
});

for (const [name, prefix, suffix, owner] of [
  ["string content", '"a', 'b"', "string"],
  ["member name", '{"a', 'b":1}', "string"],
  ["escaped character", '"a\\', 'b"', "char"],
  ["Unicode escape prefix", '"a\\u12', 'b"', "char"],
  ["integer", "12", "3", "int"],
  ["fraction", "1.", "2", "frac"],
  ["exponent", "1e+", "2", "exp"],
  ["number prefix", "-", "2", "number"],
  ["array layout", "[ ", "1]", "array"],
  ["object layout", "{ ", '"a":1}', "object"],
  ["member separator", '{"a" ', ":1}", "member"],
  ["member value", '{"a": ', "1}", "member"],
  ["root layout", " ", "null", "json_text"],
]) {
  test(`a decoding failure run in ${name} retains its owner and minimal range`, () => {
    const invalidBytes = Buffer.from([255, 254, 128]);
    const start = Buffer.byteLength(prefix);
    const source = Buffer.concat([
      Buffer.from(prefix),
      invalidBytes,
      Buffer.from(suffix),
    ]);
    const result = parse(source);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(
      result.issues,
      [
        [
          owner,
          "invalid_syntax",
          "invalid_encoding",
          start,
          start + invalidBytes.length,
        ],
      ],
      result.cst,
    );
  });
}

test("decoding failures stay isolated across JSON syntax boundaries", () => {
  const invalidBytes = Buffer.from([255, 254, 128]);
  for (const source of [
    '{"a":[true,false,null,12.3e+4]}',
    String.raw`"x\u1234y"`,
    "[01,1.a2,tru]",
    ' {"a":1} ',
  ]) {
    const bytes = Buffer.from(source);
    for (let byte = 0; byte <= bytes.length; byte++) {
      const input = Buffer.concat([
        bytes.subarray(0, byte),
        invalidBytes,
        bytes.subarray(byte),
      ]);
      const result = parse(input);
      assert.deepEqual(
        result.issues
          .filter(([, , reason]) => reason === "invalid_encoding")
          .map(([, , , start, end]) => [start, end]),
        [[byte, byte + invalidBytes.length]],
        `${JSON.stringify({ source, byte })}\n${result.cst}`,
      );
    }
  }
});

test("CST helpers preserve fields, anonymous leaves and UTF-8 ranges across CRLF", () => {
  const source = '{"é":\r\n"\\n"}';
  const text = String.raw`0:0 - 1:5   json_text
0:0 - 1:5     value
0:0 - 1:5       object
0:0 - 0:1         "{"
0:1 - 1:4         member
0:1 - 0:5           name: string
0:1 - 0:2             "\""
0:2 - 0:4             char
0:2 - 0:4               unescaped
0:4 - 0:5             "\""
0:5 - 0:6           ":"
1:0 - 1:4           value: value
1:0 - 1:4             string
1:0 - 1:1               "\""
1:1 - 1:3               char
1:1 - 1:2                 "\\"
1:2 - 1:3                 "n"
1:3 - 1:4               "\""
1:4 - 1:5         "}"`;
  const tree = parseCst(text, source);
  assert.equal(tree.hasError, false);
  assert.deepEqual(tree.issues, []);
  assert.deepEqual(tree.nodes, [
    {
      kind: "json_text",
      named: true,
      field: null,
      parent: null,
      start: 0,
      end: 13,
    },
    { kind: "value", named: true, field: null, parent: 0, start: 0, end: 13 },
    { kind: "object", named: true, field: null, parent: 1, start: 0, end: 13 },
    { kind: "{", named: false, field: null, parent: 2, start: 0, end: 1 },
    { kind: "member", named: true, field: null, parent: 2, start: 1, end: 12 },
    { kind: "string", named: true, field: "name", parent: 4, start: 1, end: 5 },
    { kind: '"', named: false, field: null, parent: 5, start: 1, end: 2 },
    { kind: "char", named: true, field: null, parent: 5, start: 2, end: 4 },
    {
      kind: "unescaped",
      named: true,
      field: null,
      parent: 7,
      start: 2,
      end: 4,
    },
    { kind: '"', named: false, field: null, parent: 5, start: 4, end: 5 },
    { kind: ":", named: false, field: null, parent: 4, start: 5, end: 6 },
    {
      kind: "value",
      named: true,
      field: "value",
      parent: 4,
      start: 8,
      end: 12,
    },
    { kind: "string", named: true, field: null, parent: 11, start: 8, end: 12 },
    { kind: '"', named: false, field: null, parent: 12, start: 8, end: 9 },
    { kind: "char", named: true, field: null, parent: 12, start: 9, end: 11 },
    { kind: "\\", named: false, field: null, parent: 14, start: 9, end: 10 },
    { kind: "n", named: false, field: null, parent: 14, start: 10, end: 11 },
    { kind: '"', named: false, field: null, parent: 12, start: 11, end: 12 },
    { kind: "}", named: false, field: null, parent: 2, start: 12, end: 13 },
  ]);
});

test("CST helpers report native recovery flags and reject truncated roots", () => {
  for (const [marker, expected] of [
    ["", false],
    ["•", true],
  ]) {
    const tree = parseCst(`0:0 - 0:0   ${marker}json_text`, "");
    assert.equal(tree.hasError, expected);
  }
  assert.throws(() => parseCst("0:0 - 0:1   json_text", "é"));
});

test(`every ASCII character keeps issues owned in each lexical context`, () => {
  const contexts = [
    ["", ""],
    ["[", "]"],
    ['{"a":', "}"],
    ['"', '"'],
  ];
  const asciiMax = 0x7f;
  for (let character = 0; character <= asciiMax; character++) {
    for (const [prefix, suffix] of contexts) {
      const source = `${prefix}${String.fromCharCode(character)}${suffix}`;
      const tree = parse(source);
      assert.equal(
        tree.hasError,
        false,
        `${JSON.stringify(source)}\n${tree.cst}`,
      );
    }
  }
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

test("a truncated UTF-8 sequence stays invalid at EOF independently of the missing quote", () => {
  const result = parse(Buffer.from([34, 97, 195]));
  assert.deepEqual(result.issues, [
    ["string", "invalid_syntax", "invalid_encoding", 2, 3],
    ["string", "incomplete_syntax", "missing_string_close", 3, 3],
  ]);
});

for (const { name, source, expected } of [
  {
    name: "invalid integer text survives a decoding failure and later digits",
    source: Buffer.from([45, 120, 255, 49]),
    expected: [
      ["number", "invalid_syntax", "invalid_number", 1, 2],
      ["number", "invalid_syntax", "invalid_encoding", 2, 3],
    ],
  },
  {
    name: "invalid integer text survives a decoding failure at EOF",
    source: Buffer.from([45, 120, 255]),
    expected: [
      ["number", "invalid_syntax", "invalid_number", 1, 2],
      ["number", "invalid_syntax", "invalid_encoding", 2, 3],
    ],
  },
  {
    name: "a decoding failure in the integer position is not also missing digits",
    source: Buffer.from([45, 255]),
    expected: [["number", "invalid_syntax", "invalid_encoding", 1, 2]],
  },
  {
    name: "a decoding failure in the integer position keeps the following fraction",
    source: Buffer.from([43, 255, 46, 53]),
    expected: [
      ["number", "invalid_syntax", "invalid_number", 0, 1],
      ["number", "invalid_syntax", "invalid_encoding", 1, 2],
    ],
  },
  {
    name: "ancestor array closing after an object comma and a decoding failure",
    source: Buffer.from([91, 123, 34, 97, 34, 58, 49, 44, 255, 93]),
    expected: [
      ["object", "invalid_syntax", "unexpected_separator", 7, 8],
      ["object", "invalid_syntax", "invalid_encoding", 8, 9],
      ["object", "invalid_syntax", "missing_object_close", 9, 9],
    ],
  },
]) {
  test(name, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, expected, tree.cst);
  });
}

for (const { name: language } of grammars) {
  for (const { source, expected } of [
    {
      source: Buffer.from('{"a":x\xff:1}', "latin1"),
      expected: [
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
        ["member", "invalid_syntax", "invalid_member_name", 5, 7],
        ["invalid_member_name", "invalid_syntax", "invalid_encoding", 6, 7],
      ],
    },
    {
      source: Buffer.from('{"a":"b"\xff:1}', "latin1"),
      expected: [
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
        ["member", "invalid_syntax", "invalid_encoding", 8, 9],
      ],
    },
  ]) {
    test(`${language}: member lookahead preserves decoding issues: ${source.toString("hex")}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
    });
  }
}

for (const { name: language } of grammars) {
  for (const { source, nameRange, encoding } of [
    { source: "{x\xff:1}", nameRange: [1, 3], encoding: [[2, 3]] },
    { source: "{tru\xff:1}", nameRange: [1, 5], encoding: [[4, 5]] },
    { source: "{true\xff:1}", nameRange: [1, 6], encoding: [[5, 6]] },
    { source: "{tr\xffue:1}", nameRange: [1, 6], encoding: [[3, 4]] },
    { source: "{truex\xff:1}", nameRange: [1, 7], encoding: [[6, 7]] },
    { source: "{/x\xff:1}", nameRange: [1, 4], encoding: [[3, 4]] },
    { source: "{x\xff\xfey:1}", nameRange: [1, 5], encoding: [[2, 4]] },
    {
      source: "{x\xffy\xfez:1}",
      nameRange: [1, 6],
      encoding: [
        [2, 3],
        [4, 5],
      ],
    },
    { source: "[{x\xff:1}]", nameRange: [2, 4], encoding: [[3, 4]] },
    { source: "{x\xff \n:1}", nameRange: [1, 3], encoding: [[2, 3]] },
  ]) {
    test(`${language}: undecodable member name has no value issues: ${JSON.stringify(source)}`, () => {
      const result = parse(Buffer.from(source, "latin1"), [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        ["member", "invalid_syntax", "invalid_member_name", ...nameRange],
        ...encoding.map(([start, end]) => [
          "invalid_member_name",
          "invalid_syntax",
          "invalid_encoding",
          start,
          end,
        ]),
      ]);
      const reason = result.nodes.findIndex(
        ({ kind }) => kind === "invalid_member_name",
      );
      assert.deepEqual(
        result.nodes
          .filter(({ parent }) => parent === reason)
          .map(({ kind }) => kind),
        encoding.map(() => "syntax_issue"),
      );
      const member = result.nodes.findIndex(({ kind }) => kind === "member");
      const value = result.nodes.find(
        ({ parent, field }) => parent === member && field === "value",
      );
      assert.ok(value);
      assert.equal(source.slice(value.start, value.end), "1");
    });
  }
  if (language !== "json") {
    test(`${language}: a comment after an undecodable member name belongs to the member`, () => {
      const result = parse(
        Buffer.from("{x\xff/*gap*/:1}", "latin1"),
        [],
        language,
      );
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        ["member", "invalid_syntax", "invalid_member_name", 1, 3],
        ["invalid_member_name", "invalid_syntax", "invalid_encoding", 2, 3],
      ]);
      const comment = result.nodes.find(
        ({ kind }) => kind === "multi_line_comment",
      );
      assert.ok(comment);
      assert.equal(result.nodes[comment.parent].kind, "member");
    });
  }
  for (const { prefix, suffix, invalidPrefix } of [
    { prefix: "tr", suffix: "ue", invalidPrefix: false },
    { prefix: "true", suffix: "", invalidPrefix: false },
    { prefix: "fal", suffix: "se", invalidPrefix: false },
    { prefix: "nul", suffix: "l", invalidPrefix: false },
    { prefix: "tr/", suffix: "ue", invalidPrefix: true },
    { prefix: "tr", suffix: "/ue", invalidPrefix: false },
    { prefix: "x", suffix: "", invalidPrefix: true },
    { prefix: "truex", suffix: "", invalidPrefix: true },
    { prefix: "falx", suffix: "se", invalidPrefix: true },
    { prefix: "/x", suffix: "true", invalidPrefix: true },
  ]) {
    test(`${language}: undecodable word stays one value: ${prefix} + invalid bytes + ${suffix}`, () => {
      const invalidBytes = Buffer.from([255, 254]);
      const start = Buffer.byteLength(`[${prefix}`);
      const source = Buffer.concat([
        Buffer.from(`[${prefix}`),
        invalidBytes,
        Buffer.from(`${suffix}]`),
      ]);
      const result = parse(source, [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        ...(invalidPrefix
          ? [["value", "invalid_syntax", "invalid_value", 1, start]]
          : []),
        [
          "value",
          "invalid_syntax",
          "invalid_encoding",
          start,
          start + invalidBytes.length,
        ],
      ]);
      assert.deepEqual(
        result.nodes
          .filter(({ kind }) => kind === "value")
          .map(({ start, end }) => [start, end]),
        [
          [0, source.length],
          [1, source.length - 1],
        ],
      );
      assert.equal(
        result.nodes.some(({ kind }) =>
          ["true", "false", "null"].includes(kind),
        ),
        false,
      );
    });
  }
  test(`${language}: separate decoding runs stay inside the same word`, () => {
    const result = parse(
      Buffer.from([91, 116, 255, 114, 117, 254, 101, 93]),
      [],
      language,
    );
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, [
      ["value", "invalid_syntax", "invalid_encoding", 2, 3],
      ["value", "invalid_syntax", "invalid_encoding", 5, 6],
    ]);
  });
}

for (const { name: language } of grammars) {
  for (const { name, source, expected, members } of [
    {
      name: "controls and decoding failures precede a missing colon",
      source: Buffer.from([123, 34, 97, 34, 1, 255, 32, 49, 125]),
      expected: [
        ["member", "invalid_syntax", "invalid_character", 4, 5],
        ["member", "invalid_syntax", "invalid_encoding", 5, 6],
        ["member", "invalid_syntax", "missing_name_separator", 7, 7],
      ],
      members: [[1, 8]],
    },
    {
      name: "controls and decoding failures precede missing syntax at EOF",
      source: Buffer.from([123, 34, 97, 34, 1, 255, 32]),
      expected: [
        ["member", "invalid_syntax", "invalid_character", 4, 5],
        ["member", "invalid_syntax", "invalid_encoding", 5, 6],
        ["member", "incomplete_syntax", "missing_name_separator", 7, 7],
        ["member", "incomplete_syntax", "missing_value", 7, 7],
        ["object", "incomplete_syntax", "missing_object_close", 7, 7],
      ],
      members: [[1, 7]],
    },
  ]) {
    test(`${language}: ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
      assert.deepEqual(
        tree.nodes
          .filter(({ kind }) => kind === "member")
          .map(({ start, end }) => [start, end]),
        members,
      );
    });
  }
}

for (const { name: language } of grammars) {
  test(`${language}: decoding failure stays inside a literal at EOF and in a member`, () => {
    for (const [prefix, suffix] of [
      ["true", ""],
      ['{"a":tr', "ue}"],
      ["[tr", "ue,0]"],
    ]) {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from([255]),
        Buffer.from(suffix),
      ]);
      const result = parse(source, [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        [
          "value",
          "invalid_syntax",
          "invalid_encoding",
          prefix.length,
          prefix.length + 1,
        ],
      ]);
    }
  });
}

for (const { name: language } of grammars) {
  for (const { source, byte, split, extra } of [
    { source: '{"a":"b"1}', byte: 8, split: 5, extra: [] },
    {
      source: '{"a":1 2}',
      byte: 6,
      split: 5,
      extra: [["member", "invalid_syntax", "invalid_member_name", 5, 6]],
    },
    { source: '[{"a":"b"1}]', byte: 9, split: 6, extra: [] },
  ]) {
    test(`${language}: adding and removing a colon reassigns the member value as a name: ${source}`, () => {
      const edits = [{ byte, deleteBytes: 0, insert: ":" }];
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          edits,
          applyEdits(source, edits),
          language,
        ).issues,
        [
          ["member", "invalid_syntax", "missing_value", split, split],
          ["object", "invalid_syntax", "missing_value_separator", split, split],
          ...extra,
        ],
      );
      edits.push({ byte, deleteBytes: 1, insert: "" });
      assertIncrementalEqualsFresh(source, edits, source, language);
    });
  }

  test(`${language}: normal digits split and rejoin an invalid numeric run`, () => {
    const source = "1__2";
    const edits = [{ byte: 2, deleteBytes: 0, insert: "3" }];
    const split = assertIncrementalEqualsFresh(
      source,
      edits,
      "1_3_2",
      language,
    );
    assert.deepEqual(split.issues, [
      ["int", "invalid_syntax", "invalid_number", 1, 2],
      ["int", "invalid_syntax", "invalid_number", 3, 4],
    ]);
    edits.push({ byte: 2, deleteBytes: 1, insert: "" });
    const joined = assertIncrementalEqualsFresh(
      source,
      edits,
      source,
      language,
    );
    assert.deepEqual(joined.issues, [
      ["int", "invalid_syntax", "invalid_number", 1, 3],
    ]);
  });

  for (const [prefix, suffix] of [
    ["tr", "ue"],
    ["true", ""],
  ]) {
    test(`${language}: invalid literal prefixes appear and disappear before a decoding failure: ${prefix}`, () => {
      const source = Buffer.concat([
        Buffer.from(`[${prefix}`),
        Buffer.from([255]),
        Buffer.from(`${suffix}]`),
      ]);
      const byte = prefix.length + 1;
      const edits = [{ byte, deleteBytes: 0, insert: "x" }];
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          edits,
          applyEdits(source, edits),
          language,
        ).issues,
        [
          ["value", "invalid_syntax", "invalid_value", 1, byte + 1],
          ["value", "invalid_syntax", "invalid_encoding", byte + 1, byte + 2],
        ],
      );
      edits.push({ byte, deleteBytes: 1, insert: "" });
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          edits,
          applyEdits(source, edits),
          language,
        ).issues,
        [["value", "invalid_syntax", "invalid_encoding", byte, byte + 1]],
      );
    });
  }

  test(`${language}: adding and removing a colon reclassifies an undecodable name and value`, () => {
    const source = Buffer.from("{x\xff:1}", "latin1");
    const edits = [{ byte: 3, deleteBytes: 1, insert: "" }];
    assert.deepEqual(
      assertIncrementalEqualsFresh(
        source,
        edits,
        applyEdits(source, edits),
        language,
      ).issues,
      [
        ["object", "invalid_syntax", "unexpected_value", 1, 4],
        ["value", "invalid_syntax", "invalid_value", 1, 2],
        ["value", "invalid_syntax", "invalid_encoding", 2, 3],
      ],
    );
    edits.push({ byte: 3, deleteBytes: 0, insert: ":" });
    assert.deepEqual(
      assertIncrementalEqualsFresh(
        source,
        edits,
        applyEdits(source, edits),
        language,
      ).issues,
      [
        ["member", "invalid_syntax", "invalid_member_name", 1, 3],
        ["invalid_member_name", "invalid_syntax", "invalid_encoding", 2, 3],
      ],
    );
  });

  test(`${language}: literal spelling does not add value issues inside an undecodable name`, () => {
    const source = Buffer.from("{tru\xff:1}", "latin1");
    const edits = [{ byte: 4, deleteBytes: 0, insert: "x" }];
    assert.deepEqual(
      assertIncrementalEqualsFresh(
        source,
        edits,
        applyEdits(source, edits),
        language,
      ).issues,
      [
        ["member", "invalid_syntax", "invalid_member_name", 1, 6],
        ["invalid_member_name", "invalid_syntax", "invalid_encoding", 5, 6],
      ],
    );
    edits.push({ byte: 4, deleteBytes: 1, insert: "" });
    assert.deepEqual(
      assertIncrementalEqualsFresh(
        source,
        edits,
        applyEdits(source, edits),
        language,
      ).issues,
      [
        ["member", "invalid_syntax", "invalid_member_name", 1, 5],
        ["invalid_member_name", "invalid_syntax", "invalid_encoding", 4, 5],
      ],
    );
  });

  test(`${language}: repairing an undecodable name restores a confirmed literal value`, () => {
    const source = Buffer.from("{tr\xffue:1}", "latin1");
    const edits = [{ byte: 3, deleteBytes: 1, insert: "" }];
    const result = assertIncrementalEqualsFresh(
      source,
      edits,
      applyEdits(source, edits),
      language,
    );
    assert.deepEqual(result.issues, [
      ["member", "invalid_syntax", "invalid_member_name", 1, 5],
    ]);
    const reason = result.nodes.findIndex(
      ({ kind }) => kind === "invalid_member_name",
    );
    const literal = result.nodes.find(({ kind }) => kind === "true");
    assert.ok(literal);
    const value = result.nodes[literal.parent];
    assert.equal(value.kind, "value");
    assert.equal(value.parent, reason);
  });

  if (language !== "json") {
    for (const source of ["1/", "true/", "[1 /", '{"a"/', "/"]) {
      test(`${language}: a comment opener completes and becomes incomplete again: ${source}`, () => {
        for (const insert of ["/ tail", "* tail */", " ", "x"]) {
          assertEditHistory(
            {
              source,
              edits: [
                { byte: source.length, deleteBytes: 0, insert },
                { byte: source.length, deleteBytes: insert.length, insert: "" },
              ],
            },
            language,
          );
        }
      });
    }
  }

  test(`${language}: repairing a decoding failure restores the escaped character`, () => {
    const source = Buffer.from([34, 92, 255, 254, 128, 34]);
    const edits = [{ byte: 2, deleteBytes: 3, insert: "n" }];
    const result = assertIncrementalEqualsFresh(
      source,
      edits,
      applyEdits(source, edits),
      language,
    );
    assert.deepEqual(result.issues, []);
  });

  if (language !== "json") {
    test(`${language}: completing, breaking and restoring a block comment preserves comma classification`, () => {
      const source = "[1,/*é😀";
      const end = Buffer.byteLength(source);
      const history = [{ byte: end, deleteBytes: 0, insert: "*/]" }];
      const complete =
        language === "jsonc"
          ? [["array", "invalid_syntax", "unexpected_separator", 2, 3]]
          : [];
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          history,
          applyEdits(source, history),
          language,
        ).issues,
        complete,
      );
      history.push({ byte: end, deleteBytes: 1, insert: "" });
      const incomplete = end + 2;
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          history,
          applyEdits(source, history),
          language,
        ).issues,
        [
          [
            "multi_line_comment",
            "incomplete_syntax",
            "missing_comment_close",
            incomplete,
            incomplete,
          ],
          ...(language === "jsonc"
            ? [
                [
                  "array",
                  "incomplete_syntax",
                  "missing_value",
                  incomplete,
                  incomplete,
                ],
              ]
            : []),
          [
            "array",
            "incomplete_syntax",
            "missing_array_close",
            incomplete,
            incomplete,
          ],
        ],
      );
      history.push({ byte: end, deleteBytes: 0, insert: "*" });
      assert.deepEqual(
        assertIncrementalEqualsFresh(
          source,
          history,
          applyEdits(source, history),
          language,
        ).issues,
        complete,
      );
    });
  }
}

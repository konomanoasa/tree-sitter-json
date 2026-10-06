import assert from "node:assert/strict";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { parse } from "./support/parser.js";

test("empty array has no syntax issues", () => {
  const tree = parse("[]");
  assert.deepEqual(tree.issues, []);
  assert.deepEqual(
    tree.nodes.map(({ kind }) => kind),
    ["json_text", "value", "array", "[", "]"],
  );
});

test("empty document retains a zero-width missing value", () => {
  assert.deepEqual(parse("").issues, [
    ["json_text", "incomplete_syntax", "missing_value", 0, 0],
  ]);
});

test("unfinished array retains its opening and missing closing position", () => {
  assert.deepEqual(parse("[").issues, [
    ["array", "incomplete_syntax", "missing_array_close", 1, 1],
  ]);
});

const valid = [
  ["all six value categories", '[{},[],"x",123,true,false,null]'],
  ["named members and nesting", '{"a":[1,{"b":false}],"c":null}'],
  ["empty strings and duplicate names", '{"":0,"a":1,"a":2}'],
  [
    "decimal forms and large exponents",
    "[-0,12,-12,1.25,0.001,1e9,1E+400,-1.5e-12]",
  ],
  ["all escapes", '"\\"\\\\\\/\\b\\f\\n\\r\\t\\u0041\\uabcd"'],
  ["surrogate escapes", '"\\uD800\\uDC00\\uDEAD"'],
  [
    "Unicode and non-control characters",
    '"あ😀\u007f\u0085\u2028\u2029\ufeff"',
  ],
  ["four layout characters", ' \t\r\n { \r "a"\t:\n[ 1,\t2\r] }\n'],
  ["top-level string", '"x"'],
  ["top-level number", "42"],
  ["top-level true", "true"],
  ["top-level false", "false"],
  ["top-level null", "null"],
];
for (const [name, source] of valid) {
  test(name, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, [], tree.cst);
    assert.equal(tree.nodes[0].kind, "json_text");
  });
}

const issues = [
  {
    name: "whitespace-only document",
    source: " \n",
    expected: [["json_text", "incomplete_syntax", "missing_value", 2, 2]],
  },
  {
    name: "member value before closing",
    source: '{"a":}',
    expected: [["member", "invalid_syntax", "missing_value", 5, 5]],
  },
  {
    name: "member value at EOF",
    source: '{"a":',
    expected: [
      ["member", "incomplete_syntax", "missing_value", 5, 5],
      ["object", "incomplete_syntax", "missing_object_close", 5, 5],
    ],
  },
  {
    name: "missing colon",
    source: '{"a" 1}',
    expected: [["member", "invalid_syntax", "missing_name_separator", 5, 5]],
  },
  {
    name: "missing name",
    source: "{:1}",
    expected: [["member", "invalid_syntax", "missing_member_name", 1, 1]],
  },
  {
    name: "missing array comma",
    source: "[1 2]",
    expected: [["array", "invalid_syntax", "missing_value_separator", 3, 3]],
  },
  {
    name: "missing object comma",
    source: '{"a":1 "b":2}',
    expected: [["object", "invalid_syntax", "missing_value_separator", 7, 7]],
  },
  {
    name: "ancestor object closing",
    source: '{"a":[1}',
    expected: [["array", "invalid_syntax", "missing_array_close", 7, 7]],
  },
  {
    name: "ancestor array closing",
    source: '[{"a":1]',
    expected: [["object", "invalid_syntax", "missing_object_close", 7, 7]],
  },
  {
    name: "stray object closing inside array",
    source: "[1}]",
    expected: [["array", "invalid_syntax", "invalid_character", 2, 3]],
  },
  {
    name: "stray array closing inside object",
    source: '{"a":1]}',
    expected: [["object", "invalid_syntax", "invalid_character", 6, 7]],
  },
  {
    name: "extra root value",
    source: "1 true",
    expected: [["json_text", "invalid_syntax", "unexpected_value", 2, 6]],
  },
  {
    name: "unknown escape",
    source: '"x\\qy"',
    expected: [["char", "invalid_syntax", "invalid_escape", 2, 4]],
  },
  {
    name: "Unicode escape ended by closing quote",
    source: '"\\u12"',
    expected: [["char", "invalid_syntax", "invalid_escape", 1, 5]],
  },
  {
    name: "Unicode escape at EOF",
    source: '"\\u12',
    expected: [
      ["char", "incomplete_syntax", "invalid_escape", 1, 5],
      ["string", "incomplete_syntax", "missing_string_close", 5, 5],
    ],
  },
  {
    name: "raw control character",
    source: '"a\u0000b"',
    expected: [["string", "invalid_syntax", "invalid_character", 2, 3]],
  },
  {
    name: "leading zero",
    source: "01",
    expected: [["int", "invalid_syntax", "invalid_number", 1, 2]],
  },
  {
    name: "exponent at EOF",
    source: "1e+",
    expected: [["exp", "incomplete_syntax", "missing_digits", 3, 3]],
  },
  {
    name: "exponent ended by layout",
    source: "1e ",
    expected: [["exp", "invalid_syntax", "missing_digits", 2, 2]],
  },
  {
    name: "literal at EOF",
    source: "tru",
    expected: [["value", "incomplete_syntax", "invalid_value", 0, 3]],
  },
  {
    name: "literal ended by layout",
    source: "tru ",
    expected: [["value", "invalid_syntax", "invalid_value", 0, 3]],
  },
  {
    name: "joined literals",
    source: "truefalse",
    expected: [["value", "invalid_syntax", "invalid_value", 0, 9]],
  },
  {
    name: "NUL does not separate joined literals",
    source: "true\u0000false",
    expected: [["value", "invalid_syntax", "invalid_value", 0, 10]],
  },
  {
    name: "vertical tab does not split a literal prefix",
    source: "tru\u000be",
    expected: [["value", "invalid_syntax", "invalid_value", 0, 5]],
  },
  {
    name: "unquoted member name",
    source: "{foo:1}",
    expected: [["member", "invalid_syntax", "invalid_member_name", 1, 4]],
  },
  {
    name: "NUL stays inside an unquoted member name",
    source: "{foo\u0000:1}",
    expected: [["member", "invalid_syntax", "invalid_member_name", 1, 5]],
  },
  {
    name: "control between an unquoted member name and its colon",
    source: "{foo \u0001:2}",
    expected: [
      ["member", "invalid_syntax", "invalid_member_name", 1, 4],
      ["member", "invalid_syntax", "invalid_character", 5, 6],
    ],
  },
  {
    name: "numeric member name",
    source: "{1:2}",
    expected: [["member", "invalid_syntax", "invalid_member_name", 1, 2]],
  },
  {
    name: "object value without a member",
    source: "{1}",
    expected: [["object", "invalid_syntax", "unexpected_value", 1, 2]],
  },
  {
    name: "leading, duplicate and trailing array commas",
    source: "[,,1,,2,,]",
    expected: [
      ["array", "invalid_syntax", "unexpected_separator", 1, 2],
      ["array", "invalid_syntax", "unexpected_separator", 2, 3],
      ["array", "invalid_syntax", "unexpected_separator", 5, 6],
      ["array", "invalid_syntax", "unexpected_separator", 7, 8],
      ["array", "invalid_syntax", "unexpected_separator", 8, 9],
    ],
  },
  {
    name: "independent missing member components at EOF",
    source: '{"a"',
    expected: [
      ["member", "incomplete_syntax", "missing_name_separator", 4, 4],
      ["member", "incomplete_syntax", "missing_value", 4, 4],
      ["object", "incomplete_syntax", "missing_object_close", 4, 4],
    ],
  },
  {
    name: "independent missing member components before closing",
    source: '{"a"}',
    expected: [
      ["member", "invalid_syntax", "missing_name_separator", 4, 4],
      ["member", "invalid_syntax", "missing_value", 4, 4],
    ],
  },
  {
    name: "member control before a value",
    source: '{"a":\u0000true}',
    expected: [["member", "invalid_syntax", "invalid_character", 5, 6]],
  },
  {
    name: "root stray delimiter preserves the first value",
    source: "}true",
    expected: [["json_text", "invalid_syntax", "invalid_character", 0, 1]],
  },
  {
    name: "closing after a nonstring value closes the object before a colon",
    source: "{1 }:",
    expected: [
      ["object", "invalid_syntax", "unexpected_value", 1, 2],
      ["json_text", "invalid_syntax", "invalid_character", 4, 5],
    ],
  },
  {
    name: "comma after a nonstring value separates it from a colon",
    source: "{1 , :2}",
    expected: [
      ["object", "invalid_syntax", "unexpected_value", 1, 2],
      ["member", "invalid_syntax", "missing_member_name", 5, 5],
    ],
  },
  {
    name: "stray closing between a nonstring value and a colon stays in the object",
    source: "{1 ]:2}",
    expected: [
      ["object", "invalid_syntax", "unexpected_value", 1, 2],
      ["object", "invalid_syntax", "invalid_character", 3, 4],
      ["object", "invalid_syntax", "missing_value_separator", 4, 4],
      ["member", "invalid_syntax", "missing_member_name", 4, 4],
    ],
  },
  {
    name: "Unicode prefix followed by another u",
    source: '"\\uu"',
    expected: [["char", "invalid_syntax", "invalid_escape", 1, 4]],
  },
  {
    name: "Unicode escape stops at first nonhex character",
    source: '"\\uGx"',
    expected: [["char", "invalid_syntax", "invalid_escape", 1, 4]],
  },
  {
    name: "bad Unicode escape preserves following escape",
    source: '"\\u12\\n"',
    expected: [["char", "invalid_syntax", "invalid_escape", 1, 5]],
  },
  {
    name: "physical newline closes a string and keeps the next value",
    source: '"a\r\n1',
    expected: [
      ["string", "invalid_syntax", "missing_string_close", 2, 2],
      ["json_text", "invalid_syntax", "unexpected_value", 4, 5],
    ],
  },
  {
    name: "integer digits at EOF",
    source: "-",
    expected: [["number", "incomplete_syntax", "missing_digits", 1, 1]],
  },
  {
    name: "integer digits before fraction",
    source: ".5",
    expected: [["number", "invalid_syntax", "missing_digits", 0, 0]],
  },
  {
    name: "fraction digits at EOF",
    source: "1.",
    expected: [["frac", "incomplete_syntax", "missing_digits", 2, 2]],
  },
  {
    name: "fraction digits before exponent",
    source: "1.e2",
    expected: [["frac", "invalid_syntax", "missing_digits", 2, 2]],
  },
  {
    name: "hexadecimal notation stays in one number",
    source: "0x10",
    expected: [["int", "invalid_syntax", "invalid_number", 1, 4]],
  },
  {
    name: "second decimal point",
    source: "1.2.3",
    expected: [["frac", "invalid_syntax", "invalid_number", 3, 4]],
  },
  {
    name: "second exponent",
    source: "1e2e3",
    expected: [["exp", "invalid_syntax", "invalid_number", 3, 4]],
  },
  {
    name: "invalid integer text is not also missing digits",
    source: "-NaN",
    expected: [["number", "invalid_syntax", "invalid_number", 1, 4]],
  },
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
  {
    name: "leading plus",
    source: "+1",
    expected: [["number", "invalid_syntax", "invalid_number", 0, 1]],
  },
  {
    name: "normal digits split contiguous invalid numeric runs",
    source: "1__2__3",
    expected: [
      ["int", "invalid_syntax", "invalid_number", 1, 3],
      ["int", "invalid_syntax", "invalid_number", 4, 6],
    ],
  },
  {
    name: "normal integer follows an invalid prefix",
    source: "--12",
    expected: [["number", "invalid_syntax", "invalid_number", 1, 2]],
  },
  {
    name: "adjacent forbidden string characters form one issue",
    source: '"\u0001\u0002x\u0003"',
    expected: [
      ["string", "invalid_syntax", "invalid_character", 1, 3],
      ["string", "invalid_syntax", "invalid_character", 4, 5],
    ],
  },
  {
    name: "adjacent forbidden member layout characters form one issue",
    source: '{"a":\u0001\u00021}',
    expected: [["member", "invalid_syntax", "invalid_character", 5, 7]],
  },
  {
    name: "noninitial BOM is not layout",
    source: " ﻿[]",
    expected: [
      ["value", "invalid_syntax", "invalid_value", 1, 4],
      ["json_text", "invalid_syntax", "unexpected_value", 4, 6],
    ],
  },
];

for (const { name, source, expected } of issues) {
  test(name, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, expected, tree.cst);
  });
}

for (const { name, source, owner, position, item, ranges } of [
  {
    name: "array values survive a stray closing after a comma",
    source: "[1,}2]",
    owner: "array",
    position: 3,
    item: "value",
    ranges: [
      [1, 2],
      [4, 5],
    ],
  },
  {
    name: "object members survive a stray closing after a comma",
    source: '{"a":1,] "b":2}',
    owner: "object",
    position: 7,
    item: "member",
    ranges: [
      [1, 6],
      [9, 14],
    ],
  },
]) {
  test(name, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, [
      [owner, "invalid_syntax", "invalid_character", position, position + 1],
    ]);
    const container = tree.nodes.findIndex((node) => node.kind === owner);
    assert.deepEqual(
      tree.nodes
        .filter((node) => node.parent === container && node.kind === item)
        .map(({ start, end }) => [start, end]),
      ranges,
    );
    const comma = tree.nodes.find((node) => node.kind === ",");
    assert.equal(comma.parent, container);
    assert.deepEqual([comma.start, comma.end], [position - 1, position]);
  });
}

for (const { name, source, reason, expected, ranges } of [
  {
    name: "control after an object value does not turn it into a member name",
    source: '{[]\u0000 "a":1}',
    reason: "unexpected_value",
    expected: [
      ["object", "invalid_syntax", "unexpected_value", 1, 3],
      ["object", "invalid_syntax", "invalid_character", 3, 4],
      ["object", "invalid_syntax", "missing_value_separator", 5, 5],
    ],
    ranges: [[5, 10]],
  },
  {
    name: "colon confirms a nonstring member name across a control",
    source: "{[]\u0000:1}",
    reason: "invalid_member_name",
    expected: [
      ["member", "invalid_syntax", "invalid_member_name", 1, 3],
      ["member", "invalid_syntax", "invalid_character", 3, 4],
    ],
    ranges: [[1, 6]],
  },
]) {
  test(name, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, expected);
    const index = tree.nodes.findIndex((node) => node.kind === reason);
    assert.equal(tree.nodes[index + 1].kind, "value");
    assert.equal(tree.nodes[index + 1].parent, index);
    assert.equal(tree.nodes[index + 2].kind, "array");
    assert.deepEqual(
      tree.nodes
        .filter((node) => node.kind === "member")
        .map(({ start, end }) => [start, end]),
      ranges,
    );
  });
}

for (const [name, source] of [
  ["boolean", "true"],
  ["null", "null"],
  ["array", "[]"],
  ["object", "{}"],
]) {
  test(`${name} member names keep their value structure`, () => {
    const tree = parse(`{${source}:1}`);
    assert.equal(tree.hasError, false, tree.cst);
    assert.deepEqual(tree.issues, [
      ["member", "invalid_syntax", "invalid_member_name", 1, source.length + 1],
    ]);
    const reason = tree.nodes.findIndex(
      (node) => node.kind === "invalid_member_name",
    );
    assert.equal(tree.nodes[reason + 1].kind, "value");
    assert.equal(tree.nodes[reason + 1].parent, reason);
  });
}

for (const source of [
  "// comment\n1",
  "/* comment */1",
  "'text'",
  "NaN",
  "Infinity",
  "{key:1}",
]) {
  test(`extensions are syntax issues: ${JSON.stringify(source)}`, () => {
    const tree = parse(source);
    assert.equal(tree.hasError, false, tree.cst);
    assert.notDeepEqual(tree.issues, []);
    assert.ok(tree.issues.every((issue) => issue[1] === "invalid_syntax"));
  });
}

test("BOM and UTF-8 leaf ranges preserve original source positions", () => {
  const tree = parse('\uFEFF{"é":"😀"}');
  assert.deepEqual(tree.issues, []);
  assert.deepEqual(
    tree.nodes
      .filter((node) => node.kind === "unescaped")
      .map(({ start, end }) => [start, end]),
    [
      [5, 7],
      [10, 14],
    ],
  );
  assert.deepEqual(
    tree.nodes
      .filter((node) => node.field === "name" || node.field === "value")
      .map(({ kind, field, start, end }) => [kind, field, start, end]),
    [
      ["string", "name", 4, 8],
      ["value", "value", 9, 15],
    ],
  );
});

test("invalid number and escape reasons retain only confirmed leaves", () => {
  const tree = parse('[0x12,"\\u12G"]');
  const leaves = tree.nodes.filter(
    (_node, index) => !tree.nodes.some((child) => child.parent === index),
  );
  assert.deepEqual(
    leaves.map(({ kind, named, start, end }) => [kind, named, start, end]),
    [
      ["[", false, 0, 1],
      ["0", false, 1, 2],
      ["digit", true, 3, 4],
      ["digit", true, 4, 5],
      [",", false, 5, 6],
      ['"', false, 6, 7],
      ["\\", false, 7, 8],
      ["u", false, 8, 9],
      ["hexdig", true, 9, 10],
      ["hexdig", true, 10, 11],
      ['"', false, 12, 13],
      ["]", false, 13, 14],
    ],
  );
});

test("exponent markers are named leaves", () => {
  const tree = parse("[1e2,1E2]");
  assert.deepEqual(
    tree.nodes.flatMap((node, index) =>
      node.kind === "e"
        ? [
            [
              node.named,
              node.start,
              node.end,
              tree.nodes.some(({ parent }) => parent === index),
            ],
          ]
        : [],
    ),
    [
      [true, 2, 3, false],
      [true, 6, 7, false],
    ],
  );
});

for (const { name: language } of grammars) {
  for (const { name, source, expected, members } of [
    {
      name: "a quoted name after a newline",
      source: '{"a":\n"b":1}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 6, 6],
        ["object", "invalid_syntax", "missing_value_separator", 6, 6],
      ],
      members: ['"a":\n', '"b":1'],
    },
    {
      name: "a quoted name after a missing colon",
      source: '{"a" "b":1}',
      expected: [
        ["member", "invalid_syntax", "missing_name_separator", 5, 5],
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
      ],
      members: ['"a" ', '"b":1'],
    },
    {
      name: "a numeric name",
      source: '{"a": 1:2}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 6, 6],
        ["object", "invalid_syntax", "missing_value_separator", 6, 6],
        ["member", "invalid_syntax", "invalid_member_name", 6, 7],
      ],
      members: ['"a": ', "1:2"],
    },
    {
      name: "a numeric name with layout before its colon",
      source: '{"a":1 :2}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
        ["member", "invalid_syntax", "invalid_member_name", 5, 6],
      ],
      members: ['"a":', "1 :2"],
    },
    {
      name: "a literal name inside an array's object",
      source: '[{"a":true:1}]',
      expected: [
        ["member", "invalid_syntax", "missing_value", 6, 6],
        ["object", "invalid_syntax", "missing_value_separator", 6, 6],
        ["member", "invalid_syntax", "invalid_member_name", 6, 10],
      ],
      members: ['"a":', "true:1"],
    },
    {
      name: "a bare word name",
      source: '{"a":foo:1}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
        ["member", "invalid_syntax", "invalid_member_name", 5, 8],
      ],
      members: ['"a":', "foo:1"],
    },
    {
      name: "a name containing an escaped quote and colon",
      source: '{"a":"b\\":c":1}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "missing_value_separator", 5, 5],
      ],
      members: ['"a":', '"b\\":c":1'],
    },
    ...(language === "json"
      ? []
      : [
          {
            name: "a quoted name followed by a comment",
            source: '{"a":"b"/*:*/:1}',
            expected: [
              ["member", "invalid_syntax", "missing_value", 5, 5],
              ["object", "invalid_syntax", "missing_value_separator", 5, 5],
            ],
            members: ['"a":', '"b"/*:*/:1'],
          },
          {
            name: "a numeric name followed by a line comment",
            source: '{"a":1//:\n:2}',
            expected: [
              ["member", "invalid_syntax", "missing_value", 5, 5],
              ["object", "invalid_syntax", "missing_value_separator", 5, 5],
              ["member", "invalid_syntax", "invalid_member_name", 5, 6],
            ],
            members: ['"a":', "1//:\n:2"],
          },
          {
            name: "a slash-prefixed word that is not a comment",
            source: '{"a":/x:1}',
            expected: [
              ["member", "invalid_syntax", "missing_value", 5, 5],
              ["object", "invalid_syntax", "missing_value_separator", 5, 5],
              ["member", "invalid_syntax", "invalid_member_name", 5, 7],
            ],
            members: ['"a":', "/x:1"],
          },
        ]),
  ]) {
    test(`${language}: member recovery preserves ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
      const indices = tree.nodes.flatMap(({ kind }, index) =>
        kind === "member" ? [index] : [],
      );
      assert.deepEqual(
        indices.map((index) => {
          const { start, end } = tree.nodes[index];
          return source.slice(start, end);
        }),
        members,
      );
      assert.equal(
        tree.nodes.some(
          ({ field, parent }) => field === "value" && parent === indices[0],
        ),
        false,
      );
      assert.ok(
        tree.nodes.some(
          ({ field, parent }) => field === "value" && parent === indices[1],
        ),
      );
    });
  }

  for (const source of [
    '{"a":"b:c"}',
    '{"a":"b\\":c"}',
    '{"a":{"b":1}}',
    '{"a":[{"b":1}]}',
    '{"a":"b","c":1}',
  ]) {
    test(`${language}: member recovery preserves normal values: ${source}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, []);
    });
  }

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

  for (const [source, value] of [
    ['{"a":"b" "c":1}', '"b"'],
    ['{"a":"b"}:1', '"b"'],
    ['{"a":["b"]:1}', '["b"]'],
    ['{"a":{"b":1}:2}', '{"b":1}'],
  ]) {
    test(`${language}: member lookahead stops at the next value or container boundary: ${source}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      const owner = tree.nodes.findIndex(({ kind }) => kind === "member");
      const node = tree.nodes.find(
        ({ parent, field }) => parent === owner && field === "value",
      );
      assert.ok(node, tree.cst);
      assert.equal(source.slice(node.start, node.end), value);
    });
  }
}

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
    const source = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([255, 254, 128]),
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
          prefix.length,
          prefix.length + 3,
        ],
      ],
      result.cst,
    );
  });
}

test("a truncated UTF-8 sequence stays invalid at EOF independently of the missing quote", () => {
  const result = parse(Buffer.from([34, 97, 195]));
  assert.deepEqual(result.issues, [
    ["string", "invalid_syntax", "invalid_encoding", 2, 3],
    ["string", "incomplete_syntax", "missing_string_close", 3, 3],
  ]);
});

test("decoding failures stay isolated across JSON syntax boundaries", () => {
  for (const source of [
    '{"a":[true,false,null,12.3e+4]}',
    String.raw`"x\u1234y"`,
    "[01,1.a2,tru]",
    ' {"a":1} ',
  ]) {
    for (let byte = 0; byte <= source.length; byte++) {
      const input = Buffer.concat([
        Buffer.from(source.slice(0, byte)),
        Buffer.from([255, 254, 128]),
        Buffer.from(source.slice(byte)),
      ]);
      const result = parse(input);
      assert.deepEqual(
        result.issues
          .filter(([, , reason]) => reason === "invalid_encoding")
          .map(([, , , start, end]) => [start, end]),
        [[byte, byte + 3]],
        `${JSON.stringify({ source, byte })}\n${result.cst}`,
      );
    }
  }
});

const languages = grammars.filter(({ name }) => name !== "json");

for (const { name: language } of languages) {
  for (const { name, source, bodies } of [
    {
      name: "line comment ends before CRLF",
      source: "// head\r\n1",
      bodies: [" head"],
    },
    {
      name: "line comment ends before CR",
      source: "1// tail\r",
      bodies: [" tail"],
    },
    {
      name: "line comment ends before LF",
      source: "1// tail\n",
      bodies: [" tail"],
    },
    { name: "line comment ends at EOF", source: "1// tail", bodies: [" tail"] },
    { name: "empty line comment has no body", source: "1//", bodies: [] },
    { name: "empty block comment has no body", source: "/**/1", bodies: [] },
    {
      name: "block comment keeps controls and JSON delimiters",
      source: '1/*\u0000\u001f\r\n"[{}]\\*/',
      bodies: ['\u0000\u001f\r\n"[{}]\\'],
    },
    {
      name: "block comment closes at the first marker without nesting",
      source: "1/*outer/*inner*/",
      bodies: ["outer/*inner"],
    },
    {
      name: "a lone star belongs to block comment content",
      source: "1/*a*b**c*/",
      bodies: ["a*b**c"],
    },
    {
      name: "a literal ends before a comment",
      source: "true/*x*/",
      bodies: ["x"],
    },
    {
      name: "a number ends before a comment",
      source: "12.5e+2//x",
      bodies: ["x"],
    },
    {
      name: "comment markers inside a string remain characters",
      source: '"// /* */"',
      bodies: [],
    },
  ]) {
    test(`${language}: ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, [], tree.cst);
      const bytes = Buffer.from(source);
      assert.deepEqual(
        tree.nodes
          .filter(({ kind }) => kind === "comment_text")
          .map(({ start, end }) => bytes.subarray(start, end).toString()),
        bodies,
      );
    });
  }

  test(`${language}: comments belong directly to their source owner`, () => {
    const source = '/*r*/{/*o*/"a"/*n*/:/*v*/1/*t*/}/*e*/';
    const tree = parse(source, [], language);
    assert.deepEqual(tree.issues, []);
    const bytes = Buffer.from(source);
    assert.deepEqual(
      tree.nodes
        .filter(({ kind }) => kind === "multi_line_comment")
        .map(({ start, end, parent }) => [
          tree.nodes[parent].kind,
          bytes.subarray(start, end).toString(),
        ]),
      [
        ["json_text", "/*r*/"],
        ["object", "/*o*/"],
        ["member", "/*n*/"],
        ["member", "/*v*/"],
        ["object", "/*t*/"],
        ["json_text", "/*e*/"],
      ],
    );
    for (const node of tree.nodes.filter(({ kind }) =>
      ["/*", "*/"].includes(kind),
    )) {
      assert.equal(node.named, false);
      assert.equal(tree.nodes[node.parent].kind, "multi_line_comment");
    }
  });

  for (const { name, source, expected } of [
    {
      name: "unfinished block after a value",
      source: "1/*",
      expected: [
        [
          "multi_line_comment",
          "incomplete_syntax",
          "missing_comment_close",
          3,
          3,
        ],
      ],
    },
    {
      name: "unfinished block and missing root value are independent",
      source: "/*",
      expected: [
        [
          "multi_line_comment",
          "incomplete_syntax",
          "missing_comment_close",
          2,
          2,
        ],
        ["json_text", "incomplete_syntax", "missing_value", 2, 2],
      ],
    },
    {
      name: "line-comment-only document still requires a value",
      source: "//",
      expected: [["json_text", "incomplete_syntax", "missing_value", 2, 2]],
    },
    {
      name: "block-comment-only document still requires a value",
      source: "/*x*/",
      expected: [["json_text", "incomplete_syntax", "missing_value", 5, 5]],
    },
    {
      name: "comment terminates an incomplete literal",
      source: "tru/*x*/",
      expected: [["value", "invalid_syntax", "invalid_value", 0, 3]],
    },
    {
      name: "comment terminates an unfinished fraction",
      source: "1./**/",
      expected: [["frac", "invalid_syntax", "missing_digits", 2, 2]],
    },
    {
      name: "comment terminates an unfinished exponent",
      source: "1e+/**/",
      expected: [["exp", "invalid_syntax", "missing_digits", 3, 3]],
    },
    {
      name: "a slash without a comment marker stays an invalid value",
      source: "/x",
      expected: [["value", "invalid_syntax", "invalid_value", 0, 2]],
    },
    {
      name: "a slash in a number stays in that number",
      source: "1/2",
      expected: [["int", "invalid_syntax", "invalid_number", 1, 2]],
    },
    {
      name: "comment before a missing colon belongs to the member",
      source: '{"a"/*x*/1}',
      expected: [["member", "invalid_syntax", "missing_name_separator", 9, 9]],
    },
    {
      name: "comment preserves a confirmed unquoted member name",
      source: "{foo/*x*/:1}",
      expected: [["member", "invalid_syntax", "invalid_member_name", 1, 4]],
    },
  ]) {
    test(`${language}: ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
    });
  }

  for (const { name, source, expected, bodies } of [
    {
      name: "block comment decoding failure splits normal content",
      source: Buffer.from([49, 47, 42, 97, 255, 255, 98, 42, 47]),
      expected: [
        ["multi_line_comment", "invalid_syntax", "invalid_encoding", 4, 6],
      ],
      bodies: ["a", "b"],
    },
    {
      name: "line comment decoding failure stays inside the comment",
      source: Buffer.from([49, 47, 47, 97, 255, 98, 10]),
      expected: [
        ["single_line_comment", "invalid_syntax", "invalid_encoding", 4, 5],
      ],
      bodies: ["a", "b"],
    },
  ]) {
    test(`${language}: ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
      assert.deepEqual(
        tree.nodes
          .filter(({ kind }) => kind === "comment_text")
          .map(({ start, end }) => source.subarray(start, end).toString()),
        bodies,
      );
    });
  }
}

for (const { name: language } of grammars) {
  const trailing = language === "jsonc_trailing";
  for (const { name, source, owner, comma } of [
    { name: "array trailing comma", source: "[1,]", owner: "array", comma: 2 },
    {
      name: "object trailing comma",
      source: '{"a":1,}',
      owner: "object",
      comma: 6,
    },
  ]) {
    test(`${language}: ${name} follows the selected language`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(
        tree.issues,
        trailing
          ? []
          : [
              [
                owner,
                "invalid_syntax",
                "unexpected_separator",
                comma,
                comma + 1,
              ],
            ],
        tree.cst,
      );
      const leaf = tree.nodes.find(
        (node) => node.kind === "," && node.start === comma,
      );
      assert.ok(leaf, tree.cst);
      assert.equal(leaf.named, false);
      assert.equal(
        tree.nodes[leaf.parent].kind,
        trailing ? owner : "unexpected_separator",
      );
    });
  }

  for (const { name, source, expected } of [
    {
      name: "empty array cannot have a comma",
      source: "[,]",
      expected: [["array", "invalid_syntax", "unexpected_separator", 1, 2]],
    },
    {
      name: "empty object cannot have a comma",
      source: "{,}",
      expected: [["object", "invalid_syntax", "unexpected_separator", 1, 2]],
    },
    {
      name: "array duplicate comma before a value",
      source: "[1,,2]",
      expected: [["array", "invalid_syntax", "unexpected_separator", 3, 4]],
    },
    {
      name: "array duplicate trailing comma",
      source: "[1,,]",
      expected: [
        ...(trailing
          ? []
          : [["array", "invalid_syntax", "unexpected_separator", 2, 3]]),
        ["array", "invalid_syntax", "unexpected_separator", 3, 4],
      ],
    },
    {
      name: "object duplicate trailing comma",
      source: '{"a":1,,}',
      expected: [
        ...(trailing
          ? []
          : [["object", "invalid_syntax", "unexpected_separator", 6, 7]]),
        ["object", "invalid_syntax", "unexpected_separator", 7, 8],
      ],
    },
    {
      name: "array comma at EOF",
      source: "[1,",
      expected: [
        ...(trailing
          ? []
          : [["array", "incomplete_syntax", "missing_value", 3, 3]]),
        ["array", "incomplete_syntax", "missing_array_close", 3, 3],
      ],
    },
    {
      name: "object comma at EOF",
      source: '{"a":1,',
      expected: [
        ...(trailing
          ? []
          : [["object", "incomplete_syntax", "missing_member", 7, 7]]),
        ["object", "incomplete_syntax", "missing_object_close", 7, 7],
      ],
    },
    {
      name: "stray closing after an array comma at EOF",
      source: "[1,}",
      expected: [
        ["array", "invalid_syntax", "invalid_character", 3, 4],
        ...(trailing
          ? []
          : [["array", "incomplete_syntax", "missing_value", 4, 4]]),
        ["array", "incomplete_syntax", "missing_array_close", 4, 4],
      ],
    },
    {
      name: "ancestor array closing after an object comma",
      source: '[{"a":1,]',
      expected: [
        ...(trailing
          ? []
          : [["object", "invalid_syntax", "unexpected_separator", 7, 8]]),
        ["object", "invalid_syntax", "missing_object_close", 8, 8],
      ],
    },
    {
      name: "ancestor object closing after an array comma",
      source: '{"a":[1,}',
      expected: [
        ...(trailing
          ? []
          : [["array", "invalid_syntax", "unexpected_separator", 7, 8]]),
        ["array", "invalid_syntax", "missing_array_close", 8, 8],
      ],
    },
    {
      name: "array closing after a comma and a stray closing",
      source: "[1,}]",
      expected: [
        ...(trailing
          ? []
          : [["array", "invalid_syntax", "unexpected_separator", 2, 3]]),
        ["array", "invalid_syntax", "invalid_character", 3, 4],
      ],
    },
    {
      name: "array colon after a comma keeps the following value",
      source: "[1,:2]",
      expected: [["array", "invalid_syntax", "invalid_character", 3, 4]],
    },
    {
      name: "array closing after a comma and a stray colon",
      source: "[1,:]",
      expected: [
        ...(trailing
          ? []
          : [["array", "invalid_syntax", "unexpected_separator", 2, 3]]),
        ["array", "invalid_syntax", "invalid_character", 3, 4],
      ],
    },
    {
      name: "object closing after a comma and a control",
      source: '{"a":1,\u0001}',
      expected: [
        ...(trailing
          ? []
          : [["object", "invalid_syntax", "unexpected_separator", 6, 7]]),
        ["object", "invalid_syntax", "invalid_character", 7, 8],
      ],
    },
  ]) {
    test(`${language}: ${name}`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, expected, tree.cst);
      if (["[,]", "{,}"].includes(source)) {
        assert.equal(
          tree.nodes.filter(
            ({ kind, parent }) =>
              kind === "member" ||
              (kind === "value" && tree.nodes[parent]?.kind === "array"),
          ).length,
          0,
        );
      }
    });
  }

  if (language === "json") continue;
  for (const { name, source, strict, relaxed } of [
    {
      name: "block comment before closing",
      source: "[1,/*x*/]",
      strict: [["array", "invalid_syntax", "unexpected_separator", 2, 3]],
      relaxed: [],
    },
    {
      name: "object block comment before closing",
      source: '{"a":1,/*x*/}',
      strict: [["object", "invalid_syntax", "unexpected_separator", 6, 7]],
      relaxed: [],
    },
    {
      name: "line comment before closing",
      source: "[1,//x\n]",
      strict: [["array", "invalid_syntax", "unexpected_separator", 2, 3]],
      relaxed: [],
    },
    {
      name: "closed comment after comma at EOF",
      source: "[1,/*x*/",
      strict: [
        ["array", "incomplete_syntax", "missing_value", 8, 8],
        ["array", "incomplete_syntax", "missing_array_close", 8, 8],
      ],
      relaxed: [["array", "incomplete_syntax", "missing_array_close", 8, 8]],
    },
    {
      name: "unfinished comment after comma at EOF",
      source: "[1,/*",
      strict: [
        [
          "multi_line_comment",
          "incomplete_syntax",
          "missing_comment_close",
          5,
          5,
        ],
        ["array", "incomplete_syntax", "missing_value", 5, 5],
        ["array", "incomplete_syntax", "missing_array_close", 5, 5],
      ],
      relaxed: [
        [
          "multi_line_comment",
          "incomplete_syntax",
          "missing_comment_close",
          5,
          5,
        ],
        ["array", "incomplete_syntax", "missing_array_close", 5, 5],
      ],
    },
  ]) {
    test(`${language}: ${name} follows the selected language`, () => {
      const tree = parse(source, [], language);
      assert.equal(tree.hasError, false, tree.cst);
      assert.deepEqual(tree.issues, trailing ? relaxed : strict, tree.cst);
    });
  }
}

for (const language of ["jsonc", "jsonc_trailing"]) {
  for (const { source, owner, start, missing } of [
    { source: "1/", owner: "json_text", start: 1, missing: [] },
    { source: "1 /", owner: "json_text", start: 2, missing: [] },
    { source: "true/", owner: "json_text", start: 4, missing: [] },
    {
      source: "[1 /",
      owner: "array",
      start: 3,
      missing: [["array", "incomplete_syntax", "missing_array_close", 4, 4]],
    },
    {
      source: '{"a":1/',
      owner: "object",
      start: 6,
      missing: [["object", "incomplete_syntax", "missing_object_close", 7, 7]],
    },
    {
      source: '{"a"/',
      owner: "member",
      start: 4,
      missing: [
        ["member", "incomplete_syntax", "missing_name_separator", 5, 5],
        ["member", "incomplete_syntax", "missing_value", 5, 5],
        ["object", "incomplete_syntax", "missing_object_close", 5, 5],
      ],
    },
    {
      source: "/",
      owner: "json_text",
      start: 0,
      missing: [["json_text", "incomplete_syntax", "missing_value", 1, 1]],
    },
  ]) {
    test(`${language}: unfinished comment opener at EOF: ${source}`, () => {
      const result = parse(source, [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        [owner, "incomplete_syntax", "invalid_comment", start, start + 1],
        ...missing,
      ]);
      assert.equal(
        result.nodes.some(
          ({ kind }) =>
            kind === "single_line_comment" || kind === "multi_line_comment",
        ),
        false,
      );
    });
  }
  test(`${language}: unfinished comment does not make the preceding literal completable`, () => {
    const result = parse("tru/", [], language);
    assert.equal(result.hasError, false, result.cst);
    assert.deepEqual(result.issues, [
      ["value", "invalid_syntax", "invalid_value", 0, 3],
      ["json_text", "incomplete_syntax", "invalid_comment", 3, 4],
    ]);
  });
  for (const source of ["1/ ", "true/ ", "1/x", "/\n"]) {
    test(`${language}: a nonfinal slash cannot be completed by appending: ${JSON.stringify(source)}`, () => {
      const result = parse(source, [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.ok(
        result.issues.some(([, outcome]) => outcome === "invalid_syntax"),
      );
      assert.equal(
        result.issues.some(([, , reason]) => reason === "invalid_comment"),
        false,
      );
    });
  }
}

for (const language of ["json", "jsonc", "jsonc_trailing"]) {
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
      const source = Buffer.concat([
        Buffer.from(`[${prefix}`),
        Buffer.from([255, 254]),
        Buffer.from(`${suffix}]`),
      ]);
      const result = parse(source, [], language);
      assert.equal(result.hasError, false, result.cst);
      assert.deepEqual(result.issues, [
        ...(invalidPrefix
          ? [["value", "invalid_syntax", "invalid_value", 1, prefix.length + 1]]
          : []),
        [
          "value",
          "invalid_syntax",
          "invalid_encoding",
          prefix.length + 1,
          prefix.length + 3,
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

for (const language of ["json", "jsonc", "jsonc_trailing"]) {
  for (const { name, source, expected, members } of [
    {
      name: "a stray closing ends the member before a nameless member",
      source: '{"a" ]:1}',
      expected: [
        ["member", "invalid_syntax", "missing_name_separator", 5, 5],
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "invalid_character", 5, 6],
        ["object", "invalid_syntax", "missing_value_separator", 6, 6],
        ["member", "invalid_syntax", "missing_member_name", 6, 6],
      ],
      members: [
        [1, 5],
        [6, 8],
      ],
    },
    {
      name: "a stray closing ends the member before a named member",
      source: '{"a" ] "b":1}',
      expected: [
        ["member", "invalid_syntax", "missing_name_separator", 5, 5],
        ["member", "invalid_syntax", "missing_value", 5, 5],
        ["object", "invalid_syntax", "invalid_character", 5, 6],
        ["object", "invalid_syntax", "missing_value_separator", 7, 7],
      ],
      members: [
        [1, 5],
        [7, 12],
      ],
    },
    {
      name: "a stray closing ends a member after its colon",
      source: '{"a": ]:1}',
      expected: [
        ["member", "invalid_syntax", "missing_value", 6, 6],
        ["object", "invalid_syntax", "invalid_character", 6, 7],
        ["object", "invalid_syntax", "missing_value_separator", 7, 7],
        ["member", "invalid_syntax", "missing_member_name", 7, 7],
      ],
      members: [
        [1, 6],
        [7, 9],
      ],
    },
    {
      name: "member gaps precede missing syntax at a stray closing",
      source: '{"a"\u0001 ]:1}',
      expected: [
        ["member", "invalid_syntax", "invalid_character", 4, 5],
        ["member", "invalid_syntax", "missing_name_separator", 6, 6],
        ["member", "invalid_syntax", "missing_value", 6, 6],
        ["object", "invalid_syntax", "invalid_character", 6, 7],
        ["object", "invalid_syntax", "missing_value_separator", 7, 7],
        ["member", "invalid_syntax", "missing_member_name", 7, 7],
      ],
      members: [
        [1, 6],
        [7, 9],
      ],
    },
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

for (const language of ["json", "jsonc", "jsonc_trailing"]) {
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

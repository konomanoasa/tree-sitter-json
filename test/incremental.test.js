import assert from "node:assert/strict";
import test from "node:test";
import { applyEdits, parse as parseLanguage } from "./support/parser.js";

for (const language of ["json", "jsonc", "jsonc_trailing"]) {
  const parse = (source, edits = []) => parseLanguage(source, edits, language);

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
      assert.deepEqual(parse(source, edits).issues, [
        ["member", "invalid_syntax", "missing_value", split, split],
        ["object", "invalid_syntax", "missing_value_separator", split, split],
        ...extra,
      ]);
      edits.push({ byte, deleteBytes: 1, insert: "" });
      compareHistory(source, edits);
    });
  }

  test(`${language}: normal digits split and rejoin an invalid numeric run`, () => {
    const source = "1__2";
    const edits = [{ byte: 2, deleteBytes: 0, insert: "3" }];
    const split = parse(source, edits);
    assert.deepEqual(split.issues, [
      ["int", "invalid_syntax", "invalid_number", 1, 2],
      ["int", "invalid_syntax", "invalid_number", 3, 4],
    ]);
    assert.deepEqual(split.nodes, parse("1_3_2").nodes);
    edits.push({ byte: 2, deleteBytes: 1, insert: "" });
    const joined = parse(source, edits);
    assert.deepEqual(joined.issues, [
      ["int", "invalid_syntax", "invalid_number", 1, 3],
    ]);
    assert.deepEqual(joined.nodes, parse(source).nodes);
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
      assert.deepEqual(parse(source, edits).issues, [
        ["value", "invalid_syntax", "invalid_value", 1, byte + 1],
        ["value", "invalid_syntax", "invalid_encoding", byte + 1, byte + 2],
      ]);
      edits.push({ byte, deleteBytes: 1, insert: "" });
      compareHistory(source, edits);
      assert.deepEqual(parse(source, edits).issues, [
        ["value", "invalid_syntax", "invalid_encoding", byte, byte + 1],
      ]);
    });
  }

  test(`${language}: adding and removing a colon reclassifies an undecodable name and value`, () => {
    const source = Buffer.from("{x\xff:1}", "latin1");
    const edits = [{ byte: 3, deleteBytes: 1, insert: "" }];
    assert.deepEqual(parse(source, edits).issues, [
      ["object", "invalid_syntax", "unexpected_value", 1, 4],
      ["value", "invalid_syntax", "invalid_value", 1, 2],
      ["value", "invalid_syntax", "invalid_encoding", 2, 3],
    ]);
    edits.push({ byte: 3, deleteBytes: 0, insert: ":" });
    assert.deepEqual(parse(source, edits).issues, [
      ["member", "invalid_syntax", "invalid_member_name", 1, 3],
      ["invalid_member_name", "invalid_syntax", "invalid_encoding", 2, 3],
    ]);
    compareHistory(source, edits);
  });

  test(`${language}: literal spelling does not add value issues inside an undecodable name`, () => {
    const source = Buffer.from("{tru\xff:1}", "latin1");
    const edits = [{ byte: 4, deleteBytes: 0, insert: "x" }];
    assert.deepEqual(parse(source, edits).issues, [
      ["member", "invalid_syntax", "invalid_member_name", 1, 6],
      ["invalid_member_name", "invalid_syntax", "invalid_encoding", 5, 6],
    ]);
    edits.push({ byte: 4, deleteBytes: 1, insert: "" });
    assert.deepEqual(parse(source, edits).issues, [
      ["member", "invalid_syntax", "invalid_member_name", 1, 5],
      ["invalid_member_name", "invalid_syntax", "invalid_encoding", 4, 5],
    ]);
    compareHistory(source, edits);
  });

  test(`${language}: repairing an undecodable name restores a confirmed literal value`, () => {
    const source = Buffer.from("{tr\xffue:1}", "latin1");
    const edits = [{ byte: 3, deleteBytes: 1, insert: "" }];
    const result = parse(source, edits);
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
    compareHistory(source, edits);
  });

  if (language !== "json") {
    for (const source of ["1/", "true/", "[1 /", '{"a"/', "/"]) {
      test(`${language}: a comment opener completes and becomes incomplete again: ${source}`, () => {
        for (const insert of ["/ tail", "* tail */", " ", "x"]) {
          compareHistory(source, [
            { byte: source.length, deleteBytes: 0, insert },
            { byte: source.length, deleteBytes: insert.length, insert: "" },
          ]);
        }
      });
    }
  }

  function compareHistory(source, edits) {
    const history = [];
    for (const edit of edits) {
      history.push(edit);
      const edited = applyEdits(source, history);
      const fresh = parse(edited);
      const incremental = parse(source, history);
      assert.deepEqual(
        incremental.nodes,
        fresh.nodes,
        JSON.stringify({ source, history, edited: edited.toString() }),
      );
    }
  }

  for (const source of [
    '{"a":[true,false,null,-12.34e+5,"\\uD834\\uDD1E"]}',
    '{"a":[1},"b":2}',
    '[{"a":1],2]',
    "{true:1,[]:2,{}:3,foo:4}",
    '{"a":1 :2}',
    '{"a":\n"b":1}',
    '{"a" "b":1}',
    '{"a":"é\\":😀":1}',
    "[1,}\u0001]",
    "{1 ]:2}",
    '{"a" ]:1}',
    '{"a" ] "b":1}',
    '{"a"\u0001 ]:1}',
    '[01,+2,.3,1.,1e+,truefalse,"\\q","\\u12"]',
    '\uFEFF{\r\n"名":"é😀",\r\n"b":0\r\n}',
    ...(language === "json"
      ? []
      : [
          '/*é😀*/{"a"/*name*/:1,//line\r\n"b":[2,],}',
          "[1,/*unfinished",
          "//only\r\n/*more*/",
          '[1e/*boundary*/,"\\u12"/*tail*/]',
          '{"a":"b"/*:*/:1}',
          '{"a":1//: ignored\n:2}',
          '{"a":/x:1}',
        ]),
  ]) {
    test(`${language}: deleting and restoring every code point: ${JSON.stringify(source)}`, () => {
      let byte = 0;
      for (const character of source) {
        const length = Buffer.byteLength(character);
        compareHistory(source, [
          { byte, deleteBytes: length, insert: "" },
          { byte, deleteBytes: 0, insert: character },
        ]);
        byte += length;
      }
    });
  }

  for (const source of [
    '{"a":[-0.5E-2,true,"\\u1234"]}',
    '"\\u12',
    '[{"a":1',
    ...(language === "json"
      ? []
      : ["[1,/*é😀*/]", '{"a":1,//é\r\n}', "//é😀", "/*é😀"]),
  ]) {
    test(`${language}: typing and erasing all prefixes: ${JSON.stringify(source)}`, () => {
      const edits = [];
      let byte = 0;
      for (const character of source) {
        edits.push({ byte, deleteBytes: 0, insert: character });
        byte += Buffer.byteLength(character);
      }
      for (const character of [...source].reverse()) {
        byte -= Buffer.byteLength(character);
        edits.push({
          byte,
          deleteBytes: Buffer.byteLength(character),
          insert: "",
        });
      }
      compareHistory("", edits);
    });
  }

  test(`${language}: fixed-seed generated histories preserve the public CST (seed 8259)`, () => {
    let seed = 8259;
    const random = (limit) => {
      seed ^= seed << 13;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      return (seed >>> 0) % limit;
    };
    const values = [
      "null",
      "false",
      "true",
      "0",
      "-12.34e+56",
      '"é\\n"',
      "[]",
      "{}",
    ];
    const fragments = [
      '"',
      "\\",
      "u",
      "0",
      "-",
      "e",
      ":",
      ",",
      "[",
      "]",
      "{",
      "}",
      " ",
      "\r\n",
      "é",
      "true",
      "/",
      "*",
      "//",
      "/*",
      "*/",
    ];
    for (let run = 0; run < 16; run++) {
      const layout = language === "json" ? "" : random(2) ? "/*é*/" : "//x\r\n";
      const trailing = language === "jsonc_trailing" && random(2) ? "," : "";
      const source = `[${layout}${Array.from({ length: 5 }, () => values[random(values.length)]).join(`,${layout}`)}${trailing}${layout}]`;
      assert.deepEqual(parse(source).issues, []);
      let edited = source;
      const edits = [];
      for (let step = 0; step < 12; step++) {
        const characters = [...edited];
        const index = random(characters.length + 1);
        const byte = Buffer.byteLength(characters.slice(0, index).join(""));
        const deleteBytes =
          random(2) && index < characters.length
            ? Buffer.byteLength(characters[index])
            : 0;
        const insert = fragments[random(fragments.length)];
        const edit = { byte, deleteBytes, insert };
        edits.push(edit);
        edited = applyEdits(edited, [edit]).toString();
      }
      compareHistory(source, edits);
    }
  });

  for (const [prefix, suffix] of [
    ['"a', 'b"'],
    ['"\\', 'b"'],
    ["1.", "2"],
    ["12", "3"],
    ["{", '"a":1}'],
    ...(language === "json"
      ? []
      : [
          ["/*", "*/1"],
          ["//", "\r\n1"],
        ]),
  ]) {
    test(`${language}: splitting a character merges the preceding decoding issue after ${JSON.stringify(prefix)}`, () => {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from([255]),
        Buffer.from(`é${suffix}`),
      ]);
      const edits = [{ byte: prefix.length + 2, deleteBytes: 1, insert: "" }];
      compareHistory(source, edits);
      assert.deepEqual(
        parse(source, edits)
          .issues.filter(([, , reason]) => reason === "invalid_encoding")
          .map(([, , , start, end]) => [start, end]),
        [[prefix.length, prefix.length + 2]],
      );
    });
  }

  test(`${language}: repairing a decoding failure restores the escaped character`, () => {
    const source = Buffer.from([34, 92, 255, 254, 128, 34]);
    const edits = [{ byte: 2, deleteBytes: 3, insert: "n" }];
    compareHistory(source, edits);
    assert.deepEqual(parse(source, edits).issues, []);
  });

  if (language !== "json") {
    test(`${language}: completing, breaking and restoring a block comment preserves comma classification`, () => {
      const source = "[1,/*é😀";
      const end = Buffer.byteLength(source);
      const history = [{ byte: end, deleteBytes: 0, insert: "*/]" }];
      compareHistory(source, history);
      const complete =
        language === "jsonc"
          ? [["array", "invalid_syntax", "unexpected_separator", 2, 3]]
          : [];
      assert.deepEqual(parse(source, history).issues, complete);
      history.push({ byte: end, deleteBytes: 1, insert: "" });
      compareHistory(source, history);
      const incomplete = end + 2;
      assert.deepEqual(parse(source, history).issues, [
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
      ]);
      history.push({ byte: end, deleteBytes: 0, insert: "*" });
      compareHistory(source, history);
      assert.deepEqual(parse(source, history).issues, complete);
    });
  }
}

test("adding and removing the array closing preserves incremental structure", () => {
  const edits = [{ byte: 1, deleteBytes: 0, insert: "]" }];
  assert.deepEqual(parseLanguage("[", edits).nodes, parseLanguage("[]").nodes);
  edits.push({ byte: 1, deleteBytes: 1, insert: "" });
  assert.deepEqual(parseLanguage("[", edits).nodes, parseLanguage("[").nodes);
});

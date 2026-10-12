import assert from "node:assert/strict";
import { test } from "node:test";
import { grammars } from "../scripts/tree-sitter.js";
import { applyEdits, assertEditHistory, parse } from "./support/parser.js";

for (const { name: language } of grammars) {
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
        assertEditHistory(
          {
            source,
            edits: [
              { byte, deleteBytes: length, insert: "" },
              { byte, deleteBytes: 0, insert: character },
            ],
          },
          language,
        );
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
      assertEditHistory({ source: "", edits }, language);
    });
  }

  const historySeed = 8259;
  test(`${language}: fixed-seed generated histories preserve the public CST (seed ${historySeed})`, () => {
    const historyCount = 16;
    const valuesPerArray = 5;
    const editsPerHistory = 12;
    const xorshiftLeftBits = 13;
    const xorshiftRightBits = 17;
    const xorshiftFinalLeftBits = 5;
    let state = historySeed;
    const random = (limit) => {
      state ^= state << xorshiftLeftBits;
      state ^= state >>> xorshiftRightBits;
      state ^= state << xorshiftFinalLeftBits;
      return (state >>> 0) % limit;
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
    for (let run = 0; run < historyCount; run++) {
      const layout = language === "json" ? "" : random(2) ? "/*é*/" : "//x\r\n";
      const trailing = language === "jsonc_trailing" && random(2) ? "," : "";
      const source = `[${layout}${Array.from({ length: valuesPerArray }, () => values[random(values.length)]).join(`,${layout}`)}${trailing}${layout}]`;
      assert.deepEqual(parse(source, [], language).issues, []);
      let edited = source;
      const edits = [];
      for (let step = 0; step < editsPerHistory; step++) {
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
      assertEditHistory({ source, edits }, language);
    }
  });
}

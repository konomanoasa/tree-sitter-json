import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

for (const source of [
  '{"a":[true,false,null,-12.34e+5,"\\uD834\\uDD1E"]}',
  '{"a":"é😀\\":x","b":[]}',
  '\uFEFF{\r\n"名":"é😀",\r\n"b":0\r\n}',
]) {
  test(`deleting and restoring each code point recovers the normal CST: ${source}`, () => {
    let byte = 0;
    for (const character of source) {
      const length = Buffer.byteLength(character);
      assertEditHistory({
        source,
        edits: [
          { byte, deleteBytes: length, insert: "" },
          { byte, deleteBytes: 0, insert: character },
        ],
      });
      byte += length;
    }
  });
}

for (const source of ['{"a":[-0.5E-2,true,"\\u1234"]}', '"é😀"']) {
  test(`typing and erasing prefixes agrees with fresh whenever complete: ${source}`, () => {
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
    assertEditHistory({ source: "", edits });
  });
}

const historySeed = 8259;
test(`fixed-seed generated histories restore normal structures (seed ${historySeed})`, () => {
  const historyCount = 16;
  const valuesPerArray = 5;
  const editsPerHistory = 12;
  let state = historySeed;
  const random = (limit) => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
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
  ];
  for (let run = 0; run < historyCount; run++) {
    const source = `[${Array.from({ length: valuesPerArray }, () => values[random(values.length)]).join(",")}]`;
    assert.equal(parse(source).hasError, false, source);
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
    edits.push({
      byte: 0,
      deleteBytes: Buffer.byteLength(edited),
      insert: source,
    });
    assertEditHistory({ source, edits });
  }
});

const collectionSize = 2_000;
const tokenLength = 20_000;
const nestingDepth = 128;
for (const { name, source, byte } of [
  {
    name: "wide array",
    source: `[${Array(collectionSize).fill("123").join(",")}]`,
    byte: 1,
  },
  {
    name: "wide object",
    source: `{${Array(collectionSize).fill('"a":123').join(",")}}`,
    byte: 5,
  },
  {
    name: "long string",
    source: `"${"a".repeat(tokenLength)}"`,
    byte: tokenLength / 2,
  },
  {
    name: "long number",
    source: "1".repeat(tokenLength),
    byte: tokenLength / 2,
  },
  {
    name: "deep array",
    source: `${"[".repeat(nestingDepth)}0${"]".repeat(nestingDepth)}`,
    byte: nestingDepth,
  },
  {
    name: "deep object",
    source: `${'{"a":'.repeat(nestingDepth)}0${"}".repeat(nestingDepth)}`,
    byte: nestingDepth * 5,
  },
]) {
  test(`a local edit in a ${name} preserves the normal CST and ranges`, () => {
    const edits = [{ byte, deleteBytes: 1, insert: "2" }];
    const expected = applyEdits(source, edits);
    assert.equal(parse(expected).hasError, false);
    assertIncrementalEqualsFresh(source, edits, expected);
  });
}

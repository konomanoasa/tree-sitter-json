import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

for (const [prefix, suffix] of [
  ['"a', 'b"'],
  ['"\\', 'b"'],
  ["1.", "2"],
  ["12", "3"],
  ["{", '"a":1}'],
]) {
  test(`splitting a character merges the preceding decoding issue after ${JSON.stringify(prefix)}`, () => {
    const start = Buffer.byteLength(prefix);
    const source = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([255]),
      Buffer.from(`é${suffix}`),
    ]);
    const edits = [{ byte: start + 2, deleteBytes: 1, insert: "" }];
    const result = assertIncrementalEqualsFresh(
      source,
      edits,
      applyEdits(source, edits),
    );
    assert.deepEqual(
      result.issues
        .filter(([, , reason]) => reason === "invalid_encoding")
        .map(([, , , start, end]) => [start, end]),
      [[start, start + 2]],
    );
  });
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
]) {
  test(`deleting and restoring every code point: ${JSON.stringify(source)}`, () => {
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

for (const source of ['{"a":[-0.5E-2,true,"\\u1234"]}', '"\\u12', '[{"a":1']) {
  test(`typing and erasing all prefixes: ${JSON.stringify(source)}`, () => {
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
test(`fixed-seed generated histories preserve the public CST (seed ${historySeed})`, () => {
  const historiesPerInput = 2;
  const editsPerHistory = 4;
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
  const inputs = [
    "null",
    "-12.34e+56",
    "[null,false,true,0,[],{}]",
    '{"名":"é\\n","a":[1,2]}',
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
  const historyCount = inputs.length * historiesPerInput;
  for (let run = 0; run < historyCount; run++) {
    const source = inputs[run % inputs.length];
    assert.deepEqual(parse(source).issues, []);
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
    assertEditHistory({ source, edits });
  }
});

test("adding and removing the array closing preserves incremental structure", () => {
  const edits = [{ byte: 1, deleteBytes: 0, insert: "]" }];
  assertIncrementalEqualsFresh("[", edits, "[]");
  edits.push({ byte: 1, deleteBytes: 1, insert: "" });
  assertIncrementalEqualsFresh("[", edits, "[");
});

const collectionSize = 10_000;
const tokenLength = 100_000;
const nestingDepth = 128;
const unfinishedNestingDepth = 32;
const objectPrefix = '{"a":';
const mixedPrefix = '{"a":[';
const largeInputCases = [
  {
    name: `array with ${collectionSize} elements`,
    source: `[${Array(collectionSize).fill("123").join(",")}]`,
    byte: 1,
  },
  {
    name: `object with ${collectionSize} members`,
    source: `{${Array(collectionSize).fill('"a":123').join(",")}}`,
    byte: 5,
  },
  {
    name: `string of ${tokenLength} characters`,
    source: `"${"a".repeat(tokenLength)}"`,
    byte: tokenLength / 2,
  },
  {
    name: `number of ${tokenLength} digits`,
    source: "1".repeat(tokenLength),
    byte: tokenLength / 2,
  },
  {
    name: `invalid number of ${tokenLength} digits`,
    source: `0x${"1".repeat(tokenLength)}`,
    byte: tokenLength / 2,
  },
  {
    name: `${tokenLength} repeated commas`,
    source: `[0${",".repeat(tokenLength)}]`,
    byte: 1,
  },
  {
    name: `arrays nested ${nestingDepth} levels`,
    source: `${"[".repeat(nestingDepth)}0${"]".repeat(nestingDepth)}`,
    byte: nestingDepth,
  },
  {
    name: `objects nested ${nestingDepth} levels`,
    source: `${objectPrefix.repeat(nestingDepth)}0${"}".repeat(nestingDepth)}`,
    byte: nestingDepth * objectPrefix.length,
  },
  {
    name: `unfinished containers nested ${unfinishedNestingDepth} levels`,
    source: `${mixedPrefix.repeat(unfinishedNestingDepth)}0`,
    byte: unfinishedNestingDepth * mixedPrefix.length,
  },
];

const cases = [...largeInputCases];
for (const { name, source, byte } of cases) {
  test(`editing ${name} preserves the public CST and ranges`, () => {
    assert.equal(parse(source).hasError, false);
    const edits = [{ byte, deleteBytes: 1, insert: "2" }];
    const fresh = parse(applyEdits(source, edits));
    const incremental = parse(source, edits);
    assert.equal(fresh.hasError, false);
    assert.equal(incremental.hasError, false);
    assert.deepEqual(incremental.nodes, fresh.nodes);
  });
}

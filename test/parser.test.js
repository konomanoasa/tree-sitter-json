import assert from "node:assert/strict";
import { test } from "node:test";
import { assertIncrementalEqualsFresh, parse } from "./support/parser.js";

test("every forbidden raw string control is rejected while its Unicode escape is accepted", () => {
  const controlLimit = 0x20;
  for (let codePoint = 0; codePoint < controlLimit; codePoint++) {
    const raw = `"a${String.fromCodePoint(codePoint)}b"`;
    assert.equal(parse(raw).hasError, true, `raw U+${codePoint.toString(16)}`);
    const escaped = `"a\\u${codePoint.toString(16).padStart(4, "0")}b"`;
    const tree = parse(escaped);
    assert.equal(tree.hasError, false, escaped);
    assert.equal(tree.nodes.filter(({ kind }) => kind === "hexdig").length, 4);
  }
});

test("layout is limited to the four JSON characters outside strings", () => {
  for (const character of [
    " ",
    "\t",
    "\n",
    "\r",
    "\v",
    "\f",
    "\0",
    "\u00a0",
    "\u2028",
    "\u2029",
    "\uFEFF",
  ]) {
    const allowed = [" ", "\t", "\n", "\r"].includes(character);
    for (const [before, after] of [
      ["[", "1]"],
      ['{"a"', ":1}"],
      ["1", ""],
    ]) {
      assert.equal(
        parse(before + character + after).hasError,
        !allowed,
        JSON.stringify({ before, character, after }),
      );
    }
  }
});

test("all number and literal token boundaries reject inserted whitespace", () => {
  for (const word of ["true", "false", "null", "-12.34E+56", "\\u1234"]) {
    for (let index = 1; index < word.length; index++) {
      const split = `${word.slice(0, index)} ${word.slice(index)}`;
      const source = word.startsWith("\\") ? `"${split}"` : split;
      assert.equal(parse(source).hasError, true, source);
    }
  }
});

test("truncated, overlong, surrogate and out-of-range UTF-8 sequences are rejected", () => {
  for (const invalid of [
    [0xc3],
    [0xe2, 0x82],
    [0xf0, 0x9f, 0x98],
    [0xc0, 0x80],
    [0xed, 0xa0, 0x80],
    [0xf4, 0x90, 0x80, 0x80],
    [0xff],
    [0x80],
  ]) {
    for (const [before, after] of [
      ['"', '"'],
      ['"', ""],
      ["[", "]"],
      ["1", ""],
    ]) {
      const source = Buffer.concat([
        Buffer.from(before),
        Buffer.from(invalid),
        Buffer.from(after),
      ]);
      assert.equal(parse(source).hasError, true, source.toString("hex"));
    }
  }
});

test("repairing missing syntax restores the normal CST", () => {
  for (const { initial, byte, insert, source } of [
    { initial: '{"a" 1}', byte: 4, insert: ":", source: '{"a": 1}' },
    { initial: '{"a":}', byte: 5, insert: "null", source: '{"a":null}' },
    { initial: "[1 2]", byte: 2, insert: ",", source: "[1, 2]" },
    { initial: '"\\u12"', byte: 5, insert: "34", source: '"\\u1234"' },
    { initial: "1e+", byte: 3, insert: "2", source: "1e+2" },
    { initial: '[{"a":1}', byte: 8, insert: "]", source: '[{"a":1}]' },
  ]) {
    assert.equal(parse(initial).hasError, true, initial);
    assert.equal(parse(source).hasError, false, source);
    assertIncrementalEqualsFresh(
      initial,
      [{ byte, deleteBytes: 0, insert }],
      source,
    );
  }
});

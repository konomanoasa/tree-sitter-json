import assert from "node:assert/strict";
import { test } from "node:test";
import JSONLanguage from "@konomanoasa/tree-sitter-json";
import Parser from "tree-sitter";

test("Node.js language parses JSON with the scanner and exposes node metadata", () => {
  const parser = new Parser();
  parser.setLanguage(JSONLanguage);
  const source = '{"a":[true,1,"x"]}';
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.type, "json_text");
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.text, source);
  assert.equal(tree.rootNode.descendantsOfType("syntax_issue").length, 0);
  assert.ok(
    JSONLanguage.nodeTypeInfo.some(
      (node) => node.type === "json_text" && node.named,
    ),
  );
});

test("Node.js packaged highlights capture JSON property names", () => {
  const parser = new Parser();
  parser.setLanguage(JSONLanguage);
  const tree = parser.parse('{"a":1}');
  const query = new Parser.Query(JSONLanguage, JSONLanguage.HIGHLIGHTS_QUERY);
  assert.deepEqual(
    query
      .captures(tree.rootNode)
      .filter(({ name }) => name === "property")
      .map(({ name, node }) => [name, node.text]),
    [["property", "a"]],
  );
});

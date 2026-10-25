import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  createTreeSitter,
  grammars,
  packageName,
  root,
} from "../scripts/tree-sitter.js";

const commandTimeoutMs = 60_000;
const firstThemeColor = 17;
const newlineByte = 0x0a;

function decodeEntities(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function renderedCaptures(html, source) {
  const start = html.indexOf("<pre><code>");
  const end = html.indexOf("</code></pre>");
  assert.ok(start >= 0 && end >= start, html);
  const content = html.slice(start + "<pre><code>".length, end);
  const stack = [];
  const captures = [];
  let text = "";
  for (const part of content.matchAll(
    /<span class='([^']*)'>|<[/]span>|([^<]+)/g,
  )) {
    if (part[1] !== undefined) stack.push(part[1].replaceAll(" ", "."));
    else if (part[0] === "</span>") assert.notEqual(stack.pop(), undefined);
    else {
      const decoded = decodeEntities(part[2]);
      text += decoded;
      captures.push(
        ...Array(Buffer.byteLength(decoded)).fill(stack.at(-1) ?? ""),
      );
    }
  }
  assert.equal(stack.length, 0, "unclosed highlight span");
  assert.equal(
    text.replace(/\n$/, ""),
    source.replace(/\n$/, ""),
    "rendered source differs from the input",
  );
  return captures;
}

function createHighlighter({ directory, root, run, captureNames }) {
  const parserDirectory = join(directory, "parsers");
  mkdirSync(parserDirectory);
  symlinkSync(root, join(parserDirectory, "tree-sitter-test"), "junction");
  const configPath = join(directory, "highlight.json");
  const capturePath = join(directory, "captures.txt");
  writeFileSync(
    configPath,
    JSON.stringify({
      "parser-directories": [parserDirectory],
      theme: Object.fromEntries(
        captureNames.map((name, index) => [name, index + firstThemeColor]),
      ),
    }),
  );
  writeFileSync(capturePath, `${captureNames.join("\n")}\n`);

  return (scope, source) => {
    const path = join(directory, "highlight.txt");
    writeFileSync(path, source);
    const parsed = run(["parse", "--cst", "--scope", scope, path]);
    assert.doesNotMatch(parsed, /^[0-9: \t-]+•/m, parsed);
    const captures = renderedCaptures(
      run([
        "highlight",
        "--check",
        "--captures-path",
        capturePath,
        "--config-path",
        configPath,
        "--html",
        "--layout",
        "fragment",
        "--style",
        "classes",
        "--scope",
        scope,
        path,
      ]),
      source,
    );
    for (const capture of captures) {
      assert.ok(
        capture === "" || captureNames.includes(capture),
        `unexpected final capture: ${capture}`,
      );
    }
    return captures;
  };
}

function assertCaptures(source, actual, ranges) {
  const bytes = Buffer.from(source);
  const expected = Array(bytes.length).fill("");
  let previousEnd = 0;
  for (const [start, end, capture] of ranges) {
    assert.ok(
      Number.isSafeInteger(start) && start >= previousEnd,
      "expected ranges must be ordered and disjoint",
    );
    assert.ok(
      Number.isSafeInteger(end) && end > start && end <= bytes.length,
      "expected range exceeds source bytes",
    );
    expected.fill(capture, start, end);
    previousEnd = end;
  }
  for (const [index, byte] of bytes.entries()) {
    if (byte !== newlineByte)
      assert.equal(
        actual[index],
        expected[index],
        `byte ${index} in ${JSON.stringify(source)}`,
      );
  }
}

const captureNames = [
  "boolean",
  "comment",
  "constant.builtin",
  "number",
  "property",
  "punctuation.bracket",
  "punctuation.delimiter",
  "string",
  "string.escape",
];
let highlight;

let directory;
let runner;
before(() => {
  directory = mkdtempSync(join(tmpdir(), `${packageName}-highlight-`));
  runner = createTreeSitter();
  highlight = createHighlighter({
    directory,
    root,
    run: assertCommand,
    captureNames,
  });
});
after(() => {
  try {
    runner?.close();
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function assertCommand(arguments_) {
  const result = runner.run(arguments_, {
    timeout: commandTimeoutMs,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Non-standard highlight captures/);
  return result.stdout;
}

const finalCaptureCases = [
  {
    name: "member names override string content while escapes keep their classification",
    source: '{"a\\n":"b\\u1234"}',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.delimiter"],
      [2, 3, "property"],
      [3, 5, "string.escape"],
      [5, 8, "punctuation.delimiter"],
      [8, 9, "string"],
      [9, 15, "string.escape"],
      [15, 16, "punctuation.delimiter"],
      [16, 17, "punctuation.bracket"],
    ],
  },
  {
    name: "all numeric components share number and literals keep distinct captures",
    source: "[-0.12E+3,true,false,null]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 9, "number"],
      [9, 10, "punctuation.delimiter"],
      [10, 14, "boolean"],
      [14, 15, "punctuation.delimiter"],
      [15, 20, "boolean"],
      [20, 21, "punctuation.delimiter"],
      [21, 25, "constant.builtin"],
      [25, 26, "punctuation.bracket"],
    ],
  },
  {
    name: "invalid leading plus signs retain their numeric role",
    source: "[+1,+,1e+]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "number"],
      [3, 4, "punctuation.delimiter"],
      [4, 5, "number"],
      [5, 6, "punctuation.delimiter"],
      [6, 9, "number"],
      [9, 10, "punctuation.bracket"],
    ],
  },
  {
    name: "invalid numeric names, unexpected values and commas keep leaf captures",
    source: "{1:0x12,} true",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "number"],
      [2, 3, "punctuation.delimiter"],
      [3, 4, "number"],
      [5, 7, "number"],
      [7, 8, "punctuation.delimiter"],
      [8, 9, "punctuation.bracket"],
      [10, 14, "boolean"],
    ],
  },
  {
    name: "invalid and incomplete escapes capture only confirmed prefix leaves",
    source: '["\\q","\\u12G","\\u1',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.delimiter"],
      [2, 3, "string.escape"],
      [4, 7, "punctuation.delimiter"],
      [7, 11, "string.escape"],
      [12, 15, "punctuation.delimiter"],
      [15, 18, "string.escape"],
    ],
  },
  {
    name: "zero-width issues add no captures and layout remains uncolored",
    source: '{"a" : [ 1e+ , ]',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.delimiter"],
      [2, 3, "property"],
      [3, 4, "punctuation.delimiter"],
      [5, 6, "punctuation.delimiter"],
      [7, 8, "punctuation.bracket"],
      [9, 12, "number"],
      [13, 14, "punctuation.delimiter"],
      [15, 16, "punctuation.bracket"],
    ],
  },
  {
    name: "all simple escapes include the backslash and escaped quote",
    source: '"\\"\\\\\\/\\b\\f\\n\\r\\t"',
    captures: [
      [0, 1, "punctuation.delimiter"],
      [1, 17, "string.escape"],
      [17, 18, "punctuation.delimiter"],
    ],
  },
  {
    name: "UTF-8 content and spaces use their owning string context",
    source: '{"é ":"😀 "}',
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 2, "punctuation.delimiter"],
      [2, 5, "property"],
      [5, 8, "punctuation.delimiter"],
      [8, 13, "string"],
      [13, 14, "punctuation.delimiter"],
      [14, 15, "punctuation.bracket"],
    ],
  },
];
for (const grammar of grammars) {
  for (const { name, source, captures } of finalCaptureCases) {
    test(`${grammar.name}: ${name}`, () =>
      assertCaptures(source, highlight(grammar.scope, source), captures));
  }
  if (grammar.name === "json") {
    test(`${grammar.name}: raw invalid text has no extension-language captures`, () => {
      const source = "/*comment*/ 'text' NaN";
      assertCaptures(source, highlight(grammar.scope, source), []);
    });
    continue;
  }
  for (const { name, source, captures } of [
    {
      name: "comment leaves and member leaves keep separate captures",
      source: '/*r*/{"a"/*n*/:1,/*t*/}',
      captures: [
        [0, 5, "comment"],
        [5, 6, "punctuation.bracket"],
        [6, 7, "punctuation.delimiter"],
        [7, 8, "property"],
        [8, 9, "punctuation.delimiter"],
        [9, 14, "comment"],
        [14, 15, "punctuation.delimiter"],
        [15, 16, "number"],
        [16, 17, "punctuation.delimiter"],
        [17, 22, "comment"],
        [22, 23, "punctuation.bracket"],
      ],
    },
    {
      name: "unfinished comment captures actual marker and text only",
      source: '1/* "x',
      captures: [
        [0, 1, "number"],
        [1, 6, "comment"],
      ],
    },
    {
      name: "line-comment newline remains layout",
      source: "//x\n1",
      captures: [
        [0, 3, "comment"],
        [4, 5, "number"],
      ],
    },
    {
      name: "comment markers in strings keep their string classification",
      source: '"/*x*/"',
      captures: [
        [0, 1, "punctuation.delimiter"],
        [1, 6, "string"],
        [6, 7, "punctuation.delimiter"],
      ],
    },
  ]) {
    test(`${grammar.name}: ${name}`, () =>
      assertCaptures(source, highlight(grammar.scope, source), captures));
  }
}

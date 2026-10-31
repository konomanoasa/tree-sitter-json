import assert from "node:assert/strict";

const newlineByte = 0x0a;

function publicNodes(cst, bytes) {
  const starts = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === newlineByte) starts.push(index + 1);
  }
  const nodes = [];
  const ancestors = [];
  for (const line of cst.split("\n")) {
    const position = /^([0-9]+):([0-9]+) +- +([0-9]+):([0-9]+) +/.exec(line);
    if (!position) continue;
    const [location, startRow, startColumn, endRow, endColumn] = position;
    const body = line.slice(location.length);
    const match =
      /^(([a-z_0-9]+): )?•?([a-z_0-9]+|ERROR|MISSING|"([^"\\]|\\.)*")/.exec(
        body,
      );
    if (!match) continue;
    const [, , field, kind] = match;
    const depth = location.length + (body.startsWith("•") ? 1 : 0);
    while (ancestors.length && ancestors.at(-1).depth >= depth) ancestors.pop();
    const parent = ancestors.at(-1)?.index ?? null;
    if (kind === "ERROR" || kind === "MISSING") {
      ancestors.push({ depth, index: parent });
      continue;
    }
    const named = !kind.startsWith('"');
    const start = starts[Number(startRow)] + Number(startColumn);
    const end = starts[Number(endRow)] + Number(endColumn);
    nodes.push({
      kind: named ? kind : JSON.parse(kind),
      named,
      field: field ?? null,
      parent,
      start,
      end,
    });
    ancestors.push({ depth, index: nodes.length - 1 });
  }
  return nodes;
}

function issues(nodes, cst) {
  return nodes.flatMap((node, index) => {
    if (node.kind !== "syntax_issue") return [];
    const outcome = nodes[index + 1];
    const reason = nodes[index + 2];
    assert.equal(node.field, "issue", cst);
    assert.equal(outcome.parent, index);
    assert.equal(reason.parent, index + 1);
    assert.ok(["invalid_syntax", "incomplete_syntax"].includes(outcome.kind));
    assert.deepEqual(
      [outcome.start, outcome.end, reason.start, reason.end],
      [node.start, node.end, node.start, node.end],
    );
    return [
      [
        nodes[node.parent].kind,
        outcome.kind,
        reason.kind,
        node.start,
        node.end,
      ],
    ];
  });
}

function parseCst(cst, source) {
  const bytes = Buffer.from(source);
  const root =
    /^[0-9]+:[0-9]+ +- +([0-9]+):([0-9]+) +•?(json_text|ERROR)( |\n|$)/.exec(
      cst,
    );
  assert.ok(root, cst);
  let row = 0;
  for (const byte of bytes) if (byte === newlineByte) row += 1;
  assert.deepEqual(
    root.slice(1, 3).map(Number),
    [row, bytes.length - bytes.lastIndexOf(newlineByte) - 1],
    "root must reach the edited source end",
  );
  const nodes = publicNodes(cst, bytes);
  return {
    cst,
    nodes,
    issues: issues(nodes, cst),
    // CLI status misses hidden missing tokens.
    hasError: /^[^ \t\r\n]+[ \t]+-[ \t]+[^ \t\r\n]+[ \t]+•/.test(cst),
  };
}

export { parseCst };

import assert from "node:assert/strict";

function parseCst(cst, source) {
  const bytes = Buffer.from(source);
  assert.match(cst, /^[0-9]+:[0-9]+ +- +[0-9]+:[0-9]+ +•?(json_text|ERROR)/);
  const hasError = /^[0-9]+:[0-9]+ +- +[0-9]+:[0-9]+ +•/.test(cst);
  if (hasError) return { cst, nodes: [], hasError };
  const starts = [0];
  for (const [index, byte] of bytes.entries()) {
    if (byte === 0x0a) starts.push(index + 1);
  }
  const nodes = [];
  const ancestors = [];
  for (const line of cst.split("\n")) {
    const position = /^([0-9]+):([0-9]+) +- +([0-9]+):([0-9]+) +/.exec(line);
    if (!position) continue;
    const [location, startRow, startColumn, endRow, endColumn] = position;
    let body = line.slice(location.length);
    const depth = location.length;
    const field = /^([a-z_0-9]+): /.exec(body);
    if (field) body = body.slice(field[0].length);
    const match = /^([a-z_0-9]+|ERROR|"([^"\\]|\\.)*")/.exec(body);
    if (!match) continue;
    const named = !body.startsWith('"');
    const kind = named ? match[0] : JSON.parse(match[0]);
    while (ancestors.length && ancestors.at(-1).depth >= depth) ancestors.pop();
    const start = starts[Number(startRow)] + Number(startColumn);
    const end = starts[Number(endRow)] + Number(endColumn);
    assert.ok(start >= 0 && start <= end && end <= bytes.length, line);
    const parent = ancestors.at(-1)?.index ?? null;
    if (parent !== null) {
      assert.ok(nodes[parent].start <= start && end <= nodes[parent].end, line);
    }
    nodes.push({ kind, named, field: field?.[1] ?? null, parent, start, end });
    ancestors.push({ depth, index: nodes.length - 1 });
  }
  assert.ok(nodes.length, cst);
  assert.ok(["json_text", "ERROR"].includes(nodes[0].kind), cst);
  assert.equal(nodes[0].end, bytes.length, "root must reach the source end");
  return { cst, nodes, hasError };
}

export { parseCst };

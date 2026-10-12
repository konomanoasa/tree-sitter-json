import assert from "node:assert/strict";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    const languages = [];
    for (const attribute of attributes) {
      const language = /^:language\(([a-z_0-9]+)\)$/.exec(attribute);
      if (language) languages.push(language[1]);
      else
        assert.equal(
          attribute,
          ":cst",
          `unsupported corpus attribute: ${attribute}`,
        );
    }
    assert.ok(languages.length, `${name}: corpus must specify its languages`);
    assert.equal(
      new Set(languages).size,
      languages.length,
      `${name}: repeated language`,
    );
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source, languages });
  }
  return cases;
}

export { parseCorpus };

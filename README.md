# tree-sitter-json

[![CI](https://github.com/konomanoasa/tree-sitter-json/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-json/actions/workflows/ci.yaml)
[![crates.io](https://img.shields.io/crates/v/konomanoasa-tree-sitter-json)](https://crates.io/crates/konomanoasa-tree-sitter-json)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-json)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-json)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammars for
JSON and JSON with comments.

## Grammars

| Grammar | Language |
| ------- | -------- |
| `json`  | JSON     |
| `jsonc` | JSONC    |

## Parsing Option

For JSONC with trailing commas, use `jsonc_trailing`.

## Installation

```sh
npm install @konomanoasa/tree-sitter-json
```

## Development

```sh
npm install
npm run build
npm test
```

## Specifications

- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259.html)
- [ECMA-404, second edition](https://ecma-international.org/publications-and-standards/standards/ecma-404/)
- [JSONC draft](https://jsonc.org/)

## Used By

[json-ts-mode](https://github.com/konomanoasa/json-ts-mode)

## License

[MIT](LICENSE)

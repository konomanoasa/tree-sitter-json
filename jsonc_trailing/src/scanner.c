#define JSON_COMMENTS 1
#define JSON_TRAILING 1
#include "../../common/scanner.h"

void *tree_sitter_jsonc_trailing_external_scanner_create(void) {
  return json_scanner_create();
}

void tree_sitter_jsonc_trailing_external_scanner_destroy(void *payload) {
  json_scanner_destroy(payload);
}

unsigned tree_sitter_jsonc_trailing_external_scanner_serialize(
  void *payload,
  char *buffer
) {
  return json_scanner_serialize(payload, buffer);
}

void tree_sitter_jsonc_trailing_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  json_scanner_deserialize(payload, buffer, length);
}

bool tree_sitter_jsonc_trailing_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  return json_scanner_scan(payload, lexer, valid_symbols);
}

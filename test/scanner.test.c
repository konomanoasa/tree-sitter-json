#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include JSON_SCANNER_SOURCE

#define COUNT(array) (sizeof(array) / sizeof((array)[0]))

#define SCANNER_FUNCTION_RAW(prefix, name) prefix##_##name
#define SCANNER_FUNCTION(prefix, name) SCANNER_FUNCTION_RAW(prefix, name)
#define scanner_function(name) SCANNER_FUNCTION(JSON_SCANNER_PREFIX, name)

struct MockLexer {
  TSLexer lexer;
  const int32_t *input;
  size_t length;
  size_t offset;
  size_t mark;
};

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  struct MockLexer *mock = (struct MockLexer *)lexer;
  if (mock->offset < mock->length) {
    mock->offset += 1;
  }
  lexer->lookahead =
    mock->offset < mock->length ? mock->input[mock->offset] : 0;
}

static void mock_mark_end(TSLexer *lexer) {
  struct MockLexer *mock = (struct MockLexer *)lexer;
  mock->mark = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const struct MockLexer *mock = (const struct MockLexer *)lexer;
  return mock->offset == mock->length;
}

static void
init_mock_lexer(struct MockLexer *mock, const int32_t *input, size_t length) {
  *mock = (struct MockLexer){
    .lexer =
      {
        .lookahead = length == 0 ? 0 : input[0],
        .result_symbol = UINT16_MAX,
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .eof = mock_eof,
      },
    .input = input,
    .length = length,
    .mark = SIZE_MAX,
  };
}

static void test_stateless_lifecycle_and_serialization(void) {
  enum { SENTINEL_BYTE = 0x5a };
  void *scanner = scanner_function(create)();
  assert(scanner == NULL);
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
  memset(buffer, SENTINEL_BYTE, sizeof(buffer));
  assert(scanner_function(serialize)(scanner, buffer) == 0);
  for (size_t index = 0; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == SENTINEL_BYTE);
  }
  scanner_function(deserialize)(scanner, NULL, 0);
  scanner_function(deserialize)(scanner, buffer, sizeof(buffer));
  scanner_function(destroy)(scanner);
}

static void test_eof_issues_do_not_consume_source(void) {
  struct MockLexer mock;
  init_mock_lexer(&mock, NULL, 0);
  bool valid[TOKEN_COUNT] = {false};
  valid[INCOMPLETE_MISSING_ARRAY_CLOSE] = true;
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INCOMPLETE_MISSING_ARRAY_CLOSE);
  assert(mock.mark == 0);
  valid[ERROR_SENTINEL] = true;
  assert(!scanner_function(scan)(NULL, &mock.lexer, valid));
}

static void test_escape_lookahead_preserves_the_token_start(void) {
  const int32_t input[] = {'\\', 'u', '1', '2', '"'};
  const size_t input_length = COUNT(input);
  struct MockLexer mock;
  init_mock_lexer(&mock, input, input_length);
  bool valid[TOKEN_COUNT] = {false};
  valid[ESCAPE_START] = true;
  valid[INVALID_ESCAPE_START] = true;
  valid[INCOMPLETE_ESCAPE_START] = true;
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_ESCAPE_START);
  assert(mock.offset == input_length);
  assert(mock.mark == 0);
  init_mock_lexer(&mock, input, input_length - 1);
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INCOMPLETE_ESCAPE_START);
  assert(mock.mark == 0);
}

static void test_comma_token_excludes_layout_and_later_commas(void) {
  const int32_t input[] = {',', ' ', ',', '\n', ']'};
  const size_t input_length = COUNT(input);
  struct MockLexer mock;
  init_mock_lexer(&mock, input, input_length);
  bool valid[TOKEN_COUNT] = {false};
  valid[COMMA] = true;
  valid[EXTRA_COMMA] = true;
  valid[INCOMPLETE_MISSING_ARRAY_CLOSE] = true;
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == (JSON_TRAILING ? COMMA : EXTRA_COMMA));
  assert(mock.offset == (JSON_TRAILING ? 1 : input_length));
  assert(mock.mark == 1);
}

static void test_literal_boundaries_and_prefixes(void) {
  const int32_t input[] = {'t', 'r', 'u', ' '};
  const size_t input_length = COUNT(input);
  const size_t prefix_length = input_length - 1;
  struct MockLexer mock;
  bool valid[TOKEN_COUNT] = {false};
  valid[TRUE] = true;
  valid[INVALID_VALUE] = true;
  valid[INCOMPLETE_VALUE] = true;
  init_mock_lexer(&mock, input, prefix_length);
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INCOMPLETE_VALUE);
  assert(mock.mark == prefix_length);
  init_mock_lexer(&mock, input, input_length);
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_VALUE);
  assert(mock.mark == prefix_length);
}

static void test_nul_is_a_real_control_character_not_eof(void) {
  const int32_t input[] = {0};
  struct MockLexer mock;
  init_mock_lexer(&mock, input, COUNT(input));
  bool valid[TOKEN_COUNT] = {false};
  valid[INVALID_STRING_CHARACTER] = true;
  valid[INCOMPLETE_MISSING_STRING_CLOSE] = true;
  assert(scanner_function(scan)(NULL, &mock.lexer, valid));
  assert(mock.lexer.result_symbol == INVALID_STRING_CHARACTER);
  assert(mock.mark == 1);
}

int main(void) {
  test_stateless_lifecycle_and_serialization();
  test_eof_issues_do_not_consume_source();
  test_escape_lookahead_preserves_the_token_start();
  test_comma_token_excludes_layout_and_later_commas();
  test_literal_boundaries_and_prefixes();
  test_nul_is_a_real_control_character_not_eof();
  return 0;
}

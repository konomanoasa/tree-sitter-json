#include "tree_sitter/parser.h"

enum TokenType {
  NUMBER_START,
  NUMBER_END,
  UNESCAPED,
  DIGIT,
  DIGIT1_9,
  HEXDIG,
  TRUE,
  FALSE,
  NULL_TOKEN,
  MINUS,
  ESCAPE_START,
  INVALID_ESCAPE_START,
  INCOMPLETE_ESCAPE_START,
  UNDECODABLE_ESCAPE_START,
  BAD_ESCAPE_CHARACTER,
  BAD_ESCAPE_END,
  COMMA,
  NAME_SEPARATOR,
  INVALID_ZERO_SUFFIX_END,
  UNDECODABLE_WORD_PREFIX,
  WORD_FRAGMENT,
  WORD_END,
  MEMBER_VALUE_START,
  BARE_MEMBER_NAME,
  INVALID_MISSING_VALUE,
  INCOMPLETE_MISSING_VALUE,
  INVALID_MISSING_NAME_SEPARATOR,
  INCOMPLETE_MISSING_NAME_SEPARATOR,
  INVALID_MISSING_OBJECT_CLOSE,
  INCOMPLETE_MISSING_OBJECT_CLOSE,
  INVALID_MISSING_ARRAY_CLOSE,
  INCOMPLETE_MISSING_ARRAY_CLOSE,
  INVALID_MISSING_STRING_CLOSE,
  INCOMPLETE_MISSING_STRING_CLOSE,
  INVALID_MISSING_DIGITS,
  INCOMPLETE_MISSING_DIGITS,
  INCOMPLETE_MISSING_MEMBER,
  INVALID_MISSING_MEMBER_NAME,
  MISSING_OBJECT_SEPARATOR,
  MISSING_ARRAY_SEPARATOR,
  INVALID_VALUE,
  INCOMPLETE_VALUE,
  INVALID_CHARACTER,
  INVALID_STRING_CHARACTER,
  INVALID_CONTROL_CHARACTER,
  EXTRA_COMMA,
  PLUS,
  INVALID_INT,
  INVALID_FRAC,
  INVALID_EXP,
  INVALID_ENCODING,
  INVALID_WORD_PREFIX,
  ERROR_SENTINEL,
  TOKEN_COUNT
};

static const int32_t DECODE_ERROR = -1;

enum NumberPart { INT_PART, FRAC_PART, EXP_PART, NO_PART };

static const unsigned INVALID_RUNS[] = {INVALID_INT, INVALID_FRAC, INVALID_EXP};

static inline bool space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

static inline bool line_end(int32_t c) {
  return c == '\r' || c == '\n';
}

static inline bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}

static inline bool hex(int32_t c) {
  return digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static inline bool starts_number(int32_t c) {
  return digit(c) || c == '-' || c == '+' || c == '.';
}

static inline bool control(TSLexer *l) {
  return !l->eof(l) && l->lookahead >= 0 && l->lookahead < 0x20;
}

static inline bool boundary(TSLexer *l) {
  const int32_t c = l->lookahead;
  return l->eof(l) ||
    space(c) ||
    c == '"' ||
    c == '[' ||
    c == ']' ||
    c == '{' ||
    c == '}' ||
    c == ',' ||
    c == ':';
}

static inline bool part_end(TSLexer *l, enum NumberPart part) {
  return boundary(l) ||
    (part != EXP_PART && (l->lookahead == 'e' || l->lookahead == 'E')) ||
    (part == INT_PART && l->lookahead == '.');
}

static inline enum NumberPart number_part(const bool *v) {
  enum NumberPart part = INT_PART;
  while (part != NO_PART && !v[INVALID_RUNS[part]]) part++;
  return part;
}

static inline bool ends_escape(TSLexer *l) {
  const int32_t c = l->lookahead;
  return l->eof(l) || c == '"' || c == '\\' || line_end(c);
}

static inline unsigned first_valid(const bool *v, const unsigned *tokens) {
  while (*tokens != TOKEN_COUNT && !v[*tokens]) tokens++;
  return *tokens;
}

static inline bool finish(TSLexer *l, unsigned token) {
  l->result_symbol = token;
  return true;
}

static inline bool emit(TSLexer *l, unsigned token) {
  l->mark_end(l);
  return finish(l, token);
}

static inline bool finish_lookahead(TSLexer *l, unsigned token) {
  // Continuation-byte edits can change the decoded lookahead character.
  if (!l->eof(l)) l->advance(l, false);
  return finish(l, token);
}

static inline bool emit_zero_width(TSLexer *l, unsigned token) {
  l->mark_end(l);
  return finish_lookahead(l, token);
}

static inline bool take(TSLexer *l, unsigned token) {
  l->advance(l, false);
  return emit(l, token);
}

static inline bool
take_controls(TSLexer *l, unsigned token, bool (*stop)(int32_t)) {
  do {
    l->advance(l, false);
  } while (control(l) && !stop(l->lookahead));
  return emit(l, token);
}

static inline bool
missing(TSLexer *l, const bool *v, unsigned invalid, unsigned incomplete) {
  const unsigned token = l->eof(l) ? incomplete : invalid;
  return v[token] && emit_zero_width(l, token);
}

static inline bool skip_member_gap(TSLexer *l) {
  for (;;) {
    while (space(l->lookahead)) l->advance(l, false);
    if (!control(l) && l->lookahead != DECODE_ERROR) return true;
    l->advance(l, false);
  }
}

static inline bool closes_container(int32_t c, const bool *v) {
  return (c == ']' &&
           (v[INCOMPLETE_MISSING_ARRAY_CLOSE] ||
             v[INVALID_MISSING_OBJECT_CLOSE])) ||
    (c == '}' &&
      (v[INCOMPLETE_MISSING_OBJECT_CLOSE] || v[INVALID_MISSING_ARRAY_CLOSE]));
}

static inline bool stray(int32_t c, const bool *v) {
  if (c == ',') return true;
  if (c == ':')
    return !v[INVALID_MISSING_MEMBER_NAME] && !v[MISSING_OBJECT_SEPARATOR];
  return (c == ']' || c == '}') && !closes_container(c, v);
}

static inline bool member_follows(TSLexer *l) {
  if (l->lookahead == '"') {
    l->advance(l, false);
    while (!l->eof(l) && !line_end(l->lookahead)) {
      if (l->lookahead == '"') {
        l->advance(l, false);
        break;
      }
      if (l->lookahead == '\\') {
        l->advance(l, false);
        if (l->eof(l) || line_end(l->lookahead)) break;
      }
      l->advance(l, false);
    }
  } else {
    if (boundary(l)) return false;
    while (!boundary(l)) l->advance(l, false);
  }
  return skip_member_gap(l) && l->lookahead == ':';
}

static inline bool start_member_value(TSLexer *l) {
  return finish_lookahead(
    l,
    member_follows(l) ? INVALID_MISSING_VALUE : MEMBER_VALUE_START
  );
}

struct Word {
  bool empty;
  unsigned literal;
  bool complete;
};

static inline struct Word read_word(TSLexer *l) {
  struct Word word = {true, TOKEN_COUNT, false};
  const char *rest = "";
  switch (l->lookahead) {
    case 't':
      word.literal = TRUE;
      rest = "true";
      break;
    case 'f':
      word.literal = FALSE;
      rest = "false";
      break;
    case 'n':
      word.literal = NULL_TOKEN;
      rest = "null";
      break;
  }
  while (!boundary(l) && l->lookahead != DECODE_ERROR) {
    if (*rest && *rest == l->lookahead) rest++;
    else word.literal = TOKEN_COUNT;
    l->advance(l, false);
    word.empty = false;
  }
  l->mark_end(l);
  word.complete = word.literal != TOKEN_COUNT && !*rest;
  return word;
}

static inline bool scan_word(TSLexer *l, const bool *v) {
  const struct Word word = read_word(l);
  if (word.empty) return false;
  if (
    l->lookahead == DECODE_ERROR &&
    (v[UNDECODABLE_WORD_PREFIX] || v[INVALID_WORD_PREFIX])
  ) {
    const unsigned token = word.literal == TOKEN_COUNT
      ? INVALID_WORD_PREFIX
      : UNDECODABLE_WORD_PREFIX;
    return v[token] && finish_lookahead(l, token);
  }
  if (word.complete && v[word.literal]) return finish(l, word.literal);
  unsigned token = word.literal != TOKEN_COUNT && !word.complete && l->eof(l)
    ? INCOMPLETE_VALUE
    : INVALID_VALUE;
  if (!v[BARE_MEMBER_NAME]) return v[token] && finish(l, token);
  if (skip_member_gap(l) && l->lookahead == ':') token = BARE_MEMBER_NAME;
  return v[token] && finish_lookahead(l, token);
}

static inline bool scan_word_fragment(TSLexer *l) {
  return !read_word(l).empty && finish_lookahead(l, WORD_FRAGMENT);
}

static inline bool scan_invalid_run(TSLexer *l, enum NumberPart part) {
  while (
    !part_end(l, part) && !digit(l->lookahead) && l->lookahead != DECODE_ERROR
  )
    l->advance(l, false);
  return emit(l, INVALID_RUNS[part]);
}

static inline bool scan_decode_errors(TSLexer *l, const bool *v) {
  if (l->lookahead != DECODE_ERROR || !v[INVALID_ENCODING]) return false;
  do {
    l->advance(l, false);
  } while (l->lookahead == DECODE_ERROR);
  l->mark_end(l);
  return finish_lookahead(l, INVALID_ENCODING);
}

static inline bool scan_escape_start(TSLexer *l, const bool *v) {
  l->mark_end(l);
  l->advance(l, false);
  unsigned token = INVALID_ESCAPE_START;
  if (l->eof(l)) {
    token = INCOMPLETE_ESCAPE_START;
  } else if (l->lookahead == 'u') {
    l->advance(l, false);
    unsigned count = 0;
    while (count < 4 && hex(l->lookahead)) {
      l->advance(l, false);
      count++;
    }
    if (count == 4) token = ESCAPE_START;
    else if (l->eof(l)) token = INCOMPLETE_ESCAPE_START;
  } else {
    switch (l->lookahead) {
      case '"':
      case '\\':
      case '/':
      case 'b':
      case 'f':
      case 'n':
      case 'r':
      case 't':
        token = ESCAPE_START;
        break;
    }
  }
  if (token == INVALID_ESCAPE_START && l->lookahead == DECODE_ERROR)
    token = UNDECODABLE_ESCAPE_START;
  return v[token] && finish_lookahead(l, token);
}

static inline bool scan_comma(TSLexer *l, const bool *v) {
  if (!v[COMMA]) return take(l, EXTRA_COMMA);
  l->advance(l, false);
  l->mark_end(l);
  unsigned token = COMMA;
  while (skip_member_gap(l)) {
    if (closes_container(l->lookahead, v)) {
      token = EXTRA_COMMA;
      break;
    }
    if (!stray(l->lookahead, v)) break;
    l->advance(l, false);
  }
  return v[token] && finish_lookahead(l, token);
}

static inline bool scan_member_value_start(TSLexer *l, const bool *v) {
  const int32_t c = l->lookahead;
  if (
    !v[MEMBER_VALUE_START] ||
    c <= ' ' ||
    c == ']' ||
    c == '}' ||
    c == ',' ||
    c == ':'
  )
    return false;
  l->mark_end(l);
  return start_member_value(l);
}

static inline bool scan_word_tail(TSLexer *l, const bool *v) {
  if (v[WORD_END] && boundary(l)) return emit_zero_width(l, WORD_END);
  return v[WORD_FRAGMENT] && scan_word_fragment(l);
}

static inline bool scan_string(TSLexer *l, const bool *v) {
  const int32_t c = l->lookahead;
  if (v[HEXDIG] && hex(c)) return take(l, HEXDIG);
  if (v[BAD_ESCAPE_END] && (!v[BAD_ESCAPE_CHARACTER] || ends_escape(l)))
    return emit_zero_width(l, BAD_ESCAPE_END);
  if (v[BAD_ESCAPE_CHARACTER] && !ends_escape(l) && (c != 'u' || v[HEXDIG]))
    return take(l, BAD_ESCAPE_CHARACTER);
  if (v[UNESCAPED] && c >= 0x20 && c != '"' && c != '\\')
    return take(l, UNESCAPED);
  if (v[INVALID_STRING_CHARACTER] && control(l) && !line_end(c))
    return take_controls(l, INVALID_STRING_CHARACTER, line_end);
  return (l->eof(l) || line_end(c)) &&
    missing(
      l,
      v,
      INVALID_MISSING_STRING_CLOSE,
      INCOMPLETE_MISSING_STRING_CLOSE
    );
}

static inline bool scan_number(TSLexer *l, const bool *v) {
  const int32_t c = l->lookahead;
  if (v[NUMBER_START] && starts_number(c))
    return emit_zero_width(l, NUMBER_START);
  if (v[NUMBER_END] && boundary(l)) return emit_zero_width(l, NUMBER_END);
  if (
    v[INVALID_ZERO_SUFFIX_END] && (part_end(l, INT_PART) || c == DECODE_ERROR)
  )
    return emit_zero_width(l, INVALID_ZERO_SUFFIX_END);
  if (v[MINUS] && c == '-') return take(l, MINUS);
  if (v[PLUS] && c == '+') return take(l, PLUS);
  if (v[DIGIT] && digit(c)) return take(l, DIGIT);
  if (v[DIGIT1_9] && c >= '1' && c <= '9') return take(l, DIGIT1_9);
  const enum NumberPart part = number_part(v);
  if (part == NO_PART || digit(c) || c == DECODE_ERROR) return false;
  if (part_end(l, part))
    return missing(l, v, INVALID_MISSING_DIGITS, INCOMPLETE_MISSING_DIGITS);
  return scan_invalid_run(l, part);
}

static inline bool scan_structure(TSLexer *l, const bool *v) {
  static const unsigned unfinished[] = {
    INCOMPLETE_MISSING_MEMBER,
    INCOMPLETE_MISSING_ARRAY_CLOSE,
    INCOMPLETE_MISSING_OBJECT_CLOSE,
    TOKEN_COUNT
  };
  const int32_t c = l->lookahead;
  if (space(c)) return false;
  if (c == ':' && v[NAME_SEPARATOR]) return take(l, NAME_SEPARATOR);
  if (v[INVALID_CHARACTER] && stray(c, v)) return take(l, INVALID_CHARACTER);
  if (v[INVALID_CONTROL_CHARACTER] && control(l))
    return take_controls(l, INVALID_CONTROL_CHARACTER, space);
  if (
    c != ':' &&
    missing(
      l,
      v,
      INVALID_MISSING_NAME_SEPARATOR,
      INCOMPLETE_MISSING_NAME_SEPARATOR
    )
  )
    return true;
  if (
    (l->eof(l) || c == ']' || c == '}' || c == ',' || c == ':') &&
    missing(l, v, INVALID_MISSING_VALUE, INCOMPLETE_MISSING_VALUE)
  )
    return true;
  if (l->eof(l)) {
    const unsigned token = first_valid(v, unfinished);
    return token != TOKEN_COUNT && emit_zero_width(l, token);
  }
  if (c == ']' && v[INVALID_MISSING_OBJECT_CLOSE])
    return emit_zero_width(l, INVALID_MISSING_OBJECT_CLOSE);
  if (c == '}' && v[INVALID_MISSING_ARRAY_CLOSE])
    return emit_zero_width(l, INVALID_MISSING_ARRAY_CLOSE);
  if (c > ' ' && c != ']' && c != '}' && c != ',') {
    if (v[MISSING_OBJECT_SEPARATOR])
      return emit_zero_width(l, MISSING_OBJECT_SEPARATOR);
    if (v[MISSING_ARRAY_SEPARATOR])
      return emit_zero_width(l, MISSING_ARRAY_SEPARATOR);
  }
  return c == ':' &&
    v[INVALID_MISSING_MEMBER_NAME] &&
    emit_zero_width(l, INVALID_MISSING_MEMBER_NAME);
}

static inline bool scan_value_word(TSLexer *l, const bool *v) {
  return (v[TRUE] ||
           v[FALSE] ||
           v[NULL_TOKEN] ||
           v[INVALID_VALUE] ||
           v[INCOMPLETE_VALUE] ||
           v[BARE_MEMBER_NAME]) &&
    !boundary(l) &&
    !starts_number(l->lookahead) &&
    scan_word(l, v);
}

static inline bool scan(TSLexer *l, const bool *v) {
  if (v[ERROR_SENTINEL]) return false;
  const int32_t c = l->lookahead;
  if (c == '\\' && v[ESCAPE_START]) return scan_escape_start(l, v);
  if (c == ',' && (v[COMMA] || v[EXTRA_COMMA])) return scan_comma(l, v);
  // Failure must leave input untouched.
  return scan_member_value_start(l, v) ||
    scan_decode_errors(l, v) ||
    scan_word_tail(l, v) ||
    scan_string(l, v) ||
    scan_number(l, v) ||
    scan_structure(l, v) ||
    scan_value_word(l, v);
}

void *tree_sitter_json_external_scanner_create(void) {
  return NULL;
}
void tree_sitter_json_external_scanner_destroy(void *payload) {
  (void)payload;
}
unsigned
tree_sitter_json_external_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}
void tree_sitter_json_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  (void)payload;
  (void)buffer;
  (void)length;
}
bool tree_sitter_json_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid_symbols
) {
  (void)payload;
  return scan(lexer, valid_symbols);
}

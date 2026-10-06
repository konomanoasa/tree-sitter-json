#ifndef TREE_SITTER_JSON_SCANNER_H
#define TREE_SITTER_JSON_SCANNER_H

#include "tree_sitter/parser.h"

#ifndef JSON_COMMENTS
#define JSON_COMMENTS 0
#endif

#ifndef JSON_TRAILING
#define JSON_TRAILING 0
#endif

enum TokenType {
  NUMBER_START,
  INT_END,
  FRAC_END,
  EXP_END,
  NUMBER_END,
  UNESCAPED,
  DIGIT,
  DIGIT1_9,
  HEXDIG,
  TRUE,
  FALSE,
  NULL_TOKEN,
  ESCAPE_START,
  INVALID_ESCAPE_START,
  INCOMPLETE_ESCAPE_START,
  BAD_ESCAPE_CHARACTER,
  BAD_ESCAPE_END,
  COMMA,
  EXP_PLUS,
  EXP_MINUS,
  NAME_SEPARATOR,
  INVALID_INT_START,
  INVALID_INT_CHARACTER,
  INVALID_INT_END,
  INVALID_FRAC_START,
  INVALID_FRAC_CHARACTER,
  INVALID_FRAC_END,
  INVALID_EXP_START,
  INVALID_EXP_CHARACTER,
  INVALID_EXP_END,
  UNDECODABLE_ESCAPE_START,
  INVALID_ZERO_SUFFIX_START,
  INVALID_ZERO_SUFFIX_END,
  SINGLE_LINE_COMMENT_TEXT,
  MULTI_LINE_COMMENT_TEXT,
  UNDECODABLE_WORD_PREFIX,
  WORD_FRAGMENT,
  WORD_END,
  MEMBER_VALUE_START,
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
  BARE_MEMBER_NAME,
  EXTRA_COMMA,
  INVALID_PLUS,
  INVALID_ENCODING,
  INVALID_NUMBER_ENCODING,
  INVALID_WORD_ENCODING,
  INVALID_WORD_PREFIX,
  INCOMPLETE_COMMENT,
  INCOMPLETE_MISSING_COMMENT_CLOSE,
  ERROR_SENTINEL,
  TOKEN_COUNT
};

static bool space(int32_t c) {
  return c == ' ' || c == '\t' || c == '\r' || c == '\n';
}

static bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}

static bool hex(int32_t c) {
  return digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
}

static bool skip_comment(TSLexer *l) {
  if (l->lookahead == '/') {
    do {
      l->advance(l, false);
    } while (!l->eof(l) && l->lookahead != '\r' && l->lookahead != '\n');
    return true;
  }
  if (l->lookahead != '*')
    return false;
  l->advance(l, false);
  while (!l->eof(l)) {
    if (l->lookahead == '*') {
      l->advance(l, false);
      if (l->lookahead == '/') {
        l->advance(l, false);
        return true;
      }
    } else {
      l->advance(l, false);
    }
  }
  return true;
}

static bool skip_layout(TSLexer *l) {
  for (;;) {
    while (space(l->lookahead) && !l->eof(l))
      l->advance(l, false);
    if (!JSON_COMMENTS || l->lookahead != '/')
      return true;
    l->advance(l, false);
    if (!skip_comment(l))
      return false;
  }
}

static bool skip_member_gap(TSLexer *l) {
  bool layout;
  while ((layout = skip_layout(l)) && !l->eof(l) && l->lookahead < 0x20)
    l->advance(l, false);
  return layout;
}

static bool boundary(TSLexer *l) {
  const int32_t c = l->lookahead;
  return l->eof(l) ||
    space(c) ||
    c ==
    '"' ||
    c ==
    '[' ||
    c ==
    ']' ||
    c ==
    '{' ||
    c ==
    '}' ||
    c ==
    ',' ||
    c == ':';
}

static bool part_end(TSLexer *l, unsigned part) {
  return boundary(l) ||
    (part < 2 && (l->lookahead == 'e' || l->lookahead == 'E')) ||
    (part == 0 && l->lookahead == '.');
}

static bool closes_container(int32_t c, const bool *v) {
  return (c ==
           ']' &&
           (v[INCOMPLETE_MISSING_ARRAY_CLOSE] ||
             v[INVALID_MISSING_OBJECT_CLOSE])) ||
    (c ==
      '}' &&
      (v[INCOMPLETE_MISSING_OBJECT_CLOSE] || v[INVALID_MISSING_ARRAY_CLOSE]));
}

static bool stray(int32_t c, const bool *v) {
  if (c == ':')
    return !v[INVALID_MISSING_MEMBER_NAME] && !v[MISSING_OBJECT_SEPARATOR];
  return (c == ']' || c == '}') && !closes_container(c, v);
}

static bool member_follows(TSLexer *l, bool prefix) {
  if (!prefix && l->lookahead == '"') {
    l->advance(l, false);
    while (!l->eof(l) && l->lookahead != '\r' && l->lookahead != '\n') {
      if (l->lookahead == '"') {
        l->advance(l, false);
        break;
      }
      if (l->lookahead == '\\') {
        l->advance(l, false);
        if (l->eof(l) || l->lookahead == '\r' || l->lookahead == '\n')
          break;
      }
      l->advance(l, false);
    }
  } else {
    if (!prefix && boundary(l))
      return false;
    while (!boundary(l)) {
      if (JSON_COMMENTS && l->lookahead == '/') {
        l->advance(l, false);
        if (l->lookahead == '/' || l->lookahead == '*') {
          skip_comment(l);
          break;
        }
      } else {
        l->advance(l, false);
      }
    }
  }
  return skip_member_gap(l) && l->lookahead == ':';
}

static bool emit(TSLexer *l, unsigned token) {
  l->result_symbol = token;
  l->mark_end(l);
  return true;
}

static bool finish_lookahead(TSLexer *l, unsigned token) {
  l->result_symbol = token;
  // Continuation-byte edits can change the decoded lookahead character.
  if (!l->eof(l))
    l->advance(l, false);
  return true;
}

static bool emit_zero_width(TSLexer *l, unsigned token) {
  l->mark_end(l);
  return finish_lookahead(l, token);
}

static bool start_member_value(TSLexer *l, bool prefix) {
  const unsigned token =
    member_follows(l, prefix) ? INVALID_MISSING_VALUE : MEMBER_VALUE_START;
  return finish_lookahead(l, token);
}

static bool take(TSLexer *l, unsigned token) {
  const bool string = token == INVALID_STRING_CHARACTER;
  const bool controls = (string || token == INVALID_CONTROL_CHARACTER) &&
    l->lookahead >=
    0 &&
    l->lookahead < 0x20;
  do {
    l->advance(l, false);
  } while (
    controls &&
    !l->eof(l) &&
    l->lookahead >=
    0 &&
    l->lookahead <
    0x20 &&
    (string ? l->lookahead != '\r' && l->lookahead != '\n'
            : !space(l->lookahead))
  );
  return emit(l, token);
}

static bool
missing(TSLexer *l, const bool *v, unsigned invalid, unsigned incomplete) {
  const unsigned token = l->eof(l) ? incomplete : invalid;
  return v[token] && emit_zero_width(l, token);
}

static bool escape_start(TSLexer *l, const bool *v) {
  l->mark_end(l);
  l->advance(l, false);
  unsigned token = INVALID_ESCAPE_START;
  if (l->eof(l)) {
    token = INCOMPLETE_ESCAPE_START;
  } else if (l->lookahead == 'u') {
    l->advance(l, false);
    unsigned count = 0;
    while (count < 4 && hex(l->lookahead) && !l->eof(l)) {
      l->advance(l, false);
      count++;
    }
    if (count == 4)
      token = ESCAPE_START;
    else if (l->eof(l))
      token = INCOMPLETE_ESCAPE_START;
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
  if (token == INVALID_ESCAPE_START && l->lookahead == -1)
    token = UNDECODABLE_ESCAPE_START;
  return v[token] && finish_lookahead(l, token);
}

static bool word(TSLexer *l, const bool *v, bool prefix) {
  const char *const words[] = {"true", "false", "null"};
  const unsigned kinds[] = {TRUE, FALSE, NULL_TOKEN};
  bool matches[] = {!prefix, !prefix, !prefix};
  const unsigned lengths[] = {4, 5, 4};
  unsigned length = prefix ? 1 : 0;
  bool comment = false;
  while (!boundary(l) && l->lookahead != -1) {
    if (JSON_COMMENTS && l->lookahead == '/') {
      l->mark_end(l);
      l->advance(l, false);
      if (l->lookahead == '/' || l->lookahead == '*' || l->eof(l)) {
        comment = true;
        break;
      }
      for (unsigned i = 0; i < 3; i++)
        matches[i] = false;
      if (length < 6)
        length++;
      continue;
    }
    for (unsigned i = 0; i < 3; i++)
      if (length >= lengths[i] || l->lookahead != words[i][length])
        matches[i] = false;
    if (length < 6)
      length++;
    l->advance(l, false);
  }
  if (!length)
    return false;
  if (!comment)
    l->mark_end(l);
  if (v[WORD_FRAGMENT])
    return finish_lookahead(l, WORD_FRAGMENT);
  if (
    l->lookahead == -1 && (v[UNDECODABLE_WORD_PREFIX] || v[INVALID_WORD_PREFIX])
  ) {
    const unsigned token = matches[0] || matches[1] || matches[2]
      ? UNDECODABLE_WORD_PREFIX
      : INVALID_WORD_PREFIX;
    return v[token] && finish_lookahead(l, token);
  }
  for (unsigned i = 0; i < 3; i++) {
    if (matches[i] && length == lengths[i] && v[kinds[i]]) {
      l->result_symbol = kinds[i];
      return true;
    }
  }
  unsigned token = INVALID_VALUE;
  for (unsigned i = 0; i < 3; i++)
    if (matches[i] && length < lengths[i] && !comment && l->eof(l))
      token = INCOMPLETE_VALUE;
  if (v[BARE_MEMBER_NAME]) {
    if (comment)
      skip_comment(l);
    if (skip_member_gap(l) && l->lookahead == ':')
      token = BARE_MEMBER_NAME;
    if (!l->eof(l))
      l->advance(l, false);
  }
  if (!v[token])
    return false;
  l->result_symbol = token;
  return true;
}

static inline void *json_scanner_create(void) {
  return NULL;
}

static inline void json_scanner_destroy(void *payload) {
  (void)payload;
}

static inline unsigned json_scanner_serialize(void *payload, char *buffer) {
  (void)payload;
  (void)buffer;
  return 0;
}

static inline void
json_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
  (void)payload;
  (void)buffer;
  (void)length;
}

static inline bool json_scanner_scan(void *payload, TSLexer *l, const bool *v) {
  (void)payload;
  if (v[ERROR_SENTINEL])
    return false;
  const int32_t c = l->lookahead;

  if (
    v[MEMBER_VALUE_START] &&
    !l->eof(l) &&
    !space(c) &&
    c >=
    0x20 &&
    c !=
    ']' &&
    c !=
    '}' &&
    c !=
    ',' &&
    c !=
    ':' &&
    !(JSON_COMMENTS && c == '/')
  ) {
    l->mark_end(l);
    return start_member_value(l, false);
  }

  if (v[SINGLE_LINE_COMMENT_TEXT] || v[MULTI_LINE_COMMENT_TEXT]) {
    const bool single = v[SINGLE_LINE_COMMENT_TEXT];
    bool content = false;
    while (!l->eof(l) && l->lookahead != -1) {
      if (single && (l->lookahead == '\r' || l->lookahead == '\n'))
        break;
      if (!single && l->lookahead == '*') {
        l->mark_end(l);
        l->advance(l, false);
        if (l->lookahead == '/') {
          if (!content)
            return false;
          l->result_symbol = MULTI_LINE_COMMENT_TEXT;
          return true;
        }
      } else {
        l->advance(l, false);
      }
      content = true;
      l->mark_end(l);
    }
    if (content) {
      l->result_symbol =
        single ? SINGLE_LINE_COMMENT_TEXT : MULTI_LINE_COMMENT_TEXT;
      return true;
    }
    if (!single && l->eof(l) && v[INCOMPLETE_MISSING_COMMENT_CLOSE])
      return emit_zero_width(l, INCOMPLETE_MISSING_COMMENT_CLOSE);
    if (c != -1 && !(single && l->eof(l)))
      return false;
  }

  if (
    JSON_COMMENTS &&
    c ==
    '/' &&
    !v[UNESCAPED] &&
    !v[BAD_ESCAPE_CHARACTER] &&
    !v[BAD_ESCAPE_END]
  ) {
    l->mark_end(l);
    l->advance(l, false);
    if (l->lookahead == '/' || l->lookahead == '*' || l->eof(l)) {
      const unsigned ends[] = {
        INVALID_INT_END,
        INT_END,
        INVALID_ZERO_SUFFIX_END,
        INVALID_FRAC_END,
        FRAC_END,
        INVALID_EXP_END,
        EXP_END,
        NUMBER_END,
        INVALID_MISSING_DIGITS,
        WORD_END
      };
      for (unsigned i = 0; i < sizeof(ends) / sizeof(ends[0]); i++)
        if (v[ends[i]])
          return finish_lookahead(l, ends[i]);
      if (l->eof(l) && v[INCOMPLETE_COMMENT])
        return emit(l, INCOMPLETE_COMMENT);
      return false;
    }
    if (v[MEMBER_VALUE_START])
      return start_member_value(l, true);
    const unsigned starts[] = {
      INVALID_ZERO_SUFFIX_START,
      INVALID_INT_START,
      INVALID_FRAC_START,
      INVALID_EXP_START
    };
    for (unsigned i = 0; i < sizeof(starts) / sizeof(starts[0]); i++)
      if (v[starts[i]])
        return finish_lookahead(l, starts[i]);
    const unsigned contents[] = {
      INVALID_INT_CHARACTER,
      INVALID_FRAC_CHARACTER,
      INVALID_EXP_CHARACTER,
      WORD_FRAGMENT
    };
    for (unsigned i = 0; i < sizeof(contents) / sizeof(contents[0]); i++)
      if (v[contents[i]])
        return emit(l, contents[i]);
    const unsigned missing[] = {
      INVALID_MISSING_NAME_SEPARATOR,
      MISSING_OBJECT_SEPARATOR,
      MISSING_ARRAY_SEPARATOR
    };
    for (unsigned i = 0; i < sizeof(missing) / sizeof(missing[0]); i++)
      if (v[missing[i]])
        return finish_lookahead(l, missing[i]);
    if (v[INVALID_VALUE] || v[BARE_MEMBER_NAME])
      return word(l, v, true);
    return false;
  }

  if (
    c ==
    -1 &&
    (v[INVALID_ENCODING] ||
      v[INVALID_NUMBER_ENCODING] ||
      v[INVALID_WORD_ENCODING])
  ) {
    do {
      l->advance(l, false);
    } while (!l->eof(l) && l->lookahead == -1);
    l->mark_end(l);
    return finish_lookahead(
      l,
      v[INVALID_NUMBER_ENCODING]   ? INVALID_NUMBER_ENCODING
        : v[INVALID_WORD_ENCODING] ? INVALID_WORD_ENCODING
                                   : INVALID_ENCODING
    );
  }

  if (v[WORD_END] && boundary(l))
    return emit_zero_width(l, WORD_END);
  if (v[WORD_FRAGMENT] && !boundary(l))
    return word(l, v, false);

  if (
    c ==
    '\\' &&
    (v[ESCAPE_START] || v[INVALID_ESCAPE_START] || v[INCOMPLETE_ESCAPE_START])
  )
    return escape_start(l, v);
  if (v[HEXDIG] && hex(c) && !l->eof(l))
    return take(l, HEXDIG);
  if (
    v[BAD_ESCAPE_END] &&
    (!v[BAD_ESCAPE_CHARACTER] ||
      l->eof(l) ||
      c ==
      '"' ||
      c ==
      '\\' ||
      c ==
      '\r' ||
      c == '\n')
  )
    return emit_zero_width(l, BAD_ESCAPE_END);
  if (
    v[BAD_ESCAPE_CHARACTER] &&
    (c != 'u' || v[HEXDIG]) &&
    c !=
    '"' &&
    c !=
    '\\' &&
    c !=
    '\r' &&
    c !=
    '\n' &&
    !l->eof(l)
  )
    return take(l, BAD_ESCAPE_CHARACTER);
  if (v[UNESCAPED] && c >= 0x20 && c != '"' && c != '\\' && !l->eof(l))
    return take(l, UNESCAPED);
  if (
    v[INVALID_STRING_CHARACTER] &&
    c <
    0x20 &&
    c !=
    '\r' &&
    c !=
    '\n' &&
    !l->eof(l)
  )
    return take(l, INVALID_STRING_CHARACTER);
  if (
    (l->eof(l) || c == '\r' || c == '\n') &&
    missing(l, v, INVALID_MISSING_STRING_CLOSE, INCOMPLETE_MISSING_STRING_CLOSE)
  )
    return true;

  const unsigned starts[] =
    {INVALID_INT_START, INVALID_FRAC_START, INVALID_EXP_START};
  const unsigned contents[] =
    {INVALID_INT_CHARACTER, INVALID_FRAC_CHARACTER, INVALID_EXP_CHARACTER};
  const unsigned ends[] = {INVALID_INT_END, INVALID_FRAC_END, INVALID_EXP_END};
  const unsigned part_ends[] = {INT_END, FRAC_END, EXP_END};
  for (unsigned i = 0; i < 3; i++) {
    if (v[ends[i]] && (part_end(l, i) || c == -1 || digit(c)))
      return emit_zero_width(l, ends[i]);
    if (v[part_ends[i]] && part_end(l, i))
      return emit_zero_width(l, part_ends[i]);
  }
  if (v[NUMBER_END] && boundary(l))
    return emit_zero_width(l, NUMBER_END);
  if (v[NUMBER_START] && (digit(c) || c == '-' || c == '+' || c == '.'))
    return emit_zero_width(l, NUMBER_START);
  if (v[INVALID_ZERO_SUFFIX_START] && !part_end(l, 0))
    return emit_zero_width(l, INVALID_ZERO_SUFFIX_START);
  if (v[INVALID_ZERO_SUFFIX_END] && (part_end(l, 0) || c == -1))
    return emit_zero_width(l, INVALID_ZERO_SUFFIX_END);
  if (v[DIGIT] && digit(c))
    return take(l, DIGIT);
  if (v[DIGIT1_9] && c >= '1' && c <= '9')
    return take(l, DIGIT1_9);
  if (v[INVALID_PLUS] && c == '+')
    return take(l, INVALID_PLUS);
  if (v[EXP_PLUS] && c == '+')
    return take(l, EXP_PLUS);
  if (v[EXP_MINUS] && c == '-')
    return take(l, EXP_MINUS);
  if (v[INVALID_PLUS] && c == '-')
    return false;
  if (c == '0' && v[DIGIT1_9])
    return false;
  for (unsigned i = 0; i < 3; i++) {
    if (v[contents[i]] && !part_end(l, i) && !digit(c))
      return take(l, contents[i]);
    if (v[starts[i]] && !part_end(l, i) && !digit(c))
      return emit_zero_width(l, starts[i]);
  }
  if (missing(l, v, INVALID_MISSING_DIGITS, INCOMPLETE_MISSING_DIGITS))
    return true;

  if (space(c) && !l->eof(l))
    return false;
  if (c == ',' && (v[COMMA] || v[EXTRA_COMMA])) {
    if (!v[COMMA])
      return take(l, EXTRA_COMMA);
    if (JSON_TRAILING)
      return take(l, COMMA);
    l->advance(l, false);
    l->mark_end(l);
    bool layout;
    while (
      (layout = skip_member_gap(l)) &&
      !l->eof(l) &&
      (l->lookahead == ',' || stray(l->lookahead, v))
    )
      l->advance(l, false);
    const unsigned token =
      layout && closes_container(l->lookahead, v) ? EXTRA_COMMA : COMMA;
    return v[token] && finish_lookahead(l, token);
  }
  if (c == ':' && v[NAME_SEPARATOR])
    return take(l, NAME_SEPARATOR);
  if (v[INVALID_CHARACTER] && stray(c, v))
    return take(l, INVALID_CHARACTER);
  if (v[INVALID_CONTROL_CHARACTER] && c < 0x20 && !l->eof(l))
    return take(l, INVALID_CONTROL_CHARACTER);
  if (
    c !=
    ':' &&
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
    const unsigned eof[] = {
      INCOMPLETE_MISSING_MEMBER,
      INCOMPLETE_MISSING_ARRAY_CLOSE,
      INCOMPLETE_MISSING_OBJECT_CLOSE
    };
    for (unsigned i = 0; i < sizeof(eof) / sizeof(eof[0]); i++)
      if (v[eof[i]])
        return emit_zero_width(l, eof[i]);
    return false;
  }
  if (c == ']' && v[INVALID_MISSING_OBJECT_CLOSE])
    return emit_zero_width(l, INVALID_MISSING_OBJECT_CLOSE);
  if (c == '}' && v[INVALID_MISSING_ARRAY_CLOSE])
    return emit_zero_width(l, INVALID_MISSING_ARRAY_CLOSE);
  if (
    (c == ']' && v[INCOMPLETE_MISSING_ARRAY_CLOSE]) ||
    (c == '}' && v[INCOMPLETE_MISSING_OBJECT_CLOSE])
  )
    return false;

  if (c != ']' && c != '}' && c != ',' && c >= 0x20) {
    if (v[MISSING_OBJECT_SEPARATOR])
      return emit_zero_width(l, MISSING_OBJECT_SEPARATOR);
    if (v[MISSING_ARRAY_SEPARATOR])
      return emit_zero_width(l, MISSING_ARRAY_SEPARATOR);
  }
  if (v[INVALID_MISSING_MEMBER_NAME] && c == ':')
    return emit_zero_width(l, INVALID_MISSING_MEMBER_NAME);
  if (v[INVALID_CHARACTER] && (c == ']' || c == '}' || c == ','))
    return take(l, INVALID_CHARACTER);
  if (
    (v[TRUE] ||
      v[FALSE] ||
      v[NULL_TOKEN] ||
      v[INVALID_VALUE] ||
      v[INCOMPLETE_VALUE] ||
      v[BARE_MEMBER_NAME]) &&
    !boundary(l) &&
    c !=
    '-' &&
    c !=
    '+' &&
    c !=
    '.' &&
    !digit(c)
  )
    return word(l, v, false);
  return false;
}

#endif

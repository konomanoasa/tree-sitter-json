[
  "{"
  "}"
  "["
  "]"
] @punctuation.bracket

[
  ":"
  ","
] @punctuation.delimiter

(string
  "\"" @punctuation.delimiter)

[
  "true"
  "false"
] @boolean

"null" @constant.builtin

(unescaped) @string

(char
  [
    "\\"
    "\""
    "/"
    "b"
    "f"
    "n"
    "r"
    "t"
    "u"
  ] @string.escape)

(hexdig) @string.escape

[
  (digit1_9)
  (digit)
  (e)
] @number

(int
  "0" @number)

(number
  "-" @number)

(frac
  "." @number)

(exp
  [
    "+"
    "-"
  ] @number)

(member
  name: (string
    (char
      (unescaped) @property)))

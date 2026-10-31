export default grammar({
  name: "json",

  extras: () => [],

  rules: {
    json_text: ($) => seq(optional($._ws), $.value, optional($._ws)),

    value: ($) =>
      choice($.object, $.array, $.number, $.string, "false", "null", "true"),

    object: ($) =>
      seq(
        "{",
        optional($._ws),
        optional(seq($.member, optional($._ws), repeat($._next_member))),
        "}",
      ),

    _next_member: ($) => seq(",", optional($._ws), $.member, optional($._ws)),

    member: ($) =>
      seq(
        field("name", $.string),
        optional($._ws),
        ":",
        optional($._ws),
        field("value", $.value),
      ),

    array: ($) =>
      seq(
        "[",
        optional($._ws),
        optional(seq($.value, optional($._ws), repeat($._next_value))),
        "]",
      ),

    _next_value: ($) => seq(",", optional($._ws), $.value, optional($._ws)),

    number: ($) => seq(optional("-"), $.int, optional($.frac), optional($.exp)),
    int: ($) => choice("0", seq($.digit1_9, repeat($.digit))),
    frac: ($) => seq(".", repeat1($.digit)),
    exp: ($) => seq($.e, optional(choice("+", "-")), repeat1($.digit)),
    e: () => /[eE]/,
    digit1_9: () => /[1-9]/,
    digit: () => /[0-9]/,

    string: ($) => seq('"', repeat($.char), '"'),
    char: ($) =>
      choice(
        $.unescaped,
        seq(
          "\\",
          choice(
            '"',
            "\\",
            "/",
            "b",
            "f",
            "n",
            "r",
            "t",
            seq("u", $.hexdig, $.hexdig, $.hexdig, $.hexdig),
          ),
        ),
      ),
    unescaped: () => /[\x20-\x21\x23-\x5b\x5d-\u{10ffff}]/u,
    hexdig: () => /[0-9a-fA-F]/,

    _ws: () => /[ \t\r\n]+/,
  },
});

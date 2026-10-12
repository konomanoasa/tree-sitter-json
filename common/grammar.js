const missingParts = [
  "value",
  "name_separator",
  "object_close",
  "array_close",
  "string_close",
  "digits",
];
const tokenIssues = [
  ...missingParts.flatMap((part) => [
    [`invalid_missing_${part}`, "invalid_syntax", `missing_${part}`],
    [`incomplete_missing_${part}`, "incomplete_syntax", `missing_${part}`],
  ]),
  ["incomplete_missing_member", "incomplete_syntax", "missing_member"],
  ["invalid_missing_member_name", "invalid_syntax", "missing_member_name"],
  ["missing_object_separator", "invalid_syntax", "missing_value_separator"],
  ["missing_array_separator", "invalid_syntax", "missing_value_separator"],
  ["invalid_value", "invalid_syntax", "invalid_value"],
  ["incomplete_value", "incomplete_syntax", "invalid_value"],
  ["invalid_character", "invalid_syntax", "invalid_character"],
  ["invalid_string_character", "invalid_syntax", "invalid_character"],
  ["invalid_control_character", "invalid_syntax", "invalid_character"],
  ["extra_comma", "invalid_syntax", "unexpected_separator", ","],
  ["plus", "invalid_syntax", "invalid_number", "+"],
  ["invalid_int", "invalid_syntax", "invalid_number"],
  ["invalid_frac", "invalid_syntax", "invalid_number"],
  ["invalid_exp", "invalid_syntax", "invalid_number"],
  ["invalid_encoding", "invalid_syntax", "invalid_encoding"],
  ["invalid_word_prefix", "invalid_syntax", "invalid_value"],
  ["incomplete_comment", "incomplete_syntax", "invalid_comment"],
  [
    "incomplete_missing_comment_close",
    "incomplete_syntax",
    "missing_comment_close",
  ],
];
export const tokens = [
  "number_start",
  "number_end",
  "unescaped",
  "digit",
  "digit1_9",
  "hexdig",
  "true",
  "false",
  "null",
  "minus",
  "escape_start",
  "invalid_escape_start",
  "incomplete_escape_start",
  "undecodable_escape_start",
  "bad_escape_character",
  "bad_escape_end",
  "comma",
  "name_separator",
  "invalid_zero_suffix_end",
  "single_line_comment_text",
  "multi_line_comment_text",
  "undecodable_word_prefix",
  "word_fragment",
  "word_end",
  "member_value_start",
  "bare_member_name",
  ...tokenIssues.map(([token]) => token),
  "error_sentinel",
];

export default function defineGrammar(name) {
  const comments = name !== "json";
  const trailing = name === "jsonc_trailing";
  const rules = {};
  function defineIssue(id, outcome, reason, source) {
    rules[`_${id}_source`] = source;
    rules[`_${id}_outcome`] = ($) => alias($[`_${id}_source`], $[reason]);
    rules[`_${id}_issue`] = ($) => alias($[`_${id}_outcome`], $[outcome]);
  }
  const issue = ($, id) =>
    field("issue", alias($[`_${id}_issue`], $.syntax_issue));
  const absent = ($, part) =>
    choice(
      issue($, `invalid_missing_${part}`),
      issue($, `incomplete_missing_${part}`),
    );
  const digit = ($) => alias($._digit, $.digit);
  const value = ($, context) => alias($[`_value_${context}`], $.value);
  const layout = ($) =>
    comments
      ? [
          $._ws,
          $.single_line_comment,
          $.multi_line_comment,
          issue($, "incomplete_comment"),
        ]
      : [$._ws];
  const memberGap = ($) =>
    repeat(
      choice(
        ...layout($),
        issue($, "invalid_control_character"),
        issue($, "invalid_encoding"),
      ),
    );
  const gap = ($) =>
    repeat(
      choice(
        ...layout($),
        issue($, "invalid_control_character"),
        issue($, "invalid_character"),
        issue($, "invalid_encoding"),
      ),
    );
  const extraCommas = ($) => repeat(seq(issue($, "extra_comma"), gap($)));
  const digitItem = ($, part) =>
    choice(digit($), issue($, `invalid_${part}`), issue($, "invalid_encoding"));
  const badEscape = ($) =>
    seq(
      "\\",
      choice(
        seq(
          "u",
          repeat(alias($._hexdig, $.hexdig)),
          optional($._bad_escape_character),
        ),
        optional($._bad_escape_character),
      ),
      $._bad_escape_end,
    );

  const containerContext = (kind, context) =>
    context === "root" || context === kind ? kind : "both";
  function collection($, kind, context) {
    const array = kind === "array";
    return seq(
      array ? "[" : "{",
      gap($),
      extraCommas($),
      optional($[`_${kind}_${context}_body`]),
      choice(
        array ? "]" : "}",
        issue($, `incomplete_missing_${kind}_close`),
        ...(context === "both"
          ? [issue($, `invalid_missing_${kind}_close`)]
          : []),
      ),
    );
  }
  function collectionBody($, kind, context) {
    const array = kind === "array";
    const item = array
      ? value($, context)
      : choice(
          alias($[`_member_${context}`], $.member),
          issue($, `unexpected_${context}`),
        );
    const comma = alias($._comma, ",");
    return seq(
      item,
      gap($),
      repeat(
        seq(
          choice(
            seq(
              comma,
              gap($),
              extraCommas($),
              trailing
                ? item
                : choice(
                    item,
                    array
                      ? absent($, "value")
                      : issue($, "incomplete_missing_member"),
                  ),
            ),
            seq(issue($, `missing_${kind}_separator`), item),
          ),
          gap($),
        ),
      ),
      trailing ? optional($._trailing_comma) : extraCommas($),
    );
  }

  for (const [token, outcome, reason, leaf] of tokenIssues) {
    defineIssue(token, outcome, reason, ($) =>
      leaf ? alias($[`_${token}`], leaf) : $[`_${token}`],
    );
  }
  defineIssue("invalid_zero_suffix", "invalid_syntax", "invalid_number", ($) =>
    seq(repeat1(choice(digit($), $._invalid_int)), $._invalid_zero_suffix_end),
  );
  for (const kind of ["invalid", "incomplete"]) {
    defineIssue(`${kind}_escape`, `${kind}_syntax`, "invalid_escape", ($) =>
      seq($[`_${kind}_escape_start`], badEscape($)),
    );
  }
  defineIssue("unexpected_root", "invalid_syntax", "unexpected_value", ($) =>
    value($, "root"),
  );
  for (const context of ["root", "array", "object", "both"]) {
    const inObject = context === "object" || context === "both";
    rules[`_non_string_${context}`] = ($) =>
      choice(
        $.number,
        alias($._true, "true"),
        alias($._false, "false"),
        alias($._null, "null"),
        alias($[`_array_${containerContext("array", context)}`], $.array),
        alias($[`_object_${containerContext("object", context)}`], $.object),
        issue($, "invalid_value"),
        issue($, "incomplete_value"),
      );
    rules[`_non_string_value_${context}`] = ($) =>
      choice($[`_non_string_${context}`], $._undecodable_word);
    rules[`_value_${context}`] = ($) =>
      choice($.string, $[`_non_string_value_${context}`]);
    if (inObject) {
      defineIssue(
        `unexpected_${context}`,
        "invalid_syntax",
        "unexpected_value",
        ($) => alias($[`_non_string_value_${context}`], $.value),
      );
      defineIssue(
        `invalid_name_${context}`,
        "invalid_syntax",
        "invalid_member_name",
        ($) =>
          prec.dynamic(
            1,
            choice(
              alias($[`_non_string_${context}`], $.value),
              seq(
                choice($._undecodable_word_prefix, $._invalid_word_prefix),
                $._undecodable_word_tail,
              ),
              $._bare_member_name,
            ),
          ),
      );
      rules[`_member_${context}`] = ($) =>
        seq(
          choice(
            seq(
              field("name", $.string),
              memberGap($),
              choice(
                alias($._name_separator, ":"),
                absent($, "name_separator"),
              ),
            ),
            seq(
              issue($, `invalid_name_${context}`),
              memberGap($),
              alias($._name_separator, ":"),
            ),
            seq(
              issue($, "invalid_missing_member_name"),
              alias($._name_separator, ":"),
            ),
          ),
          memberGap($),
          choice(
            seq($._member_value_start, field("value", value($, context))),
            absent($, "value"),
          ),
        );
    }
  }
  if (trailing) {
    rules._trailing_comma = ($) =>
      seq(alias($._comma, ","), gap($), extraCommas($));
  }
  for (const [kind, context] of [
    ["array", "array"],
    ["array", "both"],
    ["object", "object"],
    ["object", "both"],
  ]) {
    rules[`_${kind}_${context}`] = ($) => collection($, kind, context);
    rules[`_${kind}_${context}_body`] = ($) => collectionBody($, kind, context);
  }

  return grammar({
    name,
    extras: () => [],
    externals: ($) => tokens.map((token) => $[`_${token}`]),
    conflicts: ($) => [
      [$._non_string_value_object, $._invalid_name_object_source],
      [$._non_string_value_both, $._invalid_name_both_source],
      [$._invalid_word_prefix_source, $._invalid_name_object_source],
      [$._invalid_word_prefix_source, $._invalid_name_both_source],
      [$._undecodable_word, $._invalid_name_object_source],
      [$._undecodable_word, $._invalid_name_both_source],
    ],
    rules: {
      json_text: ($) =>
        seq(
          gap($),
          choice(value($, "root"), issue($, "incomplete_missing_value")),
          gap($),
          repeat(seq(issue($, "unexpected_root"), gap($))),
        ),
      _ws: () => /[ \t\r\n]+/,
      _undecodable_word: ($) =>
        seq(
          choice($._undecodable_word_prefix, issue($, "invalid_word_prefix")),
          $._undecodable_word_tail,
        ),
      _undecodable_word_tail: ($) =>
        seq(
          issue($, "invalid_encoding"),
          repeat(choice($._word_fragment, issue($, "invalid_encoding"))),
          $._word_end,
        ),
      ...(comments
        ? {
            single_line_comment: ($) =>
              prec.right(
                seq(
                  "//",
                  repeat(
                    choice(
                      alias($._single_line_comment_text, $.comment_text),
                      issue($, "invalid_encoding"),
                    ),
                  ),
                ),
              ),
            multi_line_comment: ($) =>
              seq(
                "/*",
                repeat(
                  choice(
                    alias($._multi_line_comment_text, $.comment_text),
                    issue($, "invalid_encoding"),
                  ),
                ),
                choice("*/", issue($, "incomplete_missing_comment_close")),
              ),
          }
        : {}),
      string: ($) =>
        seq(
          '"',
          repeat(
            choice(
              $.char,
              issue($, "invalid_string_character"),
              issue($, "invalid_encoding"),
            ),
          ),
          choice('"', absent($, "string_close")),
        ),
      char: ($) =>
        choice(
          alias($._unescaped, $.unescaped),
          seq(
            $._escape_start,
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
              seq(
                "u",
                ...Array.from({ length: 4 }, () => alias($._hexdig, $.hexdig)),
              ),
            ),
          ),
          issue($, "invalid_escape"),
          issue($, "incomplete_escape"),
          seq(
            $._undecodable_escape_start,
            "\\",
            optional(seq("u", repeat(alias($._hexdig, $.hexdig)))),
            issue($, "invalid_encoding"),
          ),
        ),
      number: ($) =>
        seq(
          $._number_start,
          optional(choice(alias($._minus, "-"), issue($, "plus"))),
          choice(
            $.int,
            seq(
              repeat1(
                choice(issue($, "invalid_int"), issue($, "invalid_encoding")),
              ),
              optional($.int),
            ),
            absent($, "digits"),
          ),
          optional($.frac),
          optional($.exp),
          $._number_end,
        ),
      int: ($) =>
        choice(
          seq(
            "0",
            repeat(
              choice(
                issue($, "invalid_zero_suffix"),
                issue($, "invalid_encoding"),
              ),
            ),
          ),
          seq(alias($._digit1_9, $.digit1_9), repeat(digitItem($, "int"))),
        ),
      frac: ($) =>
        seq(".", choice(repeat1(digitItem($, "frac")), absent($, "digits"))),
      exp: ($) =>
        seq(
          $.e,
          optional(choice(alias($._plus, "+"), alias($._minus, "-"))),
          choice(repeat1(digitItem($, "exp")), absent($, "digits")),
        ),
      e: () => token(choice("e", "E")),
      ...rules,
    },
  });
}

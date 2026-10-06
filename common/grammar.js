export default function defineGrammar(name) {
  const comments = name !== "json";
  const trailing = name === "jsonc_trailing";
  const missing = [
    "value",
    "name_separator",
    "object_close",
    "array_close",
    "string_close",
    "digits",
  ];
  const rawIssues = [
    ...missing.flatMap((name) => [
      [`invalid_missing_${name}`, "invalid_syntax", `missing_${name}`],
      [`incomplete_missing_${name}`, "incomplete_syntax", `missing_${name}`],
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
    ["bare_member_name", "invalid_syntax", "invalid_member_name"],
    ["extra_comma", "invalid_syntax", "unexpected_separator", ","],
    ["invalid_plus", "invalid_syntax", "invalid_number", "+"],
    ["invalid_encoding", "invalid_syntax", "invalid_encoding"],
    ["invalid_number_encoding", "invalid_syntax", "invalid_encoding"],
    ["invalid_word_encoding", "invalid_syntax", "invalid_encoding"],
    ["invalid_word_prefix", "invalid_syntax", "invalid_value"],
    ["incomplete_comment", "incomplete_syntax", "invalid_comment"],
    [
      "incomplete_missing_comment_close",
      "incomplete_syntax",
      "missing_comment_close",
    ],
  ];
  const markers = [
    "number_start",
    "int_end",
    "frac_end",
    "exp_end",
    "number_end",
    "unescaped",
    "digit",
    "digit1_9",
    "hexdig",
    "true",
    "false",
    "null",
    "escape_start",
    "invalid_escape_start",
    "incomplete_escape_start",
    "bad_escape_character",
    "bad_escape_end",
    "comma",
    "exp_plus",
    "exp_minus",
    "name_separator",
    "invalid_int_start",
    "invalid_int_character",
    "invalid_int_end",
    "invalid_frac_start",
    "invalid_frac_character",
    "invalid_frac_end",
    "invalid_exp_start",
    "invalid_exp_character",
    "invalid_exp_end",
    "undecodable_escape_start",
    "invalid_zero_suffix_start",
    "invalid_zero_suffix_end",
    "single_line_comment_text",
    "multi_line_comment_text",
    "undecodable_word_prefix",
    "word_fragment",
    "word_end",
    "member_value_start",
  ];
  const issue = ($, name) =>
    field("issue", alias($[`_${name}_issue`], $.syntax_issue));
  const absent = ($, name) =>
    choice(
      issue($, `invalid_missing_${name}`),
      issue($, `incomplete_missing_${name}`),
    );
  const rules = {};
  function problem(name, outcome, reason, body) {
    rules[`_${name}_source`] = body;
    rules[`_${name}_outcome`] = ($) => alias($[`_${name}_source`], $[reason]);
    rules[`_${name}_issue`] = ($) => alias($[`_${name}_outcome`], $[outcome]);
  }
  for (const [name, outcome, reason, leaf] of rawIssues) {
    problem(name, outcome, reason, ($) =>
      leaf ? alias($[`_${name}`], leaf) : $[`_${name}`],
    );
  }
  const digit = ($) => alias($._digit, $.digit);
  const value = ($, context) => alias($[`_value_${context}`], $.value);
  const member = ($, context) => alias($[`_member_${context}`], $.member);
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
  for (const part of ["int", "frac", "exp"]) {
    problem(`invalid_${part}`, "invalid_syntax", "invalid_number", ($) =>
      seq(
        $[`_invalid_${part}_start`],
        repeat1($[`_invalid_${part}_character`]),
        $[`_invalid_${part}_end`],
      ),
    );
  }
  problem("invalid_zero_suffix", "invalid_syntax", "invalid_number", ($) =>
    seq(
      $._invalid_zero_suffix_start,
      repeat1(choice(digit($), $._invalid_int_character)),
      $._invalid_zero_suffix_end,
    ),
  );
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
  for (const kind of ["invalid", "incomplete"]) {
    problem(`${kind}_escape`, `${kind}_syntax`, "invalid_escape", ($) =>
      seq($[`_${kind}_escape_start`], badEscape($)),
    );
  }
  function collection($, kind, context, nested) {
    const isArray = kind === "array";
    const item = isArray
      ? value($, context)
      : choice(member($, context), issue($, `unexpected_${context}`));
    const comma = alias($._comma, ",");
    const extraCommas = repeat(seq(issue($, "extra_comma"), gap($)));
    return seq(
      isArray ? "[" : "{",
      gap($),
      extraCommas,
      optional(
        seq(
          item,
          gap($),
          repeat(
            seq(
              choice(
                seq(
                  comma,
                  gap($),
                  extraCommas,
                  choice(
                    item,
                    ...(trailing
                      ? []
                      : [
                          isArray
                            ? absent($, "value")
                            : issue($, "incomplete_missing_member"),
                        ]),
                  ),
                ),
                seq(issue($, `missing_${kind}_separator`), item),
              ),
              gap($),
            ),
          ),
          trailing ? optional(seq(comma, gap($), extraCommas)) : extraCommas,
        ),
      ),
      choice(
        isArray ? "]" : "}",
        issue($, `incomplete_missing_${kind}_close`),
        ...(nested ? [issue($, `invalid_missing_${kind}_close`)] : []),
      ),
    );
  }
  for (const context of ["root", "array", "object", "both"]) {
    const hasArray = context === "array" || context === "both";
    const hasObject = context === "object" || context === "both";
    rules[`_non_string_${context}`] = ($) =>
      choice(
        $.number,
        alias($._true, "true"),
        alias($._false, "false"),
        alias($._null, "null"),
        alias($[hasObject ? "_array_in_object" : "_array"], $.array),
        alias($[hasArray ? "_object_in_array" : "_object"], $.object),
        issue($, "invalid_value"),
        issue($, "incomplete_value"),
      );
    rules[`_non_string_value_${context}`] = ($) =>
      choice($[`_non_string_${context}`], $._undecodable_word);
    rules[`_value_${context}`] = ($) =>
      choice($.string, $[`_non_string_value_${context}`]);
    if (context !== "array") {
      problem(
        `unexpected_${context}`,
        "invalid_syntax",
        "unexpected_value",
        ($) =>
          context === "root"
            ? value($, context)
            : alias($[`_non_string_value_${context}`], $.value),
      );
    }
    if (context === "object" || context === "both") {
      problem(
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
              choice(
                issue($, `invalid_name_${context}`),
                issue($, "bare_member_name"),
              ),
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
  return grammar({
    name,
    extras: () => [],
    externals: ($) => [
      ...markers.map((name) => $[`_${name}`]),
      ...rawIssues.map(([name]) => $[`_${name}`]),
      $._error_sentinel,
    ],
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
          issue($, "invalid_word_encoding"),
          repeat(choice($._word_fragment, issue($, "invalid_word_encoding"))),
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
      _array: ($) => collection($, "array", "array", false),
      _array_in_object: ($) => collection($, "array", "both", true),
      _object: ($) => collection($, "object", "object", false),
      _object_in_array: ($) => collection($, "object", "both", true),
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
          optional(choice("-", issue($, "invalid_plus"))),
          choice(
            $.int,
            seq(
              repeat1(
                choice(
                  issue($, "invalid_int"),
                  issue($, "invalid_number_encoding"),
                ),
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
        seq(
          choice(
            seq(
              "0",
              repeat(
                choice(
                  issue($, "invalid_zero_suffix"),
                  issue($, "invalid_number_encoding"),
                ),
              ),
            ),
            seq(
              alias($._digit1_9, $.digit1_9),
              repeat(
                choice(
                  digit($),
                  issue($, "invalid_int"),
                  issue($, "invalid_number_encoding"),
                ),
              ),
            ),
          ),
          $._int_end,
        ),
      frac: ($) =>
        seq(
          ".",
          choice(
            repeat1(
              choice(
                digit($),
                issue($, "invalid_frac"),
                issue($, "invalid_number_encoding"),
              ),
            ),
            absent($, "digits"),
          ),
          $._frac_end,
        ),
      exp: ($) =>
        seq(
          $.e,
          optional(choice(alias($._exp_plus, "+"), alias($._exp_minus, "-"))),
          choice(
            repeat1(
              choice(
                digit($),
                issue($, "invalid_exp"),
                issue($, "invalid_number_encoding"),
              ),
            ),
            absent($, "digits"),
          ),
          $._exp_end,
        ),
      e: () => token(choice("e", "E")),
      ...rules,
    },
  });
}

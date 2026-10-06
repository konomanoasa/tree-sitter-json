use tree_sitter_language::LanguageFn;

unsafe extern "C" {
  fn tree_sitter_json() -> *const ();
  fn tree_sitter_jsonc() -> *const ();
  fn tree_sitter_jsonc_trailing() -> *const ();
}

pub const LANGUAGE: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_json) };
pub const LANGUAGE_JSONC: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_jsonc) };
pub const LANGUAGE_JSONC_TRAILING: LanguageFn =
  unsafe { LanguageFn::from_raw(tree_sitter_jsonc_trailing) };

pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");
pub const NODE_TYPES_JSONC: &str =
  include_str!("../../jsonc/src/node-types.json");
pub const NODE_TYPES_JSONC_TRAILING: &str =
  include_str!("../../jsonc_trailing/src/node-types.json");

pub const HIGHLIGHTS_QUERY: &str = include_str!("../../queries/highlights.scm");
pub const HIGHLIGHTS_QUERY_JSONC: &str = concat!(
  include_str!("../../queries/highlights.scm"),
  "\n",
  include_str!("../../jsonc/queries/highlights.scm")
);
pub const HIGHLIGHTS_QUERY_JSONC_TRAILING: &str = HIGHLIGHTS_QUERY_JSONC;

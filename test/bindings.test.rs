use konomanoasa_tree_sitter_json as grammar;
use tree_sitter::{Language, Parser, Query};

#[test]
fn parses_valid_source() {
  for (language, node_types, query) in [
    (
      grammar::LANGUAGE,
      grammar::NODE_TYPES,
      grammar::HIGHLIGHTS_QUERY,
    ),
    (
      grammar::LANGUAGE_JSONC,
      grammar::NODE_TYPES_JSONC,
      grammar::HIGHLIGHTS_QUERY_JSONC,
    ),
    (
      grammar::LANGUAGE_JSONC_TRAILING,
      grammar::NODE_TYPES_JSONC_TRAILING,
      grammar::HIGHLIGHTS_QUERY_JSONC_TRAILING,
    ),
  ] {
    let language = language.into();
    let mut parser = Parser::new();
    parser.set_language(&language).unwrap();
    let tree = parser.parse("[]", None).unwrap();
    assert_eq!(tree.root_node().kind(), "json_text");
    assert_eq!(tree.root_node().byte_range(), 0..2);
    assert!(!tree.root_node().has_error());
    assert!(node_types.contains("\"json_text\""));
    Query::new(&language, query).unwrap();
  }
}

#[derive(Debug, PartialEq, Eq)]
struct PublicNode {
  kind: String,
  named: bool,
  parent: Option<usize>,
  field: Option<String>,
  range: std::ops::Range<usize>,
  start: tree_sitter::Point,
  end: tree_sitter::Point,
}

fn snapshot(tree: &tree_sitter::Tree) -> Vec<PublicNode> {
  let mut result = Vec::new();
  let mut pending = vec![(tree.root_node(), None, None)];
  while let Some((node, field, parent)) = pending.pop() {
    let next_parent = if node.is_error() || node.is_missing() {
      parent
    } else {
      let index = result.len();
      result.push(PublicNode {
        kind: node.kind().to_string(),
        named: node.is_named(),
        parent,
        field: field.map(str::to_string),
        range: node.byte_range(),
        start: node.start_position(),
        end: node.end_position(),
      });
      Some(index)
    };
    for index in (0..node.child_count()).rev() {
      pending.push((
        node.child(index).unwrap(),
        node.field_name_for_child(index),
        next_parent,
      ));
    }
  }
  result
}

fn assert_issue_ownership(nodes: &[PublicNode], source: &[u8]) {
  for (index, node) in nodes
    .iter()
    .enumerate()
    .filter(|(_, node)| node.kind == "syntax_issue")
  {
    assert_eq!(node.field.as_deref(), Some("issue"), "{source:?}");
    let outcome = &nodes[index + 1];
    let reason = &nodes[index + 2];
    assert_eq!(outcome.parent, Some(index), "{source:?}");
    assert_eq!(reason.parent, Some(index + 1), "{source:?}");
    assert!(matches!(
      outcome.kind.as_str(),
      "invalid_syntax" | "incomplete_syntax"
    ));
    for child in [outcome, reason] {
      assert_eq!(node.range, child.range, "{source:?}");
      assert_eq!(node.start, child.start, "{source:?}");
      assert_eq!(node.end, child.end, "{source:?}");
    }
  }
}

fn languages() -> [(&'static str, Language); 3] {
  [
    ("json", grammar::LANGUAGE.into()),
    ("jsonc", grammar::LANGUAGE_JSONC.into()),
    ("jsonc_trailing", grammar::LANGUAGE_JSONC_TRAILING.into()),
  ]
}

fn parser(language: &Language) -> Parser {
  let mut parser = Parser::new();
  parser.set_language(language).unwrap();
  parser
}

fn point(source: &[u8], byte: usize) -> tree_sitter::Point {
  let prefix = &source[..byte];
  tree_sitter::Point {
    row: prefix.iter().filter(|byte| **byte == b'\n').count(),
    column: prefix
      .iter()
      .rposition(|byte| *byte == b'\n')
      .map_or(byte, |newline| byte - newline - 1),
  }
}

fn edit(
  source: &mut Vec<u8>,
  tree: &mut tree_sitter::Tree,
  byte: usize,
  delete: usize,
  insert: &[u8],
) {
  let start_position = point(source, byte);
  let old_end_position = point(source, byte + delete);
  source.splice(byte..byte + delete, insert.iter().copied());
  tree.edit(&tree_sitter::InputEdit {
    start_byte: byte,
    old_end_byte: byte + delete,
    new_end_byte: byte + insert.len(),
    start_position,
    old_end_position,
    new_end_position: point(source, byte + insert.len()),
  });
}

#[test]
fn nul_insertion_and_removal_matches_fresh_parsing() {
  for (name, language) in languages() {
    let mut parser = parser(&language);
    let mut source = br#"{"a":"b"}"#.to_vec();
    let mut tree = parser.parse(&source, None).unwrap();
    for (byte, delete, insert) in
      [(6, 0, b"\0".as_slice()), (6, 1, b"".as_slice())]
    {
      edit(&mut source, &mut tree, byte, delete, insert);
      tree = parser.parse(&source, Some(&tree)).unwrap();
      let fresh = parser.parse(&source, None).unwrap();
      assert_eq!(snapshot(&tree), snapshot(&fresh), "{name}");
    }
  }
}

#[test]
fn bom_at_nonzero_included_range_start_is_not_discarded() {
  let source = "xx\u{feff}[]";
  for (name, language) in languages() {
    let mut parser = parser(&language);
    parser
      .set_included_ranges(&[tree_sitter::Range {
        start_byte: 2,
        end_byte: source.len(),
        start_point: tree_sitter::Point::new(0, 2),
        end_point: tree_sitter::Point::new(0, source.len()),
      }])
      .unwrap();
    let tree = parser.parse(source, None).unwrap();
    let nodes = snapshot(&tree);
    let issue = nodes
      .iter()
      .find(|node| node.kind == "invalid_value")
      .unwrap();
    assert_eq!(issue.range, 2..5, "{name}");
  }
}

#[test]
fn byte_edit_histories_preserve_the_public_cst_and_decoding_issues() {
  const HISTORY_SEED: u32 = 8259;
  const EDIT_COUNT: usize = 2_000;
  const MAX_DELETED_BYTES: usize = 4;
  const MAX_SOURCE_BYTES: usize = 200;
  const RESET_INTERVAL: usize = 100;
  const XORSHIFT_LEFT_BITS: u32 = 13;
  const XORSHIFT_RIGHT_BITS: u32 = 17;
  const XORSHIFT_FINAL_LEFT_BITS: u32 = 5;
  let fragments: &[&[u8]] = &[
    b"\"",
    b"\\",
    b"u",
    b"0",
    b"12",
    b"-",
    b"+",
    b"e",
    b":",
    b",",
    b"[",
    b"]",
    b"{",
    b"}",
    b" ",
    b"\r\n",
    b"true",
    b"false",
    b"null",
    b"\0",
    b"\xff",
    b"\xc3",
    b"/",
    b"*",
    b"//",
    b"/*",
    b"*/",
    "é".as_bytes(),
    "😀".as_bytes(),
  ];
  for (language_name, language) in languages() {
    let mut state = HISTORY_SEED;
    for original in [
      br#"{"a":[true,false,null,12.3e+4,"\u1234"]}"#.as_slice(),
      br#"[01,1.a2,tru,"\q","\u12"]"#.as_slice(),
      br#"{"a":1 :2}"#.as_slice(),
      "/*é😀*/{\"a\"/*name*/:1,//line\r\n\"b\":[2,],}".as_bytes(),
      b"[1,/*unfinished\xff".as_slice(),
    ] {
      let mut parser = parser(&language);
      let mut source = original.to_vec();
      let mut tree = parser.parse(&source, None).unwrap();
      for step in 0..EDIT_COUNT {
        let mut random = |limit: usize| {
          state ^= state << XORSHIFT_LEFT_BITS;
          state ^= state >> XORSHIFT_RIGHT_BITS;
          state ^= state << XORSHIFT_FINAL_LEFT_BITS;
          state as usize % limit
        };
        let byte = random(source.len() + 1);
        let delete = random((source.len() - byte).min(MAX_DELETED_BYTES) + 1);
        let insert = fragments[random(fragments.len())];
        let previous = source.clone();
        edit(&mut source, &mut tree, byte, delete, insert);
        let incremental = parser.parse(&source, Some(&tree)).unwrap();
        let fresh = parser.parse(&source, None).unwrap();
        let a = snapshot(&incremental);
        let b = snapshot(&fresh);
        if a != b {
          panic!(
            "{language_name}: seed={HISTORY_SEED}, step={step}, before={previous:?}, edit=({byte}, {delete}, {insert:?}), after={source:?}\nincremental={}\nfresh={}",
            incremental.root_node().to_sexp(),
            fresh.root_node().to_sexp()
          );
        }
        assert_eq!(fresh.root_node().end_byte(), source.len(), "{source:?}");
        assert!(
          !fresh.root_node().has_error(),
          "{language_name}: step={step}, {source:?}: {}",
          fresh.root_node().to_sexp()
        );
        for (byte, _) in source
          .iter()
          .enumerate()
          .filter(|(_, value)| **value == 255)
        {
          assert!(
            b.iter().any(|node| node.kind == "invalid_encoding"
              && node.range.contains(&byte)),
            "unreported decoding failure at {byte} in {source:?}"
          );
        }
        assert_issue_ownership(&b, &source);
        tree = incremental;
        if source.len() > MAX_SOURCE_BYTES || (step + 1) % RESET_INTERVAL == 0 {
          source = original.to_vec();
          tree = parser.parse(&source, None).unwrap();
        }
      }
    }
  }
}

#[test]
fn continuation_byte_edits_and_restoration_match_fresh_parsing() {
  for (language_name, language) in languages() {
    for (name, original, byte, delete, insert) in [
      (
        "array separator",
        "[0 😀]".as_bytes(),
        4,
        3,
        b"e".as_slice(),
      ),
      ("integer", "1😀".as_bytes(), 2, 3, b"e".as_slice()),
      (
        "literal middle",
        b"[true]".as_slice(),
        3,
        0,
        b"\xff".as_slice(),
      ),
      (
        "literal suffix",
        b"[true]".as_slice(),
        5,
        0,
        b"\xff".as_slice(),
      ),
      (
        "literal prefix repair",
        b"[tr\xffue]".as_slice(),
        3,
        1,
        b"".as_slice(),
      ),
      (
        "literal before comment",
        b"[tr\xffue/*x*/]".as_slice(),
        3,
        1,
        b"".as_slice(),
      ),
      (
        "literal before unfinished comment",
        b"[tr\xffue/".as_slice(),
        3,
        1,
        b"".as_slice(),
      ),
      ("escape", "\"\\😀\"".as_bytes(), 3, 3, b"e".as_slice()),
      (
        "member separator",
        "{\"a\"😀}".as_bytes(),
        5,
        3,
        b"e".as_slice(),
      ),
      (
        "string ending",
        "[\"\n😀]".as_bytes(),
        4,
        3,
        b"e".as_slice(),
      ),
      (
        "literal boundary",
        b"true\xc3 ".as_slice(),
        5,
        1,
        b"\xa9".as_slice(),
      ),
      (
        "bare member name",
        b"{foo\xc3 :1}".as_slice(),
        5,
        1,
        b"\xa9".as_slice(),
      ),
      (
        "bare member name colon lookahead",
        "{a é}".as_bytes(),
        4,
        1,
        b":".as_slice(),
      ),
      (
        "trailing comma lookahead",
        "[1,é]".as_bytes(),
        4,
        1,
        b"]".as_slice(),
      ),
      (
        "block comment body",
        "/*é😀*/1".as_bytes(),
        5,
        3,
        b"\xff".as_slice(),
      ),
      (
        "line comment body",
        "//é😀\r\n1".as_bytes(),
        5,
        3,
        b"\xff".as_slice(),
      ),
      (
        "comment closing boundary",
        b"[1,/*x*\xc3]".as_slice(),
        7,
        1,
        b"/".as_slice(),
      ),
    ] {
      let mut parser = parser(&language);
      let mut source = original.to_vec();
      let mut tree = parser.parse(&source, None).unwrap();
      let restored = &original[byte..byte + delete];
      for (delete, insert) in [(delete, insert), (insert.len(), restored)] {
        edit(&mut source, &mut tree, byte, delete, insert);
        tree = parser.parse(&source, Some(&tree)).unwrap();
        let fresh = parser.parse(&source, None).unwrap();
        assert_eq!(
          snapshot(&tree),
          snapshot(&fresh),
          "{language_name}/{name}: {source:?}"
        );
        assert_issue_ownership(&snapshot(&tree), &source);
      }
      assert_eq!(source, original, "{name}");
    }
  }
}

// Split a Postgres migration file into individual statements.
//
// Splitting on ";" alone corrupts function bodies: 004_security_rls.sql defines
// its RLS helpers inside $function$ ... $function$ blocks that contain their own
// semicolons. This tokenizer tracks line comments, block comments, single-quoted
// literals and dollar-quoted blocks so only top-level semicolons split.

export function splitSqlStatements(sql) {
  const statements = [];
  let current = "";
  let index = 0;

  while (index < sql.length) {
    const rest = sql.slice(index);

    // Line comment: consume through the newline.
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", index);
      const stop = end === -1 ? sql.length : end + 1;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    // Block comment: consume through the terminator.
    if (rest.startsWith("/*")) {
      const end = sql.indexOf("*/", index + 2);
      const stop = end === -1 ? sql.length : end + 2;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    // Single-quoted literal, honouring the '' escape.
    if (sql[index] === "'") {
      let cursor = index + 1;
      while (cursor < sql.length) {
        if (sql[cursor] === "'" && sql[cursor + 1] === "'") {
          cursor += 2;
          continue;
        }
        if (sql[cursor] === "'") {
          cursor += 1;
          break;
        }
        cursor += 1;
      }
      current += sql.slice(index, cursor);
      index = cursor;
      continue;
    }

    // Dollar-quoted block: $tag$ ... $tag$ (tag may be empty).
    const dollarTag = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/.exec(rest);
    if (dollarTag) {
      const tag = dollarTag[0];
      const end = sql.indexOf(tag, index + tag.length);
      const stop = end === -1 ? sql.length : end + tag.length;
      current += sql.slice(index, stop);
      index = stop;
      continue;
    }

    if (sql[index] === ";") {
      const trimmed = current.trim();
      if (trimmed) statements.push(trimmed);
      current = "";
      index += 1;
      continue;
    }

    current += sql[index];
    index += 1;
  }

  const trailing = current.trim();
  if (trailing) statements.push(trailing);

  // Drop fragments that are only comments or whitespace.
  return statements.filter((statement) => !isCommentOnly(statement));
}

export function isCommentOnly(statement) {
  const stripped = statement
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/--[^\n]*/g, "")
    .trim();
  return stripped.length === 0;
}

// Minimal CSV writer (RFC 4180-ish) — no dependency. A field is quoted only
// when it actually needs it (contains a comma, quote, or newline); internal
// quotes are doubled per the RFC.
function csvField(value) {
  let s = value === null || value === undefined ? "" : String(value);

  // Every field here can originate from an anonymous public form submission
  // (name, email, project details) — a value starting with =, +, -, @, or a
  // tab/CR is interpreted as a formula by Excel/Sheets/Numbers regardless of
  // CSV quoting (CSV/Excel formula injection, CWE-1236). Prefixing with a
  // single quote forces it to be read as plain text instead of executed.
  if (/^[=+\-@\t\r]/.test(s)) {
    s = "'" + s;
  }

  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

// rows: array of plain objects. headers: the column order and the object
// keys to pull from each row — also becomes the header line verbatim.
function toCsv(rows, headers) {
  const lines = [headers.map(csvField).join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => csvField(row[h])).join(","));
  }
  // CRLF line endings are the RFC 4180 convention and what Excel expects.
  return lines.join("\r\n") + "\r\n";
}

module.exports = { csvField, toCsv };

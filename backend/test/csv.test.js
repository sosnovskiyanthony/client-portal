const test = require("node:test");
const assert = require("node:assert/strict");
const { csvField, toCsv } = require("../utils/csv");

test("csvField passes plain values through unquoted", () => {
  assert.equal(csvField("hello"), "hello");
  assert.equal(csvField(42), "42");
});

test("csvField quotes and escapes a value containing a comma", () => {
  assert.equal(csvField("Smith, Jane"), '"Smith, Jane"');
});

test("csvField quotes and doubles internal quotes", () => {
  assert.equal(csvField('She said "hi"'), '"She said ""hi"""');
});

test("csvField quotes a value containing a newline", () => {
  assert.equal(csvField("line one\nline two"), '"line one\nline two"');
});

test("csvField renders null/undefined as an empty field", () => {
  assert.equal(csvField(null), "");
  assert.equal(csvField(undefined), "");
});

// CSV/Excel formula injection (CWE-1236) — every field here can originate
// from an anonymous public form submission, and a value starting with one
// of these characters is interpreted as a formula by spreadsheet apps
// regardless of CSV quoting. A leading single quote forces plain-text.
test("csvField neutralizes a leading = (formula injection)", () => {
  // Also contains commas and quotes, so it's both prefixed and
  // RFC4180-quoted (with internal quotes doubled) — that's correct.
  assert.equal(
    csvField('=HYPERLINK("http://evil.example","click")'),
    '"\'=HYPERLINK(""http://evil.example"",""click"")"'
  );
  // A plain leading = with nothing else special in it — prefixed, not quoted.
  assert.equal(csvField("=cmd"), "'=cmd");
});

test("csvField neutralizes a leading +, -, and @", () => {
  assert.equal(csvField("+1+1"), "'+1+1");
  assert.equal(csvField("-2+3"), "'-2+3");
  // Contains a comma too, so this one is both prefixed and RFC4180-quoted —
  // that's correct, not a bug.
  assert.equal(csvField("@SUM(1,2)"), '"\'@SUM(1,2)"');
});

test("csvField neutralizes a leading tab or carriage return used to smuggle a formula prefix", () => {
  assert.equal(csvField("\t=cmd"), "'\t=cmd");
  // \r also triggers the separate RFC4180 quoting rule, so this one is both
  // prefixed and quoted — that's correct, not a bug.
  assert.equal(csvField("\r=cmd"), '"\'\r=cmd"');
});

test("csvField does not touch a value that merely contains, but doesn't start with, a formula character", () => {
  assert.equal(csvField("price = $5"), "price = $5");
  assert.equal(csvField("email@example.com"), "email@example.com");
});

test("toCsv produces a header row plus one row per input, CRLF-terminated", () => {
  const csv = toCsv(
    [
      { id: 1, name: "Jordan" },
      { id: 2, name: "Sam, Jr." },
    ],
    ["id", "name"]
  );
  assert.equal(csv, 'id,name\r\n1,Jordan\r\n2,"Sam, Jr."\r\n');
});

test("toCsv with no rows still emits just the header line", () => {
  assert.equal(toCsv([], ["id", "name"]), "id,name\r\n");
});

test("toCsv pulls only the listed headers, in that order, ignoring extra row keys", () => {
  const csv = toCsv([{ b: "2", a: "1", extra: "ignored" }], ["a", "b"]);
  assert.equal(csv, "a,b\r\n1,2\r\n");
});

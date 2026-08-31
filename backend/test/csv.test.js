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

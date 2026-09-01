const test = require("node:test");
const assert = require("node:assert/strict");
const { generateContractPdf } = require("../services/contractPdf");

const CONTRACT = {
  contractNumber: "CONTRACT-2026-0001",
  projectName: "Test Project",
  clientName: "Jane Smith",
  createdAt: new Date().toISOString(),
};

test("generateContractPdf produces a real, non-empty PDF buffer", async () => {
  const content = { sections: [{ key: "parties", title: "Parties", content: "This agreement is between BrindLeaf and Jane Smith." }] };
  const buffer = await generateContractPdf(CONTRACT, content);

  assert.ok(Buffer.isBuffer(buffer));
  assert.ok(buffer.length > 500, "a real PDF with content should be more than a trivial number of bytes");
  assert.equal(buffer.slice(0, 4).toString(), "%PDF", "must start with the PDF magic bytes");
});

test("generateContractPdf handles an empty sections array without throwing", async () => {
  const buffer = await generateContractPdf(CONTRACT, { sections: [] });
  assert.ok(Buffer.isBuffer(buffer));
  assert.equal(buffer.slice(0, 4).toString(), "%PDF");
});

test("generateContractPdf produces multiple pages for long content (real page-overflow, not truncation)", async () => {
  const longContent = { sections: [{ key: "long", title: "Long Section", content: "Lorem ipsum dolor sit amet. ".repeat(400) }] };
  const buffer = await generateContractPdf(CONTRACT, longContent);
  // %PDF version markers aside, a reliable page-count signal without a full
  // PDF parser is counting "/Type /Page" object occurrences — pdfkit emits
  // one per actual page.
  const pageCount = (buffer.toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
  assert.ok(pageCount >= 2, `expected multiple pages for long content, got ${pageCount}`);
});

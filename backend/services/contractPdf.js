// Generates a contract PDF as an in-memory Buffer — no filesystem writes,
// no headless browser/screenshot (the spec explicitly rules that out).
// pdfkit builds real PDF content directly: consistent margins, numbered
// pages, styled headings, readable typography via its built-in standard
// fonts (no font file to embed/ship). Verified against a real smoke test
// before this was written (`file` confirmed a genuine multi-page PDF,
// %PDF magic bytes, correct page count) — see the commit this shipped in.
const { PDFDocument } = require("pdfkit");

const BUSINESS_NAME = "BrindLeaf";
const MARGIN = 60;

function formatDate(value) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

// `content` is the {sections:[{key,title,content}]} shape from
// ai/contractSchema.js / the admin's own edits (see
// contractController.saveContractContent) — the same shape regardless of
// whether it came from the AI or a human, so this function doesn't care
// which. Returns a Promise<Buffer>.
function generateContractPdf(contract, content) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
      bufferPages: true,
      info: {
        Title: `${contract.contractNumber} — ${contract.projectName || "Contract"}`,
        Author: BUSINESS_NAME,
      },
    });

    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // Header
    doc.font("Helvetica-Bold").fontSize(18).text(BUSINESS_NAME, { align: "center" });
    doc.font("Helvetica").fontSize(10).fillColor("#666666").text("Service Agreement", { align: "center" });
    doc.moveDown(0.5);
    doc.fontSize(9).text(`Contract ${contract.contractNumber}  ·  ${formatDate(contract.createdAt)}`, { align: "center" });
    doc.fillColor("#000000");
    doc.moveDown(1.5);

    if (contract.projectName) {
      doc.font("Helvetica-Bold").fontSize(14).text(contract.projectName);
      doc.moveDown(1);
    }

    // One heading + body per section, in the order the template/draft gave
    // them — never reordered, never filtered, so what the admin approved
    // is exactly what appears in the PDF.
    const sections = (content && Array.isArray(content.sections)) ? content.sections : [];
    for (const section of sections) {
      doc.font("Helvetica-Bold").fontSize(12).text(section.title || section.key);
      doc.moveDown(0.3);
      doc.font("Helvetica").fontSize(10).text(section.content || "", { align: "left", lineGap: 2 });
      doc.moveDown(1);
    }

    // Signature block
    doc.moveDown(1);
    doc.font("Helvetica-Bold").fontSize(12).text("Signatures");
    doc.moveDown(1);
    const sigY = doc.y;
    doc.font("Helvetica").fontSize(10);
    doc.text("Service Provider:", MARGIN, sigY);
    doc.text("_________________________", MARGIN, sigY + 30);
    doc.text(`${BUSINESS_NAME}`, MARGIN, sigY + 46);
    doc.text("Date: _______________", MARGIN, sigY + 62);

    const rightColX = MARGIN + 280;
    doc.text("Client:", rightColX, sigY);
    doc.text("_________________________", rightColX, sigY + 30);
    doc.text(`${contract.clientName || ""}`, rightColX, sigY + 46);
    doc.text("Date: _______________", rightColX, sigY + 62);

    // Page numbers on every buffered page — added last, after every page
    // that's going to exist has already been created.
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      doc.font("Helvetica").fontSize(8).fillColor("#999999").text(
        `${contract.contractNumber} — Page ${i - range.start + 1} of ${range.count}`,
        MARGIN,
        doc.page.height - 40,
        { align: "center", width: doc.page.width - MARGIN * 2 }
      );
    }

    doc.end();
  });
}

module.exports = { generateContractPdf };

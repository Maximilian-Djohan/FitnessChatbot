// pdf-parse's package entry point runs test code when imported from ESM
// (it checks module.parent), so we import the library file directly.
// @types/pdf-parse only covers the package root, hence this declaration.
declare module "pdf-parse/lib/pdf-parse.js" {
  interface PdfParseResult {
    text: string;
    numpages: number;
    info: Record<string, unknown>;
  }
  function pdfParse(data: Buffer | Uint8Array): Promise<PdfParseResult>;
  export default pdfParse;
}

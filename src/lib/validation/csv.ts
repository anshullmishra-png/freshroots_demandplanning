// Minimal CSV reader. Cleaning is limited to what the data spec allows (G-D2):
// strip a BOM, normalise line endings, trim whitespace. Nothing else is changed.

export interface CsvRecord {
  /** 1-based line in the file where the record starts (the header is line 1). */
  line: number;
  cells: string[];
}

export function parseCsv(input: string): CsvRecord[] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const records: CsvRecord[] = [];
  let cells: string[] = [];
  let cell = "";
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endCell = () => {
    cells.push(cell.trim());
    cell = "";
  };
  const endRecord = () => {
    endCell();
    if (cells.some((c) => c !== "")) records.push({ line: recordLine, cells });
    cells = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === "\n") line++;
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endCell();
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      cell += ch;
    }
  }
  if (cell !== "" || cells.length > 0) endRecord();
  return records;
}

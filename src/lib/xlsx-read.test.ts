import { test } from "node:test";
import assert from "node:assert/strict";
import { crc32, deflateRawSync } from "node:zlib";
import { readXlsx } from "./xlsx-read";

/** Kleines ZIP (Deflate) im Speicher, wie Excel es für .xlsx schreibt. */
function zip(files: Record<string, string>): Buffer {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const raw = Buffer.from(content, "utf8");
    const data = deflateRawSync(raw);
    const nameBuf = Buffer.from(name, "utf8");
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(8, 10);
    head.writeUInt32LE(crc32(raw), 16);
    head.writeUInt32LE(data.length, 20);
    head.writeUInt32LE(raw.length, 24);
    head.writeUInt16LE(nameBuf.length, 28);
    head.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, data);
    central.push(head, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const dir = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

function workbook(sheetXml: string, shared: string[] = []): Buffer {
  return zip({
    "xl/workbook.xml": `<?xml version="1.0" encoding="UTF-8"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Inventur Getränke" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `<?xml version="1.0" encoding="UTF-8"?><Relationships><Relationship Id="rId1" Type="worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    "xl/sharedStrings.xml": `<sst>${shared.map((t) => `<si><t>${t}</t></si>`).join("")}</sst>`,
    "xl/worksheets/sheet1.xml": `<?xml version="1.0" encoding="UTF-8"?><worksheet>${sheetXml}</worksheet>`,
  });
}

test("readXlsx liest eine gewöhnliche Inventurliste wie bisher", () => {
  const shared = ["Inventurliste Getränke", "Bezeichnung", "Einheit", "EK netto", "Ist Bestand", "Apfelsaft", "FL 1,00"];
  const xml =
    `<dimension ref="A1:E4"/><sheetData>` +
    `<row r="1"><c r="A1" t="s"><v>0</v></c></row>` +
    `<row r="3"><c r="A3" t="s"><v>1</v></c><c r="B3" t="s"><v>2</v></c><c r="C3" t="s"><v>3</v></c><c r="D3" t="s"><v>4</v></c></row>` +
    `<row r="4"><c r="A4" t="s"><v>5</v></c><c r="B4" t="s"><v>6</v></c><c r="C4"><v>1.25</v></c><c r="E4" t="inlineStr"><is><t>Notiz</t></is></c></row>` +
    `<row><c t="b"><v>1</v></c><c t="str"><v>a &amp; b</v></c></row>` +
    `</sheetData>`;
  const [sheet] = readXlsx(workbook(xml, shared));
  assert.equal(sheet.name, "Inventur Getränke");
  assert.deepEqual(sheet.rows, [
    ["Inventurliste Getränke"],
    [],
    ["Bezeichnung", "Einheit", "EK netto", "Ist Bestand"],
    ["Apfelsaft", "FL 1,00", 1.25, null, "Notiz"],
    [1, "a & b"],
  ]);
});

test("readXlsx: übertriebene Größenangabe im Kopf schadet nicht", () => {
  const xml = `<dimension ref="A1:XFD1048576"/><sheetData><row r="1"><c r="A1"><v>7</v></c></row></sheetData>`;
  assert.deepEqual(readXlsx(workbook(xml))[0].rows, [[7]]);
});

test("readXlsx lehnt riesige Zeilennummern ab", () => {
  const xml = `<sheetData><row r="20000000"><c r="A20000000"><v>1</v></c></row></sheetData>`;
  assert.throws(() => readXlsx(workbook(xml)), /Excel-Datei ist zu groß/);
  // Die letzte erlaubte Zeile geht noch.
  const ok = `<sheetData><row r="200000"><c r="A200000"><v>1</v></c></row></sheetData>`;
  const rows = readXlsx(workbook(ok))[0].rows;
  assert.equal(rows.length, 200_000);
  assert.deepEqual(rows[199_999], [1]);
});

test("readXlsx lehnt Spalten jenseits von XFD ab", () => {
  assert.throws(() => readXlsx(workbook(`<sheetData><row r="1"><c r="ZZZZZZ1"><v>1</v></c></row></sheetData>`)), /Excel-Datei ist zu groß/);
  assert.throws(() => readXlsx(workbook(`<sheetData><row r="1"><c r="XFE1"><v>1</v></c></row></sheetData>`)), /Excel-Datei ist zu groß/);
  const rows = readXlsx(workbook(`<sheetData><row r="1"><c r="XFD1"><v>1</v></c></row></sheetData>`))[0].rows;
  assert.equal(rows[0].length, 16_384);
  assert.equal(rows[0][16_383], 1);
});

test("readXlsx begrenzt die Zahl der Zeilen und Zellen", () => {
  // Viele Zeilen ohne Nummer.
  const many = `<sheetData>${"<row><c><v>1</v></c></row>".repeat(200_001)}</sheetData>`;
  assert.throws(() => readXlsx(workbook(many)), /Excel-Datei ist zu groß/);
  // Wenige Zeilen, aber jede bis Spalte XFD: zu viele Zellen.
  const wide = `<sheetData>${Array.from({ length: 400 }, (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}"><v>1</v></c></row>`).join("")}</sheetData>`;
  assert.throws(() => readXlsx(workbook(wide)), /Excel-Datei ist zu groß/);
});

test("readXlsx lehnt viele Zeilen bis XFD ab, bevor sie aufgebaut sind", () => {
  const xml = `<sheetData>${Array.from({ length: 5_000 }, (_, i) => `<row r="${i + 1}"><c r="XFD${i + 1}"><v>1</v></c></row>`).join("")}</sheetData>`;
  const buf = workbook(xml);
  const start = Date.now();
  assert.throws(() => readXlsx(buf), /Excel-Datei ist zu groß/);
  assert.ok(Date.now() - start < 1_000, `zu langsam: ${Date.now() - start} ms`);
});

test("readXlsx überspringt ungültige Zeilennummern wie bisher", () => {
  const xml = `<sheetData><row r="-3"><c r="A1"><v>9</v></c></row><row r="1"><c r="A1"><v>1</v></c></row><row r="1.5"><c r="A1"><v>8</v></c></row><row><c r="A2"><v>2</v></c></row></sheetData>`;
  assert.deepEqual(readXlsx(workbook(xml))[0].rows, [[1], [2]]);
});

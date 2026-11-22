//! Minimal XLSX writer. A workbook is a ZIP of a few XML parts, so a small
//! stored-only ZIP implementation avoids a heavyweight dependency.

pub enum Cell {
    Text(String),
    Number(i64),
    Empty,
}

fn crc32(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for byte in bytes {
        crc ^= u32::from(*byte);
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                0xedb8_8320 ^ (crc >> 1)
            } else {
                crc >> 1
            };
        }
    }
    crc ^ 0xffff_ffff
}

fn write_u16(target: &mut Vec<u8>, value: u16) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn write_u32(target: &mut Vec<u8>, value: u32) {
    target.extend_from_slice(&value.to_le_bytes());
}

fn store_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut local = Vec::new();
    let mut central = Vec::new();
    let mut offset = 0u32;

    for (name, data) in entries {
        let name = name.as_bytes();
        let crc = crc32(data);

        let mut header = Vec::with_capacity(30);
        write_u32(&mut header, 0x0403_4b50);
        write_u16(&mut header, 20);
        write_u16(&mut header, 0x0800);
        write_u16(&mut header, 0);
        write_u16(&mut header, 0);
        write_u16(&mut header, 0x21);
        write_u32(&mut header, crc);
        write_u32(&mut header, data.len() as u32);
        write_u32(&mut header, data.len() as u32);
        write_u16(&mut header, name.len() as u16);
        write_u16(&mut header, 0);
        local.extend_from_slice(&header);
        local.extend_from_slice(name);
        local.extend_from_slice(data);

        let mut directory = Vec::with_capacity(46);
        write_u32(&mut directory, 0x0201_4b50);
        write_u16(&mut directory, 20);
        write_u16(&mut directory, 20);
        write_u16(&mut directory, 0x0800);
        write_u16(&mut directory, 0);
        write_u16(&mut directory, 0);
        write_u16(&mut directory, 0x21);
        write_u32(&mut directory, crc);
        write_u32(&mut directory, data.len() as u32);
        write_u32(&mut directory, data.len() as u32);
        write_u16(&mut directory, name.len() as u16);
        write_u16(&mut directory, 0);
        write_u16(&mut directory, 0);
        write_u16(&mut directory, 0);
        write_u16(&mut directory, 0);
        write_u32(&mut directory, 0);
        write_u32(&mut directory, offset);
        central.extend_from_slice(&directory);
        central.extend_from_slice(name);

        offset += header.len() as u32 + name.len() as u32 + data.len() as u32;
    }

    let mut end = Vec::with_capacity(22);
    write_u32(&mut end, 0x0605_4b50);
    write_u16(&mut end, 0);
    write_u16(&mut end, 0);
    write_u16(&mut end, entries.len() as u16);
    write_u16(&mut end, entries.len() as u16);
    write_u32(&mut end, central.len() as u32);
    write_u32(&mut end, offset);
    write_u16(&mut end, 0);

    let mut output = local;
    output.extend_from_slice(&central);
    output.extend_from_slice(&end);
    output
}

fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn column_letter(index: usize) -> String {
    let mut value = index + 1;
    let mut letters = String::new();
    while value > 0 {
        let remainder = (value - 1) % 26;
        letters.insert(0, char::from(b'A' + remainder as u8));
        value = (value - 1) / 26;
    }
    letters
}

fn cell_xml(reference: &str, cell: &Cell) -> String {
    match cell {
        Cell::Empty => String::new(),
        Cell::Number(value) => format!("<c r=\"{reference}\"><v>{value}</v></c>"),
        Cell::Text(value) if value.is_empty() => String::new(),
        Cell::Text(value) => format!(
            "<c r=\"{reference}\" t=\"inlineStr\"><is><t xml:space=\"preserve\">{}</t></is></c>",
            escape_xml(value)
        ),
    }
}

/// Builds a one-sheet workbook named «پرداخت‌ها».
pub fn build_payments_workbook(rows: &[Vec<Cell>]) -> Vec<u8> {
    let xml = |value: String| value.into_bytes();
    let rows_xml = rows
        .iter()
        .enumerate()
        .map(|(row_index, row)| {
            let cells = row
                .iter()
                .enumerate()
                .map(|(column_index, cell)| {
                    cell_xml(
                        &format!("{}{}", column_letter(column_index), row_index + 1),
                        cell,
                    )
                })
                .collect::<String>();
            format!("<row r=\"{}\">{cells}</row>", row_index + 1)
        })
        .collect::<String>();

    let entries = vec![
        (
            "[Content_Types].xml".to_string(),
            xml("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">
<Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/>
<Default Extension=\"xml\" ContentType=\"application/xml\"/>
<Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/>
<Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/>
</Types>".to_string()),
        ),
        (
            "_rels/.rels".to_string(),
            xml("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/>
</Relationships>"
                .to_string()),
        ),
        (
            "xl/workbook.xml".to_string(),
            xml("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\">
<sheets><sheet name=\"پرداخت‌ها\" sheetId=\"1\" r:id=\"rId1\"/></sheets>
</workbook>"
                .to_string()),
        ),
        (
            "xl/_rels/workbook.xml.rels".to_string(),
            xml("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\">
<Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/>
</Relationships>"
                .to_string()),
        ),
        (
            "xl/worksheets/sheet1.xml".to_string(),
            xml(format!(
                "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>
<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><sheetData>{rows_xml}</sheetData></worksheet>"
            )),
        ),
    ];
    store_zip(&entries)
}

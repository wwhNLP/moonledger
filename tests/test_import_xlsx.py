import io
import unittest
import zipfile
from import_xlsx import read_xlsx


def workbook(sheet_count=1, sheet_xml=None, styles='', shared=''):
    output = io.BytesIO()
    ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
    sheet_xml = sheet_xml or '<row r="1"><c r="A1" t="inlineStr"><is><t>交易时间</t></is></c></row>'
    with zipfile.ZipFile(output, 'w', zipfile.ZIP_DEFLATED) as z:
        sheets = ''.join(f'<sheet name="Sheet{i}" sheetId="{i}" r:id="rId{i}"/>' for i in range(1, sheet_count + 1))
        z.writestr('xl/workbook.xml', f'<workbook xmlns="{ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>{sheets}</sheets></workbook>')
        rels = ''.join(f'<Relationship Id="rId{i}" Target="worksheets/sheet{i}.xml"/>' for i in range(1, sheet_count + 1))
        z.writestr('xl/_rels/workbook.xml.rels', f'<Relationships>{rels}</Relationships>')
        for i in range(1, sheet_count + 1):
            z.writestr(f'xl/worksheets/sheet{i}.xml', f'<worksheet xmlns="{ns}"><sheetData>{sheet_xml}</sheetData></worksheet>')
        if styles:
            z.writestr('xl/styles.xml', f'<styleSheet xmlns="{ns}">{styles}</styleSheet>')
        if shared:
            z.writestr('xl/sharedStrings.xml', f'<sst xmlns="{ns}">{shared}</sst>')
    return output.getvalue()


class XlsxTests(unittest.TestCase):
    def test_read_strings_dates_and_long_transaction_ids_without_float_conversion(self):
        rows = '<row r="1"><c r="A1" s="1"><v>45351.5</v></c><c r="B1" t="s"><v>0</v></c><c r="C1"><v>123456789012345678901234</v></c><c r="E1" t="inlineStr"><is><t>午饭</t></is></c></row>'
        data = workbook(sheet_xml=rows, styles='<cellXfs><xf numFmtId="0"/><xf numFmtId="14"/></cellXfs>', shared='<si><t>餐饮美食</t></si>')
        row = read_xlsx(data)[0]['rows'][0]
        self.assertEqual(row, ['2024-02-29 12:00:00', '餐饮美食', '123456789012345678901234', '', '午饭'])

    def test_formula_is_not_used_as_a_financial_value(self):
        data = workbook(sheet_xml='<row><c r="A1"><f>SUM(1,2)</f><v>3</v></c></row>')
        self.assertIn('公式', read_xlsx(data)[0]['rows'][0][0])

    def test_more_than_ten_sheets_fails_instead_of_silently_truncating(self):
        with self.assertRaisesRegex(ValueError, '超过 10'):
            read_xlsx(workbook(sheet_count=11))

    def test_corrupt_file_and_oversized_file_are_rejected(self):
        with self.assertRaises(ValueError):
            read_xlsx(b'not a workbook')
        with self.assertRaises(ValueError):
            read_xlsx(b'x' * (10 * 1024 * 1024 + 1))

    def test_multiple_sheets_remain_visible_for_frontend_ambiguity_check(self):
        self.assertEqual(len(read_xlsx(workbook(sheet_count=2))), 2)

    def test_invalid_shared_string_reference_is_rejected(self):
        data = workbook(sheet_xml='<row><c r="A1" t="s"><v>99</v></c></row>')
        with self.assertRaisesRegex(ValueError, '索引'):
            read_xlsx(data)


if __name__ == '__main__':
    unittest.main()

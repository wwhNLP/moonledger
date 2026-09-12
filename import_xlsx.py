"""Read an unencrypted XLSX in memory, without executing formulas or macros."""
import io
import posixpath
import re
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def read_xlsx(data):
    if len(data) > 10 * 1024 * 1024:
        raise ValueError('文件过大，请使用 10 MB 以内的 XLSX。')
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError('不是可读取的 XLSX。请先解压导出的账单，密码文件需先解锁。') from None
    with archive:
        info = archive.infolist()
        if len(info) > 2000 or sum(item.file_size for item in info) > 50 * 1024 * 1024:
            raise ValueError('表格解压后过大，请缩小导出时间范围。')
        if any(item.flag_bits & 1 for item in info):
            raise ValueError('请先在本机解锁表格，再导入 XLSX。')

        def xml(name, optional=False):
            if name not in archive.namelist():
                if optional:
                    return None
                raise ValueError('表格结构不完整，请重新导出。')
            blob = archive.read(name)
            if b'<!DOCTYPE' in blob.upper() or b'<!ENTITY' in blob.upper():
                raise ValueError('不支持包含外部定义的表格。')
            try:
                return ET.fromstring(blob)
            except ET.ParseError:
                raise ValueError('表格内容损坏，请重新导出。') from None

        shared_root = xml('xl/sharedStrings.xml', True)
        shared = [] if shared_root is None else [''.join(si.itertext()) for si in shared_root.findall('s:si', NS)]
        styles = xml('xl/styles.xml', True)
        date_styles = set()
        if styles is not None:
            formats = {int(n.get('numFmtId')): n.get('formatCode', '') for n in styles.findall('s:numFmts/s:numFmt', NS)}
            for i, xf in enumerate(styles.findall('s:cellXfs/s:xf', NS)):
                number_format = int(xf.get('numFmtId', '0'))
                code = re.sub(r'"[^"]*"|\[[^]]*\]', '', formats.get(number_format, '')).lower()
                if number_format in range(14, 23) or (number_format >= 164 and re.search(r'[yd]', code)):
                    date_styles.add(i)
        workbook = xml('xl/workbook.xml')
        properties = workbook.find('s:workbookPr', NS)
        date1904 = properties is not None and properties.get('date1904') in ['1', 'true']
        relations = xml('xl/_rels/workbook.xml.rels')
        targets = {r.get('Id'): r.get('Target') for r in relations if r.get('TargetMode') != 'External'}
        sheets = []
        total_rows = 0
        sheet_nodes = workbook.findall('s:sheets/s:sheet', NS)
        if len(sheet_nodes) > 10:
            raise ValueError('工作表超过 10 个，请将交易工作表另存后分次导入。')
        for sheet in sheet_nodes:
            target = targets.get(sheet.get(REL))
            if not target:
                continue
            path = posixpath.normpath(target.lstrip('/') if target.startswith('/') else 'xl/' + target)
            if not path.startswith('xl/worksheets/') or not path.endswith('.xml'):
                continue
            root = xml(path)
            rows = []
            for row in root.findall('s:sheetData/s:row', NS):
                values = []
                for cell in row.findall('s:c', NS):
                    ref = cell.get('r', '')
                    letters = re.match(r'[A-Z]+', ref)
                    column = 0
                    for letter in letters.group() if letters else 'A':
                        column = column * 26 + ord(letter) - 64
                    if column > 80:
                        continue
                    while len(values) < column:
                        values.append('')
                    node = cell.find('s:v', NS)
                    value = node.text if node is not None and node.text else ''
                    kind = cell.get('t')
                    if kind == 's':
                        index = int(value or '-1')
                        if index < 0 or index >= len(shared):
                            raise ValueError('表格共享文本索引无效。')
                        value = shared[index]
                    elif kind == 'inlineStr':
                        inline = cell.find('s:is', NS)
                        value = ''.join(inline.itertext()) if inline is not None else ''
                    elif cell.find('s:f', NS) is not None:
                        # Do not trust cached formula results as financial data.
                        value = '[公式单元格，请转换为值]'
                    elif value and int(cell.get('s', '0')) in date_styles:
                        try:
                            epoch = datetime(1904, 1, 1) if date1904 else datetime(1899, 12, 30)
                            value = (epoch + timedelta(days=float(value))).strftime('%Y-%m-%d %H:%M:%S')
                        except (ValueError, OverflowError):
                            raise ValueError('表格日期无效。') from None
                    if len(value) > 4000:
                        raise ValueError('单元格文本过长，请使用原始对账文件。')
                    values[column - 1] = value
                if any(values):
                    rows.append(values)
                    total_rows += 1
                    if total_rows > 50050:
                        raise ValueError('一次最多读取 50,000 笔账单。')
            sheets.append({'name': sheet.get('name', '工作表'), 'rows': rows})
        if not sheets:
            raise ValueError('表格中没有可读取的工作表。')
        return sheets

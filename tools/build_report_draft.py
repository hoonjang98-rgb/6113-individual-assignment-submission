"""Build a seven-page English draft or final report; generation never certifies readiness."""
import argparse
import hashlib
import html
import json
import re
from datetime import datetime, timezone
from pathlib import Path

from pypdf import PdfReader
from reportlab.graphics.shapes import Drawing, Line, Polygon, Rect, String
from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, Image

ROOT = Path(__file__).resolve().parents[1]
TEAL = colors.HexColor('#166b5d')
INK = colors.HexColor('#18382f')
MUTED = colors.HexColor('#52665b')
LIGHT = colors.HexColor('#edf4ef')
WIDTH = A4[0] - 84

styles = {
    'body': ParagraphStyle('body', fontName='Helvetica', fontSize=10.1, leading=14.1,
                           textColor=INK, spaceAfter=7, alignment=TA_LEFT),
    'h1': ParagraphStyle('h1', fontName='Helvetica-Bold', fontSize=29, leading=33,
                         textColor=TEAL, spaceAfter=10),
    'h2': ParagraphStyle('h2', fontName='Helvetica-Bold', fontSize=14.2, leading=18,
                         textColor=TEAL, spaceBefore=8, spaceAfter=8),
    'cell': ParagraphStyle('cell', fontName='Helvetica', fontSize=9.1, leading=12.1,
                           textColor=INK, spaceAfter=0),
    'caption': ParagraphStyle('caption', fontName='Helvetica', fontSize=9.2, leading=12.4,
                              textColor=MUTED, spaceBefore=3, spaceAfter=9),
    'reference': ParagraphStyle('reference', fontName='Helvetica', fontSize=9.4, leading=12.7,
                                textColor=INK, spaceAfter=5),
}

def inline(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'`([^`]+)`', r'<font name="Courier" size="8.6">\1</font>', text)
    text = re.sub(r'\[([^\]]+)\]\((https://[^)]+)\)',
                  r'<a href="\2" color="#166b5d"><u>\1</u></a>', text)
    return text

def para(text, kind='body'):
    return Paragraph(inline(text), styles[kind])

def architecture():
    d = Drawing(515, 225)
    def box(x, y, w, h, lines):
        d.add(Rect(x, y, w, h, fillColor=LIGHT, strokeColor=TEAL, strokeWidth=.8, rx=5, ry=5))
        for label, dy, size, bold in lines:
            d.add(String(x + w/2, y + dy, label, textAnchor='middle', fillColor=INK,
                         fontName='Helvetica-Bold' if bold else 'Helvetica', fontSize=size))
    def arrow(x1, y1, x2, y2):
        d.add(Line(x1, y1, x2, y2, strokeColor=TEAL, strokeWidth=1.3))
        if y1 == y2:
            points = [x2, y2, x2-5, y2+3, x2-5, y2-3]
        else:
            points = [x2, y2, x2-3, y2+5, x2+3, y2+5]
        d.add(Polygon(points, fillColor=TEAL, strokeColor=TEAL))
    box(5, 55, 98, 145, [('Browser', 96, 13, True), ('English UI', 74, 10, False), ('HTML/CSS/JS', 57, 9.7, False)])
    box(135, 145, 106, 55, [('MetaMask', 33, 11.5, True), ('Wallet signing', 16, 9.5, False)])
    box(135, 55, 106, 55, [('Flask API', 33, 11.5, True), ('Public reads', 16, 9.5, False)])
    box(264, 55, 81, 55, [('RPC', 32, 12, True), ('Gateway', 16, 9.5, False)])
    box(371, 55, 138, 145, [('Sepolia', 108, 12, True), ('FreelancePay', 87, 11, True), ('Rules / state / events', 58, 9, False), ('Chain 11155111', 34, 9, False)])
    box(371, 10, 138, 28, [('Issuer: exact value', 10, 9.5, True)])
    arrow(103, 172, 135, 172)
    arrow(241, 172, 371, 172)
    d.add(String(306, 181, 'Signed writes', textAnchor='middle', fillColor=MUTED, fontSize=9))
    arrow(103, 82, 135, 82)
    arrow(241, 82, 264, 82)
    arrow(345, 82, 371, 82)
    arrow(440, 55, 440, 38)
    d.add(String(186, 120, 'Read-only server', textAnchor='middle', fillColor=MUTED, fontSize=9))
    scale = WIDTH / d.width
    d.scale(scale, scale)
    d.width *= scale
    d.height *= scale
    return d

def table(lines, available_width=WIDTH):
    rows = []
    for line in lines:
        cells = [cell.strip() for cell in line.strip().strip('|').split('|')]
        if all(re.fullmatch(r'[:\- ]+', cell) for cell in cells):
            continue
        rows.append([para(cell, 'cell') for cell in cells])
    columns = len(rows[0])
    widths = [available_width * .29, available_width * .71] if columns == 2 else [available_width * .31, available_width * .46, available_width * .23]
    if 'Actual Sepolia receipt' in lines[0]:
        widths = [available_width * .54, available_width * .23, available_width * .23]
    result = Table(rows, colWidths=widths, hAlign='LEFT', repeatRows=1)
    result.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), LIGHT),
        ('LINEBELOW', (0, 0), (-1, 0), .7, TEAL),
        ('LINEBELOW', (0, 1), (-1, -1), .35, colors.HexColor('#d3dfd7')),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 7),
        ('RIGHTPADDING', (0, 0), (-1, -1), 7),
    ]))
    return [result, Spacer(1, 8)]

def page_blocks(text):
    result = []
    lines = text.strip().splitlines()
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        if not line:
            i += 1
            continue
        if line.startswith('# '):
            result.append(para(line[2:], 'h1'))
        elif line.startswith('## '):
            result.append(para(line[3:], 'h2'))
        elif line.startswith('|'):
            group = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                group.append(lines[i])
                i += 1
            result.extend(table(group))
            continue
        elif line.startswith('!['):
            path = re.search(r'\]\(([^)]+)\)', line).group(1)
            if path.endswith('.svg'):
                result.append(architecture())
            else:
                image = Image(str(ROOT / 'docs' / path))
                ratio = 245 / image.imageWidth
                image.drawWidth = 245
                image.drawHeight = image.imageHeight * ratio
                image.hAlign = 'CENTER'
                # Keep the original screenshot readable and place its caption
                # and receipt measurements beside it instead of shrinking it.
                if path in ('evidence/screenshots/app-sepolia-paid-user.png',
                            'evidence/screenshots/hosted-client-paid.png'):
                    next_index = i + 1
                    while not lines[next_index].strip():
                        next_index += 1
                    assert lines[next_index].startswith('**Figure 2.')
                    caption = para(lines[next_index].strip(), 'caption')
                    next_index += 1
                    while not lines[next_index].strip():
                        next_index += 1
                    receipt_lines = []
                    while next_index < len(lines) and lines[next_index].strip().startswith('|'):
                        receipt_lines.append(lines[next_index])
                        next_index += 1
                    assert receipt_lines and 'Actual Sepolia receipt' in receipt_lines[0]
                    side = [caption, Spacer(1, 10)] + table(receipt_lines, WIDTH - 259)
                    paired = Table([[image, '', side]], colWidths=[245, 14, WIDTH - 259])
                    paired.setStyle(TableStyle([
                        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
                        ('LEFTPADDING', (0, 0), (-1, -1), 0),
                        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
                        ('TOPPADDING', (0, 0), (-1, -1), 0),
                        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
                    ]))
                    result.extend([Spacer(1, 8), paired, Spacer(1, 12)])
                    i = next_index - 1
                else:
                    result.append(image)
        else:
            group = [line]
            while i+1 < len(lines) and lines[i+1].strip() and not lines[i+1].startswith(('#', '|', '![')):
                i += 1
                group.append(lines[i].strip())
            kind = 'caption' if line.startswith('**Figure ') else 'reference' if re.match(r'^\[\d+\]', line) else 'body'
            result.append(para(' '.join(group), kind))
        i += 1
    return result

def chrome(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#d3dfd7'))
    canvas.line(42, A4[1]-40, A4[0]-42, A4[1]-40)
    canvas.setFillColor(MUTED)
    canvas.setFont('Helvetica', 8.2)
    canvas.drawString(42, A4[1]-31, 'FREELANCEPAY  /  SC6113')
    canvas.drawRightString(A4[0]-42, A4[1]-31,
                           'DRAFT - LIVE VERIFICATION OPEN' if doc.report_stage == 'draft' else 'INDIVIDUAL ASSIGNMENT REPORT')
    canvas.line(42, 35, A4[0]-42, 35)
    label = 'English report preparation' if doc.report_stage == 'draft' else 'English assignment report'
    canvas.drawString(42, 22, f'{label} | {doc.report_date} | Test funds only')
    canvas.drawRightString(A4[0]-42, 22, f'{doc.page} / 7')
    canvas.restoreState()


def reference_entries(source):
    entries = [
        {'number': int(number), 'title': title, 'url': url}
        for number, title, url in re.findall(
            r'^\[(\d+)\]\s+\[([^\]]+)\]\((https://[^)\s]+)\)\.?\s*$',
            source, re.MULTILINE)
    ]
    numbers = [entry['number'] for entry in entries]
    if not entries or numbers != list(range(1, len(entries) + 1)):
        raise ValueError('References must have unique consecutive numbers starting at 1.')
    for citation in re.findall(r'\[(\d+(?:,\d+)*)\]', source):
        if not set(map(int, citation.split(','))) <= set(numbers):
            raise ValueError(f'Citation [{citation}] has no bibliography entry.')
    return entries


def build_report(stage='draft'):
    if stage not in ('draft', 'final'):
        raise ValueError('Unknown report stage.')
    source_path = ROOT / 'docs' / ('REPORT_DRAFT.md' if stage == 'draft' else 'REPORT_FINAL.md')
    if not source_path.is_file():
        raise FileNotFoundError(f'{source_path.name} is required for {stage} mode; no automatic promotion of a draft.')
    output = ROOT / 'output' / 'pdf' / ('FreelancePay_Report_DRAFT.pdf' if stage == 'draft' else 'FreelancePay_Report.pdf')
    record_path = ROOT / 'docs/evidence' / ('report-draft-preparation.json' if stage == 'draft' else 'report-final-build.json')
    source = source_path.read_text(encoding='utf-8')
    if re.search(r'[\uac00-\ud7a3]', source):
        raise ValueError('Report source must be English.')
    if stage == 'draft' and 'DRAFT - not ready for submission.' not in source:
        raise ValueError('Draft source must explicitly identify its incomplete status.')
    if stage == 'final' and ('DRAFT -' in source or 'LIVE VERIFICATION OPEN' in source):
        raise ValueError('Final source still contains a draft-only banner.')
    entries = reference_entries(source)
    pages = re.split(r'<!-- PAGE \d+ -->', source)[1:]
    if len(pages) != 7:
        raise ValueError('The report layout requires seven explicit page sections.')
    previous_builds = []
    if record_path.is_file():
        previous = json.loads(record_path.read_text(encoding='utf-8'))
        previous_builds = previous.get('previousBuilds', []) + [{
            key: previous.get(key) for key in ['recordedAtUtc', 'pdfSha256', 'sourceSha256',
                                              'pagesIncludingTitleAndReferences', 'visualInspection', 'result']
        }]
    output.parent.mkdir(parents=True, exist_ok=True)
    record_path.parent.mkdir(parents=True, exist_ok=True)
    flow = []
    for index, page_source in enumerate(pages):
        if index:
            flow.append(PageBreak())
        flow.extend(page_blocks(page_source))
    # Validate a temporary PDF first so failed layout checks preserve the prior artifact.
    pending = output.with_suffix('.building.pdf')
    document = SimpleDocTemplate(str(pending), pagesize=A4, leftMargin=42, rightMargin=42,
                                 topMargin=51, bottomMargin=45,
                                 title='FreelancePay - SC6113 Report' + (' Draft' if stage == 'draft' else ''),
                                 author='SC6113 project - Codex-assisted preparation',
                                 subject='Incomplete report preparation' if stage == 'draft' else
                                         'SC6113 individual assignment; evidence and acceptance recorded separately')
    now = datetime.now(timezone.utc)
    document.report_stage = stage
    document.report_date = now.strftime('%d %B %Y').lstrip('0')
    document.build(flow, onFirstPage=chrome, onLaterPages=chrome)
    with pending.open('rb') as handle:
        reader = PdfReader(handle)
        text = '\n'.join(page.extract_text() for page in reader.pages)
        topics = ['Introduction', 'Problem Statement', 'Objectives', 'System Architecture',
                  'Technologies Used', 'Smart Contract Design', 'Application Design', 'Implementation',
                  'Testing and Results', 'Challenges Encountered', 'Limitations', 'Future Improvements', 'Conclusion']
        page_count = len(reader.pages)
        assert page_count == 7, f'Layout produced {page_count} pages; expected seven.'
        assert all(topic in text for topic in topics), 'Missing prescribed report topic.'
        assert not re.search(r'[\uac00-\ud7a3]', text)
        assert text.count('DRAFT - LIVE VERIFICATION OPEN') == (7 if stage == 'draft' else 0)
        uris = {str(annotation.get_object().get('/A', {}).get('/URI'))
                for page in reader.pages for annotation in page.get('/Annots', [])
                if annotation.get_object().get('/A', {}).get('/URI')}
        assert {entry['url'] for entry in entries} <= uris, 'Missing clickable reference.'
    pending.replace(output)
    screenshot_path = next(path for path in re.findall(r'!\[[^\]]*\]\(([^)]+)\)', source)
                           if not path.endswith('.svg'))
    screenshot_relative = 'docs/' + screenshot_path
    record = {
        'schemaVersion': 2, 'recordedAtUtc': now.isoformat(), 'stage': stage,
        'result': f'Seven-page English {stage} built; visual QA pending. Build is not submission approval.',
        'basis': 'Original 5-8 page/13-topic report; approved report strengthening and full assignment Goal.',
        'traceability': {'requirements': [f'R{i:02}' for i in range(1, 19)],
                         'objectives': [f'L{i:02}' for i in range(1, 6)],
                         'verification': ['V01', 'V17', 'V19', 'V20', 'V21', 'V22'], 'deliverables': ['D08', 'D09', 'D10']},
        'pdf': output.relative_to(ROOT).as_posix(), 'source': source_path.relative_to(ROOT).as_posix(),
        'pdfSha256': hashlib.sha256(output.read_bytes()).hexdigest(),
        'sourceSha256': hashlib.sha256(source_path.read_bytes()).hexdigest(),
        'builderSha256': hashlib.sha256((ROOT / 'tools/build_report_draft.py').read_bytes()).hexdigest(),
        'pagesIncludingTitleAndReferences': page_count, 'topicsFound': topics,
        'extractedWords': len(text.split()), 'englishOnlyCheck': 'No Hangul; English prose requires visual review.',
        'visualInspection': 'Pending', 'submissionReady': False,
        'readinessReason': 'Report generation does not close live-wallet, Render, visual-review or final-package acceptance.',
        'sourceScreenshot': screenshot_relative,
        'sourceScreenshotSha256': hashlib.sha256((ROOT / screenshot_relative).read_bytes()).hexdigest(),
        'figure1': 'Native compact vector architecture derived from implemented source/design; not hosting evidence.',
        'applicationSourceChanges': 0, 'publicTransactionsSubmitted': 0,
        'previousBuilds': previous_builds,
        'references': [entry['url'] for entry in entries], 'referenceEntries': entries,
        'clickableReferenceCheck': 'Passed'
    }
    if stage == 'draft':
        record['openGates'] = ['Actual wallet W01-W06', 'Verified Render Linux/HTTPS and actual Chrome journeys',
                               'Final report updates, supporting deliverables and final clean package audit']
    record_path.write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
    return record


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=['draft', 'final'], default='draft',
                        help='Default draft. Final requires a separate REPORT_FINAL.md and never certifies submission readiness.')
    args = parser.parse_args()
    record = build_report(args.stage)
    print(json.dumps({'result': record['result'], 'pages': record['pagesIncludingTitleAndReferences'],
                      'words': record['extractedWords'], 'pdf': record['pdf']}))


if __name__ == '__main__':
    main()

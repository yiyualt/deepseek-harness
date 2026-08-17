"""Build a minimal but valid .docx with a ~200-char Chinese essay, no third-party deps."""
import os
import zipfile

TITLE = "专注的力量"
PARAS = [
    "专注是一种稀缺的能力。在这个信息爆炸的时代，注意力被通知、消息和短视频不断切割，"
    "很难长时间沉浸在一件事里。然而，真正有价值的成果，几乎都来自深度的、不被打扰的思考与练习。",
    "学会专注，首先要创造安静的环境：放下手机，关掉多余的页面，让大脑只面对眼前的任务。"
    "其次，要接受开始时的不适，进入专注往往需要十几分钟的过渡。当注意力稳定下来，"
    "思维会变得敏锐，晦涩的问题也会逐渐清晰。",
    "专注不是天赋，而是可以训练的习惯。每天留出一段不被打扰的时间，长期坚持，"
    "就会带来远超预期的改变。",
]


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def title_p(text: str) -> str:
    rpr = ('<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" '
           'w:eastAsia="微软雅黑"/><w:b/><w:sz w:val="36"/><w:szCs w:val="36"/></w:rPr>')
    return (f'<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="240"/>{rpr}</w:pPr>'
            f'<w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>')


def body_p(text: str) -> str:
    rpr = ('<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" '
           'w:eastAsia="微软雅黑"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr>')
    return (f'<w:p><w:pPr><w:ind w:firstLineChars="200" w:firstLine="480"/>'
            f'<w:spacing w:after="120" w:line="360" w:lineRule="auto"/>{rpr}</w:pPr>'
            f'<w:r>{rpr}<w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>')


document_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    '<w:body>'
    + title_p(TITLE)
    + "".join(body_p(p) for p in PARAS)
    + ('<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
       '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>')
    + '</w:body></w:document>'
)

content_types_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" '
    'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)

rels_xml = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" '
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
    'Target="word/document.xml"/>'
    '</Relationships>'
)

OUT = "/Users/yuyi/Pyleaf/deepseek-harness/专注的力量.docx"
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types_xml)
    z.writestr("_rels/.rels", rels_xml)
    z.writestr("word/document.xml", document_xml)

body_chars = sum(len(p) for p in PARAS)
print(f"OK {OUT} size={os.path.getsize(OUT)} body_chars={body_chars}")

"""Build a ~200-char Chinese diary entry as a valid .docx (no third-party deps)."""
import os
import datetime
import zipfile

# 动态日期标题：年月日 星期X 晴
dt = datetime.datetime.now()
WEEK = "一二三四五六日"[dt.weekday()]
TITLE = f"{dt.year}年{dt.month}月{dt.day}日 星期{WEEK} 晴"

PARAS = [
    "今天早起跑了一趟五公里，回来时天还没完全亮，空气里有清晨特有的凉意。"
    "洗完澡坐在窗边喝咖啡，看着城市一点点醒来，心情格外平静，连昨日的疲惫都消散了。",
    "上午处理完积压的邮件，下午把拖了两周的项目方案终于写完。"
    "虽然中间卡了几次，但把它真正落到纸上的那一刻，有一种久违的踏实感。",
    "傍晚散了会儿步，顺路在书店翻完半本书。回到家翻开本子，写下今天的几件小事。"
    "日子不必每天都轰轰烈烈，能把普通的一天过得有秩序、有回味，还能在夜里记下点什么，"
    "就已经很好了。",
]


def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def title_p(text: str) -> str:
    rpr = ('<w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" '
           'w:eastAsia="微软雅黑"/><w:b/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr>')
    return (f'<w:p><w:pPr><w:jc w:val="center"/><w:spacing w:after="200"/>{rpr}</w:pPr>'
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

OUT = "/Users/yuyi/Pyleaf/deepseek-harness/日记.docx"
with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", content_types_xml)
    z.writestr("_rels/.rels", rels_xml)
    z.writestr("word/document.xml", document_xml)

body_chars = sum(len(p) for p in PARAS)
print(f"TITLE={TITLE}")
print(f"OK {OUT} size={os.path.getsize(OUT)} body_chars={body_chars}")

from io import BytesIO
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab import rl_config
from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

rl_config.useA85 = False


def register_academic_font():
    fonts = (
        Path(__file__).resolve().parent / "fonts" / "DejaVuSans.ttf",
        Path("C:/Windows/Fonts/arial.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"),
    )
    font = next(path for path in fonts if path.is_file())
    pdfmetrics.registerFont(TTFont("Academic", str(font), asciiReadable=False))


def create_certificate(request_id, profile):
    register_academic_font()
    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4)
    pdf.setTitle("Демо-справка об обучении")
    pdf.setAuthor("Академик")
    width, height = A4
    pdf.setFillColor(HexColor("#174D35"))
    pdf.rect(0, height - 12, width, 12, fill=1, stroke=0)
    pdf.setFont("Academic", 12)
    pdf.drawString(56, height - 70, "АКАДЕМИК  /  КОНКУРСНЫЙ КОНЦЕПТ")
    pdf.setFont("Academic", 24)
    pdf.drawString(56, height - 132, "Справка об обучении")
    pdf.setFont("Academic", 12)
    pdf.drawString(56, height - 160, f"Демонстрационный образец № {request_id}")
    pdf.setStrokeColor(HexColor("#CFDDD5"))
    pdf.line(56, height - 182, width - 56, height - 182)
    pdf.setFillColor(HexColor("#171A20"))
    for index, field in enumerate((
        f"Студент: {profile['name']}",
        f"Курс: {profile['year']}",
        f"Группа: {profile['group']}",
    )):
        pdf.drawString(56, height - 220 - index * 28, field)
    pdf.drawString(56, 60, "Демонстрационный документ с вымышленными данными.")
    pdf.save()
    return output.getvalue()


def create_transcript(request_id, profile, semesters):
    register_academic_font()
    output = BytesIO()
    document = SimpleDocTemplate(
        output, pagesize=A4, leftMargin=48, rightMargin=48, topMargin=45, bottomMargin=48,
        title="Выписка из зачётки", author="Академик",
    )
    green = HexColor("#174D35")
    body = ParagraphStyle("AcademicBody", fontName="Academic", fontSize=10, leading=15)
    title = ParagraphStyle("AcademicTitle", parent=body, fontSize=22, leading=28, textColor=green)
    subtitle = ParagraphStyle("AcademicSemester", parent=body, fontSize=12, leading=18, keepWithNext=True)
    story = [
        Paragraph("Выписка из зачётки", title),
        Paragraph(f"Демонстрационный документ № {request_id}", body),
        Spacer(1, 10),
        Paragraph(escape(f"Студент: {profile['name']} · Группа: {profile['group']}"), body),
    ]
    if profile["recordBook"]:
        story.append(Paragraph(escape(f"Зачётка № {profile['recordBook']}"), body))
    if not semesters:
        story.extend([Spacer(1, 12), Paragraph("Завершённых курсов пока нет.", body)])
    for semester in semesters:
        number = semester["number"]
        story.extend([Spacer(1, 12), Paragraph(f"{(number + 1) // 2} курс · {number} семестр", subtitle)])
        rows = [[Paragraph("Дисциплина", body), Paragraph("Оценка", body)]]
        for course in semester["courses"]:
            result = course.get("result") or "Нет итоговой оценки"
            rows.append([Paragraph(escape(course["title"]), body), Paragraph(escape(str(result)), body)])
        table = Table(rows, colWidths=[document.width - 112, 112], repeatRows=1, hAlign="LEFT")
        table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), HexColor("#E7F2EB")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [HexColor("#FFFFFF"), HexColor("#F5F7F6")]),
            ("LINEBELOW", (0, 0), (-1, 0), 0.5, HexColor("#CFDDD5")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ]))
        story.append(table)

    def footer(pdf, doc):
        pdf.setFont("Academic", 9)
        pdf.setFillColor(green)
        pdf.drawString(48, 28, "Академик · демонстрационные данные")
        pdf.drawRightString(A4[0] - 48, 28, str(doc.page))

    document.build(story, onFirstPage=footer, onLaterPages=footer)
    return output.getvalue()

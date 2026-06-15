"""Xuat bao cao Excel theo mau danh gia: KPI, tien do, bang chung, viec phat sinh, lich su."""
import io
from datetime import date

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models, schemas
from . import kpi_service

HEADER_FILL = PatternFill("solid", fgColor="1F4E79")
HEADER_FONT = Font(bold=True, color="FFFFFF", size=11)
TITLE_FONT = Font(bold=True, size=14, color="1F4E79")
THIN = Side(style="thin", color="B0B0B0")
BORDER = Border(left=THIN, right=THIN, top=THIN, bottom=THIN)
HEALTH_FILLS = {
    "green": PatternFill("solid", fgColor="C6EFCE"),
    "yellow": PatternFill("solid", fgColor="FFEB9C"),
    "red": PatternFill("solid", fgColor="FFC7CE"),
}


def _style_header(ws, row: int, n_cols: int):
    for c in range(1, n_cols + 1):
        cell = ws.cell(row=row, column=c)
        cell.fill = HEADER_FILL
        cell.font = HEADER_FONT
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)


APPRAISAL_BLUE = PatternFill("solid", fgColor="B8CCE4")
RED_BOLD = Font(bold=True, color="FF0000", size=10)


def export_appraisal_excel(db: Session, user: models.User) -> bytes:
    """Xuat dung MAU PERFORMANCE APPRAISAL cua cong ty — import nguoc lai duoc.

    Chua co KPI -> xuat template trong (giu nguyen tieu de, quy tac, header)
    de nguoi dung dien tay hoac doi chieu.
    """
    kpis = kpi_service.get_active_kpis(db, user.id)
    objectives = list(
        db.scalars(
            select(models.Objective).where(
                models.Objective.user_id == user.id,
                models.Objective.archived == False,  # noqa: E712
            )
        )
    )
    year = kpis[0].year if kpis else date.today().year

    wb = Workbook()
    ws = wb.active
    ws.title = "Performance Appraisal"

    # ===== Phan dau: thong tin nhan vien + quy tac =====
    ws["A1"] = f"{year} Performance Appraisal"
    ws["A1"].font = Font(bold=True, size=18)
    ws["A2"] = "Mã nhân viên/Employee code"
    ws["B2"] = ""  # nguoi dung tu dien ma nhan vien cong ty
    ws["A3"] = "Họ tên nhân viên/Employee name"
    ws["B3"] = user.name or ""
    for r in (2, 3):
        ws.cell(row=r, column=1).font = Font(bold=True)
    ws["A4"] = (
        "(*) Trường thông tin bắt buộc/required field\n"
        "- Tổng tỷ trọng KPIs của mỗi Objectives phải bằng 100%/The sum of all KPIs of each Objective is 100%\n"
        "- Tổng tỷ trọng tất cả Objectives phải bằng 100%/The sum of all objectives is 100%"
    )
    ws["A4"].font = RED_BOLD
    ws["A4"].alignment = Alignment(wrap_text=True, vertical="top")
    ws.row_dimensions[4].height = 48
    ws["A5"] = "Nhân viên nhận xét tổng quan (*)\nOverall Employee Comment"
    ws["A6"] = "Nhu cầu phát triển của nhân viên (*)\nDevelopment Needs"
    for r in (5, 6):
        ws.cell(row=r, column=1).font = Font(bold=True)
        ws.cell(row=r, column=1).alignment = Alignment(wrap_text=True, vertical="top")
        ws.merge_cells(start_row=r, start_column=2, end_row=r, end_column=6)
        for c in range(1, 7):
            ws.cell(row=r, column=c).border = BORDER
        ws.row_dimensions[r].height = 32

    # ===== Bang Objective / KPI =====
    HEAD_ROW = 8
    headers = [
        "Objective (*)",
        "Tỷ trọng Objective/Objective Proportion* (%)",
        "KPI (*)",
        "Tỷ trọng KPI/KPI Proportion* (%)",
        "Nhân viên tự nhận xét/Employee self-assessment*",
        "Nhân viên đánh giá/Self-KPI rating*",
    ]
    for c, h in enumerate(headers, 1):
        cell = ws.cell(row=HEAD_ROW, column=c, value=h)
        cell.fill = APPRAISAL_BLUE
        cell.font = Font(bold=True, size=10)
        cell.border = BORDER
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    ws.row_dimensions[HEAD_ROW].height = 30

    def kpi_row(r: int, kpi: models.KPI | None):
        for c in range(1, 7):
            ws.cell(row=r, column=c).border = BORDER
            ws.cell(row=r, column=c).alignment = Alignment(vertical="top", wrap_text=True)
        if kpi is None:
            return
        ws.cell(row=r, column=3, value=kpi.name)
        ws.cell(row=r, column=4, value=kpi.weight)
        over = " — VƯỢT CHỈ TIÊU" if kpi.progress > 100 else ""
        note = (
            f"{kpi.current_value:g}%" if kpi.unit == "%"
            else f"Thực đạt {kpi.current_value:g}/{kpi.target_value:g} {kpi.unit} = {kpi.progress:.0f}%"
        )
        ws.cell(row=r, column=5, value=note + over)
        # cot 6 (Self-KPI rating) de trong cho nhan vien tu cham theo thang diem cong ty

    r = HEAD_ROW + 1
    groups = [(o, [k for k in kpis if k.objective_id == o.id]) for o in objectives]
    ungrouped = [k for k in kpis if k.objective_id is None]
    if ungrouped:
        groups.append((None, ungrouped))

    if not kpis:
        # Template trong: 8 dong ke san de dien tay
        for _ in range(8):
            kpi_row(r, None)
            r += 1
    else:
        for obj, group in groups:
            if not group:
                continue
            start = r
            for k in group:
                kpi_row(r, k)
                r += 1
            end = r - 1
            if end > start:
                ws.merge_cells(start_row=start, start_column=1, end_row=end, end_column=1)
                ws.merge_cells(start_row=start, start_column=2, end_row=end, end_column=2)
            ws.cell(row=start, column=1, value=obj.name if obj else "(Chưa gắn Objective)")
            ws.cell(row=start, column=2, value=obj.weight if obj else "")
            ws.cell(row=start, column=1).font = Font(bold=True)
            ws.cell(row=start, column=1).alignment = Alignment(vertical="center", wrap_text=True)
            ws.cell(row=start, column=2).alignment = Alignment(vertical="center", horizontal="center")

    for i, w in enumerate([34, 16, 40, 14, 42, 16], 1):
        ws.column_dimensions[ws.cell(row=HEAD_ROW, column=i).column_letter].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def export_evaluation_excel(db: Session, user_id: int = 1) -> bytes:
    kpis = kpi_service.get_active_kpis(db, user_id)
    today = date.today()
    wb = Workbook()

    # ===== Sheet 1: Tong quan KPI =====
    ws = wb.active
    ws.title = "Tổng quan KPI"
    ws["A1"] = f"BÁO CÁO ĐÁNH GIÁ KPI NĂM {kpis[0].year if kpis else today.year}"
    ws["A1"].font = TITLE_FONT
    ws["A2"] = f"Ngày xuất: {today.isoformat()}"
    headers = ["STT", "Mục tiêu (Objective)", "KPI", "Mô tả / Chỉ tiêu",
               "Trọng số trong mục tiêu (%)", "Đơn vị", "Chỉ tiêu số", "Thực đạt", "Deadline",
               "Tiến độ (%)", "Kỳ vọng (%)", "Chênh lệch", "Trạng thái"]
    ws.append([])
    ws.append(headers)
    _style_header(ws, 4, len(headers))
    # nhom theo muc tieu de doc de hon
    kpis_sorted = sorted(kpis, key=lambda k: (k.objective_name or "ZZZ (chưa gắn mục tiêu)", k.id))
    for i, k in enumerate(kpis_sorted, 1):
        health, gap = kpi_service.health_of(k, today)
        exp = kpi_service.expected_progress(k, today)
        label = {"green": "Đúng tiến độ", "yellow": "Cần chú ý", "red": "Rủi ro"}[health]
        if k.progress > 100:
            label = "Vượt chỉ tiêu ★"
        ws.append([i, k.objective_name or "(chưa gắn mục tiêu)", k.name, k.target or k.description,
                   k.weight, k.unit, k.target_value, k.current_value,
                   str(k.deadline or f"{k.year}-12-31"), k.progress, exp, gap, label])
        row = ws.max_row
        for c in range(1, len(headers) + 1):
            ws.cell(row=row, column=c).border = BORDER
            ws.cell(row=row, column=c).alignment = Alignment(vertical="top", wrap_text=True)
        ws.cell(row=row, column=13).fill = (
            PatternFill("solid", fgColor="D9E1F2") if k.progress > 100 else HEALTH_FILLS[health]
        )
    widths = [5, 26, 32, 34, 13, 10, 10, 10, 12, 11, 11, 11, 14]
    for i, w in enumerate(widths, 1):
        ws.column_dimensions[ws.cell(row=4, column=i).column_letter].width = w
    dash = kpi_service.build_dashboard(db, user_id)
    ws.append([])
    ws.append(["", "TỔNG TIẾN ĐỘ NĂM (theo trọng số mục tiêu, KPI vượt tính tối đa 100%)",
               "", "", "", "", "", "", "", dash.overall_progress])
    ws.cell(row=ws.max_row, column=2).font = Font(bold=True)
    ws.cell(row=ws.max_row, column=10).font = Font(bold=True)
    # bang tom tat theo muc tieu
    ws.append([])
    ws.append(["", "TIẾN ĐỘ THEO MỤC TIÊU (OBJECTIVE)", "Trọng số (%)", "Số KPI", "Tiến độ (%)"])
    ws.cell(row=ws.max_row, column=2).font = Font(bold=True, color="1F4E79")
    for o in dash.objectives:
        ws.append(["", o.name, o.weight, o.kpi_count, o.progress])

    # ===== Sheet 2: Bang chung cong viec =====
    ws2 = wb.create_sheet("Bằng chứng công việc")
    headers2 = ["Ngày", "Đầu việc", "Chi tiết", "Trạng thái", "KPI", "+Thực đạt (theo đơn vị KPI)", "Nguồn", "Nguồn gốc dữ liệu"]
    ws2.append(headers2)
    _style_header(ws2, 1, len(headers2))
    items = list(
        db.scalars(
            select(models.WorkItem)
            .where(models.WorkItem.user_id == user_id, models.WorkItem.confirmed == True)  # noqa: E712
            .order_by(models.WorkItem.work_date.desc().nullslast(), models.WorkItem.created_at.desc())
        )
    )
    for w in items:
        ws2.append([
            str(w.work_date or w.created_at.date()), w.title, w.detail,
            schemas.STATUS_LABELS.get(w.status, w.status),
            w.kpi.name if w.kpi else "(việc phát sinh - chưa gắn KPI)",
            w.progress_delta, w.source, w.source_ref,
        ])
        for c in range(1, len(headers2) + 1):
            ws2.cell(row=ws2.max_row, column=c).border = BORDER
            ws2.cell(row=ws2.max_row, column=c).alignment = Alignment(vertical="top", wrap_text=True)
    for i, w in enumerate([12, 35, 30, 12, 30, 12, 10, 30], 1):
        ws2.column_dimensions[ws2.cell(row=1, column=i).column_letter].width = w

    # ===== Sheet 3: Viec phat sinh =====
    ws3 = wb.create_sheet("Việc phát sinh")
    headers3 = ["Ngày", "Đầu việc", "Chi tiết", "Nguồn gốc"]
    ws3.append(headers3)
    _style_header(ws3, 1, len(headers3))
    for w in items:
        if w.status == "phat_sinh":
            ws3.append([str(w.work_date or w.created_at.date()), w.title, w.detail, w.source_ref])
            for c in range(1, len(headers3) + 1):
                ws3.cell(row=ws3.max_row, column=c).border = BORDER
    for i, w in enumerate([12, 40, 40, 30], 1):
        ws3.column_dimensions[ws3.cell(row=1, column=i).column_letter].width = w

    # ===== Sheet 4: Lich su thay doi KPI =====
    ws4 = wb.create_sheet("Lịch sử thay đổi KPI")
    headers4 = ["Ngày", "KPI", "Trường thay đổi", "Giá trị cũ", "Giá trị mới", "Lý do"]
    ws4.append(headers4)
    _style_header(ws4, 1, len(headers4))
    logs = list(
        db.scalars(select(models.KPIChangeLog).order_by(models.KPIChangeLog.changed_at.desc()))
    )
    for lg in logs:
        kpi = db.get(models.KPI, lg.kpi_id)
        ws4.append([
            lg.changed_at.date().isoformat(), kpi.name if kpi else f"#{lg.kpi_id}",
            lg.field, lg.old_value, lg.new_value, lg.reason,
        ])
        for c in range(1, len(headers4) + 1):
            ws4.cell(row=ws4.max_row, column=c).border = BORDER
    for i, w in enumerate([12, 35, 16, 25, 25, 30], 1):
        ws4.column_dimensions[ws4.cell(row=1, column=i).column_letter].width = w

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


# ===== Self-review export =====

_SECTION_FILL = PatternFill("solid", fgColor="4472C4")
_SECTION_FONT = Font(bold=True, color="FFFFFF", size=11)


def export_self_review_excel(period_label: str, content: str) -> bytes:
    """Xuat ban tu danh gia thanh file Excel co dinh dang dep."""
    wb = Workbook()
    ws = wb.active
    ws.title = "Tự đánh giá"
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 90

    # Tieu de chinh
    ws.merge_cells("A1:B1")
    c = ws["A1"]
    c.value = f"BẢN TỰ ĐÁNH GIÁ — {period_label.upper()}"
    c.font = Font(bold=True, size=14, color="FFFFFF")
    c.fill = PatternFill("solid", fgColor="1F4E79")
    c.alignment = Alignment(horizontal="center", vertical="center")
    ws.row_dimensions[1].height = 30

    ws.merge_cells("A2:B2")
    c = ws["A2"]
    c.value = f"Ngày xuất: {date.today().isoformat()}"
    c.font = Font(italic=True, color="808080", size=10)
    c.alignment = Alignment(horizontal="right")

    row = 4
    pending: list[str] = []

    def _flush(r: int) -> int:
        """Ghi cac dong noi dung dang cho vao sheet, tra ve row moi."""
        for ln in pending:
            stripped = ln.strip()
            if not stripped:
                continue
            # Strip markdown bullet/bold markers
            stripped = stripped.lstrip("- *")
            stripped = stripped.replace("**", "").replace("*", "").replace("`", "")
            ws[f"B{r}"] = stripped
            ws[f"B{r}"].font = Font(size=10)
            ws[f"B{r}"].alignment = Alignment(wrap_text=True, vertical="top")
            ws.row_dimensions[r].height = 15
            r += 1
        pending.clear()
        return r

    for line in content.split("\n"):
        if line.startswith("## ") or line.startswith("### "):
            row = _flush(row)
            row += 1  # khoang cach truoc section
            header_text = line.lstrip("#").strip()
            ws.merge_cells(f"A{row}:B{row}")
            c = ws[f"A{row}"]
            c.value = header_text
            c.font = _SECTION_FONT
            c.fill = _SECTION_FILL
            c.alignment = Alignment(vertical="center")
            ws.row_dimensions[row].height = 22
            row += 1
        else:
            pending.append(line)

    _flush(row)

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _md_strip(text: str) -> str:
    """Bỏ markdown inline (bold/italic/code/link) trả về plain text."""
    import re
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)  # **bold**
    text = re.sub(r"\*(.+?)\*", r"\1", text)       # *italic*
    text = re.sub(r"`(.+?)`", r"\1", text)          # `code`
    text = re.sub(r"\[(.+?)\]\(.+?\)", r"\1", text) # [link](url)
    return text


def export_report_pdf(period_label: str, content: str) -> bytes:
    """Xuat noi dung bao cao (markdown) ra PDF co font Unicode."""
    import re
    from .export_service import _find_pdf_font
    from fpdf import FPDF

    reg, bold = _find_pdf_font()
    pdf = FPDF()
    pdf.set_auto_page_break(True, margin=15)
    if reg:
        pdf.add_font("Main", "", reg)
        pdf.add_font("Main", "B", bold or reg)
        fam = "Main"
    else:
        fam = "Helvetica"
    pdf.add_page()
    epw = pdf.w - 2 * pdf.l_margin

    def _safe_cell(text: str, font_style: str = "", font_size: int = 10,
                   line_h: float = 5, color: tuple = (0, 0, 0)):
        """Render một đoạn text, bỏ qua dòng nếu gặp lỗi font."""
        try:
            pdf.set_font(fam, font_style, font_size)
            pdf.set_text_color(*color)
            # Lọc ký tự ngoài BMP (emoji, surrogate) để tránh lỗi fpdf2
            safe = re.sub(r"[^ -￿]", "?", text)
            pdf.multi_cell(epw, line_h, safe, new_x="LMARGIN", new_y="NEXT")
            pdf.set_text_color(0, 0, 0)
        except Exception:
            pass  # bỏ qua dòng lỗi, không làm hỏng cả file

    # Tieu de chinh
    _safe_cell(f"BẢN TỰ ĐÁNH GIÁ — {period_label.upper()}", "B", 15, 9, (31, 78, 121))
    try:
        pdf.set_font(fam, "", 9)
        pdf.set_text_color(130, 130, 130)
        pdf.cell(0, 6, f"Ngày xuất: {date.today().isoformat()}", new_x="LMARGIN", new_y="NEXT")
        pdf.set_text_color(0, 0, 0)
    except Exception:
        pass
    pdf.ln(3)

    for line in content.split("\n"):
        if line.startswith("## "):
            pdf.ln(3)
            _safe_cell(_md_strip(line[3:].strip()), "B", 12, 8, (31, 78, 121))
            pdf.ln(1)
        elif line.startswith("### "):
            pdf.ln(1)
            _safe_cell(_md_strip(line[4:].strip()), "B", 10, 6, (68, 114, 196))
        elif line.startswith("- ") or line.startswith("* "):
            _safe_cell("  • " + _md_strip(line[2:].strip()), "", 10, 5)
        elif line.strip():
            _safe_cell(_md_strip(line.strip()), "", 10, 5)
        else:
            pdf.ln(2)

    out = pdf.output()
    return bytes(out)

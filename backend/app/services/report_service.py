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

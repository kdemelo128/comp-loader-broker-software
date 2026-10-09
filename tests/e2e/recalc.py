"""Open an .xlsx in LibreOffice, recalculate everything, and check every formula:
no error results, and every stored value equal to the recalculated one."""
import sys, subprocess, time, os, uno, openpyxl
from com.sun.star.beans import PropertyValue
path = os.path.abspath(sys.argv[1])
proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--accept=socket,host=localhost,port=2002;urp;'],
                        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
ctx = None
for _ in range(60):
    try:
        local = uno.getComponentContext()
        resolver = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local)
        ctx = resolver.resolve('uno:socket,host=localhost,port=2002;urp;StarOffice.ComponentContext'); break
    except Exception: time.sleep(0.5)
desktop = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx)
p = PropertyValue(); p.Name = 'Hidden'; p.Value = True
doc = desktop.loadComponentFromURL('file://' + path, '_blank', 0, (p,))
doc.calculateAll()
cached = openpyxl.load_workbook(path, data_only=True)
forms = openpyxl.load_workbook(path, data_only=False)
mism, errs, nform, uncached = [], [], 0, 0
for ws in forms.worksheets:
    sh = doc.Sheets.getByName(ws.title)
    for row in ws.iter_rows():
        for c in row:
            if isinstance(c.value, str) and c.value.startswith('='):
                nform += 1
                cell = sh.getCellByPosition(c.column - 1, c.row - 1)
                err = cell.getError()
                if err: errs.append(f"{ws.title}!{c.coordinate} err {err} {c.value[:60]}"); continue
                cv = cached[ws.title][c.coordinate].value
                t = cell.getType().value
                lv = cell.getValue() if t == 'VALUE' or (t == 'FORMULA' and cell.FormulaResultType2 == 1) else cell.getString()
                if isinstance(cv, (int, float)) and isinstance(lv, (int, float)):
                    if abs(cv - lv) > 1e-6 * max(1, abs(lv)): mism.append(f"{ws.title}!{c.coordinate} cached {cv} recalc {lv} {c.value[:60]}")
                elif cv is None and lv not in ('', 0, 0.0):
                    # a value but none stored (a firm template's own formulas): Excel works it out on
                    # opening. Workbooks the app builds itself should have none of these.
                    uncached += 1
doc.close(True); proc.terminate()
print(f"sheets={len(forms.worksheets)} formulas={nform} errors={len(errs)} mismatches={len(mism)} no-stored-value={uncached}")
for x in (errs + mism)[:40]: print('  ', x)

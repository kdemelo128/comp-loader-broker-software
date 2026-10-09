"""Print LibreOffice's recalculated values for the given cells: lo_values.py file.xlsx 'Sheet!A1' ..."""
import sys, subprocess, time, os, uno
from com.sun.star.beans import PropertyValue
path = os.path.abspath(sys.argv[1])
proc = subprocess.Popen(['soffice', '--headless', '--invisible', '--norestore', '--accept=socket,host=localhost,port=2003;urp;'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
for _ in range(60):
    try:
        local = uno.getComponentContext()
        ctx = local.ServiceManager.createInstanceWithContext('com.sun.star.bridge.UnoUrlResolver', local).resolve('uno:socket,host=localhost,port=2003;urp;StarOffice.ComponentContext'); break
    except Exception: time.sleep(0.5)
p = PropertyValue(); p.Name = 'Hidden'; p.Value = True
doc = ctx.ServiceManager.createInstanceWithContext('com.sun.star.frame.Desktop', ctx).loadComponentFromURL('file://' + path, '_blank', 0, (p,))
doc.calculateAll()
for a in sys.argv[2:]:
    sh, cell = a.rsplit('!', 1)
    c = doc.Sheets.getByName(sh).getCellRangeByName(cell)
    print(a, c.getValue() if c.FormulaResultType2 == 1 or c.getType().value == 'VALUE' else repr(c.getString()))
doc.close(True); proc.terminate()

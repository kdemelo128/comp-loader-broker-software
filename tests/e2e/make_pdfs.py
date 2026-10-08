import json, re, sys
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import letter
d = sys.argv[1]
pages = json.load(open(f"{d}/pages.json"))
CW = 0.6 * 7.5  # courier char width at 7.5pt
def render(name, texts, encrypt=None):
    c = canvas.Canvas(f"{d}/{name}.pdf", pagesize=letter, encrypt=encrypt)
    for t in texts:
        y = 760
        for line in t.split("\n"):
            for m in re.finditer(r"\S+(?: \S+)*", line):
                c.setFont("Courier", 7.5)
                c.drawString(30 + m.start() * CW, y, m.group(0))
            y -= 11
            if y < 30:
                c.showPage(); y = 760
        c.showPage()
    c.save()
render("om-retail", pages["om_retail"])
render("om-netlease", pages["om_netlease"])
render("om-multifamily", pages["om_multifamily"])
render("costar-comps", pages["costar_set"])
render("om-encrypted", pages["om_retail"], encrypt="secret")
# a long OM: 120 pages of filler around the real pages
filler = ["Market Overview\n\n" + "\n".join(f"  Paragraph {i} about the submarket and its tenants, traffic, and demographics." for i in range(40))] * 115
render("om-large", pages["om_retail"][:2] + filler + pages["om_retail"][2:])
# scanned: an image only, no text
from reportlab.lib.utils import ImageReader
from PIL import Image, ImageDraw
img = Image.new("RGB", (1200, 1600), "white"); dr = ImageDraw.Draw(img); dr.text((100,100), "Asking Price $5,000,000  Cap Rate 6.5%", fill="black")
img.save(f"{d}/scan.png")
c = canvas.Canvas(f"{d}/om-scanned.pdf", pagesize=letter); c.drawImage(f"{d}/scan.png", 0, 0, 612, 792); c.showPage(); c.drawImage(f"{d}/scan.png", 0, 0, 612, 792); c.save()
open(f"{d}/corrupt.pdf", "wb").write(b"%PDF-1.7\n1 0 obj << /Type /Catalog >> garbage garbage\n")
open(f"{d}/empty.pdf", "wb").write(b"")
open(f"{d}/notes.txt", "w").write("hello")
# photos
for i, (w, h) in enumerate([(4032, 3024), (800, 600), (3024, 4032)]):
    Image.new("RGB", (w, h), (40 + i*60, 120, 160)).save(f"{d}/photo{i}.jpg", quality=90)
print("ok")

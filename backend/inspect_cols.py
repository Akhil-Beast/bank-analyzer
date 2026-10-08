import pdfplumber
import glob

files = glob.glob('D:/tmp/*.pdf')
if not files:
    print("No files found")
    exit(0)

f = files[0]
with pdfplumber.open(f) as pdf:
    p = pdf.pages[0]
    words = p.extract_words()
    for w in words:
        if any(h in w['text'] for h in ['Date', 'Narration', 'Chq', 'ValueDt', 'Withdrawal', 'Deposit', 'Closing']):
            print(f"{w['text']:18} x0={w['x0']:.1f} x1={w['x1']:.1f} top={w['top']:.1f}")

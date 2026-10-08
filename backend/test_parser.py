import pdfplumber
import glob
import re
import datetime
import pandas as pd

def extract_party_name(narration):
    if not narration:
        return ""
    narration = narration.strip()
    
    # UPI pattern: UPI-<NAME>-<VPA/ACC> or UPI-<NAME>/...
    m = re.match(r'UPI-([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9@]+|\s*@|\/|$)', narration)
    if m:
        clean = m.group(1).replace('-', ' ').strip()
        # Remove trailing single letters or artifacts
        return clean
    
    # NEFT / RTGS / IMPS pattern
    m = re.match(r'(?:NEFT|RTGS|IMPS)(?:CR|DR)?-[0-9A-Za-z]+-(?:REM-)?([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # ACH / NACH pattern
    m = re.match(r'(?:ACH|NACH)(?:D|CR|DR)?-([A-Za-z0-9\s\.\&]+?)(?:-[0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # CHQ pattern
    m = re.match(r'(?:CHQPAID|CHQREC)-[A-Za-z0-9]+-[A-Za-z0-9]+-([A-Za-z0-9\s]+)', narration)
    if m:
        return m.group(1).strip()
        
    # NWD (Cash withdrawal)
    if narration.startswith("NWD-"):
        return "Cash Withdrawal (ATM)"
        
    if "INTEREST" in narration.upper():
        return "Bank Interest"
        
    if "AUTOPAY" in narration.upper() or "BILLPAY" in narration.upper():
        return "Bill Payment / AutoPay"
        
    return narration.split('-')[0].strip()[:30]

def parse_hdfc_or_general(pdf_path):
    transactions = []
    account_no = None
    account_name = None
    bank_name = "HDFC Bank"
    
    with pdfplumber.open(pdf_path) as pdf:
        p0_text = pdf.pages[0].extract_text() or ""
        
        # Bank name detection
        if "HDFC" in p0_text.upper():
            bank_name = "HDFC Bank"
        elif "ICICI" in p0_text.upper():
            bank_name = "ICICI Bank"
        elif "SBI" in p0_text.upper() or "STATE BANK" in p0_text.upper():
            bank_name = "State Bank of India"
        elif "AXIS" in p0_text.upper():
            bank_name = "Axis Bank"
        elif "KOTAK" in p0_text.upper():
            bank_name = "Kotak Mahindra Bank"
            
        # Account Number
        acc_match = re.search(r'Account\s*No\s*:\s*([0-9X]+)', p0_text, re.IGNORECASE)
        if acc_match:
            account_no = acc_match.group(1).strip()
            
        # Customer name
        name_match = re.search(r'(?:MR\.|MS\.|MRS\.|DR\.)\s+([A-Z\s]+?)(?:State|City|Address|Account|$)', p0_text)
        if name_match:
            account_name = name_match.group(0).split('State')[0].split('City')[0].strip()

        date_pattern = re.compile(r'^\d{2}/\d{2}/\d{2,4}$')
        current_txn = None
        
        for page_idx, page in enumerate(pdf.pages):
            words = page.extract_words()
            words_by_y = {}
            for w in words:
                matched_y = False
                for by in words_by_y:
                    if abs(by - w['top']) < 3.5:
                        words_by_y[by].append(w)
                        matched_y = True
                        break
                if not matched_y:
                    words_by_y[w['top']] = [w]
                    
            sorted_ys = sorted(words_by_y.keys())
            
            for y in sorted_ys:
                line_words = sorted(words_by_y[y], key=lambda x: x['x0'])
                line_text = ' '.join(w['text'] for w in line_words).strip()
                
                # Stop if summary section reached
                if "STATEMENTSUMMARY" in line_text or "OpeningBalance" in line_text:
                    if current_txn:
                        transactions.append(current_txn)
                        current_txn = None
                    break
                    
                # Skip header/footer noise on ALL pages
                if y < 220:
                    continue
                if any(noise in line_text for noise in [
                    "HDFCBANKLIMITED", "Closingbalanceincludes", "GeneratedOn", "Thisisacomputer", "PageNo",
                    "Statementofaccount", "AccountBranch", "CustID", "AccountNo",
                    "Contentsofthisstatement", "RegisteredOfficeAddress"
                ]):
                    continue
                if "Date" in line_text and "Narration" in line_text:
                    continue
                    
                first_word = line_words[0]['text'].strip()
                
                # Check if this line starts a new transaction
                if date_pattern.match(first_word):
                    if current_txn:
                        transactions.append(current_txn)
                        current_txn = None
                        
                    txn_date_str = first_word
                    narration_parts = []
                    chq_ref = ""
                    val_date_str = ""
                    debit = 0.0
                    credit = 0.0
                    balance = 0.0
                    
                    for w in line_words[1:]:
                        x0 = w['x0']
                        text = w['text'].strip()
                        
                        if 58 <= x0 < 275:
                            narration_parts.append(text)
                        elif 275 <= x0 < 350:
                            chq_ref = text
                        elif 350 <= x0 < 400:
                            if date_pattern.match(text):
                                val_date_str = text
                        elif 400 <= x0 < 480:
                            clean = text.replace(',', '')
                            try:
                                debit = float(clean)
                            except:
                                pass
                        elif 480 <= x0 < 555:
                            clean = text.replace(',', '')
                            try:
                                credit = float(clean)
                            except:
                                pass
                        elif 555 <= x0:
                            clean = text.replace(',', '')
                            try:
                                balance = float(clean)
                            except:
                                pass
                                
                    current_txn = {
                        "page": page_idx + 1,
                        "date_str": txn_date_str,
                        "val_date_str": val_date_str,
                        "chq_ref": chq_ref,
                        "narration": ' '.join(narration_parts),
                        "debit": debit,
                        "credit": credit,
                        "balance": balance
                    }
                else:
                    # Continuation line for current transaction's narration
                    if current_txn:
                        more_narration = [w['text'] for w in line_words if 55 <= w['x0'] < 350 and not date_pattern.match(w['text'])]
                        if more_narration:
                            current_txn['narration'] += " " + ' '.join(more_narration)
                            
        if current_txn:
            transactions.append(current_txn)
            
    # Normalize dates and format amounts
    results = []
    for t in transactions:
        # Date parsing (DD/MM/YY)
        try:
            d_parts = t['date_str'].split('/')
            day, month, yr = int(d_parts[0]), int(d_parts[1]), int(d_parts[2])
            if yr < 100:
                yr += 2000
            iso_date = f"{yr:04d}-{month:02d}-{day:02d}"
        except:
            iso_date = str(datetime.date.today())
            yr = datetime.date.today().year
            month = datetime.date.today().month
            
        party_name = extract_party_name(t['narration'])
        amt = t['credit'] if t['credit'] > 0 else -t['debit']
        
        results.append({
            "transaction_date": iso_date,
            "value_date": t['val_date_str'],
            "year": yr,
            "month": month,
            "transaction_id": t['chq_ref'],
            "name": party_name,
            "description": t['narration'],
            "debit": t['debit'],
            "credit": t['credit'],
            "amount": amt,
            "balance": t['balance'],
            "bank_name": bank_name,
            "account_reference": account_no,
            "source_page": t['page']
        })
        
    return {
        "bank_name": bank_name,
        "account_no": account_no,
        "account_name": account_name,
        "transactions": results
    }

if __name__ == "__main__":
    files = glob.glob('D:/tmp/*.pdf')
    if files:
        res = parse_hdfc_or_general(files[0])
        print("Bank:", res['bank_name'])
        print("Account:", res['account_no'])
        print("Total Transactions:", len(res['transactions']))
        print("Sample 3 txns:")
        for t in res['transactions'][:3]:
            print("  ", t['transaction_date'], "|", t['name'], "| Debit:", t['debit'], "| Credit:", t['credit'], "| Bal:", t['balance'])

import os
import io
import re
import datetime
import shutil
from typing import Optional, Dict, Any, List
from dateutil import parser as date_parser
import pypdf
import pdfplumber
import pypdfium2 as pdfium

# Recognized Banks for automatic detection
BANK_KEYWORDS = [
    ("HDFC", "HDFC Bank"),
    ("ICICI", "ICICI Bank"),
    ("STATE BANK OF INDIA", "State Bank of India"),
    ("SBI", "State Bank of India"),
    ("AXIS", "Axis Bank"),
    ("KOTAK", "Kotak Mahindra Bank"),
    ("PUNJAB NATIONAL", "Punjab National Bank"),
    ("PNB", "Punjab National Bank"),
    ("BANK OF BARODA", "Bank of Baroda"),
    ("BOB", "Bank of Baroda"),
    ("CANARA", "Canara Bank"),
    ("UNION BANK", "Union Bank of India"),
    ("FEDERAL BANK", "Federal Bank"),
    ("IDFC", "IDFC FIRST Bank"),
    ("INDUSIND", "IndusInd Bank"),
    ("YES BANK", "Yes Bank"),
    ("RBL", "RBL Bank"),
    ("BANK OF INDIA", "Bank of India"),
    ("INDIAN BANK", "Indian Bank"),
    ("CENTRAL BANK OF INDIA", "Central Bank of India"),
    ("INDIAN OVERSEAS BANK", "Indian Overseas Bank"),
    ("UCO BANK", "UCO Bank"),
    ("SOUTH INDIAN BANK", "South Indian Bank"),
    ("BANDHAN BANK", "Bandhan Bank"),
    ("HSBC", "HSBC Bank"),
    ("STANDARD CHARTERED", "Standard Chartered Bank"),
    ("CITIBANK", "Citibank"),
    ("DBS", "DBS Bank"),
]

DATE_REGEX = re.compile(
    r'^\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}$|'   # 05/01/2025, 05-01-2025, 05.01.2025
    r'^\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}$|'   # 05 Jan 2025
    r'^\d{1,2}-[A-Za-z]{3}-\d{2,4}$|'       # 05-Jan-2025
    r'^\d{4}[-/.]\d{1,2}[-/.]\d{1,2}$'       # 2025-01-05
)

def clean_amount(val) -> float:
    if val is None:
        return 0.0
    s = str(val).strip().replace(',', '').replace('₹', '').replace('Rs.', '').replace(' ', '')
    if not s or s in ('-', '--', 'NIL', 'NA', 'N/A'):
        return 0.0
    is_neg = False
    if s.upper().endswith('DR') or s.startswith('-') or s.endswith('-'):
        is_neg = True
    s = re.sub(r'[^\d.-]', '', s)
    try:
        n = float(s)
        return -abs(n) if is_neg else n
    except:
        return 0.0

def parse_date(date_str):
    if not date_str:
        return None, None, None
    s = str(date_str).strip()
    if not re.search(r'\d', s):
        return None, None, None
    if re.fullmatch(r'\d+', s):
        return None, None, None
    try:
        dt = date_parser.parse(s, dayfirst=True)
        if dt.year < 1990 or dt.year > 2050:
            return None, None, None
        return dt.strftime('%Y-%m-%d'), dt.year, dt.month
    except:
        return None, None, None

def extract_party_name(narration: str) -> str:
    if not narration:
        return "Unknown"
    narration = narration.strip()
    
    # UPI pattern: UPI-<NAME>-<VPA>
    m = re.match(r'UPI-([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9@]+|\s*@|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # NEFT / RTGS / IMPS pattern
    m = re.match(r'(?:NEFT|RTGS|IMPS)(?:CR|DR)?-[0-9A-Za-z]+-(?:REM-)?([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # ACH / NACH pattern
    m = re.match(r'(?:ACH|NACH)(?:D|CR|DR)?-([A-Za-z0-9\s\.\&]+?)(?:-[0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # Cheque pattern
    m = re.match(r'(?:CHQPAID|CHQREC)-[A-Za-z0-9]+-[A-Za-z0-9]+-([A-Za-z0-9\s]+)', narration)
    if m:
        return m.group(1).strip()
        
    # ATM Cash withdrawal
    if narration.startswith("NWD-") or "ATM" in narration.upper():
        return "Cash Withdrawal (ATM)"
        
    if "INTEREST" in narration.upper():
        return "Bank Interest"
        
    if "AUTOPAY" in narration.upper() or "BILLPAY" in narration.upper():
        return "Bill Payment / AutoPay"
        
    return narration.split('-')[0].strip()[:35]

def unlock_pdf_if_needed(file_path: str, password: Optional[str] = None):
    """
    Checks if PDF is encrypted. If encrypted:
      - Returns status 'password_required' if no password given.
      - Tries to decrypt using pypdf.
      - If incorrect, returns status 'invalid_password'.
      - If successful, writes decrypted PDF back to disk and returns (decrypted_bytes, 'success').
    """
    with open(file_path, "rb") as f:
        pdf_bytes = f.read()

    is_encrypted = False
    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        is_encrypted = reader.is_encrypted
    except Exception as e:
        err = str(e).lower()
        if "password" in err or "encrypt" in err:
            is_encrypted = True
        else:
            try:
                doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes))
                doc.close()
            except Exception as pe:
                if "password" in str(pe).lower():
                    is_encrypted = True

    if not is_encrypted:
        return pdf_bytes, "success", None

    if not password:
        return None, "password_required", "This PDF is password-protected. Please enter the password to unlock it."

    # Try decrypt with pypdf
    try:
        reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
        res = reader.decrypt(password)
        if res == 0:
            return None, "invalid_password", "Incorrect password. Please verify and try again."

        writer = pypdf.PdfWriter()
        for p in reader.pages:
            writer.add_page(p)

        out_buf = io.BytesIO()
        writer.write(out_buf)
        decrypted_bytes = out_buf.getvalue()

        # Save decrypted PDF back to file_path so future PDF preview/page rendering never prompts
        try:
            temp_dec = file_path + ".unlocked.tmp"
            with open(temp_dec, "wb") as f_out:
                f_out.write(decrypted_bytes)
            if os.path.exists(temp_dec):
                try:
                    os.replace(temp_dec, file_path)
                except:
                    shutil.copy2(temp_dec, file_path)
                    os.remove(temp_dec)
        except Exception as save_err:
            print("Notice: Could not persist decrypted PDF to original path:", save_err)

        return decrypted_bytes, "success", None

    except Exception as decrypt_err:
        # Fallback check with pdfium
        try:
            doc = pdfium.PdfDocument(io.BytesIO(pdf_bytes), password=password)
            doc.close()
            return pdf_bytes, "success", None
        except Exception:
            return None, "invalid_password", "Incorrect password. Please verify and try again."

def parse_universal_statement(file_path: str, password: Optional[str] = None) -> Dict[str, Any]:
    # Step 1: Unlock / Decrypt PDF
    pdf_bytes, status, msg = unlock_pdf_if_needed(file_path, password)
    if status != "success":
        return {"status": status, "message": msg}

    transactions: List[Dict[str, Any]] = []
    bank_name = "Bank Statement"
    account_no = None
    account_name = None

    open_kwargs = {"password": password} if password else {}

    try:
        pdf_stream = io.BytesIO(pdf_bytes)
        pdf = pdfplumber.open(pdf_stream, **open_kwargs)
    except Exception as e:
        # Try opening file_path directly if memory stream failed
        pdf = pdfplumber.open(file_path, **open_kwargs)

    with pdf:
        if not pdf.pages:
            return {"status": "error", "message": "PDF contains no pages"}

        # Extract metadata from first 2 pages
        header_text = ""
        for i in range(min(2, len(pdf.pages))):
            header_text += (pdf.pages[i].extract_text() or "") + "\n"

        upper_header = header_text.upper()
        for kw, bname in BANK_KEYWORDS:
            if kw in upper_header:
                bank_name = bname
                break

        # Account number detection
        acc_m = re.search(r'(?:ACCOUNT\s*(?:NO|NUMBER)|A\/C\s*(?:NO|NUMBER)?|ACCOUNT\s*:)\s*[:\-]?\s*([0-9X]{6,22})', header_text, re.IGNORECASE)
        if acc_m:
            account_no = acc_m.group(1).strip()

        # Customer name detection
        name_m = re.search(r'(?:MR\.|MS\.|MRS\.|DR\.|M\/S|SHRI|SMT)\s+([A-Z\s]+?)(?:STATE|CITY|ADDRESS|ACCOUNT|A\/C|\n|$)', upper_header)
        if name_m:
            account_name = name_m.group(0).split('STATE')[0].split('CITY')[0].strip()

        # =====================================================================
        # STRATEGY 1: Dynamic Column Coordinate Extraction (Borderless Statements)
        # =====================================================================
        col_bounds = None
        header_y = None

        for page_idx, page in enumerate(pdf.pages):
            words = page.extract_words()
            if not words:
                continue

            lines: Dict[float, List[Dict[str, Any]]] = {}
            for w in words:
                matched_y = False
                for by in lines:
                    if abs(by - w['top']) < 3.5:
                        lines[by].append(w)
                        matched_y = True
                        break
                if not matched_y:
                    lines[w['top']] = [w]

            sorted_ys = sorted(lines.keys())

            # Detect header row dynamically if not yet identified
            if not col_bounds:
                for y in sorted_ys:
                    lwords = sorted(lines[y], key=lambda x: x['x0'])
                    ltext = ' '.join(w['text'].lower() for w in lwords)
                    if any(k in ltext for k in ['date', 'txn date', 'tran date', 'post date']) and \
                       any(k in ltext for k in ['narration', 'particular', 'desc', 'details', 'remarks']):
                        header_y = y
                        cols = []
                        for w in lwords:
                            wt = w['text'].lower().replace(' ', '').replace('.', '').replace('/', '')
                            kind = None
                            if any(k in wt for k in ['valuedt', 'valdt', 'valuedate']):
                                kind = 'val_date'
                            elif any(k in wt for k in ['date', 'txndate', 'trandate']):
                                kind = 'date'
                            elif any(k in wt for k in ['narration', 'particular', 'desc', 'details', 'remarks']):
                                kind = 'desc'
                            elif any(k in wt for k in ['chq', 'ref', 'utr', 'cheque']):
                                kind = 'ref'
                            elif any(k in wt for k in ['withdraw', 'debit', 'dr']):
                                kind = 'debit'
                            elif any(k in wt for k in ['deposit', 'credit', 'cr']):
                                kind = 'credit'
                            elif any(k in wt for k in ['bal', 'balance', 'closingbalance']):
                                kind = 'balance'
                            elif 'amount' in wt:
                                kind = 'amount'

                            if kind:
                                cols.append({'kind': kind, 'x0': w['x0'], 'x1': w['x1'], 'text': w['text']})

                        if len(cols) >= 3:
                            cols = sorted(cols, key=lambda c: c['x0'])
                            col_bounds = []
                            for i, col in enumerate(cols):
                                left = 0 if i == 0 else (cols[i-1]['x1'] + col['x0']) / 2
                                right = page.width if i == len(cols) - 1 else (col['x1'] + cols[i+1]['x0']) / 2
                                col_bounds.append({
                                    'kind': col['kind'],
                                    'left': left,
                                    'right': right,
                                    'text': col['text']
                                })
                            break

            # Parse lines using dynamic columns
            if col_bounds:
                current_txn = None
                for y in sorted_ys:
                    if header_y is not None and page_idx == 0 and y <= header_y + 4:
                        continue

                    lwords = sorted(lines[y], key=lambda x: x['x0'])
                    ltext = ' '.join(w['text'] for w in lwords).strip()

                    # Termination conditions
                    if any(k in ltext.upper() for k in ["STATEMENTSUMMARY", "OPENINGBALANCE", "CLOSINGBALANCEINCLUDES", "END OF STATEMENT"]):
                        if current_txn:
                            transactions.append(current_txn)
                            current_txn = None
                        break

                    # Header noise filtering
                    if any(noise in ltext.upper() for noise in [
                        "STATEMENT OF ACCOUNT", "GENERATED ON", "PAGE NO", "REGISTERED OFFICE ADDRESS",
                        "CONTENTS OF THIS STATEMENT", "THIS IS A COMPUTER"
                    ]):
                        continue

                    # Header line repetition on next pages
                    if ("Date" in ltext or "DATE" in ltext) and ("Narration" in ltext or "Particulars" in ltext or "NARRATION" in ltext):
                        continue

                    first_word = lwords[0]['text'].strip()

                    # Check if line begins with a date
                    date_cell = ""
                    val_date_cell = ""
                    desc_words = []
                    ref_cell = ""
                    debit_cell = ""
                    credit_cell = ""
                    bal_cell = ""
                    amount_cell = ""

                    for w in lwords:
                        x_mid = (w['x0'] + w['x1']) / 2
                        assigned_col = None
                        for cb in col_bounds:
                            if cb['left'] <= x_mid < cb['right']:
                                assigned_col = cb['kind']
                                break
                        if not assigned_col:
                            continue

                        if assigned_col == 'date':
                            date_cell += (" " + w['text'] if date_cell else w['text'])
                        elif assigned_col == 'val_date':
                            val_date_cell += (" " + w['text'] if val_date_cell else w['text'])
                        elif assigned_col == 'desc':
                            desc_words.append(w['text'])
                        elif assigned_col == 'ref':
                            ref_cell += (" " + w['text'] if ref_cell else w['text'])
                        elif assigned_col == 'debit':
                            debit_cell += w['text']
                        elif assigned_col == 'credit':
                            credit_cell += w['text']
                        elif assigned_col == 'balance':
                            bal_cell += w['text']
                        elif assigned_col == 'amount':
                            amount_cell += w['text']

                    # Check for date match on first word or date column
                    is_new_txn = False
                    txn_date = None
                    if DATE_REGEX.match(first_word):
                        is_new_txn = True
                        txn_date = first_word
                    elif date_cell and DATE_REGEX.match(date_cell.strip()):
                        is_new_txn = True
                        txn_date = date_cell.strip()

                    if is_new_txn and txn_date:
                        if current_txn:
                            transactions.append(current_txn)

                        d_amt = clean_amount(debit_cell)
                        c_amt = clean_amount(credit_cell)
                        if amount_cell and not d_amt and not c_amt:
                            amt_val = clean_amount(amount_cell)
                            if amt_val < 0 or 'DR' in amount_cell.upper():
                                d_amt = abs(amt_val)
                            else:
                                c_amt = abs(amt_val)

                        current_txn = {
                            'page': page_idx + 1,
                            'date_str': txn_date,
                            'val_date_str': val_date_cell.strip() or txn_date,
                            'narration': ' '.join(desc_words),
                            'chq_ref': ref_cell.strip(),
                            'debit': abs(d_amt),
                            'credit': abs(c_amt),
                            'balance': clean_amount(bal_cell)
                        }
                    else:
                        if current_txn:
                            continuation = [w['text'] for w in lwords if not DATE_REGEX.match(w['text']) and clean_amount(w['text']) == 0.0]
                            if continuation:
                                current_txn['narration'] += " " + ' '.join(continuation)

                if current_txn:
                    transactions.append(current_txn)

        # =====================================================================
        # STRATEGY 2: Universal Table Extraction (Bordered Grid Statements like SBI, ICICI, PNB)
        # =====================================================================
        if not transactions:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.extract_tables() or []
                if not tables:
                    tables = page.extract_tables({"vertical_strategy": "text", "horizontal_strategy": "text"}) or []

                for table in tables:
                    if not table or len(table) < 2:
                        continue

                    header_row_idx = -1
                    col_map = {}
                    for r_idx, row in enumerate(table[:6]):
                        row_str = ' '.join(str(c or '').lower() for c in row)
                        if any(d in row_str for d in ['date', 'txn', 'tran']) and any(n in row_str for n in ['particular', 'narration', 'desc', 'remark', 'details']):
                            header_row_idx = r_idx
                            for c_idx, cell in enumerate(row):
                                c_lower = str(cell or '').lower().strip()
                                if any(x in c_lower for x in ['txn date', 'trans date', 'date', 'tran date', 'post date']):
                                    if 'date' not in col_map: col_map['date'] = c_idx
                                elif any(x in c_lower for x in ['val date', 'value date', 'value dt']):
                                    col_map['val_date'] = c_idx
                                elif any(x in c_lower for x in ['narration', 'particular', 'description', 'remarks', 'details']):
                                    col_map['desc'] = c_idx
                                elif any(x in c_lower for x in ['chq', 'ref', 'cheque', 'utr', 'instrument']):
                                    col_map['ref'] = c_idx
                                elif any(x in c_lower for x in ['debit', 'withdrawal', 'dr', 'withdrawal amt']):
                                    col_map['debit'] = c_idx
                                elif any(x in c_lower for x in ['credit', 'deposit', 'cr', 'deposit amt']):
                                    col_map['credit'] = c_idx
                                elif any(x in c_lower for x in ['balance', 'bal', 'closing balance']):
                                    col_map['balance'] = c_idx
                                elif any(x in c_lower for x in ['amount', 'txn amt']):
                                    col_map['amount'] = c_idx
                                elif any(x in c_lower for x in ['type', 'cr/dr', 'dr/cr', 'd/c']):
                                    col_map['type'] = c_idx
                            break

                    if header_row_idx != -1 and 'date' in col_map:
                        for row in table[header_row_idx + 1:]:
                            if not row or not row[col_map['date']]:
                                continue
                            date_str = str(row[col_map['date']]).strip()
                            iso_d, _, _ = parse_date(date_str)
                            if not iso_d:
                                continue

                            desc_val = str(row[col_map.get('desc', -1)] or '') if 'desc' in col_map else ''
                            ref_val = str(row[col_map.get('ref', -1)] or '') if 'ref' in col_map else ''
                            d_val = clean_amount(row[col_map['debit']]) if 'debit' in col_map else 0.0
                            c_val = clean_amount(row[col_map['credit']]) if 'credit' in col_map else 0.0
                            b_val = clean_amount(row[col_map['balance']]) if 'balance' in col_map else 0.0

                            # Support single amount with Cr/Dr type indicator
                            if 'amount' in col_map and d_val == 0.0 and c_val == 0.0:
                                amt_raw = clean_amount(row[col_map['amount']])
                                type_raw = str(row[col_map['type']] or '').upper().strip() if 'type' in col_map else ''
                                if 'CR' in type_raw or amt_raw > 0:
                                    c_val = abs(amt_raw)
                                else:
                                    d_val = abs(amt_raw)

                            transactions.append({
                                "page": page_idx + 1,
                                "date_str": date_str,
                                "val_date_str": str(row[col_map.get('val_date', col_map['date'])] or date_str),
                                "chq_ref": ref_val,
                                "narration": desc_val.replace('\n', ' '),
                                "debit": abs(d_val),
                                "credit": abs(c_val),
                                "balance": b_val
                            })

    # =========================================================================
    # Standardize & Normalize All Extracted Transactions
    # =========================================================================
    results = []
    for t in transactions:
        iso_date, yr, month = parse_date(t['date_str'])
        if not iso_date:
            continue

        val_iso, _, _ = parse_date(t.get('val_date_str'))
        party = extract_party_name(t['narration'])
        amt = t['credit'] if t['credit'] > 0 else -t['debit']

        results.append({
            "transaction_date": iso_date,
            "value_date": val_iso or iso_date,
            "year": yr,
            "month": month,
            "transaction_id": t.get('chq_ref') or f"TXN-{re.sub(r'[^A-Za-z0-9]', '', t['date_str'])[:8]}-{t['page']}",
            "name": party,
            "description": t['narration'].strip(),
            "debit": float(t['debit']),
            "credit": float(t['credit']),
            "amount": float(amt),
            "balance": float(t['balance']),
            "bank_name": bank_name,
            "account_reference": account_no or "XXXX2804",
            "source_page": t['page']
        })

    return {
        "status": "success",
        "bank_name": bank_name,
        "account_no": account_no,
        "account_name": account_name,
        "transactions": results
    }

if __name__ == "__main__":
    import sys
    test_path = sys.argv[1] if len(sys.argv) > 1 else r"D:\Acct_Statement_XXXXXXXX2804_08102026 (2).pdf"
    pwd = sys.argv[2] if len(sys.argv) > 2 else "53711114"
    res = parse_universal_statement(test_path, password=pwd)
    print("Status:", res['status'])
    print("Bank:", res.get('bank_name'))
    print("Account:", res.get('account_no'))
    print("Transactions:", len(res.get('transactions', [])))

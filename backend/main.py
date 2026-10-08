import os
import uuid
import datetime
import re
from typing import Optional
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from supabase import create_client, Client
from dotenv import load_dotenv
import pdfplumber
import pandas as pd
import pypdfium2 as pdfium
import pypdf
from universal_parser import parse_universal_statement

load_dotenv()

app = FastAPI(title="Bank Statement Analyzer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

from fastapi.responses import JSONResponse
from fastapi import Request
import traceback

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    print(f"Global exception: {exc}")
    traceback.print_exc()
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={"Access-Control-Allow-Origin": "*"}
    )

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

UPLOAD_DIR = os.path.abspath("uploaded_statements")
os.makedirs(UPLOAD_DIR, exist_ok=True)

def extract_party_name(narration: str) -> str:
    if not narration:
        return "Unknown"
    narration = narration.strip()
    
    # UPI format: UPI-<NAME>-<VPA>
    m = re.match(r'UPI-([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9@]+|\s*@|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # NEFT / RTGS / IMPS format
    m = re.match(r'(?:NEFT|RTGS|IMPS)(?:CR|DR)?-[0-9A-Za-z]+-(?:REM-)?([A-Za-z0-9\s]+?)(?:-[A-Za-z0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # ACH / NACH format
    m = re.match(r'(?:ACH|NACH)(?:D|CR|DR)?-([A-Za-z0-9\s\.\&]+?)(?:-[0-9]+|\/|$)', narration)
    if m:
        return m.group(1).replace('-', ' ').strip()
        
    # Cheque format
    m = re.match(r'(?:CHQPAID|CHQREC)-[A-Za-z0-9]+-[A-Za-z0-9]+-([A-Za-z0-9\s]+)', narration)
    if m:
        return m.group(1).strip()
        
    # ATM Cash withdrawal
    if narration.startswith("NWD-"):
        return "Cash Withdrawal (ATM)"
        
    if "INTEREST" in narration.upper():
        return "Bank Interest"
        
    if "AUTOPAY" in narration.upper() or "BILLPAY" in narration.upper():
        return "Bill Payment / AutoPay"
        
    return narration.split('-')[0].strip()[:30]

def parse_bank_statement(file_path: str):
    transactions = []
    account_no = None
    account_name = None
    bank_name = "Bank Statement"
    
    with pdfplumber.open(file_path) as pdf:
        if not pdf.pages:
            return {"bank_name": bank_name, "account_no": account_no, "account_name": account_name, "transactions": []}
            
        p0_text = pdf.pages[0].extract_text() or ""
        
        # Bank Identification
        upper_text = p0_text.upper()
        if "HDFC" in upper_text:
            bank_name = "HDFC Bank"
        elif "ICICI" in upper_text:
            bank_name = "ICICI Bank"
        elif "STATE BANK" in upper_text or "SBI" in upper_text:
            bank_name = "State Bank of India"
        elif "AXIS" in upper_text:
            bank_name = "Axis Bank"
        elif "KOTAK" in upper_text:
            bank_name = "Kotak Mahindra Bank"
        elif "PUNJAB NATIONAL" in upper_text or "PNB" in upper_text:
            bank_name = "Punjab National Bank"
            
        # Account Number Detection
        acc_match = re.search(r'Account\s*No\s*:\s*([0-9X]+)', p0_text, re.IGNORECASE)
        if not acc_match:
            acc_match = re.search(r'A/c\s*(?:No|Number)?\.?\s*[:\-]?\s*([0-9X]{9,18})', p0_text, re.IGNORECASE)
        if acc_match:
            account_no = acc_match.group(1).strip()
            
        # Customer Name
        name_match = re.search(r'(?:MR\.|MS\.|MRS\.|DR\.)\s+([A-Z\s]+?)(?:State|City|Address|Account|$)', p0_text)
        if name_match:
            account_name = name_match.group(0).split('State')[0].split('City')[0].strip()

        date_pattern = re.compile(r'^\d{2}[-/]\d{2}[-/]\d{2,4}$')
        current_txn = None
        
        # 1. First attempt: Line coordinate parsing (handles borderless statements like HDFC)
        for page_idx, page in enumerate(pdf.pages):
            words = page.extract_words()
            if not words:
                continue
                
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
                
                # Check for termination summary
                if "STATEMENTSUMMARY" in line_text or "OpeningBalance" in line_text:
                    if current_txn:
                        transactions.append(current_txn)
                        current_txn = None
                    break
                    
                # Header & Footer filtering
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
                    if current_txn:
                        more_narration = [w['text'] for w in line_words if 55 <= w['x0'] < 350 and not date_pattern.match(w['text'])]
                        if more_narration:
                            current_txn['narration'] += " " + ' '.join(more_narration)
                            
        if current_txn:
            transactions.append(current_txn)

    # 2. Fallback to standard table extraction if coordinate parser didn't find any
    if not transactions:
        with pdfplumber.open(file_path) as pdf:
            for page_idx, page in enumerate(pdf.pages):
                tables = page.extract_tables()
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    headers = [str(col).lower().strip().replace('\n', ' ') if col else f"col_{j}" for j, col in enumerate(table[0])]
                    date_col_idx = next((j for j, h in enumerate(headers) if 'date' in h), None)
                    desc_col_idx = next((j for j, h in enumerate(headers) if 'desc' in h or 'narrat' in h or 'particular' in h), None)
                    debit_col_idx = next((j for j, h in enumerate(headers) if 'debit' in h or 'withdrawal' in h or 'dr' in h), None)
                    credit_col_idx = next((j for j, h in enumerate(headers) if 'credit' in h or 'deposit' in h or 'cr' in h), None)
                    bal_col_idx = next((j for j, h in enumerate(headers) if 'bal' in h), None)
                    
                    if date_col_idx is not None:
                        for row in table[1:]:
                            if not row or not row[date_col_idx]:
                                continue
                            date_val = str(row[date_col_idx]).strip()
                            if not re.search(r'\d{1,2}[-/]\d{1,2}[-/]\d{2,4}', date_val):
                                continue
                            
                            def clean_val(v):
                                if not v: return 0.0
                                try: return float(str(v).replace(',', '').replace('₹', '').strip())
                                except: return 0.0
                                
                            d_amt = clean_val(row[debit_col_idx]) if debit_col_idx is not None else 0.0
                            c_amt = clean_val(row[credit_col_idx]) if credit_col_idx is not None else 0.0
                            b_amt = clean_val(row[bal_col_idx]) if bal_col_idx is not None else 0.0
                            desc_val = str(row[desc_col_idx]) if desc_col_idx is not None else ""
                            
                            transactions.append({
                                "page": page_idx + 1,
                                "date_str": date_val,
                                "val_date_str": date_val,
                                "chq_ref": "",
                                "narration": desc_val,
                                "debit": d_amt,
                                "credit": c_amt,
                                "balance": b_amt
                            })

    # Standardize & normalize records
    results = []
    for t in transactions:
        date_str = t['date_str']
        iso_date = str(datetime.date.today())
        yr = datetime.date.today().year
        month = datetime.date.today().month
        
        def to_iso_date(d_str):
            if not d_str: return None
            try:
                sep = '/' if '/' in d_str else '-'
                d_p = d_str.strip().split(sep)
                if len(d_p) == 3:
                    d, m, y = int(d_p[0]), int(d_p[1]), int(d_p[2])
                    if y < 100: y += 2000
                    return f"{y:04d}-{m:02d}-{d:02d}"
            except:
                pass
            return None

        iso_date = to_iso_date(t['date_str']) or str(datetime.date.today())
        val_iso = to_iso_date(t.get('val_date_str')) or iso_date
        
        try:
            yr = int(iso_date.split('-')[0])
            month = int(iso_date.split('-')[1])
        except:
            yr = datetime.date.today().year
            month = datetime.date.today().month
            
        party = extract_party_name(t['narration'])
        amt = t['credit'] if t['credit'] > 0 else -t['debit']
        
        results.append({
            "transaction_date": iso_date,
            "value_date": val_iso,
            "year": yr,
            "month": month,
            "transaction_id": t.get('chq_ref') or f"TXN-{uuid.uuid4().hex[:8].upper()}",
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
        "bank_name": bank_name,
        "account_no": account_no,
        "account_name": account_name,
        "transactions": results
    }

def ensure_local_pdf(file_path: str) -> str:
    if file_path and os.path.exists(file_path):
        return file_path
    if not file_path:
        return ""
    try:
        filename = os.path.basename(file_path)
        data = supabase.storage.from_('statements').download(filename)
        os.makedirs(os.path.dirname(file_path), exist_ok=True)
        with open(file_path, "wb") as f:
            f.write(data)
        return file_path
    except Exception as e:
        print("Notice: Could not download file from Supabase storage:", e)
        return file_path

@app.post("/api/v1/upload")
@app.post("/upload")
async def upload_statement(file: UploadFile = File(...), password: Optional[str] = Form(None)):
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    saved_filename = f"{uuid.uuid4()}_{file.filename}"
    file_path = os.path.join(UPLOAD_DIR, saved_filename)
    
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)
        
    try:
        parsed = parse_universal_statement(file_path, password=password)
    except Exception as e:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=500, detail=f"Error parsing bank statement: {str(e)}")
        
    if parsed.get("status") == "password_required":
        if os.path.exists(file_path):
            os.remove(file_path)
        return {
            "status": "password_required",
            "filename": file.filename,
            "message": parsed.get("message", "This statement is password protected. Please enter the password to unlock it.")
        }
        
    if parsed.get("status") == "invalid_password":
        if os.path.exists(file_path):
            os.remove(file_path)
        return {
            "status": "invalid_password",
            "filename": file.filename,
            "message": parsed.get("message", "Incorrect password. Please verify and try again.")
        }
        
    transactions = parsed.get("transactions", [])
    if not transactions:
        if os.path.exists(file_path):
            os.remove(file_path)
        raise HTTPException(status_code=400, detail="Could not identify valid transactions in this document.")
        
    dates = [t['transaction_date'] for t in transactions]
    first_date = min(dates)
    last_date = max(dates)
    
    # 1. Insert Document metadata
    doc_data = {
        'file_name': file.filename,
        'bank_name': parsed.get('bank_name', 'Bank Statement'),
        'file_location': file_path,
        'first_transaction_date': first_date,
        'last_transaction_date': last_date,
        'total_transactions': len(transactions),
        'processing_status': 'COMPLETED'
    }
    
    doc_res = supabase.table('documents').insert(doc_data).execute()
    if not doc_res.data:
        raise HTTPException(status_code=500, detail="Failed to save document record.")
        
    doc_id = doc_res.data[0]['document_id']

    # 1.1 Persist PDF to Supabase Cloud Storage
    try:
        with open(file_path, "rb") as f_up:
            supabase.storage.from_('statements').upload(
                saved_filename,
                f_up.read(),
                {'content-type': 'application/pdf', 'upsert': 'true'}
            )
    except Exception as st_err:
        print("Notice: Cloud storage upload skipped:", st_err)
    
    # 2. Insert Transactions with duplicate detection
    added = 0
    duplicates = 0
    
    for txn in transactions:
        txn['source_document_id'] = doc_id
        try:
            supabase.table('transactions').insert(txn).execute()
            added += 1
        except Exception as e:
            err_msg = str(e)
            if 'duplicate key' in err_msg or 'unique constraint' in err_msg:
                duplicates += 1
            else:
                # Log any unexpected insert issue
                print("Insert error:", err_msg)
                
    return {
        "status": "success",
        "added": added,
        "duplicates_skipped": duplicates,
        "document_id": doc_id,
        "bank_name": parsed.get('bank_name'),
        "account_no": parsed.get('account_no'),
        "first_transaction_date": first_date,
        "last_transaction_date": last_date,
        "total_transactions": len(transactions)
    }

@app.get("/api/v1/transactions")
@app.get("/transactions")
async def get_transactions():
    try:
        res = supabase.table('transactions').select('*').order('transaction_date', desc=True).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/documents")
@app.get("/documents")
async def get_documents():
    try:
        res = supabase.table('documents').select('*').order('upload_date', desc=True).execute()
        return res.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/v1/documents/{document_id}/info")
@app.get("/documents/{document_id}/info")
async def get_document_info(document_id: str):
    res = supabase.table('documents').select('*').eq('document_id', document_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    doc_data = res.data[0]
    file_path = ensure_local_pdf(doc_data.get('file_location'))
    total_pages = 1
    if file_path and os.path.exists(file_path):
        try:
            doc = pdfium.PdfDocument(file_path)
            total_pages = len(doc)
            doc.close()
        except Exception:
            try:
                reader = pypdf.PdfReader(file_path)
                total_pages = len(reader.pages)
            except Exception:
                pass
                
    return {**doc_data, "total_pages": total_pages}

@app.get("/api/v1/documents/{document_id}/pdf")
@app.get("/documents/{document_id}/pdf")
async def get_document_pdf(document_id: str):
    res = supabase.table('documents').select('*').eq('document_id', document_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    file_path = ensure_local_pdf(res.data[0].get('file_location'))
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Physical PDF file not found on disk or cloud storage")
        
    filename = res.data[0].get('file_name', 'statement.pdf')
    return FileResponse(
        file_path, 
        media_type="application/pdf", 
        headers={
            "Content-Disposition": f'inline; filename="{filename}"',
            "Content-Security-Policy": "frame-ancestors *",
            "X-Frame-Options": "ALLOWALL",
            "Access-Control-Allow-Origin": "*"
        }
    )

@app.get("/api/v1/documents/{document_id}/page/{page_num}")
@app.get("/documents/{document_id}/page/{page_num}")
async def get_document_page(document_id: str, page_num: int):
    res = supabase.table('documents').select('*').eq('document_id', document_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    file_path = ensure_local_pdf(res.data[0].get('file_location'))
    if not file_path or not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="Physical PDF file not found on disk or cloud storage")
        
    try:
        import io, pypdfium2 as pdfium
        from fastapi.responses import Response

        doc = pdfium.PdfDocument(file_path)
        try:
            total_pages = len(doc)
            if page_num < 1 or page_num > total_pages:
                raise HTTPException(status_code=400, detail=f"Page number {page_num} out of bounds (1-{total_pages})")

            page = doc.get_page(page_num - 1)
            img = page.render(scale=2.0).to_pil()
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            
            return Response(
                content=buf.getvalue(), 
                media_type="image/png",
                headers={
                    "X-Total-Pages": str(total_pages),
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Expose-Headers": "X-Total-Pages"
                }
            )
        finally:
            doc.close()
    except HTTPException:
        raise
@app.delete("/api/v1/documents/{document_id}")
@app.delete("/documents/{document_id}")
async def delete_document(document_id: str):
    res = supabase.table('documents').select('*').eq('document_id', document_id).execute()
    if not res.data:
        raise HTTPException(status_code=404, detail="Document not found")
        
    file_path = res.data[0].get('file_location')
    
    try:
        # Delete transactions associated with this document
        supabase.table('transactions').delete().eq('source_document_id', document_id).execute()
        
        # Delete document record
        supabase.table('documents').delete().eq('document_id', document_id).execute()
        
        # Remove file from disk
        if file_path and os.path.exists(file_path):
            try:
                os.remove(file_path)
            except Exception as fe:
                print("Failed to remove file from disk:", fe)

        # Remove from Supabase Cloud Storage
        try:
            if file_path:
                supabase.storage.from_('statements').remove([os.path.basename(file_path)])
        except Exception as se:
            print("Failed to remove file from cloud storage:", se)
                
        return {"status": "success", "message": "Document and its transactions deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {str(e)}")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)


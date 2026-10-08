# 🏦 Bank Statement Analyzer & Transaction Dashboard

A modern, cloud-native banking statement parsing and analytics platform. Built with **FastAPI**, **Next.js 16 (App Router)**, **Supabase PostgreSQL & Storage**, and universal multi-tier PDF extraction algorithms.

---

## 🌟 Key Features

- **Universal Multi-Bank Parser**: Automatically parses statements from **27+ banks** (HDFC, SBI, ICICI, Axis, Kotak, PNB, Bank of Baroda, Canara, etc.) with dynamic coordinate and table boundary detection.
- **Password-Protected PDF Support**: Automatically prompts for password, decrypts in-memory, and safely persists unencrypted files for instant viewing.
- **Spreadsheet Analytics Dashboard**:
  - Full-featured TanStack table with column sorting and search.
  - Multi-level filtering by **Year, Month, Transaction Type (Debit/Credit)**, and **Amount Slider**.
  - Date Range picker.
  - Statement management tab with 1-click PDF deletion.
- **Interactive PDF Viewer**:
  - **High-Res Page View**: Ultra-sharp rendered page images with zoom controls.
  - **Interactive PDF View**: In-browser document viewer with page selector dropdown, full continuous scroll, text search, download, and open-in-new-tab.
- **Cloud-Native Storage**: Automatically saves statement PDFs to **Supabase Cloud Storage** for 100% persistent cloud operation.

---

## 🚀 24/7 Cloud Deployment Guide

### Option 1: Deploy with Render Blueprint (`render.yaml`)

1. **Push this repository to GitHub**:
   ```bash
   git init
   git add .
   git commit -m "Initial commit - Bank Statement Analyzer"
   git remote add origin https://github.com/YOUR_USERNAME/bank-analyzer.git
   git branch -M main
   git push -u origin main
   ```

2. **Deploy on Render (render.com)**:
   - Go to [dashboard.render.com](https://dashboard.render.com).
   - Click **New +** → **Blueprint**.
   - Select your GitHub repository (`bank-analyzer`).
   - Render will detect `render.yaml` and configure both services:
     - `bank-analyzer-backend` (FastAPI Python)
     - `bank-analyzer-frontend` (Next.js Node)
   - Fill in your Supabase credentials when prompted:
     - `SUPABASE_URL`: `https://rxarnxvigaoglttcesau.supabase.co`
     - `SUPABASE_KEY`: *(Your Supabase Service Role Key)*
     - `NEXT_PUBLIC_SUPABASE_URL`: `https://rxarnxvigaoglttcesau.supabase.co`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: *(Your Supabase Anon Key)*
   - Click **Apply**.
   - Render will build and deploy both services automatically with live HTTPS URLs!

---

### Option 2: Deploy Frontend on Vercel + Backend on Render

If you prefer Vercel for Next.js and Render for Python:

1. **Deploy Backend on Render**:
   - Create a **Web Service** on Render pointing to the `backend` directory.
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - Add Environment Variables:
     - `SUPABASE_URL`
     - `SUPABASE_KEY`
   - Note the backend URL (e.g. `https://bank-analyzer-backend.onrender.com`).

2. **Deploy Frontend on Vercel**:
   - Go to [vercel.com](https://vercel.com) and import the repository.
   - Set Root Directory to `frontend`.
   - Add Environment Variables:
     - `NEXT_PUBLIC_SUPABASE_URL`
     - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
     - `NEXT_PUBLIC_API_URL`: `https://bank-analyzer-backend.onrender.com`
   - Deploy!

---

## 💻 Local Development

### Prerequisites
- Python 3.11+
- Node.js 18+

### 1. Run via Launcher Script (Windows)
Double click `start-app.bat` in the root folder. It starts both the backend and frontend in dedicated console windows.

### 2. Run Manually
**Backend:**
```bash
cd backend
python -m venv venv
.\venv\Scripts\activate   # On Linux/Mac: source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  UploadCloud, Search, Calendar, FileText, ArrowUpDown, 
  Filter, RefreshCw, X, Eye, EyeOff, FileSpreadsheet, Trash2,
  CheckCircle2, AlertCircle, Building2, ChevronLeft, ChevronRight,
  SlidersHorizontal, ExternalLink, ZoomIn, ZoomOut, Layers, Lock, KeyRound, Download
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useDropzone } from 'react-dropzone';
import axios from 'axios';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
  getSortedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  SortingState
} from '@tanstack/react-table';
import { format, parseISO } from 'date-fns';

export type Transaction = {
  id: string;
  transaction_date: string;
  value_date?: string;
  year: number;
  month: number;
  transaction_id: string;
  name: string;
  description: string;
  debit: number;
  credit: number;
  amount: number;
  balance: number;
  bank_name: string;
  account_reference: string;
  source_document_id?: string;
  source_page?: number;
};

export type DocumentSummary = {
  document_id: string;
  file_name: string;
  bank_name: string;
  first_transaction_date: string;
  last_transaction_date: string;
  total_transactions: number;
  upload_date?: string;
  added?: number;
  duplicates_skipped?: number;
};

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
];

const getApiBase = () => {
  if (process.env.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '');
  }
  if (typeof window !== 'undefined') {
    const win = window as any;
    const isCapacitor = !!(
      win.Capacitor?.isNativePlatform?.() ||
      win.Capacitor?.getPlatform?.() === 'android' ||
      window.location.protocol === 'capacitor:' ||
      (window.location.hostname === 'localhost' && window.location.port !== '3000' && window.location.port !== '8000') ||
      navigator.userAgent.includes('Android')
    );

    if (isCapacitor) {
      return 'https://bank-analyzer-backend.onrender.com';
    }

    if (window.location.port === '3000') {
      return `http://${window.location.hostname}:8000`;
    }
    return 'https://bank-analyzer-backend.onrender.com';
  }
  return 'http://localhost:8000';
};

export default function TransactionDashboard() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<DocumentSummary | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  // Password-protected PDF Modal State
  const [pendingPasswordFile, setPendingPasswordFile] = useState<File | null>(null);
  const [statementPassword, setStatementPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Filter Panel Slide State & Active Tab with LocalStorage Persistence
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('bankanalyzer_filter_open');
      return saved !== null ? saved === 'true' : true;
    }
    return true;
  });
  const [sidebarTab, setSidebarTab] = useState<'filters' | 'documents'>('filters');

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem('bankanalyzer_filter_open', String(next));
      }
      return next;
    });
  };

  // Filters State
  const [globalSearch, setGlobalSearch] = useState('');
  const [selectedDocId, setSelectedDocId] = useState<string>('ALL');
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [selectedMonth, setSelectedMonth] = useState<string>('ALL');
  const [selectedBank, setSelectedBank] = useState<string>('ALL');
  const [selectedType, setSelectedType] = useState<'ALL' | 'DEBIT' | 'CREDIT'>('ALL');
  const [selectedParty, setSelectedParty] = useState<string>('');
  const [minAmount, setMinAmount] = useState<number>(0);
  const [maxAmount, setMaxAmount] = useState<number>(500000);
  const [fromDate, setFromDate] = useState<string>('');
  const [toDate, setToDate] = useState<string>('');

  // Table Sorting
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'transaction_date', desc: true }
  ]);

  // PDF Preview State
  const [previewDocId, setPreviewDocId] = useState<string | null>(null);
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [previewTotalPages, setPreviewTotalPages] = useState<number>(1);
  const [previewTxn, setPreviewTxn] = useState<Transaction | null>(null);
  const [viewerMode, setViewerMode] = useState<'image' | 'pdf'>('image');
  const [imageZoom, setImageZoom] = useState<number>(100);

  // Fetch document page count when previewing a document
  useEffect(() => {
    if (!previewDocId) return;
    const fetchDocInfo = async () => {
      try {
        const api = getApiBase();
        const res = await axios.get(`${api}/api/v1/documents/${previewDocId}/info`);
        if (res.data?.total_pages) {
          setPreviewTotalPages(res.data.total_pages);
        }
      } catch (err) {
        console.warn("Could not load document info:", err);
      }
    };
    fetchDocInfo();
  }, [previewDocId]);

  // Fetch data
  const fetchData = async () => {
    setLoading(true);
    try {
      const api = getApiBase();
      const [txRes, docRes] = await Promise.all([
        axios.get(`${api}/api/v1/transactions`),
        axios.get(`${api}/api/v1/documents`)
      ]);

      if (!Array.isArray(txRes.data) || !Array.isArray(docRes.data)) {
        throw new Error("Invalid array response from backend API");
      }

      setTransactions(txRes.data);
      setDocuments(docRes.data);
    } catch (err: any) {
      console.error("Backend fetch error, falling back to Supabase client:", err);
      try {
        const { data: txns, error: txError } = await supabase
          .from('transactions')
          .select('*')
          .order('transaction_date', { ascending: false });

        if (!txError && Array.isArray(txns)) {
          setTransactions(txns);
        } else {
          setTransactions([]);
        }

        const { data: docs, error: docError } = await supabase
          .from('documents')
          .select('*')
          .order('upload_date', { ascending: false });

        if (!docError && Array.isArray(docs)) {
          setDocuments(docs);
        } else {
          setDocuments([]);
        }
      } catch (innerErr) {
        setToastMessage({ text: "Failed to connect to backend server or database", type: 'error' });
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  // Upload handler
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    setToastMessage(null);

    for (const file of acceptedFiles) {
      const formData = new FormData();
      formData.append('file', file);

      try {
        const response = await axios.post(`${getApiBase()}/api/v1/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });

        const resData = response.data;
        if (resData.status === 'password_required' || resData.status === 'invalid_password') {
          setPendingPasswordFile(file);
          setPasswordError(resData.status === 'invalid_password' ? 'Incorrect password. Please verify and try again.' : null);
          setUploading(false);
          return;
        }

        setUploadResult({
          document_id: resData.document_id,
          file_name: file.name,
          bank_name: resData.bank_name || 'Bank Statement',
          first_transaction_date: resData.first_transaction_date,
          last_transaction_date: resData.last_transaction_date,
          total_transactions: resData.total_transactions,
          added: resData.added,
          duplicates_skipped: resData.duplicates_skipped
        });

        await fetchData();
      } catch (err: any) {
        const msg = err.response?.data?.detail || "Error parsing statement file";
        setToastMessage({ text: msg, type: 'error' });
      }
    }
    setUploading(false);
  }, []);

  // Unlock and upload handler
  const handleUnlockAndUpload = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pendingPasswordFile || !statementPassword.trim()) return;

    setUnlocking(true);
    setPasswordError(null);

    const formData = new FormData();
    formData.append('file', pendingPasswordFile);
    formData.append('password', statementPassword.trim());

    try {
      const response = await axios.post(`${getApiBase()}/api/v1/upload`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      const resData = response.data;
      if (resData.status === 'password_required' || resData.status === 'invalid_password') {
        setPasswordError('Incorrect password. Please check and try again.');
        setUnlocking(false);
        return;
      }

      setUploadResult({
        document_id: resData.document_id,
        file_name: pendingPasswordFile.name,
        bank_name: resData.bank_name || 'Bank Statement',
        first_transaction_date: resData.first_transaction_date,
        last_transaction_date: resData.last_transaction_date,
        total_transactions: resData.total_transactions,
        added: resData.added,
        duplicates_skipped: resData.duplicates_skipped
      });

      setPendingPasswordFile(null);
      setStatementPassword('');
      setPasswordError(null);
      await fetchData();
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Failed to unlock statement file";
      setPasswordError(msg);
    } finally {
      setUnlocking(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] }
  });

  // Remove / Delete uploaded PDF Document
  const handleRemoveDocument = async (docId: string, fileName: string) => {
    if (!window.confirm(`Are you sure you want to remove "${fileName}"?\nThis will permanently delete the document and all its extracted transactions.`)) {
      return;
    }

    setDeletingDocId(docId);
    try {
      await axios.delete(`${getApiBase()}/api/v1/documents/${docId}`);
      setToastMessage({
        text: `Successfully deleted "${fileName}" and associated transactions.`,
        type: 'success'
      });
      if (selectedDocId === docId) {
        setSelectedDocId('ALL');
      }
      await fetchData();
    } catch (err: any) {
      const msg = err.response?.data?.detail || "Failed to remove document";
      setToastMessage({ text: msg, type: 'error' });
    } finally {
      setDeletingDocId(null);
    }
  };

  // Dynamic Year & Month Lists based on uploaded transactions
  const availableYears = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    const years = Array.from(new Set(txns.map(t => t.year).filter(Boolean)));
    return years.sort((a, b) => b - a);
  }, [transactions]);

  const availableMonths = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    if (selectedYear === 'ALL') {
      const months = Array.from(new Set(txns.map(t => t.month).filter(Boolean)));
      return months.sort((a, b) => a - b);
    }
    const months = Array.from(
      new Set(
        txns
          .filter(t => t.year.toString() === selectedYear)
          .map(t => t.month)
          .filter(Boolean)
      )
    );
    return months.sort((a, b) => a - b);
  }, [transactions, selectedYear]);

  const availableBanks = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    return Array.from(new Set(txns.map(t => t.bank_name).filter(Boolean)));
  }, [transactions]);

  // Max transaction amount for slider bound
  const highestAmount = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    if (!txns.length) return 100000;
    const maxVal = Math.max(...txns.map(t => Math.max(t.debit || 0, t.credit || 0)));
    return Math.ceil(maxVal / 10000) * 10000 || 100000;
  }, [transactions]);

  // Active filters count badge
  const activeFiltersCount = useMemo(() => {
    let count = 0;
    if (selectedDocId !== 'ALL') count++;
    if (selectedYear !== 'ALL') count++;
    if (selectedMonth !== 'ALL') count++;
    if (selectedBank !== 'ALL') count++;
    if (selectedType !== 'ALL') count++;
    if (selectedParty) count++;
    if (minAmount > 0) count++;
    if (maxAmount < highestAmount) count++;
    if (fromDate) count++;
    if (toDate) count++;
    return count;
  }, [selectedDocId, selectedYear, selectedMonth, selectedBank, selectedType, selectedParty, minAmount, maxAmount, highestAmount, fromDate, toDate]);

  // Overall Global Date Range of ALL uploaded statements
  const globalDateRange = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    if (!txns.length) return { start: 'N/A', end: 'N/A' };
    const dates = txns.map(t => t.transaction_date).filter(Boolean);
    if (!dates.length) return { start: 'N/A', end: 'N/A' };
    const sorted = [...dates].sort();
    return {
      start: format(parseISO(sorted[0]), 'dd-MMM-yyyy'),
      end: format(parseISO(sorted[sorted.length - 1]), 'dd-MMM-yyyy')
    };
  }, [transactions]);

  // Filtered dataset
  const filteredData = useMemo(() => {
    const txns = Array.isArray(transactions) ? transactions : [];
    return txns.filter(t => {
      // Document Filter
      if (selectedDocId !== 'ALL' && t.source_document_id !== selectedDocId) return false;

      // Global Search
      if (globalSearch) {
        const q = globalSearch.toLowerCase();
        const matches = 
          (t.name && t.name.toLowerCase().includes(q)) ||
          (t.description && t.description.toLowerCase().includes(q)) ||
          (t.transaction_id && t.transaction_id.toLowerCase().includes(q)) ||
          (t.bank_name && t.bank_name.toLowerCase().includes(q)) ||
          (t.account_reference && t.account_reference.toLowerCase().includes(q)) ||
          t.amount.toString().includes(q) ||
          t.debit.toString().includes(q) ||
          t.credit.toString().includes(q) ||
          t.transaction_date.includes(q);
        if (!matches) return false;
      }

      // Year Filter
      if (selectedYear !== 'ALL' && t.year.toString() !== selectedYear) return false;

      // Month Filter
      if (selectedMonth !== 'ALL' && t.month.toString() !== selectedMonth) return false;

      // Bank Filter
      if (selectedBank !== 'ALL' && t.bank_name !== selectedBank) return false;

      // Party / Name Filter
      if (selectedParty && (!t.name || !t.name.toLowerCase().includes(selectedParty.toLowerCase()))) return false;

      // Transaction Type
      if (selectedType === 'DEBIT' && t.debit <= 0) return false;
      if (selectedType === 'CREDIT' && t.credit <= 0) return false;

      // Amount Range
      const txnAmt = Math.max(t.debit || 0, t.credit || 0);
      if (txnAmt < minAmount || txnAmt > maxAmount) return false;

      // Date Range Custom Pickers
      if (fromDate && t.transaction_date < fromDate) return false;
      if (toDate && t.transaction_date > toDate) return false;

      return true;
    });
  }, [
    transactions, selectedDocId, globalSearch, selectedYear, selectedMonth, 
    selectedBank, selectedType, selectedParty, minAmount, maxAmount, 
    fromDate, toDate
  ]);

  // Filter-dependent summary metrics
  const summaryMetrics = useMemo(() => {
    const totalCount = filteredData.length;
    const totalCredits = filteredData.reduce((acc, t) => acc + (t.credit || 0), 0);
    const totalDebits = filteredData.reduce((acc, t) => acc + (t.debit || 0), 0);
    const netAmount = totalCredits - totalDebits;
    const uniqueNames = new Set(filteredData.map(t => t.name).filter(Boolean)).size;

    const dates = filteredData.map(t => t.transaction_date).filter(Boolean).sort();
    const firstDate = dates.length ? format(parseISO(dates[0]), 'dd-MMM-yyyy') : '-';
    const lastDate = dates.length ? format(parseISO(dates[dates.length - 1]), 'dd-MMM-yyyy') : '-';

    return {
      totalCount,
      totalCredits,
      totalDebits,
      netAmount,
      uniqueNames,
      firstDate,
      lastDate
    };
  }, [filteredData]);

  // Export to CSV
  const exportToCSV = () => {
    if (!filteredData.length) return;
    const headers = [
      "Year", "Month", "Date", "Transaction ID", "Party Name", 
      "Description", "Debit", "Credit", "Amount", "Balance", "Bank", "Account No", "Page"
    ];
    const rows = filteredData.map(t => [
      t.year,
      t.month,
      t.transaction_date,
      `"${t.transaction_id || ''}"`,
      `"${t.name || ''}"`,
      `"${(t.description || '').replace(/"/g, '""')}"`,
      t.debit,
      t.credit,
      t.amount,
      t.balance,
      `"${t.bank_name || ''}"`,
      `"${t.account_reference || ''}"`,
      t.source_page || 1
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + 
      [headers.join(","), ...rows.map(e => e.join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `bank_transactions_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Generate Filtered PDF (Browser Print Friendly View)
  const generateFilteredPDF = () => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const rowsHtml = filteredData.map(t => `
      <tr>
        <td>${t.transaction_date}</td>
        <td><b>${t.name || '-'}</b></td>
        <td>${t.description}</td>
        <td>${t.transaction_id || '-'}</td>
        <td style="color: #b91c1c; text-align: right;">${t.debit > 0 ? '₹' + t.debit.toLocaleString('en-IN', {minimumFractionDigits: 2}) : '-'}</td>
        <td style="color: #15803d; text-align: right;">${t.credit > 0 ? '₹' + t.credit.toLocaleString('en-IN', {minimumFractionDigits: 2}) : '-'}</td>
        <td style="text-align: right; font-weight: bold;">₹${t.balance.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
      </tr>
    `).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Filtered Transactions Report</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 24px; color: #1e293b; }
            h1 { font-size: 22px; margin-bottom: 4px; }
            .meta { font-size: 13px; color: #64748b; margin-bottom: 20px; }
            .summary { display: flex; gap: 20px; margin-bottom: 20px; background: #f8fafc; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; }
            .summary div { font-size: 13px; }
            table { width: 100%; border-collapse: collapse; font-size: 12px; }
            th, td { border: 1px solid #cbd5e1; padding: 8px 10px; text-align: left; }
            th { background: #f1f5f9; font-weight: 600; }
          </style>
        </head>
        <body>
          <h1>Bank Transaction Statement Report</h1>
          <div class="meta">Generated on ${format(new Date(), 'dd-MMM-yyyy HH:mm')} | Total Transactions: ${filteredData.length}</div>
          <div class="summary">
            <div><b>Total Debits:</b> ₹${summaryMetrics.totalDebits.toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
            <div><b>Total Credits:</b> ₹${summaryMetrics.totalCredits.toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
            <div><b>Net Balance:</b> ₹${summaryMetrics.netAmount.toLocaleString('en-IN', {minimumFractionDigits: 2})}</div>
            <div><b>Date Range:</b> ${summaryMetrics.firstDate} → ${summaryMetrics.lastDate}</div>
          </div>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Party / Name</th>
                <th>Description</th>
                <th>Ref ID</th>
                <th style="text-align: right;">Debit</th>
                <th style="text-align: right;">Credit</th>
                <th style="text-align: right;">Balance</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
          <script>
            window.onload = function() { window.print(); }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // TanStack React Table Column Setup
  const columnHelper = createColumnHelper<Transaction>();
  const columns = useMemo(() => [
    columnHelper.accessor('year', {
      header: 'Year',
      size: 70,
      cell: info => <span className="text-gray-500 font-mono text-xs">{info.getValue()}</span>
    }),
    columnHelper.accessor('month', {
      header: 'Month',
      size: 70,
      cell: info => <span className="text-gray-500 font-medium text-xs">{MONTH_NAMES[(info.getValue() || 1) - 1]}</span>
    }),
    columnHelper.accessor('transaction_date', {
      header: ({ column }) => (
        <button 
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 font-semibold text-gray-700 hover:text-black cursor-pointer"
        >
          Date <ArrowUpDown className="w-3 h-3" />
        </button>
      ),
      cell: info => (
        <span className="font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">
          {format(parseISO(info.getValue()), 'dd-MMM-yyyy')}
        </span>
      )
    }),
    columnHelper.accessor('transaction_id', {
      header: 'Txn ID / Ref',
      cell: info => <span className="font-mono text-xs text-gray-600 truncate max-w-[120px] block">{info.getValue() || '-'}</span>
    }),
    columnHelper.accessor('name', {
      header: 'Party / Name',
      cell: info => (
        <div className="font-medium text-gray-900 max-w-[160px] truncate" title={info.getValue()}>
          {info.getValue() || '-'}
        </div>
      )
    }),
    columnHelper.accessor('description', {
      header: 'Description / Narration',
      cell: info => (
        <div className="text-xs text-gray-600 max-w-[280px] truncate" title={info.getValue()}>
          {info.getValue()}
        </div>
      )
    }),
    columnHelper.accessor('debit', {
      header: ({ column }) => (
        <button 
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 justify-end w-full font-semibold text-gray-700 cursor-pointer"
        >
          Debit <ArrowUpDown className="w-3 h-3" />
        </button>
      ),
      cell: info => {
        const val = info.getValue();
        return (
          <div className="text-right font-mono text-xs font-medium text-red-600">
            {val > 0 ? `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
          </div>
        );
      }
    }),
    columnHelper.accessor('credit', {
      header: ({ column }) => (
        <button 
          onClick={() => column.toggleSorting(column.getIsSorted() === 'asc')}
          className="flex items-center gap-1 justify-end w-full font-semibold text-gray-700 cursor-pointer"
        >
          Credit <ArrowUpDown className="w-3 h-3" />
        </button>
      ),
      cell: info => {
        const val = info.getValue();
        return (
          <div className="text-right font-mono text-xs font-medium text-green-600">
            {val > 0 ? `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2 })}` : '-'}
          </div>
        );
      }
    }),
    columnHelper.accessor('amount', {
      header: 'Amount',
      cell: info => {
        const val = info.getValue();
        return (
          <div className={`text-right font-mono text-xs font-bold ${val >= 0 ? 'text-green-700' : 'text-red-700'}`}>
            {val >= 0 ? '+' : ''}₹{Math.abs(val).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
          </div>
        );
      }
    }),
    columnHelper.accessor('balance', {
      header: 'Balance',
      cell: info => (
        <div className="text-right font-mono text-xs font-semibold text-gray-900">
          ₹{(info.getValue() || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
        </div>
      )
    }),
    columnHelper.display({
      id: 'actions',
      header: 'Source PDF',
      cell: info => {
        const row = info.row.original;
        return (
          <button
            onClick={() => {
              setPreviewDocId(row.source_document_id || (documents[0]?.document_id ?? null));
              setPreviewPage(row.source_page || 1);
              setPreviewTxn(row);
              setImageZoom(100);
            }}
            className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-2.5 py-1 rounded-md transition-colors cursor-pointer shadow-2xs"
          >
            <Eye className="w-3.5 h-3.5" />
            Page {row.source_page || 1}
          </button>
        );
      }
    })
  ], [columnHelper, documents]);

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: {
      pagination: { pageSize: 25 }
    }
  });

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col text-slate-800">
      {/* Top Navbar */}
      <header className="h-16 bg-white border-b border-slate-200 px-6 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <Building2 className="w-6 h-6 text-blue-600" />
            <span className="font-extrabold text-xl tracking-tight text-slate-900">BankAnalyzer</span>
          </div>
          <div className="h-6 w-px bg-slate-200 hidden md:block" />
          {/* Global Date Range Indicator */}
          <div className="hidden lg:flex items-center gap-2 text-xs bg-slate-100 px-3 py-1.5 rounded-full text-slate-600 font-medium">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>Overall Statement Period:</span>
            <b className="text-slate-900">{globalDateRange.start} → {globalDateRange.end}</b>
          </div>
        </div>

        {/* Global Search Bar */}
        <div className="flex-1 max-w-md mx-6">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search by Name, Amount, Txn ID, Narration..." 
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              className="w-full bg-slate-100 focus:bg-white border border-transparent focus:border-blue-500 rounded-lg pl-9 pr-4 py-2 text-sm outline-none transition-all"
            />
            {globalSearch && (
              <button 
                onClick={() => setGlobalSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Action Buttons: Slider Filter & Upload Statement */}
        <div className="flex items-center gap-3">
          {/* SLIDER BUTTON WITH UPLOADED PDF COUNT & ACTIVE FILTER BADGES */}
          <button
            onClick={toggleFilterPanel}
            className={`flex items-center gap-2.5 px-3.5 py-2 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer ${
              isFilterPanelOpen 
                ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-xs' 
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs'
            }`}
            title="Toggle Advanced Filters and Uploaded Statements Slider"
          >
            <SlidersHorizontal className="w-4 h-4 text-blue-600" />
            <span className="font-bold">Filters & Statements</span>

            {/* Uploaded PDF Count Badge */}
            <span className="flex items-center gap-1 bg-slate-100 text-slate-700 border border-slate-200 px-2 py-0.5 rounded-full text-[11px] font-bold">
              <FileText className="w-3 h-3 text-blue-600" />
              <span>{documents.length} PDF{documents.length !== 1 ? 's' : ''}</span>
            </span>

            {/* Active Filters Badge */}
            {activeFiltersCount > 0 && (
              <span className="bg-blue-600 text-white rounded-full px-1.5 py-0.2 text-[10px] font-bold">
                {activeFiltersCount}
              </span>
            )}
          </button>

          {/* Upload Button */}
          <div 
            {...getRootProps()} 
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer shadow-sm transition-all ${
              uploading 
                ? 'bg-blue-400 text-white cursor-not-allowed'
                : isDragActive
                  ? 'bg-blue-800 text-white ring-2 ring-blue-400'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                <span>Processing PDF...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-4 h-4" />
                <span>Upload Statement</span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Container */}
      <div className="flex-1 p-6 max-w-[1600px] w-full mx-auto space-y-6">
        {/* Upload Result Notification Card */}
        {uploadResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 flex items-start justify-between shadow-sm animate-in fade-in">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              <div>
                <h4 className="font-semibold text-emerald-900 text-sm">
                  Statement Successfully Processed: {uploadResult.file_name}
                </h4>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-emerald-800">
                  <span>Bank: <b>{uploadResult.bank_name}</b></span>
                  <span>Date Range: <b>{uploadResult.first_transaction_date} → {uploadResult.last_transaction_date}</b></span>
                  <span>Extracted: <b>{uploadResult.total_transactions}</b></span>
                  <span>New Added: <b className="text-emerald-700">{uploadResult.added}</b></span>
                  {uploadResult.duplicates_skipped! > 0 && (
                    <span>Duplicates Skipped: <b className="text-amber-700">{uploadResult.duplicates_skipped}</b></span>
                  )}
                </div>
              </div>
            </div>
            <button 
              onClick={() => setUploadResult(null)}
              className="text-emerald-600 hover:text-emerald-800 p-1 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Generic Toast Notification */}
        {toastMessage && (
          <div className={`border rounded-xl p-4 flex items-start justify-between shadow-sm ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="flex items-start gap-3">
              {toastMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5" />
              )}
              <div>
                <p className="text-xs font-semibold">{toastMessage.text}</p>
              </div>
            </div>
            <button 
              onClick={() => setToastMessage(null)}
              className="p-1 hover:opacity-75 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Dynamic Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Matching Transactions</span>
            <div className="text-2xl font-bold text-slate-900 mt-1">{summaryMetrics.totalCount}</div>
            <span className="text-[11px] text-slate-400">Total in view</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Total Credits</span>
            <div className="text-2xl font-bold text-emerald-600 mt-1">
              ₹{summaryMetrics.totalCredits.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[11px] text-emerald-600 font-medium">Incoming funds</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Total Debits</span>
            <div className="text-2xl font-bold text-rose-600 mt-1">
              ₹{summaryMetrics.totalDebits.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[11px] text-rose-600 font-medium">Outgoing payments</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Net Amount</span>
            <div className={`text-2xl font-bold mt-1 ${summaryMetrics.netAmount >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
              ₹{summaryMetrics.netAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[11px] text-slate-400">Net cashflow</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Unique Parties</span>
            <div className="text-2xl font-bold text-purple-600 mt-1">{summaryMetrics.uniqueNames}</div>
            <span className="text-[11px] text-slate-400">Identified entities</span>
          </div>

          <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
            <span className="text-xs text-slate-500 font-medium">Filtered Period</span>
            <div className="text-xs font-bold text-slate-900 mt-2 truncate" title={`${summaryMetrics.firstDate} → ${summaryMetrics.lastDate}`}>
              {summaryMetrics.firstDate}
            </div>
            <div className="text-xs font-bold text-slate-900 truncate">
              → {summaryMetrics.lastDate}
            </div>
          </div>
        </div>

        {/* Dashboard Workspace */}
        <div className="flex gap-6 items-start transition-all duration-300">
          {/* SLIDER / COLLAPSIBLE ADVANCED FILTER & STATEMENTS TAB */}
          {isFilterPanelOpen && (
            <div className="w-84 shrink-0 bg-white p-5 rounded-xl border border-slate-200 shadow-sm space-y-5 transition-all duration-300 animate-in fade-in slide-in-from-left-4 sticky top-24">
              {/* Header with Navigation Tabs */}
              <div className="flex items-center justify-between pb-3 border-b border-slate-100">
                <div className="flex bg-slate-100 p-0.5 rounded-lg text-xs font-bold">
                  <button
                    onClick={() => setSidebarTab('filters')}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer ${
                      sidebarTab === 'filters' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    Filters
                  </button>
                  <button
                    onClick={() => setSidebarTab('documents')}
                    className={`px-3 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                      sidebarTab === 'documents' ? 'bg-white text-blue-700 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    <span>Statements</span>
                    <span className="bg-blue-600 text-white rounded-full px-1.5 py-0.2 text-[10px]">
                      {documents.length}
                    </span>
                  </button>
                </div>

                <button
                  onClick={() => {
                    setIsFilterPanelOpen(false);
                    if (typeof window !== 'undefined') localStorage.setItem('bankanalyzer_filter_open', 'false');
                  }}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded hover:bg-slate-100 cursor-pointer"
                  title="Collapse panel slider"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
              </div>

              {/* TAB 1: ADVANCED FILTERS */}
              {sidebarTab === 'filters' && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-500">Filter Conditions</span>
                    <button 
                      onClick={() => {
                        setSelectedDocId('ALL');
                        setSelectedYear('ALL');
                        setSelectedMonth('ALL');
                        setSelectedBank('ALL');
                        setSelectedType('ALL');
                        setSelectedParty('');
                        setMinAmount(0);
                        setMaxAmount(highestAmount);
                        setFromDate('');
                        setToDate('');
                        setGlobalSearch('');
                      }}
                      className="text-blue-600 hover:text-blue-800 font-semibold cursor-pointer"
                    >
                      Reset All
                    </button>
                  </div>

                  {/* Filter by Statement Document */}
                  {Array.isArray(documents) && documents.length > 0 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">Statement Document</label>
                      <select
                        value={selectedDocId}
                        onChange={e => setSelectedDocId(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500 truncate"
                      >
                        <option value="ALL">All Uploaded Statements ({documents.length})</option>
                        {documents.map(d => (
                          <option key={d.document_id} value={d.document_id}>
                            {d.file_name} ({d.bank_name})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* Dynamic Year Categorization */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1.5">Year</label>
                    <div className="flex flex-wrap gap-1.5">
                      <button
                        onClick={() => { setSelectedYear('ALL'); setSelectedMonth('ALL'); }}
                        className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                          selectedYear === 'ALL' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        All
                      </button>
                      {availableYears.map(yr => (
                        <button
                          key={yr}
                          onClick={() => { setSelectedYear(yr.toString()); setSelectedMonth('ALL'); }}
                          className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors cursor-pointer ${
                            selectedYear === yr.toString() ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                          }`}
                        >
                          {yr}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Dynamic Month Categorization */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1.5">Month</label>
                    <select
                      value={selectedMonth}
                      onChange={e => setSelectedMonth(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                    >
                      <option value="ALL">All Months</option>
                      {availableMonths.map(m => (
                        <option key={m} value={m.toString()}>
                          {MONTH_NAMES[m - 1]} (Month {m})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Transaction Type */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1.5">Transaction Type</label>
                    <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg text-xs">
                      {(['ALL', 'DEBIT', 'CREDIT'] as const).map(type => (
                        <button
                          key={type}
                          onClick={() => setSelectedType(type)}
                          className={`py-1 rounded font-medium transition-all cursor-pointer ${
                            selectedType === type ? 'bg-white shadow-2xs text-slate-900 font-bold' : 'text-slate-600 hover:text-black'
                          }`}
                        >
                          {type === 'ALL' ? 'All' : type === 'DEBIT' ? 'Debits' : 'Credits'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Amount Slider */}
                  <div>
                    <div className="flex justify-between items-center text-xs mb-1">
                      <span className="font-semibold text-slate-700">Amount Limit Slider</span>
                      <span className="font-mono text-blue-600 font-bold">
                        Up to ₹{maxAmount.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <input 
                      type="range"
                      min={0}
                      max={highestAmount}
                      step={1000}
                      value={maxAmount}
                      onChange={e => setMaxAmount(Number(e.target.value))}
                      className="w-full accent-blue-600 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400 mt-1">
                      <span>₹0</span>
                      <span>₹{highestAmount.toLocaleString('en-IN')}</span>
                    </div>
                  </div>

                  {/* Custom Date Range */}
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1.5">Date Range</label>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">From</span>
                        <input 
                          type="date"
                          value={fromDate}
                          onChange={e => setFromDate(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                      <div>
                        <span className="text-[10px] text-slate-400 block mb-0.5">To</span>
                        <input 
                          type="date"
                          value={toDate}
                          onChange={e => setToDate(e.target.value)}
                          className="w-full bg-slate-50 border border-slate-200 rounded-md px-2 py-1 text-xs outline-none focus:border-blue-500"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Bank Filter */}
                  {availableBanks.length > 1 && (
                    <div>
                      <label className="text-xs font-semibold text-slate-700 block mb-1.5">Bank</label>
                      <select
                        value={selectedBank}
                        onChange={e => setSelectedBank(e.target.value)}
                        className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs text-slate-800 outline-none focus:border-blue-500"
                      >
                        <option value="ALL">All Banks</option>
                        {availableBanks.map(b => (
                          <option key={b} value={b}>{b}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: UPLOADED STATEMENTS WITH REMOVE ACTION */}
              {sidebarTab === 'documents' && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-500">Uploaded Files ({documents.length})</span>
                    <span className="text-[11px] text-slate-400">Manage Statements</span>
                  </div>

                  {documents.length === 0 ? (
                    <div className="p-6 text-center text-xs text-slate-400 border border-dashed border-slate-200 rounded-lg">
                      No statement files uploaded yet.
                    </div>
                  ) : (
                    <div className="space-y-2.5 max-h-[480px] overflow-y-auto pr-1">
                      {documents.map((doc) => (
                        <div 
                          key={doc.document_id}
                          className="bg-slate-50 hover:bg-slate-100/80 border border-slate-200 rounded-xl p-3 text-xs space-y-2 transition-all shadow-2xs"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="font-semibold text-slate-900 truncate flex items-center gap-1.5" title={doc.file_name}>
                              <FileText className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              <span className="truncate">{doc.file_name}</span>
                            </div>

                            {/* REMOVE / DELETE PDF BUTTON */}
                            <button
                              onClick={() => handleRemoveDocument(doc.document_id, doc.file_name)}
                              disabled={deletingDocId === doc.document_id}
                              className="text-rose-500 hover:text-rose-700 hover:bg-rose-50 p-1.5 rounded-md transition-colors cursor-pointer shrink-0 disabled:opacity-40"
                              title="Delete and remove this PDF statement"
                            >
                              {deletingDocId === doc.document_id ? (
                                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <Trash2 className="w-3.5 h-3.5" />
                              )}
                            </button>
                          </div>

                          <div className="text-[11px] text-slate-500 space-y-0.5">
                            <div>Bank: <b className="text-slate-700">{doc.bank_name}</b></div>
                            <div>Period: <b>{doc.first_transaction_date} → {doc.last_transaction_date}</b></div>
                            <div>Total: <b className="text-blue-600">{doc.total_transactions} transactions</b></div>
                          </div>

                          <div className="flex items-center gap-2 pt-1 border-t border-slate-200/60">
                            {/* View Document PDF button */}
                            <button
                              onClick={() => {
                                setPreviewDocId(doc.document_id);
                                setPreviewPage(1);
                                setPreviewTxn(null);
                                setImageZoom(100);
                              }}
                              className="flex-1 flex items-center justify-center gap-1 py-1 px-2 bg-white hover:bg-blue-50 border border-slate-200 hover:border-blue-300 rounded text-blue-600 font-medium text-[11px] transition-colors cursor-pointer"
                            >
                              <Eye className="w-3 h-3" />
                              <span>View PDF</span>
                            </button>

                            {/* Filter only this document */}
                            <button
                              onClick={() => {
                                setSelectedDocId(doc.document_id);
                                setSidebarTab('filters');
                              }}
                              className="flex items-center gap-1 py-1 px-2 bg-white hover:bg-slate-200 border border-slate-200 rounded text-slate-700 font-medium text-[11px] transition-colors cursor-pointer"
                              title="Filter transactions by this document"
                            >
                              <Filter className="w-3 h-3 text-slate-500" />
                              <span>Filter</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Center Table Area (Automatically expands to 100% when filter panel slides closed) */}
          <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-w-0 transition-all duration-300">
            {/* Table Action Bar */}
            <div className="p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 bg-slate-50/50">
              <div className="flex items-center gap-2">
                {!isFilterPanelOpen && (
                  <button
                    onClick={() => {
                      setIsFilterPanelOpen(true);
                      if (typeof window !== 'undefined') localStorage.setItem('bankanalyzer_filter_open', 'true');
                    }}
                    className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    title="Open Filters and Statements Slider"
                  >
                    <ChevronRight className="w-4 h-4" />
                    <span>Open Filters ({documents.length} PDFs)</span>
                  </button>
                )}
                <span className="text-sm font-bold text-slate-900">Transactions Spreadsheet</span>
                <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-mono">
                  {filteredData.length} records
                </span>
                {selectedDocId !== 'ALL' && (
                  <span className="text-xs bg-blue-100 text-blue-800 px-2 py-0.5 rounded-md flex items-center gap-1 font-medium">
                    Filtered by document
                    <button onClick={() => setSelectedDocId('ALL')} className="hover:opacity-75 cursor-pointer">
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={exportToCSV}
                  disabled={!filteredData.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                  title="Export to CSV / Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span>Export CSV</span>
                </button>

                <button
                  onClick={generateFilteredPDF}
                  disabled={!filteredData.length}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                  title="Generate Filtered PDF"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span>Generate Filtered PDF</span>
                </button>
              </div>
            </div>

            {/* Table Container */}
            <div className="overflow-x-auto flex-1 max-h-[620px]">
              <table className="w-full text-left border-collapse">
                <thead className="bg-slate-100 text-[11px] font-bold text-slate-600 uppercase tracking-wider sticky top-0 z-10 border-b border-slate-200">
                  {table.getHeaderGroups().map(headerGroup => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map(header => (
                        <th key={header.id} className="px-4 py-3 whitespace-nowrap">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody className="divide-y divide-slate-100 text-xs">
                  {loading ? (
                    <tr>
                      <td colSpan={columns.length} className="py-12 text-center text-slate-400">
                        <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                        Loading transaction database...
                      </td>
                    </tr>
                  ) : table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td colSpan={columns.length} className="py-12 text-center text-slate-400">
                        No transactions match the applied filters.
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map(row => (
                      <tr key={row.id} className="hover:bg-blue-50/40 transition-colors">
                        {row.getVisibleCells().map(cell => (
                          <td key={cell.id} className="px-4 py-2.5">
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </td>
                        ))}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span>Rows per page:</span>
                <select
                  value={table.getState().pagination.pageSize}
                  onChange={e => table.setPageSize(Number(e.target.value))}
                  className="bg-white border border-slate-200 rounded px-2 py-1 text-xs outline-none"
                >
                  {[15, 25, 50, 100].map(sz => (
                    <option key={sz} value={sz}>{sz}</option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-3">
                <span>
                  Page <b>{table.getState().pagination.pageIndex + 1}</b> of <b>{table.getPageCount() || 1}</b>
                </span>
                <div className="flex gap-1">
                  <button
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded font-medium disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="px-2.5 py-1 bg-white border border-slate-200 rounded font-medium disabled:opacity-40 hover:bg-slate-100 cursor-pointer"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* VIEW IN PDF STATEMENT MODAL */}
      {previewDocId && (
        <div 
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setPreviewDocId(null)}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[88vh] flex flex-col overflow-hidden animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between bg-slate-50 gap-3">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 text-blue-700 rounded-lg">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-sm flex items-center gap-2">
                    Statement Page Viewer
                  </h3>
                  {previewTxn && (
                    <p className="text-xs text-slate-500 mt-0.5">
                      Selected: <b>{previewTxn.name}</b> • {previewTxn.transaction_date} • 
                      <span className={previewTxn.amount >= 0 ? 'text-green-600 font-bold ml-1' : 'text-red-600 font-bold ml-1'}>
                        ₹{Math.abs(previewTxn.amount).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Header Viewer Controls */}
              <div className="flex items-center gap-2">
                {/* Page Navigation */}
                <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
                  <button
                    onClick={() => setPreviewPage(p => Math.max(1, p - 1))}
                    disabled={previewPage <= 1}
                    className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 text-slate-600 cursor-pointer"
                    title="Previous Page"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <div className="flex items-center px-1">
                    <select
                      value={previewPage}
                      onChange={(e) => setPreviewPage(Number(e.target.value))}
                      className="bg-transparent text-xs font-bold text-slate-800 outline-none cursor-pointer px-1 py-0.5 rounded hover:bg-slate-100"
                    >
                      {Array.from({ length: Math.max(1, previewTotalPages) }, (_, i) => i + 1).map((p) => (
                        <option key={p} value={p}>Page {p} of {previewTotalPages}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setPreviewPage(p => Math.min(previewTotalPages, p + 1))}
                    disabled={previewPage >= previewTotalPages}
                    className="p-1 hover:bg-slate-100 rounded disabled:opacity-30 text-slate-600 cursor-pointer"
                    title="Next Page"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                {/* View Mode Toggle (Rendered Image vs Native PDF) */}
                <div className="flex items-center bg-slate-200 p-0.5 rounded-lg text-xs font-semibold">
                  <button
                    onClick={() => setViewerMode('image')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      viewerMode === 'image' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    High-Res Page
                  </button>
                  <button
                    onClick={() => setViewerMode('pdf')}
                    className={`px-2.5 py-1 rounded-md transition-all cursor-pointer ${
                      viewerMode === 'pdf' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    Interactive PDF
                  </button>
                </div>

                {/* Zoom controls for image view */}
                {viewerMode === 'image' && (
                  <div className="flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
                    <button
                      onClick={() => setImageZoom(z => Math.max(50, z - 20))}
                      className="p-1 hover:bg-slate-100 rounded text-slate-600 cursor-pointer"
                      title="Zoom Out"
                    >
                      <ZoomOut className="w-4 h-4" />
                    </button>
                    <span className="px-1 text-[11px] font-mono text-slate-600">{imageZoom}%</span>
                    <button
                      onClick={() => setImageZoom(z => Math.min(200, z + 20))}
                      className="p-1 hover:bg-slate-100 rounded text-slate-600 cursor-pointer"
                      title="Zoom In"
                    >
                      <ZoomIn className="w-4 h-4" />
                    </button>
                  </div>
                )}

                {/* Download PDF Button */}
                <a
                  href={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf`}
                  download
                  className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="Download full PDF"
                >
                  <Download className="w-4 h-4" />
                </a>

                {/* Open in New Tab */}
                <a
                  href={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="Open full PDF in new browser tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">New Tab</span>
                </a>

                {/* Close Button */}
                <button 
                  onClick={() => setPreviewDocId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 cursor-pointer ml-1"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            {viewerMode === 'image' ? (
              <div className="flex-1 bg-slate-950 overflow-auto flex items-center justify-center p-4">
                <div className="overflow-auto max-h-full max-w-full flex items-center justify-center">
                  <img
                    src={`${getApiBase()}/api/v1/documents/${previewDocId}/page/${previewPage}`}
                    alt={`Statement Page ${previewPage}`}
                    style={{ width: `${imageZoom}%`, maxWidth: 'none' }}
                    className="rounded shadow-2xl transition-all duration-200 object-contain bg-white"
                  />
                </div>
              </div>
            ) : (
              <div className="flex-1 w-full h-full min-h-0 bg-slate-100 relative">
                <object
                  key={`${previewDocId}-${previewPage}`}
                  data={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf#page=${previewPage}&zoom=page-fit`}
                  type="application/pdf"
                  className="w-full h-full border-none"
                >
                  <iframe
                    key={`iframe-${previewDocId}-${previewPage}`}
                    src={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf#page=${previewPage}&zoom=page-fit`}
                    className="w-full h-full border-none"
                    title="Statement PDF Viewer"
                  >
                    <div className="flex flex-col items-center justify-center h-full p-8 text-center text-slate-700 bg-slate-50 space-y-3">
                      <FileText className="w-12 h-12 text-slate-400" />
                      <p className="font-semibold text-sm">Interactive PDF preview is not supported directly inside your browser settings.</p>
                      <p className="text-xs text-slate-500 max-w-md">
                        You can view all pages clearly using the <b>High-Res Page</b> tab, or open the PDF directly in a new browser tab.
                      </p>
                      <div className="flex items-center gap-3 pt-2">
                        <button
                          onClick={() => setViewerMode('image')}
                          className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-xs"
                        >
                          Switch to High-Res Page
                        </button>
                        <a
                          href={`/api/v1/documents/${previewDocId}/pdf`}
                          target="_blank"
                          rel="noreferrer"
                          className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-800 rounded-lg text-xs font-semibold"
                        >
                          Open in New Tab
                        </a>
                      </div>
                    </div>
                  </iframe>
                </object>
              </div>
            )}
          </div>
        </div>
      )}

      {/* PASSWORD PROTECTED PDF UNLOCK MODAL */}
      {pendingPasswordFile && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 overflow-hidden animate-in zoom-in-95 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="p-2.5 bg-amber-100 text-amber-700 rounded-xl">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Password Protected PDF</h3>
                  <p className="text-xs text-slate-500 truncate max-w-[240px]" title={pendingPasswordFile.name}>
                    {pendingPasswordFile.name}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setPendingPasswordFile(null); setStatementPassword(''); setPasswordError(null); }}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUnlockAndUpload} className="mt-4 space-y-4">
              <div>
                <label className="text-xs font-bold text-slate-700 block mb-1.5">Enter Statement Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    placeholder="Enter password (e.g. PAN, DOB, etc.)"
                    value={statementPassword}
                    onChange={(e) => setStatementPassword(e.target.value)}
                    autoFocus
                    className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white rounded-lg px-3.5 py-2 text-sm outline-none pr-10 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs font-semibold text-rose-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    {passwordError}
                  </p>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200/80 rounded-xl p-3 text-[11px] text-slate-600 space-y-1">
                <span className="font-bold text-slate-700 block">💡 Common Bank Password Hints:</span>
                <div>• <b>HDFC / SBI / ICICI:</b> Customer ID, Date of Birth (<code>DDMMYYYY</code>), or PAN in UPPERCASE.</div>
                <div>• <b>Axis / Kotak:</b> First 4 letters of name in CAPS or lowercase + DOB.</div>
                <div>• <b>Other Banks:</b> Account number or 10-digit registered mobile number.</div>
              </div>

              <div className="flex items-center gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => { setPendingPasswordFile(null); setStatementPassword(''); setPasswordError(null); }}
                  className="flex-1 py-2 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!statementPassword.trim() || unlocking}
                  className="flex-1 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  {unlocking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>{unlocking ? 'Unlocking...' : 'Unlock & Process'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

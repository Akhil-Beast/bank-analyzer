"use client";

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { 
  UploadCloud, Search, Calendar, FileText, ArrowUpDown, 
  Filter, RefreshCw, X, Eye, EyeOff, FileSpreadsheet, Trash2,
  CheckCircle2, AlertCircle, Building2, ChevronLeft, ChevronRight,
  SlidersHorizontal, ExternalLink, ZoomIn, ZoomOut, Layers, Lock, KeyRound, Download,
  LogOut, User as UserIcon, Fingerprint, Shield
} from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/context/AuthContext';
import { 
  checkBiometricAvailability, 
  getBiometricProfile, 
  registerBiometrics, 
  clearBiometricProfile,
  BiometricProfile
} from '@/lib/biometrics';
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
  file_hash?: string;
  content_hash?: string;
  added?: number;
  duplicates_skipped?: number;
};

// Compute SHA-256 hash of file content in browser before upload
const computeFileSha256 = async (file: File): Promise<string> => {
  try {
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buffer);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (err) {
    console.warn("Could not calculate SHA-256 hash:", err);
    return '';
  }
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
      return 'https://bank-analyzer-backend-7aq7.onrender.com';
    }

    if (window.location.port === '3000') {
      return `http://${window.location.hostname}:8000`;
    }
    return 'https://bank-analyzer-backend-7aq7.onrender.com';
  }
  return 'http://localhost:8000';
};

export default function TransactionDashboard() {
  const { user, session, signOut } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingDocId, setDeletingDocId] = useState<string | null>(null);
  const [uploadResult, setUploadResult] = useState<DocumentSummary | null>(null);
  const [toastMessage, setToastMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [dropzoneKey, setDropzoneKey] = useState(0);

  // Password-protected PDF Modal State
  const [pendingPasswordFile, setPendingPasswordFile] = useState<File | null>(null);
  const [statementPassword, setStatementPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [unlocking, setUnlocking] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Biometric Management State
  const [biometricProfile, setBiometricProfile] = useState<BiometricProfile | null>(null);
  const [biometricSupported, setBiometricSupported] = useState<boolean>(false);
  const [showBiometricModal, setShowBiometricModal] = useState<boolean>(false);
  const [bioPasswordInput, setBioPasswordInput] = useState<string>('');
  const [bioModalError, setBioModalError] = useState<string | null>(null);
  const [bioModalLoading, setBioModalLoading] = useState<boolean>(false);
  const [showBioPassword, setShowBioPassword] = useState<boolean>(false);

  // Filter Panel Slide State & Active Tab with LocalStorage Persistence
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState<boolean>(false);
  const [sidebarTab, setSidebarTab] = useState<'filters' | 'documents'>('filters');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      const isDesktop = window.innerWidth >= 1024;
      const saved = localStorage.getItem('bankanalyzer_filter_open');
      if (saved !== null) {
        setIsFilterPanelOpen(isDesktop ? saved === 'true' : false);
      } else {
        setIsFilterPanelOpen(isDesktop);
      }
    }
  }, []);

  const toggleFilterPanel = () => {
    setIsFilterPanelOpen(prev => {
      const next = !prev;
      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        localStorage.setItem('bankanalyzer_filter_open', String(next));
      }
      return next;
    });
  };

  // Filters State
  const [globalSearch, setGlobalSearch] = useState('');
  const [showMobileSearch, setShowMobileSearch] = useState<boolean>(false);
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
        const authHeaders = await getAuthHeaders();
        const res = await axios.get(`${api}/api/v1/documents/${previewDocId}/info`, { headers: authHeaders });
        if (res.data?.total_pages) {
          setPreviewTotalPages(res.data.total_pages);
        }
      } catch (err) {
        console.warn("Could not load document info:", err);
      }
    };
    fetchDocInfo();
  }, [previewDocId]);

  // Initialize biometric status on device
  useEffect(() => {
    let mounted = true;
    const checkBio = async () => {
      try {
        const profile = getBiometricProfile();
        const avail = await checkBiometricAvailability();
        if (mounted) {
          setBiometricProfile(profile);
          setBiometricSupported(avail.supported);
        }
      } catch (e) {
        console.warn("Could not check biometrics:", e);
      }
    };
    checkBio();
    return () => {
      mounted = false;
    };
  }, []);

  const handleEnableBiometricsFromDashboard = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bioPasswordInput || bioPasswordInput.length < 6) {
      setBioModalError('Please enter your valid password (min 6 characters).');
      return;
    }
    setBioModalLoading(true);
    setBioModalError(null);
    try {
      const email = user?.email;
      if (!email) throw new Error('User email not found.');

      const { error: verifyError } = await supabase.auth.signInWithPassword({
        email: email,
        password: bioPasswordInput,
      });
      if (verifyError) {
        setBioModalError('Incorrect password. Please verify your password and try again.');
        return;
      }

      const result = await registerBiometrics(email, bioPasswordInput);
      if (result.success) {
        const newProfile = getBiometricProfile();
        setBiometricProfile(newProfile);
        setShowBiometricModal(false);
        setBioPasswordInput('');
        setToastMessage({ text: 'Biometric sign-in successfully enabled on this device!', type: 'success' });
      } else {
        setBioModalError(result.error || 'Biometric registration cancelled or failed.');
      }
    } catch (err: any) {
      setBioModalError(err.message || 'Failed to enable biometrics.');
    } finally {
      setBioModalLoading(false);
    }
  };

  const handleRemoveBiometrics = () => {
    clearBiometricProfile();
    setBiometricProfile(null);
    setShowBiometricModal(false);
    setToastMessage({ text: 'Biometric sign-in removed from this device.', type: 'success' });
  };

  // Get session access token for authenticated backend calls
  const getAuthHeaders = async (): Promise<Record<string, string>> => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) {
      return { Authorization: `Bearer ${session.access_token}` };
    }
    return {};
  };

  // Fetch data — scoped to the current authenticated user
  const fetchData = async (showLoading: boolean = true) => {
    if (showLoading) setLoading(true);
    try {
      const api = getApiBase();
      const authHeaders = await getAuthHeaders();

      const [txRes, docRes] = await Promise.all([
        axios.get(`${api}/api/v1/transactions`, { headers: authHeaders }),
        axios.get(`${api}/api/v1/documents`, { headers: authHeaders })
      ]);

      if (!Array.isArray(txRes.data) || !Array.isArray(docRes.data)) {
        throw new Error("Invalid array response from backend API");
      }

      setTransactions(txRes.data);
      setDocuments(docRes.data);
    } catch (err: any) {
      console.error("Backend fetch error, falling back to Supabase client:", err);
      try {
        // Supabase anon client automatically scopes by auth.uid() via RLS
        const { data: txns, error: txError } = await supabase
          .from('transactions')
          .select('*')
          .order('transaction_date', { ascending: false });

        if (!txError && Array.isArray(txns) && txns.length > 0) {
          setTransactions(txns);
        }

        const { data: docs, error: docError } = await supabase
          .from('documents')
          .select('*')
          .order('upload_date', { ascending: false });

        if (!docError && Array.isArray(docs) && docs.length > 0) {
          setDocuments(docs);
        }
      } catch (innerErr) {
        if (showLoading) {
          setToastMessage({ text: "Failed to connect to backend server or database", type: 'error' });
        }
      }
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  // Re-fetch and clear state whenever the authenticated user changes
  useEffect(() => {
    // Clear all previous user's data immediately to prevent leaking state
    setTransactions([]);
    setDocuments([]);
    setUploadResult(null);
    setSelectedDocId('ALL');
    setSelectedYear('ALL');
    setSelectedMonth('ALL');
    setSelectedBank('ALL');
    setSelectedType('ALL');
    setGlobalSearch('');
    setPreviewDocId(null);

    if (user) {
      fetchData();
    } else {
      setLoading(false);
    }
  }, [user?.id]);

  // Upload handler
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (!acceptedFiles.length) return;
    setUploading(true);
    setToastMessage(null);

    for (const file of acceptedFiles) {
      // 1. Analyze and hash file content before uploading to reject duplicates upfront
      const fileHash = await computeFileSha256(file);
      if (fileHash) {
        const existingDoc = documents.find(d => d.file_hash === fileHash);
        if (existingDoc) {
          setToastMessage({
            text: `Duplicate file rejected: "${file.name}" has identical content to "${existingDoc.file_name}" already in your account.`,
            type: 'error'
          });
          continue;
        }
      }

      const formData = new FormData();
      formData.append('file', file);
      if (fileHash) {
        formData.append('file_hash', fileHash);
      }

      try {
        const authHeaders = await getAuthHeaders();
        let response;
        try {
          response = await axios.post(`${getApiBase()}/api/v1/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data', ...authHeaders }
          });
        } catch (apiErr: any) {
          if (apiErr.response?.status === 404) {
            response = await axios.post(`${getApiBase()}/upload`, formData, {
              headers: { 'Content-Type': 'multipart/form-data', ...authHeaders }
            });
          } else {
            throw apiErr;
          }
        }

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
          file_hash: resData.file_hash,
          content_hash: resData.content_hash,
          added: resData.added,
          duplicates_skipped: resData.duplicates_skipped
        });

        await fetchData();
      } catch (err: any) {
        let msg = err.response?.data?.detail || err.message || "Error parsing statement file";
        if (typeof msg === 'string') {
          const match = msg.match(/'message':\s*['"]([^'"]+)['"]/);
          if (match) msg = match[1];
        } else if (typeof msg === 'object' && msg.message) {
          msg = String(msg.message);
        }
        setToastMessage({ text: msg, type: 'error' });
      }
    }
    setDropzoneKey(prev => prev + 1);
    setUploading(false);
  }, [documents]);

  // Unlock and upload handler
  const handleUnlockAndUpload = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!pendingPasswordFile || !statementPassword.trim()) return;

    setUnlocking(true);
    setPasswordError(null);

    // Analyze and hash file content before unlocking/uploading
    const fileHash = await computeFileSha256(pendingPasswordFile);
    if (fileHash) {
      const existingDoc = documents.find(d => d.file_hash === fileHash);
      if (existingDoc) {
        setPasswordError(`This statement was already uploaded as "${existingDoc.file_name}". Duplicate upload rejected.`);
        setUnlocking(false);
        return;
      }
    }

    const formData = new FormData();
    formData.append('file', pendingPasswordFile);
    formData.append('password', statementPassword.trim());
    if (fileHash) {
      formData.append('file_hash', fileHash);
    }

    try {
      const authHeaders = await getAuthHeaders();
      let response;
      try {
        response = await axios.post(`${getApiBase()}/api/v1/upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data', ...authHeaders }
        });
      } catch (apiErr: any) {
        if (apiErr.response?.status === 404) {
          response = await axios.post(`${getApiBase()}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data', ...authHeaders }
          });
        } else {
          throw apiErr;
        }
      }

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
        file_hash: resData.file_hash,
        content_hash: resData.content_hash,
        added: resData.added,
        duplicates_skipped: resData.duplicates_skipped
      });

      setPendingPasswordFile(null);
      setStatementPassword('');
      setPasswordError(null);
      await fetchData();
    } catch (err: any) {
      let msg = err.response?.data?.detail || err.message || "Failed to unlock statement file";
      if (typeof msg === 'string') {
        const match = msg.match(/'message':\s*['"]([^'"]+)['"]/);
        if (match) msg = match[1];
      } else if (typeof msg === 'object' && msg.message) {
        msg = String(msg.message);
      }
      setPasswordError(msg);
    } finally {
      setDropzoneKey(prev => prev + 1);
      setUnlocking(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'application/pdf': ['.pdf'] }
  });

  // Remove / Delete uploaded PDF Document (Optimistic UI with Background Sync)
  const handleRemoveDocument = async (docId: string, fileName: string) => {
    if (!docId) return;
    if (!window.confirm(`Are you sure you want to remove "${fileName}"?\nThis will permanently delete the document and all its extracted transactions.`)) {
      return;
    }

    // Save previous state in case network request fails
    const prevDocs = [...documents];
    const prevTxns = [...transactions];

    // Optimistically remove from state immediately (0ms visual delay)
    setDocuments(prev => prev.filter(d => d.document_id && d.document_id !== docId));
    setTransactions(prev => prev.filter(t => t.source_document_id && t.source_document_id !== docId));
    if (selectedDocId === docId) {
      setSelectedDocId('ALL');
    }
    if (previewDocId === docId) {
      setPreviewDocId(null);
    }
    if (uploadResult?.document_id === docId) {
      setUploadResult(null);
    }

    setDeletingDocId(docId);
    try {
      const authHeaders = await getAuthHeaders();
      await axios.delete(`${getApiBase()}/api/v1/documents/${docId}`, { headers: authHeaders });
      setToastMessage({
        text: `Successfully deleted "${fileName}" and associated transactions.`,
        type: 'success'
      });
      // Silently sync with server to ensure remaining state is exact
      fetchData(false);
    } catch (err: any) {
      // Rollback to previous state on failure
      setDocuments(prevDocs);
      setTransactions(prevTxns);
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
      <header className="sticky top-0 z-30 bg-white/95 backdrop-blur-md border-b border-slate-200 px-3 sm:px-6 py-2 sm:py-3 flex items-center justify-between gap-2 shadow-2xs pt-safe">
        {/* Logo & Brand */}
        <div className="flex items-center gap-2 sm:gap-4 shrink-0 min-w-0">
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Building2 className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 shrink-0" />
            <span className="font-extrabold text-base sm:text-xl tracking-tight text-slate-900 truncate">BankAnalyzer</span>
          </div>
          <div className="h-5 w-px bg-slate-200 hidden md:block" />
          {/* Global Date Range Indicator */}
          <div className="hidden lg:flex items-center gap-2 text-xs bg-slate-100 px-3 py-1.5 rounded-full text-slate-600 font-medium">
            <Calendar className="w-3.5 h-3.5 text-blue-600" />
            <span>Overall Statement Period:</span>
            <b className="text-slate-900">{globalDateRange.start} → {globalDateRange.end}</b>
          </div>
        </div>

        {/* Global Search Bar (Desktop) */}
        <div className="hidden md:block flex-1 max-w-md mx-4">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input 
              type="text" 
              placeholder="Search by Name, Amount, Txn ID, Narration..." 
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              className="w-full bg-slate-100 focus:bg-white border border-transparent focus:border-blue-500 rounded-lg pl-9 pr-8 py-2 text-sm outline-none transition-all shadow-2xs"
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

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Mobile Search Toggle Button */}
          <button
            onClick={() => setShowMobileSearch(!showMobileSearch)}
            className="md:hidden p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 transition-colors cursor-pointer"
            title="Search transactions"
          >
            <Search className="w-4 h-4 text-slate-600" />
          </button>

          {/* Filters & Statements Toggle Button */}
          <button
            onClick={toggleFilterPanel}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-semibold border transition-all duration-200 cursor-pointer ${
              isFilterPanelOpen 
                ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-2xs'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs'
            }`}
            title="Toggle Filters and Statements"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-blue-600" />
            <span className="hidden sm:inline font-bold">Filters</span>

            {/* Uploaded PDF Count Badge */}
            <span className="flex items-center gap-0.5 bg-slate-100 text-slate-700 border border-slate-200 px-1.5 py-0.5 rounded-full text-[10px] font-bold">
              <FileText className="w-2.5 h-2.5 text-blue-600" />
              <span>{documents.length}</span>
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
            key={dropzoneKey}
            {...getRootProps()} 
            className={`flex items-center gap-1.5 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg text-xs font-semibold cursor-pointer shadow-2xs transition-all ${
              uploading 
                ? 'bg-blue-400 text-white cursor-not-allowed'
                : isDragActive
                  ? 'bg-blue-800 text-white ring-2 ring-blue-400'
                  : 'bg-blue-600 hover:bg-blue-700 text-white'
            }`}
            title="Upload Bank Statement PDF"
          >
            <input {...getInputProps()} />
            {uploading ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 sm:w-4 sm:h-4 animate-spin" />
                <span className="hidden sm:inline">Uploading...</span>
              </>
            ) : (
              <>
                <UploadCloud className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                <span className="hidden sm:inline">Upload</span>
              </>
            )}
          </div>

          {/* Authenticated User Status & Logout */}
          {user && (
            <div className="flex items-center gap-1 sm:gap-2 pl-1 sm:pl-2 border-l border-slate-200">
              {/* Biometrics Status / Manage Button */}
              {biometricSupported && (
                <button
                  type="button"
                  onClick={() => {
                    setShowBiometricModal(true);
                    setBioModalError(null);
                    setBioPasswordInput('');
                  }}
                  className={`p-1.5 sm:px-2.5 sm:py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    biometricProfile
                      ? 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                      : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'
                  }`}
                  title={biometricProfile ? 'Biometric Sign-In is active' : 'Enable Fingerprint Sign-In'}
                >
                  <Fingerprint className={`w-4 h-4 ${biometricProfile ? 'text-emerald-600' : 'text-blue-600'}`} />
                </button>
              )}

              <button
                onClick={signOut}
                className="flex items-center gap-1 p-1.5 sm:px-3 sm:py-2 bg-slate-100 hover:bg-rose-50 hover:text-rose-600 border border-slate-200 hover:border-rose-200 rounded-lg text-xs font-bold text-slate-600 transition-colors cursor-pointer"
                title="Sign out of your session"
              >
                <LogOut className="w-4 h-4 text-rose-500" />
                <span className="hidden lg:inline">Sign Out</span>
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Mobile Expandable Search Bar */}
      {showMobileSearch && (
        <div className="md:hidden bg-white border-b border-slate-200 p-3 animate-in slide-in-from-top-2">
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search by Name, Amount, Txn ID, Narration..."
              value={globalSearch}
              onChange={e => setGlobalSearch(e.target.value)}
              className="w-full bg-slate-100 focus:bg-white border border-slate-200 focus:border-blue-500 rounded-lg pl-9 pr-8 py-2 text-xs outline-none"
              autoFocus
            />
            {globalSearch && (
              <button
                onClick={() => setGlobalSearch('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      )}

      {/* Main Container */}
      <div className="flex-1 p-3.5 sm:p-6 max-w-[1600px] w-full mx-auto space-y-4 sm:space-y-6">
        {/* Upload Result Notification Card */}
        {uploadResult && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 sm:p-4 flex items-start justify-between shadow-2xs animate-in fade-in">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              <div>
                <h4 className="font-semibold text-emerald-900 text-xs sm:text-sm">
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
              className="text-emerald-700 hover:text-emerald-900 bg-emerald-100 hover:bg-emerald-200 px-2.5 py-1 rounded-md text-xs font-semibold transition-colors cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Generic Toast Notification */}
        {toastMessage && (
          <div className={`border rounded-xl p-3.5 sm:p-4 flex items-start justify-between shadow-2xs ${
            toastMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900' 
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}>
            <div className="flex items-start gap-3">
              {toastMessage.type === 'success' ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 mt-0.5 shrink-0" />
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4">
          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-indigo-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Transactions</span>
            <div className="text-lg sm:text-2xl font-bold text-slate-900 mt-0.5 truncate">{summaryMetrics.totalCount}</div>
            <span className="text-[9px] sm:text-[11px] text-slate-400 block truncate">Total in view</span>
          </div>

          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-emerald-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Total Credits</span>
            <div className="text-lg sm:text-2xl font-bold text-emerald-600 mt-0.5 truncate">
              ₹{summaryMetrics.totalCredits.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[9px] sm:text-[11px] text-emerald-600 font-medium block truncate">Incoming funds</span>
          </div>

          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-rose-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Total Debits</span>
            <div className="text-lg sm:text-2xl font-bold text-rose-600 mt-0.5 truncate">
              ₹{summaryMetrics.totalDebits.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[9px] sm:text-[11px] text-rose-600 font-medium block truncate">Outgoing payments</span>
          </div>

          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-blue-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Net Amount</span>
            <div className={`text-lg sm:text-2xl font-bold mt-0.5 truncate ${summaryMetrics.netAmount >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
              ₹{summaryMetrics.netAmount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}
            </div>
            <span className="text-[9px] sm:text-[11px] text-slate-400 block truncate">Net cashflow</span>
          </div>

          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-purple-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Unique Parties</span>
            <div className="text-lg sm:text-2xl font-bold text-purple-600 mt-0.5 truncate">{summaryMetrics.uniqueNames}</div>
            <span className="text-[9px] sm:text-[11px] text-slate-400 block truncate">Identified entities</span>
          </div>

          <div className="bg-white p-3 sm:p-4 rounded-xl border border-slate-200 shadow-2xs border-t-4 border-t-amber-500">
            <span className="text-[10px] sm:text-xs text-slate-500 font-semibold uppercase tracking-wider block truncate">Filtered Period</span>
            <div className="text-xs font-bold text-slate-900 mt-0.5 truncate" title={`${summaryMetrics.firstDate} → ${summaryMetrics.lastDate}`}>
              {summaryMetrics.firstDate}
            </div>
            <div className="text-xs font-bold text-slate-900 truncate">
              → {summaryMetrics.lastDate}
            </div>
          </div>
        </div>

        {/* Active Filter Chips (Instant View & Dismiss on Mobile & Desktop) */}
        {activeFiltersCount > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 text-xs">
            <span className="text-[11px] font-bold text-slate-400 shrink-0">Active Filters:</span>
            {selectedDocId !== 'ALL' && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Doc: {documents.find(d => d.document_id === selectedDocId)?.bank_name || '1 Statement'}
                <button onClick={() => setSelectedDocId('ALL')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedYear !== 'ALL' && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Year: {selectedYear}
                <button onClick={() => setSelectedYear('ALL')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedMonth !== 'ALL' && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Month: {MONTH_NAMES[Number(selectedMonth) - 1]}
                <button onClick={() => setSelectedMonth('ALL')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedType !== 'ALL' && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Type: {selectedType === 'DEBIT' ? 'Debits' : 'Credits'}
                <button onClick={() => setSelectedType('ALL')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {selectedBank !== 'ALL' && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Bank: {selectedBank}
                <button onClick={() => setSelectedBank('ALL')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
            {globalSearch && (
              <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 border border-blue-200 px-2.5 py-0.5 rounded-full text-[11px] font-medium shrink-0">
                Search: &quot;{globalSearch}&quot;
                <button onClick={() => setGlobalSearch('')} className="hover:text-blue-900 cursor-pointer">
                  <X className="w-3 h-3" />
                </button>
              </span>
            )}
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
              className="text-[11px] font-bold text-rose-600 hover:text-rose-800 underline shrink-0 cursor-pointer pl-1"
            >
              Clear All
            </button>
          </div>
        )}

        {/* Dashboard Workspace */}
        <div className="flex gap-6 items-start transition-all duration-300">
          {/* SLIDER / COLLAPSIBLE ADVANCED FILTER & STATEMENTS TAB */}
          {isFilterPanelOpen && (
            <>
              {/* Mobile Backdrop Overlay (< lg) */}
              <div 
                className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-xs lg:hidden animate-in fade-in"
                onClick={() => setIsFilterPanelOpen(false)}
              />

              {/* Drawer (< lg) & Sticky Sidebar (lg+) container */}
              <aside 
                className="fixed inset-y-0 right-0 z-50 w-full max-w-xs sm:max-w-sm bg-white shadow-2xl p-4 sm:p-5 flex flex-col justify-between overflow-hidden animate-in slide-in-from-right duration-200 lg:static lg:inset-auto lg:z-auto lg:w-80 lg:shrink-0 lg:shadow-sm lg:rounded-xl lg:border lg:border-slate-200 lg:top-24 lg:self-start lg:animate-in lg:fade-in lg:slide-in-from-left-4"
                style={{ maxHeight: '100dvh' }}
              >
                {/* Header with Navigation Tabs */}
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 shrink-0">
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
                      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                        localStorage.setItem('bankanalyzer_filter_open', 'false');
                      }
                    }}
                    className="text-slate-400 hover:text-slate-600 p-1 rounded-md hover:bg-slate-100 cursor-pointer"
                    title="Close panel"
                  >
                    <X className="w-5 h-5 lg:hidden" />
                    <ChevronLeft className="w-4 h-4 hidden lg:block" />
                  </button>
                </div>

                {/* Scrollable Content (Filters or Documents) */}
                <div className="flex-1 overflow-y-auto pr-1 space-y-4 my-2">
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

            {/* Mobile Drawer Footer with Apply Button (< lg) */}
            <div className="pt-3 border-t border-slate-100 lg:hidden shrink-0 flex items-center gap-2">
              <button
                onClick={() => setIsFilterPanelOpen(false)}
                className="flex-1 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold shadow-xs cursor-pointer text-center transition-colors"
              >
                Apply & View ({filteredData.length} Txns)
              </button>
            </div>
          </aside>
        </>
      )}

          {/* Center Table Area (Automatically expands to 100% when filter panel slides closed) */}
          <div className="flex-1 bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col min-w-0 transition-all duration-300">
            {/* Table Action Bar */}
            <div className="p-3 sm:p-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2.5 bg-slate-50/50">
              <div className="flex items-center gap-2 min-w-0">
                {!isFilterPanelOpen && (
                  <button
                    onClick={() => {
                      setIsFilterPanelOpen(true);
                      if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
                        localStorage.setItem('bankanalyzer_filter_open', 'true');
                      }
                    }}
                    className="hidden lg:flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors cursor-pointer"
                    title="Open Filters and Statements Slider"
                  >
                    <ChevronRight className="w-4 h-4" />
                    <span>Open Filters ({documents.length} PDFs)</span>
                  </button>
                )}
                <span className="text-sm font-bold text-slate-900 truncate">Transactions Spreadsheet</span>
                <span className="text-xs bg-slate-200 text-slate-700 px-2 py-0.5 rounded-full font-mono font-semibold shrink-0">
                  {filteredData.length}
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

              <div className="flex items-center gap-1.5 sm:gap-2">
                <button
                  onClick={exportToCSV}
                  disabled={!filteredData.length}
                  className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                  title="Export to CSV / Excel"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
                  <span className="hidden sm:inline">Export</span>
                  <span>CSV</span>
                </button>

                <button
                  onClick={generateFilteredPDF}
                  disabled={!filteredData.length}
                  className="flex items-center gap-1 px-2.5 sm:px-3 py-1.5 bg-white hover:bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 shadow-2xs disabled:opacity-50 cursor-pointer"
                  title="Generate Filtered PDF"
                >
                  <FileText className="w-3.5 h-3.5 text-blue-600" />
                  <span className="hidden sm:inline">Filtered</span>
                  <span>PDF</span>
                </button>
              </div>
            </div>

            {/* Mobile Responsive Cards View (< md screens) */}
            <div className="md:hidden divide-y divide-slate-100 flex-1">
              {loading ? (
                <div className="py-12 text-center text-slate-400">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-blue-600" />
                  <span className="text-xs">Loading transaction database...</span>
                </div>
              ) : table.getRowModel().rows.length === 0 ? (
                <div className="py-12 text-center text-slate-400 text-xs">
                  No transactions match the applied filters.
                </div>
              ) : (
                table.getRowModel().rows.map(row => {
                  const t = row.original;
                  const isCredit = (t.credit || 0) > 0;
                  const amountVal = isCredit ? t.credit : (t.debit || Math.abs(t.amount || 0));
                  return (
                    <div key={row.id} className="p-3 sm:p-3.5 hover:bg-blue-50/20 active:bg-slate-50 transition-colors space-y-2 text-xs">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-slate-900 text-sm truncate">{t.name || 'Unknown Party'}</div>
                          <div className="text-[11px] text-slate-500 font-mono flex flex-wrap items-center gap-1.5 mt-0.5">
                            <span className="bg-slate-100 text-slate-700 px-1.5 py-0.2 rounded font-semibold shrink-0">
                              {t.transaction_date ? format(parseISO(t.transaction_date), 'dd MMM yyyy') : '-'}
                            </span>
                            {t.bank_name && (
                              <span className="text-slate-400 truncate">• {t.bank_name}</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`font-mono text-sm font-bold ${isCredit ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {isCredit ? '+' : '-'}₹{amountVal.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">
                            Bal: ₹{(t.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                          </div>
                        </div>
                      </div>

                      {t.description && (
                        <p className="text-[11px] text-slate-600 line-clamp-2 bg-slate-50 p-2 rounded-lg border border-slate-100 font-mono break-words">
                          {t.description}
                        </p>
                      )}

                      <div className="flex items-center justify-between text-[11px] pt-1">
                        <span className="text-slate-400 font-mono truncate max-w-[150px]">
                          Ref: {t.transaction_id || '-'}
                        </span>
                        <button
                          onClick={() => {
                            setPreviewDocId(t.source_document_id || (documents[0]?.document_id ?? null));
                            setPreviewPage(t.source_page || 1);
                            setPreviewTxn(t);
                            setImageZoom(100);
                          }}
                          className="flex items-center gap-1 text-[11px] font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 px-2.5 py-1 rounded-md transition-colors cursor-pointer"
                        >
                          <Eye className="w-3 h-3" />
                          <span>Page {t.source_page || 1} PDF</span>
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Desktop Table View (md: block) */}
            <div className="hidden md:block overflow-x-auto flex-1 max-h-[620px]">
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
            <div className="p-3 bg-slate-50 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-600">
              <div className="flex items-center justify-between w-full sm:w-auto gap-2">
                <div className="flex items-center gap-1.5">
                  <span>Rows:</span>
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
                <span className="sm:hidden font-medium">
                  Page <b>{table.getState().pagination.pageIndex + 1}</b> of <b>{table.getPageCount() || 1}</b>
                </span>
              </div>

              <div className="flex items-center justify-between w-full sm:w-auto gap-3">
                <span className="hidden sm:inline">
                  Page <b>{table.getState().pagination.pageIndex + 1}</b> of <b>{table.getPageCount() || 1}</b>
                </span>
                <div className="flex gap-2 w-full sm:w-auto">
                  <button
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                    className="flex-1 sm:flex-initial text-center px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium disabled:opacity-40 hover:bg-slate-100 cursor-pointer shadow-2xs"
                  >
                    Previous
                  </button>
                  <button
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                    className="flex-1 sm:flex-initial text-center px-3 py-1.5 bg-white border border-slate-200 rounded-lg font-medium disabled:opacity-40 hover:bg-slate-100 cursor-pointer shadow-2xs"
                  >
                    Next
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Bottom Quick Actions Bar (< lg) */}
      <div className="lg:hidden sticky bottom-0 z-30 bg-white/95 backdrop-blur-md border-t border-slate-200 px-4 py-2 flex items-center justify-around shadow-lg pb-safe shrink-0">
        <button
          onClick={() => {
            setSidebarTab('filters');
            setIsFilterPanelOpen(true);
          }}
          className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-blue-600 relative cursor-pointer py-1 px-3"
        >
          <SlidersHorizontal className="w-4 h-4 text-blue-600" />
          <span className="text-[10px] font-bold">Filters</span>
          {activeFiltersCount > 0 && (
            <span className="absolute top-0 right-1 bg-blue-600 text-white rounded-full px-1 text-[9px] font-bold">
              {activeFiltersCount}
            </span>
          )}
        </button>

        <div {...getRootProps()} className="flex flex-col items-center gap-0.5 text-blue-600 cursor-pointer py-1 px-3">
          <input {...getInputProps()} />
          <div className="p-1.5 bg-blue-600 text-white rounded-full shadow-xs">
            <UploadCloud className="w-4 h-4" />
          </div>
          <span className="text-[10px] font-bold text-blue-600">Upload PDF</span>
        </div>

        <button
          onClick={() => {
            setSidebarTab('documents');
            setIsFilterPanelOpen(true);
          }}
          className="flex flex-col items-center gap-0.5 text-slate-700 hover:text-blue-600 relative cursor-pointer py-1 px-3"
        >
          <FileText className="w-4 h-4 text-blue-600" />
          <span className="text-[10px] font-bold">PDFs ({documents.length})</span>
        </button>
      </div>

      {/* VIEW IN PDF STATEMENT MODAL */}
      {previewDocId && (
        <div 
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-0 sm:p-4"
          onClick={() => setPreviewDocId(null)}
        >
          <div 
            className="bg-white rounded-none sm:rounded-2xl shadow-2xl w-full max-w-5xl h-full sm:h-[88vh] flex flex-col overflow-hidden animate-in zoom-in-95"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-3 sm:px-6 py-2.5 sm:py-3.5 border-b border-slate-200 flex flex-wrap items-center justify-between bg-slate-50 gap-2 shrink-0">
              <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                <div className="p-1.5 sm:p-2 bg-blue-100 text-blue-700 rounded-lg shrink-0">
                  <FileText className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-xs sm:text-sm truncate">
                    Statement Page Viewer
                  </h3>
                  {previewTxn && (
                    <p className="text-[11px] text-slate-500 mt-0.5 truncate max-w-[200px] sm:max-w-md">
                      <b>{previewTxn.name}</b> • {previewTxn.transaction_date} • 
                      <span className={previewTxn.amount >= 0 ? 'text-green-600 font-bold ml-1' : 'text-red-600 font-bold ml-1'}>
                        ₹{Math.abs(previewTxn.amount).toLocaleString('en-IN', {minimumFractionDigits: 2})}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Header Viewer Controls */}
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
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
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                      viewerMode === 'image' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    Image
                  </button>
                  <button
                    onClick={() => setViewerMode('pdf')}
                    className={`px-2 py-1 rounded-md transition-all cursor-pointer ${
                      viewerMode === 'pdf' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-600 hover:text-black'
                    }`}
                  >
                    PDF
                  </button>
                </div>

                {/* Zoom controls for image view */}
                {viewerMode === 'image' && (
                  <div className="hidden sm:flex items-center bg-white border border-slate-200 rounded-lg p-0.5 shadow-2xs">
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
                  href={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf?token=${encodeURIComponent(session?.access_token || '')}`}
                  download
                  className="p-1.5 text-slate-600 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="Download full PDF"
                >
                  <Download className="w-4 h-4" />
                </a>

                {/* Open in New Tab */}
                <a
                  href={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf?token=${encodeURIComponent(session?.access_token || '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hidden sm:flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-slate-700 hover:text-blue-600 hover:bg-blue-50 border border-slate-200 rounded-lg transition-colors cursor-pointer shadow-2xs"
                  title="Open full PDF in new browser tab"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>New Tab</span>
                </a>

                {/* Close Button */}
                <button 
                  onClick={() => setPreviewDocId(null)}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-200 cursor-pointer ml-0.5"
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
                    src={`${getApiBase()}/api/v1/documents/${previewDocId}/page/${previewPage}?token=${encodeURIComponent(session?.access_token || '')}`}
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
                  data={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf?token=${encodeURIComponent(session?.access_token || '')}#page=${previewPage}&zoom=page-fit`}
                  type="application/pdf"
                  className="w-full h-full border-none"
                >
                  <iframe
                    key={`iframe-${previewDocId}-${previewPage}`}
                    src={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf?token=${encodeURIComponent(session?.access_token || '')}#page=${previewPage}&zoom=page-fit`}
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
                          href={`${getApiBase()}/api/v1/documents/${previewDocId}/pdf?token=${encodeURIComponent(session?.access_token || '')}`}
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
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
          <div 
            className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-5 sm:p-6 max-h-[92vh] overflow-y-auto animate-in zoom-in-95 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className="p-2 sm:p-2.5 bg-amber-100 text-amber-700 rounded-xl shrink-0">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">Password Protected PDF</h3>
                  <p className="text-xs text-slate-500 truncate max-w-[200px] sm:max-w-[240px]" title={pendingPasswordFile.name}>
                    {pendingPasswordFile.name}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setPendingPasswordFile(null); setStatementPassword(''); setPasswordError(null); setDropzoneKey(prev => prev + 1); }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 cursor-pointer"
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
                    className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white rounded-lg px-3.5 py-2.5 text-base sm:text-sm outline-none pr-10 transition-all font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {passwordError && (
                  <p className="text-xs font-semibold text-rose-600 mt-2 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{passwordError}</span>
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
                  onClick={() => { setPendingPasswordFile(null); setStatementPassword(''); setPasswordError(null); setDropzoneKey(prev => prev + 1); }}
                  className="flex-1 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!statementPassword.trim() || unlocking}
                  className="flex-1 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                >
                  {unlocking ? <RefreshCw className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                  <span>{unlocking ? 'Unlocking...' : 'Unlock & Process'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Biometric Management Modal */}
      {showBiometricModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in"
          onClick={() => { setShowBiometricModal(false); setBioModalError(null); setBioPasswordInput(''); }}
        >
          <div 
            className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-5 sm:p-6 max-w-md w-full space-y-4 max-h-[92vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2.5 sm:gap-3">
                <div className={`p-2 sm:p-2.5 rounded-xl ${biometricProfile ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-100 text-blue-700'} shrink-0`}>
                  <Fingerprint className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base">
                    {biometricProfile ? 'Biometric Sign-In Active' : 'Enable Fingerprint Sign-In'}
                  </h3>
                  <p className="text-xs text-slate-500">
                    {biometricProfile ? 'Device security management' : '1-touch sign-in on this device'}
                  </p>
                </div>
              </div>
              <button 
                onClick={() => { setShowBiometricModal(false); setBioModalError(null); setBioPasswordInput(''); }}
                className="text-slate-400 hover:text-slate-600 p-1.5 rounded-md hover:bg-slate-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {biometricProfile ? (
              <div className="space-y-4 text-xs">
                <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                  <div className="flex items-center gap-2 text-slate-800 font-medium">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Fingerprint sign-in is currently active for:</span>
                  </div>
                  <div className="font-mono font-bold text-slate-900 pl-6">{biometricProfile.email}</div>
                  <p className="text-[11px] text-slate-500 pl-6">
                    Registered on: {new Date(biometricProfile.registeredAt).toLocaleDateString()}
                  </p>
                </div>

                <p className="text-slate-600 text-xs">
                  Whenever you open BankAnalyzer after exiting or closing your browser, you can log in immediately by touching the fingerprint sensor.
                </p>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={handleRemoveBiometrics}
                    className="flex-1 py-2.5 px-3 text-xs font-bold text-rose-700 bg-rose-50 hover:bg-rose-100 border border-rose-200 rounded-lg cursor-pointer transition-colors"
                  >
                    Remove from Device
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowBiometricModal(false)}
                    className="flex-1 py-2.5 px-3 text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                  >
                    Done
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleEnableBiometricsFromDashboard} className="space-y-4">
                <p className="text-xs text-slate-600">
                  Confirm your password once to register your fingerprint sensor for future 1-touch sign-ins on this device.
                </p>

                <div>
                  <label className="text-xs font-bold text-slate-700 block mb-1">
                    Confirm Account Password
                  </label>
                  <div className="relative">
                    <input
                      type={showBioPassword ? 'text' : 'password'}
                      placeholder="Enter your password"
                      value={bioPasswordInput}
                      onChange={(e) => setBioPasswordInput(e.target.value)}
                      autoFocus
                      required
                      className="w-full bg-slate-50 border border-slate-300 focus:border-blue-600 focus:bg-white rounded-lg px-3.5 py-2.5 text-base sm:text-sm outline-none pr-10 transition-all font-mono"
                    />
                    <button
                      type="button"
                      onClick={() => setShowBioPassword(p => !p)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer p-1"
                    >
                      {showBioPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                  {bioModalError && (
                    <p className="text-xs font-semibold text-rose-600 mt-2 flex items-center gap-1">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{bioModalError}</span>
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => { setShowBiometricModal(false); setBioModalError(null); setBioPasswordInput(''); }}
                    className="flex-1 py-2.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg cursor-pointer transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!bioPasswordInput || bioModalLoading}
                    className="flex-1 py-2.5 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg flex items-center justify-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                  >
                    {bioModalLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Fingerprint className="w-4 h-4" />}
                    <span>{bioModalLoading ? 'Verifying...' : 'Enable Fingerprint'}</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

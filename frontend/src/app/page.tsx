"use client";

import dynamic from 'next/dynamic';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import PhoneAuth from '@/components/PhoneAuth';
import { RefreshCw } from 'lucide-react';

const TransactionDashboard = dynamic(() => import('@/components/TransactionDashboard'), {
  ssr: false
});

function AuthenticatedApp() {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-900 text-slate-100 gap-3">
        <RefreshCw className="w-8 h-8 animate-spin text-blue-500" />
        <p className="text-sm font-semibold text-slate-300">Checking secure session...</p>
      </div>
    );
  }

  // If user is not authenticated, display the Phone OTP login screen
  if (!user) {
    return <PhoneAuth />;
  }

  // Once authenticated, display the full BankAnalyzer dashboard
  return <TransactionDashboard />;
}

export default function Home() {
  return (
    <AuthProvider>
      <AuthenticatedApp />
    </AuthProvider>
  );
}

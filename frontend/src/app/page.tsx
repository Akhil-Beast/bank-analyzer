"use client";

import dynamic from 'next/dynamic';

const TransactionDashboard = dynamic(() => import('@/components/TransactionDashboard'), {
  ssr: false
});

export default function Home() {
  return <TransactionDashboard />;
}


"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Building2, 
  Mail, 
  KeyRound, 
  ArrowRight, 
  RefreshCw, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft,
  Inbox,
  ExternalLink,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

export default function EmailAuth() {
  const [step, setStep] = useState<'email' | 'sent'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  // 60-Second Cooldown Timer for Resending
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const validateEmail = (val: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!val.trim() || !emailRegex.test(val.trim())) {
      setError('Please enter a valid email address (e.g., name@example.com).');
      return false;
    }
    return true;
  };

  // STEP 1: Send Magic Link / OTP to Email Inbox
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) return;

    setLoading(true);
    try {
      const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (sendError) throw sendError;

      setStep('sent');
      setCooldown(60);
      setSuccessMessage(`Magic Link dispatched to ${cleanEmail}`);
    } catch (err: any) {
      console.error('Send Email OTP error:', err);
      const rawMsg = err.message || '';
      if (rawMsg.toLowerCase().includes('error sending confirmation email') || rawMsg.toLowerCase().includes('unexpected_failure')) {
        setError(
          'Supabase SMTP Error: Your Custom SMTP settings in Supabase failed to authenticate. Fix: Open Supabase Project Settings -> Authentication -> SMTP Settings, toggle "Enable Custom SMTP" to OFF, and click Save.'
        );
      } else {
        setError(rawMsg || 'Failed to send login email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  // 6-digit box auto-advance & paste handler (Optional manual code input)
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newOtp = [...otp];

    if (value.length > 1) {
      const digits = value.slice(0, 6).split('');
      for (let i = 0; i < 6; i++) newOtp[i] = digits[i] || '';
      setOtp(newOtp);
      return;
    }

    newOtp[index] = value;
    setOtp(newOtp);
  };

  // Verify 6-digit OTP code (if user has code)
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const token = otp.join('');
    if (token.length !== 6) {
      setError('Please enter the complete 6-digit code.');
      return;
    }

    setLoading(true);
    try {
      const cleanEmail = email.trim().toLowerCase();
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: cleanEmail,
        token: token,
        type: 'email',
      });

      if (verifyError) throw verifyError;
      setSuccessMessage('Successfully authenticated! Loading dashboard...');
    } catch (err: any) {
      console.error('Verify Email OTP error:', err);
      setError(err.message || 'Invalid or expired code.');
    } finally {
      setLoading(false);
    }
  };

  // Resend Email
  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return;
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const cleanEmail = email.trim().toLowerCase();
      const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

      const { error: resendError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: { emailRedirectTo: redirectUrl },
      });

      if (resendError) throw resendError;
      setCooldown(60);
      setSuccessMessage(`A fresh Magic Link was sent to ${cleanEmail}`);
    } catch (err: any) {
      console.error('Resend error:', err);
      setError(err.message || 'Failed to resend email.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <div className="w-full max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-100 p-8 space-y-6">
        
        {/* Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 mb-1 shadow-inner">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">BankAnalyzer</h1>
          <p className="text-xs text-slate-500 font-medium">
            1-Click Passwordless Authentication
          </p>
        </div>

        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs flex items-start gap-2.5">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs flex items-start gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <div className="flex-1 font-medium">{successMessage}</div>
          </div>
        )}

        {step === 'email' ? (
          /* STEP 1: Enter Email */
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-blue-600" />
                <span>Your Email Address</span>
              </label>
              <input
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500"
                autoFocus
                required
              />
              <p className="text-[11px] text-slate-500">
                We'll email you a secure <b>Magic Link</b>. Click the link in your email to log in instantly!
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Login Link...</span>
                </>
              ) : (
                <>
                  <span>Send Magic Link</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          /* STEP 2: Check Email & Magic Link Instruction */
          <div className="space-y-6">
            <div className="bg-blue-50 border border-blue-200 rounded-2xl p-5 text-center space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-blue-100 text-blue-600 mx-auto">
                <Inbox className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h3 className="font-bold text-slate-900 text-base">Check Your Inbox!</h3>
                <p className="text-xs text-slate-600 mt-1">
                  We sent a secure login link to:
                </p>
                <p className="font-bold text-sm text-blue-700 mt-0.5 break-all">
                  {email.trim()}
                </p>
              </div>
              <div className="bg-white border border-blue-100 rounded-xl p-3 text-xs text-slate-600 text-left space-y-1.5 shadow-2xs">
                <p className="font-bold text-slate-800">👉 How to log in:</p>
                <p>1. Open the email from <b>Supabase</b>.</p>
                <p>2. Click the <b>"Log In"</b> button inside.</p>
                <p>3. You will be signed into BankAnalyzer automatically!</p>
                <p className="text-[11px] text-amber-700 pt-1 border-t border-slate-100">
                  ⚠️ <i>Don't see it? Check your <b>Spam</b> or <b>Junk</b> folder!</i>
                </p>
              </div>
            </div>

            {/* Quick Gmail Button */}
            <a
              href="https://mail.google.com"
              target="_blank"
              rel="noreferrer"
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 text-white font-bold text-sm rounded-xl shadow-md transition-all cursor-pointer"
            >
              <span>Open Gmail Inbox</span>
              <ExternalLink className="w-4 h-4" />
            </a>

            {/* Collapsible: Optional 6-digit Code input if user has one */}
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <button
                type="button"
                onClick={() => setShowCodeInput(!showCodeInput)}
                className="w-full flex items-center justify-between p-3 bg-slate-50 text-xs font-bold text-slate-700 hover:bg-slate-100 transition-colors"
              >
                <span className="flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                  <span>Have a 6-digit code instead?</span>
                </span>
                {showCodeInput ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>

              {showCodeInput && (
                <form onSubmit={handleVerifyOtp} className="p-4 space-y-3 bg-white border-t border-slate-200">
                  <p className="text-[11px] text-slate-500">
                    If your email includes a 6-digit verification code, enter it below:
                  </p>
                  <div className="flex items-center justify-between gap-1.5">
                    {otp.map((digit, idx) => (
                      <input
                        key={idx}
                        type="text"
                        inputMode="numeric"
                        maxLength={1}
                        value={digit}
                        onChange={(e) => handleOtpChange(idx, e.target.value)}
                        className="w-11 h-12 text-center text-lg font-black bg-slate-50 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                      />
                    ))}
                  </div>
                  <button
                    type="submit"
                    disabled={loading || otp.join('').length !== 6}
                    className="w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-all disabled:opacity-50 cursor-pointer"
                  >
                    Verify Code
                  </button>
                </form>
              )}
            </div>

            {/* Back & Resend Controls */}
            <div className="flex items-center justify-between pt-1 text-xs">
              <button
                type="button"
                onClick={() => {
                  setStep('email');
                  setError(null);
                  setSuccessMessage(null);
                }}
                className="font-semibold text-slate-500 hover:text-slate-800 flex items-center gap-1 cursor-pointer"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Use Different Email</span>
              </button>

              {cooldown > 0 ? (
                <span className="text-slate-400 font-medium">Resend in {cooldown}s</span>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading}
                  className="font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Resend Email
                </button>
              )}
            </div>
          </div>
        )}

        {/* Security Badge */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Encrypted Session • Supabase Auth</span>
        </div>
      </div>
    </div>
  );
}

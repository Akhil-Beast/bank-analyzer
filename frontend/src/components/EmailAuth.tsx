"use client";

import React, { useState, useEffect, useRef } from 'react';
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
  Inbox
} from 'lucide-react';

export default function EmailAuth() {
  const [step, setStep] = useState<'email' | 'otp'>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown countdown timer for resending OTP
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const validateEmail = (val: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!val.trim()) {
      setError('Please enter your email address.');
      return false;
    }
    if (!emailRegex.test(val.trim())) {
      setError('Please enter a valid email address (e.g., name@example.com).');
      return false;
    }
    return true;
  };

  // STEP 1: Send 6-digit OTP & Magic Link to Email
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) return;

    setLoading(true);
    try {
      // Determine redirect URL dynamically (works on localhost, Vercel, and Capacitor)
      const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;

      const { error: sendError } = await supabase.auth.signInWithOtp({
        email: cleanEmail,
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (sendError) throw sendError;

      setStep('otp');
      setCooldown(60);
      setSuccessMessage(`We sent a 6-digit code and Magic Link to ${cleanEmail}`);
      setOtp(['', '', '', '', '', '']);
      setTimeout(() => otpInputRefs.current[0]?.focus(), 150);
    } catch (err: any) {
      console.error('Send Email OTP error:', err);
      setError(err.message || 'Failed to send verification code. Please check your email and try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handle individual 6-digit OTP input boxes
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;

    const newOtp = [...otp];
    // If user pastes multiple digits
    if (value.length > 1) {
      const digits = value.slice(0, 6).split('');
      for (let i = 0; i < 6; i++) newOtp[i] = digits[i] || '';
      setOtp(newOtp);
      const nextFocus = Math.min(digits.length, 5);
      otpInputRefs.current[nextFocus]?.focus();
      return;
    }

    newOtp[index] = value;
    setOtp(newOtp);

    // Auto-advance to next box if filled
    if (value && index < 5) {
      otpInputRefs.current[index + 1]?.focus();
    }
  };

  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // STEP 2: Verify 6-digit OTP code
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const token = otp.join('');
    if (token.length !== 6) {
      setError('Please enter the complete 6-digit verification code from your email.');
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
      // AuthContext listener will automatically detect the new session and load the dashboard
    } catch (err: any) {
      console.error('Verify Email OTP error:', err);
      setError(err.message || 'Invalid or expired code. Please check your inbox or request a new code.');
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP / Magic Link
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
        options: {
          emailRedirectTo: redirectUrl,
        },
      });

      if (resendError) throw resendError;

      setCooldown(60);
      setSuccessMessage(`A new code and Magic Link were sent to ${cleanEmail}`);
      setOtp(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
    } catch (err: any) {
      console.error('Resend OTP error:', err);
      setError(err.message || 'Failed to resend code. Please wait before trying again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-slate-900 text-slate-100">
      <div className="w-full max-w-md bg-white text-slate-900 rounded-2xl shadow-2xl border border-slate-100 p-8 space-y-6">
        
        {/* App Branding */}
        <div className="text-center space-y-2">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-50 text-blue-600 mb-1 shadow-inner">
            <Building2 className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">BankAnalyzer</h1>
          <p className="text-xs text-slate-500 font-medium">
            Passwordless Email Authentication (OTP & Magic Link)
          </p>
        </div>

        {/* Status Alerts */}
        {error && (
          <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div className="flex-1 font-medium">{error}</div>
          </div>
        )}

        {successMessage && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl text-xs flex items-start gap-2.5 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <div className="flex-1 font-medium">{successMessage}</div>
          </div>
        )}

        {/* STEP 1: Email Input */}
        {step === 'email' ? (
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-blue-600" />
                <span>Your Email Address</span>
              </label>

              <div className="relative">
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  autoFocus
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                We'll email you a <b>6-digit code</b> and a clickable <b>Magic Link</b>. No password needed!
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Code & Link...</span>
                </>
              ) : (
                <>
                  <span>Send Code & Link</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          /* STEP 2: 6-Digit OTP Verification or Magic Link Click */
          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                  <span>Enter 6-Digit Code</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email');
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>Change Email</span>
                </button>
              </div>

              <div className="bg-blue-50 border border-blue-100 rounded-xl p-3 flex items-start gap-2.5 text-xs text-blue-900">
                <Inbox className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div>
                  Sent to: <b className="font-semibold">{email.trim()}</b>
                  <p className="text-[11px] text-blue-700 mt-0.5">
                    Enter the code below <b>OR</b> simply click the link inside your email to sign in instantly!
                  </p>
                </div>
              </div>

              {/* 6 Digit Input Boxes */}
              <div className="flex items-center justify-between gap-2 pt-1">
                {otp.map((digit, idx) => (
                  <input
                    key={idx}
                    ref={(el) => {
                      otpInputRefs.current[idx] = el;
                    }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => handleOtpChange(idx, e.target.value)}
                    onKeyDown={(e) => handleKeyDown(idx, e)}
                    className="w-12 h-13 text-center text-xl font-black bg-slate-50 border-2 border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white focus:ring-2 focus:ring-blue-100 transition-all"
                  />
                ))}
              </div>
            </div>

            {/* Verify Button */}
            <button
              type="submit"
              disabled={loading || otp.join('').length !== 6}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Verifying Code...</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>Verify Code & Sign In</span>
                </>
              )}
            </button>

            {/* Resend Cooldown */}
            <div className="text-center pt-1">
              {cooldown > 0 ? (
                <p className="text-xs text-slate-500 font-medium">
                  Resend code in <b className="text-slate-800">{cooldown}s</b>
                </p>
              ) : (
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={loading}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                >
                  Didn't receive code? Resend Email
                </button>
              )}
            </div>
          </form>
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

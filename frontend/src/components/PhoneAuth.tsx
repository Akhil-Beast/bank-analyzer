"use client";

import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { 
  Building2, 
  Smartphone, 
  KeyRound, 
  ArrowRight, 
  RefreshCw, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2, 
  ArrowLeft 
} from 'lucide-react';

const COUNTRY_CODES = [
  { code: '+91', country: 'India', flag: '🇮🇳' },
  { code: '+1', country: 'US / Canada', flag: '🇺🇸' },
  { code: '+44', country: 'UK', flag: '🇬🇧' },
  { code: '+971', country: 'UAE', flag: '🇦🇪' },
  { code: '+61', country: 'Australia', flag: '🇦🇺' },
  { code: '+65', country: 'Singapore', flag: '🇸🇬' },
  { code: '+49', country: 'Germany', flag: '🇩🇪' },
  { code: '+33', country: 'France', flag: '🇫🇷' },
];

export default function PhoneAuth() {
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [countryCode, setCountryCode] = useState('+91');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const otpInputRefs = useRef<(HTMLInputElement | null)[]>([]);

  // Cooldown countdown timer for resend OTP
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setInterval(() => {
      setCooldown((prev) => (prev > 0 ? prev - 1 : 0));
    }, 1000);
    return () => clearInterval(timer);
  }, [cooldown]);

  const cleanPhoneDigits = phoneNumber.replace(/\D/g, '');
  const fullPhoneNumber = `${countryCode}${cleanPhoneDigits}`;

  // Validate phone number
  const validatePhone = (): boolean => {
    if (!cleanPhoneDigits) {
      setError('Please enter your phone number.');
      return false;
    }
    if (cleanPhoneDigits.length < 8 || cleanPhoneDigits.length > 14) {
      setError('Please enter a valid phone number (8 to 14 digits).');
      return false;
    }
    return true;
  };

  // Step 1: Send OTP to Phone
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    if (!validatePhone()) return;

    setLoading(true);
    try {
      const { error: sendError } = await supabase.auth.signInWithOtp({
        phone: fullPhoneNumber,
      });

      if (sendError) {
        throw sendError;
      }

      setStep('otp');
      setCooldown(60);
      setSuccessMessage(`Verification code sent to ${fullPhoneNumber}`);
      setOtp(['', '', '', '', '', '']);
      // Focus first OTP field after transition
      setTimeout(() => {
        otpInputRefs.current[0]?.focus();
      }, 150);
    } catch (err: any) {
      console.error('Send OTP error:', err);
      const msg = err.message || 'Failed to send verification code. Please check your number or try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Handle individual OTP input box changes
  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return; // Only allow numbers

    const newOtp = [...otp];
    // If user pastes multiple digits
    if (value.length > 1) {
      const digits = value.slice(0, 6).split('');
      for (let i = 0; i < 6; i++) {
        newOtp[i] = digits[i] || '';
      }
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

  // Handle backspace navigation between OTP boxes
  const handleKeyDown = (index: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !otp[index] && index > 0) {
      otpInputRefs.current[index - 1]?.focus();
    }
  };

  // Step 2: Verify OTP
  const handleVerifyOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const token = otp.join('');
    if (token.length !== 6) {
      setError('Please enter the complete 6-digit verification code.');
      return;
    }

    setLoading(true);
    try {
      const { data, error: verifyError } = await supabase.auth.verifyOtp({
        phone: fullPhoneNumber,
        token: token,
        type: 'sms',
      });

      if (verifyError) {
        throw verifyError;
      }

      setSuccessMessage('Successfully authenticated! Loading dashboard...');
      // AuthContext listener will automatically detect the new session and load the dashboard
    } catch (err: any) {
      console.error('Verify OTP error:', err);
      const msg = err.message || 'Invalid or expired verification code. Please try again.';
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  // Resend OTP
  const handleResendOtp = async () => {
    if (cooldown > 0 || loading) return;
    setError(null);
    setSuccessMessage(null);
    setLoading(true);

    try {
      const { error: resendError } = await supabase.auth.signInWithOtp({
        phone: fullPhoneNumber,
      });

      if (resendError) {
        throw resendError;
      }

      setCooldown(60);
      setSuccessMessage(`New code sent to ${fullPhoneNumber}`);
      setOtp(['', '', '', '', '', '']);
      otpInputRefs.current[0]?.focus();
    } catch (err: any) {
      console.error('Resend OTP error:', err);
      setError(err.message || 'Failed to resend verification code. Please wait before trying again.');
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
            Secure Phone Number Authentication with Supabase OTP
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

        {/* STEP 1: Phone Number Input */}
        {step === 'phone' ? (
          <form onSubmit={handleSendOtp} className="space-y-5">
            <div className="space-y-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Smartphone className="w-3.5 h-3.5 text-blue-600" />
                <span>Mobile Phone Number</span>
              </label>
              
              <div className="flex gap-2">
                {/* Country Code Selector */}
                <select
                  value={countryCode}
                  onChange={(e) => setCountryCode(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white cursor-pointer"
                >
                  {COUNTRY_CODES.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.flag} {c.code}
                    </option>
                  ))}
                </select>

                {/* Number Input */}
                <input
                  type="tel"
                  placeholder="98765 43210"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white transition-all"
                  autoFocus
                  required
                />
              </div>
              <p className="text-[11px] text-slate-500">
                We will send a 6-digit One-Time Password (OTP) via SMS to verify your identity.
              </p>
            </div>

            <button
              type="submit"
              disabled={loading || !cleanPhoneDigits}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
            >
              {loading ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>Sending Verification Code...</span>
                </>
              ) : (
                <>
                  <span>Send Verification Code</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>
        ) : (
          /* STEP 2: OTP Verification */
          <form onSubmit={handleVerifyOtp} className="space-y-6">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <KeyRound className="w-3.5 h-3.5 text-blue-600" />
                  <span>Enter 6-Digit OTP</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    setStep('phone');
                    setError(null);
                    setSuccessMessage(null);
                  }}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeft className="w-3 h-3" />
                  <span>Change Number</span>
                </button>
              </div>

              <p className="text-xs text-slate-600 font-medium">
                Sent to: <b className="text-slate-900">{fullPhoneNumber}</b>
              </p>

              {/* 6 Digit Input Boxes */}
              <div className="flex items-center justify-between gap-2 pt-2">
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
                  <span>Verify & Sign In</span>
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
                  Didn't receive code? Resend OTP
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

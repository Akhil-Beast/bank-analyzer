"use client";

import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { 
  Building2, 
  Mail, 
  Lock, 
  Eye, 
  EyeOff, 
  ArrowRight, 
  RefreshCw, 
  ShieldCheck, 
  AlertCircle, 
  CheckCircle2,
  Fingerprint,
  UserCheck,
  KeyRound
} from 'lucide-react';
import { 
  checkBiometricAvailability, 
  getBiometricProfile, 
  registerBiometrics, 
  authenticateWithBiometrics, 
  clearBiometricProfile,
  isNativePlatform,
  BiometricProfile,
  BiometricAvailability
} from '@/lib/biometrics';

export default function EmailAuth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Biometric state
  const [biometricProfile, setBiometricProfile] = useState<BiometricProfile | null>(null);
  const [bioAvailability, setBioAvailability] = useState<BiometricAvailability | null>(null);
  const [viewMode, setViewMode] = useState<'biometric' | 'password'>('password');
  const [enableBiometricsOnLogin, setEnableBiometricsOnLogin] = useState<boolean>(true);
  const [authenticatingBiometric, setAuthenticatingBiometric] = useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const initBiometrics = async () => {
      try {
        const profile = getBiometricProfile();
        const avail = await checkBiometricAvailability();
        if (!mounted) return;

        setBioAvailability(avail);

        if (profile && avail.supported) {
          setBiometricProfile(profile);
          setViewMode('biometric');
          // On native Android, auto-prompt for biometrics shortly after mount
          if (isNativePlatform()) {
            setTimeout(() => {
              if (mounted) {
                triggerBiometricAuth(profile.email);
              }
            }, 300);
          }
        } else {
          setViewMode('password');
        }
      } catch (err) {
        console.warn("Biometrics initialization warning:", err);
      }
    };

    initBiometrics();
    return () => {
      mounted = false;
    };
  }, []);

  const triggerBiometricAuth = async (targetEmail?: string) => {
    setError(null);
    setAuthenticatingBiometric(true);
    try {
      const result = await authenticateWithBiometrics(async (userEmail, userPassword) => {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: userEmail,
          password: userPassword,
        });
        if (signInError) {
          throw signInError;
        }
      });

      if (!result.success) {
        if (result.error && !result.error.toLowerCase().includes('cancel')) {
          setError(result.error);
        }
      }
    } catch (err: any) {
      console.error("Biometric sign-in error:", err);
      if (err.message?.includes('Invalid login credentials') || err.message?.includes('invalid_credentials')) {
        setError('Your password was changed. Please sign in with your password to re-enable biometrics.');
        clearBiometricProfile();
        setBiometricProfile(null);
        setViewMode('password');
        if (targetEmail) setEmail(targetEmail);
      } else {
        setError(err.message || 'Biometric authentication failed.');
      }
    } finally {
      setAuthenticatingBiometric(false);
    }
  };

  const validateEmail = (val: string): boolean => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!val.trim() || !emailRegex.test(val.trim())) {
      setError('Please enter a valid email address.');
      return false;
    }
    return true;
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccessMessage(null);

    const cleanEmail = email.trim().toLowerCase();
    if (!validateEmail(cleanEmail)) return;

    if (!password || password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }

    if (isSignUp && password !== confirmPassword) {
      setError('Passwords do not match. Please re-enter.');
      return;
    }

    setLoading(true);
    try {
      if (isSignUp) {
        const redirectUrl = typeof window !== 'undefined' ? window.location.origin : undefined;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password: password,
          options: {
            emailRedirectTo: redirectUrl,
          },
        });

        if (signUpError) {
          if (signUpError.message.includes('already registered') || signUpError.message.includes('already been registered')) {
            setError('This email is already registered. Please sign in instead.');
          } else {
            throw signUpError;
          }
          return;
        }

        if (data.session) {
          setSuccessMessage('Account created! Loading your dashboard...');
        } else if (data.user) {
          const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password: password,
          });

          if (!signInError && signInData.session) {
            setSuccessMessage('Account created! Loading your dashboard...');
          } else {
            setSuccessMessage('Account created! Please sign in with your password.');
            setIsSignUp(false);
          }
        }
      } else {
        // First, verify credentials with a lightweight check to prevent triggering session unmount before biometric enrollment
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        const verifyClient = createClient(supabaseUrl, supabaseAnonKey, {
          auth: { persistSession: false }
        });

        const { error: testSignInError } = await verifyClient.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });

        if (testSignInError) {
          if (testSignInError.message.includes('Invalid login credentials') || testSignInError.message.includes('invalid_credentials')) {
            setError('Incorrect email or password. Please try again.');
          } else if (testSignInError.message.includes('Email not confirmed')) {
            setError('Please verify your email address first. Check your inbox for the confirmation email.');
          } else {
            throw testSignInError;
          }
          return;
        }

        // Credentials are valid! If user opted in to Biometrics on this device, prompt hardware registration now
        if (enableBiometricsOnLogin && bioAvailability?.supported) {
          try {
            const bioResult = await registerBiometrics(cleanEmail, password);
            if (bioResult.success) {
              setBiometricProfile(getBiometricProfile());
            }
          } catch (bioErr) {
            console.warn("Biometric enrollment skipped:", bioErr);
          }
        }

        // Now establish the authenticated session on the main Supabase client (persisted to sessionStorage)
        const { error: finalSignInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });

        if (finalSignInError) {
          throw finalSignInError;
        }

        setSuccessMessage('Signed in! Loading your dashboard...');
      }
    } catch (err: any) {
      console.error('Auth error:', err);
      setError(err.message || 'Authentication failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const switchMode = () => {
    setIsSignUp(!isSignUp);
    setError(null);
    setSuccessMessage(null);
    setPassword('');
    setConfirmPassword('');
  };

  const handleSwitchAccount = () => {
    clearBiometricProfile();
    setBiometricProfile(null);
    setViewMode('password');
    setEmail('');
    setPassword('');
    setError(null);
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
            Secure Personal Banking Analytics
          </p>
        </div>

        {/* 1. BIOMETRIC SIGN-IN VIEW (For returning enrolled devices) */}
        {viewMode === 'biometric' && biometricProfile ? (
          <div className="space-y-6 animate-in fade-in">
            {/* Status Alerts */}
            {error && (
              <div className="bg-rose-50 border border-rose-200 text-rose-700 px-4 py-3 rounded-xl text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="flex-1 font-medium">{error}</div>
              </div>
            )}

            {/* Profile Card */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-center space-y-1.5">
              <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Device User</span>
              <div className="flex items-center justify-center gap-2 text-sm font-bold text-slate-900">
                <UserCheck className="w-4 h-4 text-emerald-600" />
                <span className="font-mono">{biometricProfile.email}</span>
              </div>
              <p className="text-[11px] text-slate-400">
                Biometric sign-in is enabled on this device
              </p>
            </div>

            {/* Touch Fingerprint Button */}
            <div className="flex flex-col items-center justify-center py-4 space-y-4">
              <button
                type="button"
                onClick={() => triggerBiometricAuth(biometricProfile.email)}
                disabled={authenticatingBiometric}
                className="group relative flex flex-col items-center justify-center w-28 h-28 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 hover:from-blue-600 hover:to-indigo-700 active:scale-95 text-white shadow-xl hover:shadow-2xl hover:shadow-blue-500/25 transition-all cursor-pointer disabled:opacity-70"
                title="Tap to scan fingerprint"
              >
                <div className="absolute inset-0 rounded-full border-4 border-blue-200/40 animate-ping pointer-events-none opacity-40" />
                {authenticatingBiometric ? (
                  <RefreshCw className="w-12 h-12 animate-spin text-white" />
                ) : (
                  <Fingerprint className="w-13 h-13 text-white transition-transform group-hover:scale-110" />
                )}
              </button>
              
              <div className="text-center">
                <button
                  type="button"
                  onClick={() => triggerBiometricAuth(biometricProfile.email)}
                  disabled={authenticatingBiometric}
                  className="text-xs font-bold text-blue-600 hover:text-blue-800 transition-colors cursor-pointer"
                >
                  {authenticatingBiometric ? 'Verifying Biometrics...' : 'Touch to Sign In with Fingerprint'}
                </button>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Fast & secure 1-touch authentication
                </p>
              </div>
            </div>

            {/* Fallback & Switch Account Options */}
            <div className="space-y-2 pt-2 border-t border-slate-100 text-center">
              <button
                type="button"
                onClick={() => {
                  setEmail(biometricProfile.email);
                  setViewMode('password');
                  setError(null);
                }}
                className="w-full py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-slate-500" />
                <span>Use Password Instead</span>
              </button>

              <button
                type="button"
                onClick={handleSwitchAccount}
                className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 transition-colors cursor-pointer"
              >
                Switch Account / Remove Biometrics
              </button>
            </div>
          </div>
        ) : (
          /* 2. STANDARD PASSWORD LOGIN / SIGN UP VIEW */
          <>
            {/* Mode Tabs */}
            <div className="flex bg-slate-100 p-1 rounded-xl text-xs font-bold text-slate-600">
              <button
                type="button"
                onClick={() => !isSignUp || switchMode()}
                className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                  !isSignUp
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'hover:text-slate-900'
                }`}
              >
                Sign In
              </button>
              <button
                type="button"
                onClick={() => isSignUp || switchMode()}
                className={`flex-1 py-2 rounded-lg transition-all cursor-pointer ${
                  isSignUp
                    ? 'bg-white text-blue-600 shadow-sm'
                    : 'hover:text-slate-900'
                }`}
              >
                Create Account
              </button>
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

            {/* Auth Form */}
            <form onSubmit={handleAuth} className="space-y-4">
              {/* Email */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Mail className="w-3.5 h-3.5 text-blue-600" />
                  <span>Email Address</span>
                </label>
                <input
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  autoFocus
                  required
                />
              </div>

              {/* Password */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                  <Lock className="w-3.5 h-3.5 text-blue-600" />
                  <span>Password</span>
                </label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder={isSignUp ? 'Create a strong password (min 6 chars)' : '••••••••'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 pr-10 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Confirm Password (Sign Up only) */}
              {isSignUp && (
                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                    <Lock className="w-3.5 h-3.5 text-blue-600" />
                    <span>Confirm Password</span>
                  </label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Re-enter your password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    required
                  />
                </div>
              )}

              {/* Biometric Opt-in Checkbox (Available for devices with hardware support) */}
              {!isSignUp && bioAvailability?.supported && (
                <label className="flex items-start gap-2.5 p-3 bg-blue-50/70 border border-blue-100 rounded-xl cursor-pointer hover:bg-blue-50 transition-colors">
                  <input
                    type="checkbox"
                    checked={enableBiometricsOnLogin}
                    onChange={(e) => setEnableBiometricsOnLogin(e.target.checked)}
                    className="w-4 h-4 mt-0.5 text-blue-600 rounded focus:ring-blue-500 cursor-pointer"
                  />
                  <div className="text-left">
                    <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900">
                      <Fingerprint className="w-3.5 h-3.5 text-blue-600" />
                      <span>Enable Biometric / Fingerprint Sign-In</span>
                    </div>
                    <p className="text-[11px] text-blue-700 mt-0.5">
                      Enable 1-touch fingerprint authentication for all future logins on this device.
                    </p>
                  </div>
                </label>
              )}

              <button
                type="submit"
                disabled={loading || !email.trim() || !password || (isSignUp && !confirmPassword)}
                className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-bold text-sm rounded-xl shadow-md transition-all disabled:opacity-50 cursor-pointer"
              >
                {loading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>{isSignUp ? 'Creating Account...' : 'Signing In...'}</span>
                  </>
                ) : (
                  <>
                    <span>{isSignUp ? 'Create Account' : 'Sign In'}</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Toggle */}
              <div className="text-center pt-1">
                <button
                  type="button"
                  onClick={switchMode}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-800 cursor-pointer"
                >
                  {isSignUp
                    ? 'Already have an account? Sign In'
                    : "Don't have an account? Create one"}
                </button>
              </div>

              {/* If returning to Biometric option is available */}
              {biometricProfile && (
                <div className="text-center pt-1 border-t border-slate-100">
                  <button
                    type="button"
                    onClick={() => {
                      setViewMode('biometric');
                      setError(null);
                    }}
                    className="flex items-center justify-center gap-1.5 text-xs font-bold text-blue-600 hover:text-blue-800 mx-auto cursor-pointer"
                  >
                    <Fingerprint className="w-3.5 h-3.5" />
                    <span>Back to Fingerprint Sign-In</span>
                  </button>
                </div>
              )}
            </form>
          </>
        )}

        {/* Security Badge */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Your data is private and isolated · Supabase Auth</span>
        </div>
      </div>
    </div>
  );
}

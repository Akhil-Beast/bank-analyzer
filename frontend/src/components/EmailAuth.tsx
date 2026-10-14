"use client";

import React, { useState } from 'react';
import { supabase } from '@/lib/supabase';
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
  CheckCircle2
} from 'lucide-react';

export default function EmailAuth() {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: cleanEmail,
          password: password,
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
          // Auto-logged in (email confirmation disabled)
          setSuccessMessage('Account created! Loading your dashboard...');
        } else {
          // Email confirmation required
          setSuccessMessage('Account created! Please check your email to verify your address, then sign in.');
          setIsSignUp(false);
          setPassword('');
          setConfirmPassword('');
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanEmail,
          password: password,
        });

        if (signInError) {
          if (signInError.message.includes('Invalid login credentials') || signInError.message.includes('invalid_credentials')) {
            setError('Incorrect email or password. Please try again.');
          } else if (signInError.message.includes('Email not confirmed')) {
            setError('Please verify your email address first. Check your inbox for the confirmation email.');
          } else {
            throw signInError;
          }
          return;
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
        </form>

        {/* Security Badge */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-center gap-1.5 text-[11px] text-slate-400 font-medium">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
          <span>Your data is private and isolated · Supabase Auth</span>
        </div>
      </div>
    </div>
  );
}

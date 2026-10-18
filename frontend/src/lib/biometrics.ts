// Biometric Authentication Service supporting Android Native Fingerprint and WebAuthn (Passkeys)

export interface BiometricAvailability {
  supported: boolean;
  enrolled: boolean;
  type: 'fingerprint' | 'face' | 'webauthn' | 'none';
}

export interface BiometricProfile {
  email: string;
  registeredAt: string;
  type: string;
}

const BIO_PROFILE_KEY = 'bankanalyzer_biometric_profile';
const DEVICE_KEY = 'bankanalyzer_dev_key';

// Helper: Get or create device-unique salt for local credential obfuscation
const getDeviceKey = (): string => {
  if (typeof window === 'undefined') return 'bankanalyzer_default_entropy';
  let k = localStorage.getItem(DEVICE_KEY);
  if (!k) {
    k = Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    localStorage.setItem(DEVICE_KEY, k);
  }
  return k;
};

// Simple reversible XOR encryption with device key
const encryptSecret = (text: string): string => {
  const k = getDeviceKey();
  let result = '';
  for (let i = 0; i < text.length; i++) {
    result += String.fromCharCode(text.charCodeAt(i) ^ k.charCodeAt(i % k.length));
  }
  return btoa(result);
};

const decryptSecret = (cipher: string): string => {
  try {
    const raw = atob(cipher);
    const k = getDeviceKey();
    let result = '';
    for (let i = 0; i < raw.length; i++) {
      result += String.fromCharCode(raw.charCodeAt(i) ^ k.charCodeAt(i % k.length));
    }
    return result;
  } catch {
    return '';
  }
};

// Check if running inside Capacitor Android app
export const isNativePlatform = (): boolean => {
  if (typeof window === 'undefined') return false;
  const win = window as any;
  return !!(
    win.Capacitor?.isNativePlatform?.() ||
    win.Capacitor?.getPlatform?.() === 'android' ||
    win.location?.protocol === 'capacitor:' ||
    (win.location?.hostname === 'localhost' && win.location?.port !== '3000' && win.location?.port !== '8000') ||
    navigator.userAgent.includes('Android') && !!win.Capacitor
  );
};

// Check biometric hardware availability
export const checkBiometricAvailability = async (): Promise<BiometricAvailability> => {
  if (typeof window === 'undefined') {
    return { supported: false, enrolled: false, type: 'none' };
  }

  const win = window as any;

  // 1. Native Capacitor Android Plugin
  if (isNativePlatform() && win.Capacitor?.Plugins?.BiometricAuth) {
    try {
      const res = await win.Capacitor.Plugins.BiometricAuth.isAvailable();
      return {
        supported: !!res.isAvailable,
        enrolled: !!res.hasEnrolled,
        type: 'fingerprint'
      };
    } catch (err) {
      console.warn("Native BiometricAuth.isAvailable check error:", err);
    }
  }

  // 2. WebAuthn Platform Authenticator (Windows Hello, Touch ID, Android Chrome Biometrics)
  if (
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function'
  ) {
    try {
      const available = await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
      if (available) {
        return {
          supported: true,
          enrolled: true,
          type: 'webauthn'
        };
      }
    } catch (err) {
      console.warn("WebAuthn availability check error:", err);
    }
  }

  return { supported: false, enrolled: false, type: 'none' };
};

// Get stored biometric registration for this device
export const getBiometricProfile = (): BiometricProfile | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(BIO_PROFILE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed.email || !parsed.secret) return null;
    return {
      email: parsed.email,
      registeredAt: parsed.registeredAt || new Date().toISOString(),
      type: parsed.type || 'fingerprint'
    };
  } catch {
    return null;
  }
};

// Register biometric authentication after a successful standard password login
export const registerBiometrics = async (
  email: string,
  password: string
): Promise<{ success: boolean; error?: string }> => {
  const win = window as any;
  const availability = await checkBiometricAvailability();

  if (!availability.supported) {
    return {
      success: false,
      error: "Biometric hardware is not available on this device."
    };
  }

  // Verify biometrics with user right now to register device
  try {
    if (isNativePlatform() && win.Capacitor?.Plugins?.BiometricAuth) {
      const authRes = await win.Capacitor.Plugins.BiometricAuth.authenticate({
        title: "Enable Fingerprint Sign-In",
        subtitle: "Confirm your fingerprint for BankAnalyzer",
        description: "Touch the fingerprint sensor to register this device",
        negativeButtonText: "Cancel"
      });

      if (!authRes.success) {
        return {
          success: false,
          error: authRes.error || "Biometric authentication was cancelled."
        };
      }
    } else if (typeof window.PublicKeyCredential !== 'undefined') {
      // WebAuthn registration challenge
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      const userId = new TextEncoder().encode(email);

      await navigator.credentials.create({
        publicKey: {
          challenge,
          rp: { name: "BankAnalyzer", id: window.location.hostname },
          user: {
            id: userId,
            name: email,
            displayName: email
          },
          pubKeyCredParams: [
            { alg: -7, type: "public-key" }, // ES256
            { alg: -257, type: "public-key" } // RS256
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required"
          },
          timeout: 60000
        }
      });
    }

    // Save profile locally on this device
    const profileData = {
      email: email.trim().toLowerCase(),
      secret: encryptSecret(password),
      registeredAt: new Date().toISOString(),
      type: availability.type
    };
    localStorage.setItem(BIO_PROFILE_KEY, JSON.stringify(profileData));

    return { success: true };
  } catch (err: any) {
    console.error("Biometric registration error:", err);
    return {
      success: false,
      error: err.message || "Could not register biometric authentication."
    };
  }
};

// Authenticate with Biometrics and restore session
export const authenticateWithBiometrics = async (
  onSuccessCallback: (email: string, password: string) => Promise<void>
): Promise<{ success: boolean; error?: string }> => {
  if (typeof window === 'undefined') {
    return { success: false, error: "Window undefined" };
  }

  const raw = localStorage.getItem(BIO_PROFILE_KEY);
  if (!raw) {
    return { success: false, error: "No biometric profile found on this device." };
  }

  let profileData: any;
  try {
    profileData = JSON.parse(raw);
  } catch {
    return { success: false, error: "Invalid biometric profile." };
  }

  const email = profileData.email;
  const password = decryptSecret(profileData.secret);

  if (!email || !password) {
    return { success: false, error: "Corrupted biometric credentials." };
  }

  const win = window as any;

  try {
    // 1. Android Native Biometric Prompt
    if (isNativePlatform() && win.Capacitor?.Plugins?.BiometricAuth) {
      const res = await win.Capacitor.Plugins.BiometricAuth.authenticate({
        title: "Biometric Sign-In",
        subtitle: `Welcome back, ${email}`,
        description: "Touch the fingerprint sensor to sign in",
        negativeButtonText: "Use Password"
      });

      if (!res.success) {
        return {
          success: false,
          error: res.error || "Biometric verification was cancelled."
        };
      }
    } else if (typeof window.PublicKeyCredential !== 'undefined') {
      // 2. WebAuthn Prompt
      const challenge = crypto.getRandomValues(new Uint8Array(32));
      await navigator.credentials.get({
        publicKey: {
          challenge,
          rpId: window.location.hostname,
          userVerification: "required",
          timeout: 60000
        }
      });
    }

    // 3. Perform login with Supabase
    await onSuccessCallback(email, password);
    return { success: true };
  } catch (err: any) {
    console.error("Biometric authentication error:", err);
    return {
      success: false,
      error: err.message || "Biometric authentication failed or was cancelled."
    };
  }
};

// Clear biometric profile from device (e.g. switch account or disable)
export const clearBiometricProfile = () => {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(BIO_PROFILE_KEY);
  }
};

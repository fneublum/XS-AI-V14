
import React, { useState, useEffect } from 'react';
import { User, Role } from '../types';
import { Loader2, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import { issueEdgeToken } from '../services/edgeAuth';
import pkg from '../package.json';

interface LoginProps {
    onLogin: (user: User) => void;
    users: User[];
    isLoading?: boolean;
    dbError?: string | null;
}

const DEFAULT_LOGO = "https://placehold.co/240x80/ffffff/0284c7?text=XSOLUTION&font=montserrat";

const Login: React.FC<LoginProps> = ({ onLogin, users, isLoading = false, dbError }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [showPassword, setShowPassword] = useState(false);

    const [logoSrc, setLogoSrc] = useState('');
    const [bgSrc, setBgSrc] = useState('');
    const [isFormVisible, setIsFormVisible] = useState(false);

    useEffect(() => {
        const loadSequence = async () => {
            let targetLogo = DEFAULT_LOGO;
            let targetBg = '';

            try {
                const client = getSupabaseClient();
                if (client) {
                    // Fetch Logo
                    const { data: logoData } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGO').single();
                    if (logoData && logoData.url) {
                        targetLogo = logoData.url;
                    }

                    // Fetch Background
                    const { data: bgData } = await client.from('imagens').select('url').eq('companyId', 'SYSTEM').eq('type', 'LOGIN_BG').single();
                    if (bgData && bgData.url) {
                        targetBg = bgData.url;
                    }
                }
            } catch (err) {
                console.error("Asset fetch error:", err);
            }

            // 1. Load Background Image
            if (targetBg) {
                await new Promise((resolve) => {
                    const img = new Image();
                    img.src = targetBg;
                    img.onload = resolve;
                    img.onerror = resolve; // Proceed even if load fails
                });
                setBgSrc(targetBg);
                // Brief pause for BG to render
                await new Promise(r => setTimeout(r, 200));
            }

            // 2. Load Logo Image
            if (targetLogo) {
                await new Promise((resolve) => {
                    const img = new Image();
                    img.src = targetLogo;
                    img.onload = resolve;
                    img.onerror = resolve;
                });
                setLogoSrc(targetLogo);
                // Brief pause for Logo to render
                await new Promise(r => setTimeout(r, 300));
            }

            // 3. Show Login Task (Form)
            setIsFormVisible(true);
        };

        loadSequence();
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        const cleanUsername = username.trim();
        const cleanPassword = password.trim();

        if (!cleanUsername || !cleanPassword) {
            setError('Please enter username and password.');
            return;
        }

        // SECURITY: hardcoded ADMIN/JCKING bypass removed in Phase 1b.
        // Admin access must now come from a real user row with role = ADMIN.
        //
        // TODO (Phase 1e): This function still compares dbUser.password in
        // plaintext, which means passwords are stored unhashed in the DB.
        // Migrate to Supabase Auth (supabase.auth.signInWithPassword) and
        // hash any existing passwords via a backfill script. Until then,
        // any DB read exposes every user's credentials.

        const normalizedUsername = cleanUsername.toLowerCase();
        const dbUser = users.find(u => u.username.trim().toLowerCase() === normalizedUsername);

        if (dbUser && dbUser.password === cleanPassword) {
            // Phase 1c: fetch a server-signed JWT so subsequent Edge
            // Function calls (Gemini proxy, QB sync, Twilio/WhatsApp
            // send, etc.) are authenticated. Soft-fail if the auth-issue
            // function is unreachable — the rest of the app still works
            // against Supabase directly; edge-function features will
            // surface their own "please sign in again" error.
            try {
                await issueEdgeToken(cleanUsername, cleanPassword);
            } catch (err) {
                console.warn('[Login] auth-issue failed — AI/Edge features may be unavailable', err);
            }
            onLogin(dbUser);
            return;
        }

        // Constant-error message to prevent user enumeration
        setError('Invalid username or password.');
    };

    const bgStyle = bgSrc ? {
        backgroundImage: `url(${bgSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
    } : {};

    return (
        <div className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans relative transition-all duration-700`} style={bgStyle}>
            {/* Overlay if BG Image is present */}
            <div className={`absolute inset-0 bg-black/40 backdrop-blur-sm z-0 transition-opacity duration-1000 ${bgSrc ? 'opacity-100' : 'opacity-0'}`}></div>

            <div className="w-full max-w-sm flex flex-col items-center z-10">
                <div className={`mb-8 flex flex-col items-center text-center gap-3 w-full min-h-[100px] justify-end transition-all duration-700 transform ${logoSrc ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    {logoSrc && (
                        <img
                            src={logoSrc}
                            alt="System Logo"
                            className="w-full h-auto object-contain mb-2 px-4 max-h-20"
                        />
                    )}
                    <p className={`text-xs font-semibold uppercase tracking-[0.3em] transition-colors duration-700 ${bgSrc ? 'text-white/70' : 'text-slate-400'}`}>AI BUSINESS PLATFORM</p>
                </div>

                <div className={`w-full transition-all duration-700 transform ${isFormVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    {error && (
                        <div className="mb-4 bg-red-50 border border-red-200 text-red-600 p-3 rounded-xl text-sm flex items-center justify-center gap-2 animate-shake">
                            <AlertCircle size={16} /> {error}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="w-full space-y-5 bg-white p-7 rounded-2xl shadow-xl border border-slate-200/50">
                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">User</label>
                            <input
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all bg-slate-50 text-slate-900 placeholder-slate-400"
                                placeholder="Enter username"
                                autoFocus
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-1.5">
                            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Password</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 outline-none transition-all bg-slate-50 text-slate-900 placeholder-slate-400 pr-12"
                                    placeholder="Enter password"
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-400 hover:text-slate-600 transition-colors"
                                >
                                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-indigo-600 text-white font-semibold py-3 rounded-xl hover:bg-indigo-700 transition-all flex items-center justify-center gap-2 mt-2 shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                        >
                            {isLoading ? <Loader2 className="animate-spin" size={18} /> : <><span>Sign In</span> <ArrowRight size={18} /></>}
                        </button>
                    </form>
                </div>
            </div>

            <div className={`fixed bottom-3 right-3 text-[10px] font-mono tracking-widest transition-colors duration-700 z-50 ${bgSrc ? 'text-white/50' : 'text-slate-400'}`}>
                {`v${pkg.version}`}
            </div>
        </div>
    );
};

export default Login;

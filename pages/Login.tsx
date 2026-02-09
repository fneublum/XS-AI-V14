
import React, { useState, useEffect } from 'react';
import { User, Role } from '../types';
import { Loader2, ArrowRight, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { getSupabaseClient } from '../services/supabase';
import pkg from '../package.json';

interface LoginProps {
    onLogin: (user: User) => void;
    users: User[];
    isLoading?: boolean;
    dbError?: string | null;
}

const DEFAULT_LOGO = "https://placehold.co/240x80/ffffff/0284c7?text=XSOLUTION&font=montserrat";

const Login: React.FC<LoginProps> = ({ onLogin, users, isLoading = false, dbError }) => {
    // DEBUG: Log users prop on every render
    console.log('[Login] Render - users prop length:', users?.length, 'isLoading:', isLoading);
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

        // User validation

        // SHORTCUT 99: EC4 User (No Password) - Updated for CEO Role & EC4 Company
        if (cleanUsername === '99') {
            let targetCompanyId = '';
            try {
                const client = getSupabaseClient();
                if (client) {
                    // Try to find exact match or close match for EC4 ENTERPRISES
                    const { data } = await client.from('companies')
                        .select('id')
                        .ilike('name', '%EC4 ENTERPRISES%')
                        .limit(1);

                    if (data && data.length > 0) {
                        targetCompanyId = data[0].id;
                    }
                }
            } catch (err) {
                console.error("Error finding EC4 company:", err);
            }

            const shortcutEC4: User = {
                id: 'EC4_SHORTCUT',
                username: 'ec4',
                name: 'EC4',
                role: Role.CEO,
                avatarInitials: 'EC',
                allowed_company_ids: targetCompanyId ? [targetCompanyId] : [],
                email: 'ec4@xsolution.ai',
                phone: '',
                canManageInventory: true
            };
            onLogin(shortcutEC4);
            return;
        }

        // SHORTCUT: ADMIN or AD (No Password)
        if (['admin', 'ad'].includes(cleanUsername.toLowerCase())) {
            const superAdmin: User = {
                id: 'SUPER_ADMIN',
                username: 'admin',
                name: 'Super Admin',
                role: Role.ADMIN,
                avatarInitials: 'SA',
                allowed_company_ids: [],
                email: 'admin@system.local',
                phone: '',
                canManageInventory: true
            };
            onLogin(superAdmin);
            return;
        }

        // SHORTCUT: tawcr / ta2026c (CARGO_AGENT)
        if (cleanUsername.toLowerCase() === 'tawcr' && cleanPassword === 'ta2026c') {
            let targetCompanyId = '';
            let targetAgentId = '';

            try {
                const client = getSupabaseClient();
                if (client) {
                    // Try to find first company
                    const { data: compData } = await client.from('companies')
                        .select('id')
                        .limit(1);

                    if (compData && compData.length > 0) {
                        targetCompanyId = compData[0].id;
                    }

                    // Try to find first cargo agent
                    const { data: agentData } = await client.from('cargo_agents')
                        .select('id')
                        .limit(1);

                    if (agentData && agentData.length > 0) {
                        targetAgentId = agentData[0].id;
                    }
                }
            } catch (e) {
                console.error("Fallback entity fetch error", e);
            }

            const tawcrUser: User = {
                id: 'TAWCR_FALLBACK',
                username: 'tawcr',
                name: 'Tawcr Agent',
                role: Role.CARGO_AGENT,
                avatarInitials: 'TA',
                allowed_company_ids: targetCompanyId ? [targetCompanyId] : [],
                linked_entity_id: targetAgentId,
                email: 'tawcr@xsolution.ai',
                phone: ''
            };
            onLogin(tawcrUser);
            return;
        }

        const normalizedUsername = cleanUsername.toLowerCase();
        // Trim database username to handle trailing whitespace in DB records
        const dbUser = users.find(u => u.username.trim().toLowerCase() === normalizedUsername);

        // 1. Try Standard DB Login
        if (dbUser && dbUser.password === cleanPassword) {
            onLogin(dbUser);
            return;
        }

        // 2. Specific Fallback for 'mario' / 'mar@25'
        if (normalizedUsername === 'mario' && cleanPassword === 'mar@25') {
            // Fetch necessary IDs to link this user correctly
            let targetCompanyId = '';
            let targetCustomerId = '';

            try {
                const client = getSupabaseClient();
                if (client) {
                    // A. Find Company (EC4)
                    const { data: compData } = await client.from('companies')
                        .select('id')
                        .ilike('name', '%EC4%')
                        .limit(1);

                    if (compData && compData.length > 0) {
                        targetCompanyId = compData[0].id;

                        // B. Find Customer (Recircular) linked to EC4
                        const { data: custData } = await client.from('customers')
                            .select('id')
                            .eq('companyId', targetCompanyId)
                            .ilike('name', '%Recircular%')
                            .limit(1);

                        if (custData && custData.length > 0) {
                            targetCustomerId = custData[0].id;
                        } else {
                            // Try finding by contact person
                            const { data: contactData } = await client.from('customers')
                                .select('id')
                                .eq('companyId', targetCompanyId)
                                .ilike('contactPerson', '%Mario%')
                                .limit(1);
                            if (contactData && contactData.length > 0) targetCustomerId = contactData[0].id;
                        }
                    }
                }
            } catch (e) {
                console.error("Fallback entity fetch error", e);
            }

            if (dbUser) {
                const patchedUser = { ...dbUser };
                if (!patchedUser.allowed_company_ids || patchedUser.allowed_company_ids.length === 0) {
                    patchedUser.allowed_company_ids = targetCompanyId ? [targetCompanyId] : [];
                }
                if (!patchedUser.linked_entity_id && targetCustomerId) {
                    patchedUser.linked_entity_id = targetCustomerId;
                }
                onLogin(patchedUser);
            } else {
                const fallbackMario: User = {
                    id: 'MARIO_FALLBACK',
                    username: 'mario',
                    name: 'Mario Marinho',
                    role: Role.CUSTOMER,
                    avatarInitials: 'MM',
                    allowed_company_ids: targetCompanyId ? [targetCompanyId] : [],
                    linked_entity_id: targetCustomerId,
                    email: 'mario@xsolution.ai',
                    phone: ''
                };
                onLogin(fallbackMario);
            }
            return;
        }

        // 3. Specific Fallback for 'pepe' / 'pepe@25'
        if (normalizedUsername === 'pepe' && cleanPassword === 'pepe@25') {
            let targetCompanyId = '';

            try {
                const client = getSupabaseClient();
                if (client) {
                    // Assign to the first available company or EC4 if available
                    const { data: compData } = await client.from('companies')
                        .select('id')
                        .limit(1);

                    if (compData && compData.length > 0) {
                        targetCompanyId = compData[0].id;
                    }
                }
            } catch (e) {
                console.error("Fallback entity fetch error", e);
            }

            if (dbUser) {
                const patchedUser = { ...dbUser };
                if (!patchedUser.allowed_company_ids || patchedUser.allowed_company_ids.length === 0) {
                    patchedUser.allowed_company_ids = targetCompanyId ? [targetCompanyId] : [];
                }
                onLogin(patchedUser);
            } else {
                const fallbackPepe: User = {
                    id: 'PEPE_FALLBACK',
                    username: 'pepe',
                    name: 'Giusepe',
                    role: Role.USER, // Defaulting to User based on context
                    avatarInitials: 'G',
                    allowed_company_ids: targetCompanyId ? [targetCompanyId] : [],
                    email: 'pepe@example.com',
                    phone: ''
                };
                onLogin(fallbackPepe);
            }
            return;
        }

        // 4. Specific Fallback for 'manuela' / 'manu26'
        if (normalizedUsername === 'manuela' && cleanPassword === 'manu26') {
            let targetCompanyId = '';
            let targetAgentId = '';

            try {
                const client = getSupabaseClient();
                if (client) {
                    // A. Assign to EC4 company if available
                    const { data: compData } = await client.from('companies')
                        .select('id')
                        .ilike('name', '%EC4%')
                        .limit(1);

                    if (compData && compData.length > 0) {
                        targetCompanyId = compData[0].id;
                    }

                    // B. Find 'GLOBAL' Cargo Agent
                    const { data: agentData } = await client.from('cargo_agents')
                        .select('id')
                        .ilike('name', '%GLOBAL%')
                        .limit(1);

                    if (agentData && agentData.length > 0) {
                        targetAgentId = agentData[0].id;
                    }
                }
            } catch (e) {
                console.error("Fallback entity fetch error", e);
            }

            if (dbUser) {
                const patchedUser = { ...dbUser };
                if (!patchedUser.allowed_company_ids || patchedUser.allowed_company_ids.length === 0) {
                    patchedUser.allowed_company_ids = targetCompanyId ? [targetCompanyId] : [];
                }
                // Ensure role is set correctly if DB has it wrong or missing
                if (patchedUser.role !== Role.CARGO_AGENT) {
                    patchedUser.role = Role.CARGO_AGENT;
                }
                // Ensure linked entity is set
                if (!patchedUser.linked_entity_id && targetAgentId) {
                    patchedUser.linked_entity_id = targetAgentId;
                }
                onLogin(patchedUser);
            } else {
                const fallbackManuela: User = {
                    id: 'MANUELA_FALLBACK',
                    username: 'manuela',
                    name: 'Manuela Leitão',
                    role: Role.CARGO_AGENT,
                    avatarInitials: 'ML',
                    allowed_company_ids: targetCompanyId ? [targetCompanyId] : [],
                    linked_entity_id: targetAgentId,
                    email: 'manuela@xsolution.ai',
                    phone: ''
                };
                onLogin(fallbackManuela);
            }
            return;
        }

        if (dbUser) {
            setError('Incorrect password.');
        } else {
            setError('User not found.');
        }
    };

    const bgStyle = bgSrc ? {
        backgroundImage: `url(${bgSrc})`,
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        backgroundRepeat: 'no-repeat'
    } : {};

    return (
        <div className={`min-h-screen bg-slate-50 flex flex-col items-center justify-center p-4 font-sans relative transition-all duration-700 ${bgSrc ? 'opacity-100' : 'opacity-100'}`} style={bgStyle}>
            {/* Dark Overlay if BG Image is present */}
            <div className={`absolute inset-0 bg-black/50 backdrop-blur-sm z-0 transition-opacity duration-1000 ${bgSrc ? 'opacity-100' : 'opacity-0'}`}></div>

            <div className="w-full max-w-md flex flex-col items-center z-10">
                <div className={`mb-10 flex flex-col items-center text-center gap-4 w-full min-h-[120px] justify-end transition-all duration-700 transform ${logoSrc ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4'}`}>
                    {logoSrc && (
                        <img
                            src={logoSrc}
                            alt="System Logo"
                            className="w-full h-auto object-contain mb-4 px-2 max-h-24"
                        />
                    )}
                    <p className={`text-sm font-medium uppercase tracking-[0.3em] transition-colors duration-700 ${bgSrc ? 'text-white/80' : 'text-slate-400'}`}>AI BUSINESS PLATFORM</p>
                </div>

                <div className={`w-full transition-all duration-700 transform ${isFormVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'}`}>
                    <div className="w-full mb-6 space-y-2">
                        {error && (
                            <div className="bg-red-50 border border-red-100 text-red-600 p-3 rounded-lg text-sm flex items-center justify-center gap-2 animate-shake shadow-lg">
                                <AlertCircle size={16} /> {error}
                            </div>
                        )}
                    </div>

                    <form onSubmit={handleSubmit} className="w-full space-y-6 bg-white p-8 rounded-2xl shadow-2xl border border-slate-100">
                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">User:</label>
                            <input
                                type="text"
                                value={username}
                                onChange={e => setUsername(e.target.value)}
                                className="w-full border-2 border-slate-600 rounded-lg px-4 py-3 text-lg focus:border-blue-500 focus:ring-0 outline-none transition-colors bg-slate-900 text-white placeholder-slate-400"
                                autoFocus
                                disabled={isLoading}
                            />
                        </div>

                        <div className="space-y-2">
                            <label className="block text-sm font-bold text-slate-700 uppercase tracking-wider">Password:</label>
                            <div className="relative">
                                <input
                                    type={showPassword ? 'text' : 'password'}
                                    value={password}
                                    onChange={e => setPassword(e.target.value)}
                                    className="w-full border-2 border-slate-600 rounded-lg px-4 py-3 text-lg focus:border-blue-500 focus:ring-0 outline-none transition-colors bg-slate-900 text-white placeholder-slate-400 pr-12"
                                    disabled={isLoading}
                                />
                                <button
                                    type="button"
                                    onClick={() => setShowPassword(!showPassword)}
                                    className="absolute inset-y-0 right-0 flex items-center px-4 text-slate-400 hover:text-white transition-colors"
                                >
                                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                                </button>
                            </div>
                        </div>

                        <button
                            type="submit"
                            disabled={isLoading}
                            className="w-full bg-slate-900 text-white font-bold py-4 rounded-xl hover:bg-black transition-all flex items-center justify-center gap-2 mt-4 shadow-lg shadow-slate-900/20 active:scale-[0.98]"
                        >
                            {isLoading ? <Loader2 className="animate-spin" /> : <><span className="mr-1">ENTER SYSTEM</span> <ArrowRight size={20} /></>}
                        </button>
                    </form>
                </div>
            </div>

            {/* Version Number */}
            {/* Version Number */}
            <div className={`fixed bottom-4 right-4 text-xs font-mono tracking-widest transition-colors duration-700 z-50 ${bgSrc ? 'text-white drop-shadow-md' : 'text-slate-600'}`}>
                {`v${pkg.version}`}
            </div>
        </div>
    );
};

export default Login;

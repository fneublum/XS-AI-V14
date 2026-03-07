
import React, { useState, useEffect } from 'react';
import { Image, Check, Save, Building2, Upload, Trash2, Loader2, AlertTriangle, Monitor } from 'lucide-react';
import { useSupabase } from '../hooks/useSupabase';
import { Company, CompanyImage } from '../types';

// Helper to compress images on the client side
const compressImage = (file: File, maxWidth: number, quality: number = 0.7): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new globalThis.Image();
            img.src = event.target?.result as string;
            img.onload = () => {
                const elem = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height *= maxWidth / width;
                    width = maxWidth;
                }
                elem.width = width;
                elem.height = height;
                const ctx = elem.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                // Convert to WebP or JPEG for better compression than default PNG if possible, fallback to jpeg
                resolve(elem.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', quality));
            };
            img.onerror = (err) => reject(err);
        };
        reader.onerror = (error) => reject(error);
    });
};

const AdminBranding: React.FC = () => {
    // System Logo State
    const [logoUrl, setLogoUrl] = useState('');
    const [bgUrl, setBgUrl] = useState('');
    const [isSaved, setIsSaved] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [isCompressing, setIsCompressing] = useState(false);

    // Supabase Data
    const { data: companies } = useSupabase<Company>('companies');
    const { 
        data: companyImages, 
        addRecord: addImage, 
        deleteRecord: deleteImage, 
        loading: imagesLoading,
        hasSchemaError 
    } = useSupabase<CompanyImage>('imagens');
    
    const [uploadingFor, setUploadingFor] = useState<string | null>(null);

    // Load System Assets from DB
    useEffect(() => {
        const sysLogo = companyImages.find(img => img.companyId === 'SYSTEM' && img.type === 'LOGO');
        const sysBg = companyImages.find(img => img.companyId === 'SYSTEM' && img.type === 'LOGIN_BG');
        
        if (sysLogo) setLogoUrl(sysLogo.url);
        if (sysBg) setBgUrl(sysBg.url);
    }, [companyImages]);

    // 1. System Logo Handlers
    const handleLogoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setIsCompressing(true);
            try {
                // Compress logo to max width 400px
                const compressed = await compressImage(file, 400);
                setLogoUrl(compressed);
            } catch (err) {
                console.error("Compression failed", err);
                alert("Failed to process image.");
            } finally {
                setIsCompressing(false);
            }
        }
    };

    const handleBgChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setIsCompressing(true);
            try {
                // Compress BG to max width 1280px (sufficient for full screen bg usually)
                const compressed = await compressImage(file, 1280, 0.6);
                setBgUrl(compressed);
            } catch (err) {
                console.error("Compression failed", err);
                alert("Failed to process image.");
            } finally {
                setIsCompressing(false);
            }
        }
    };

    const handleSaveSystemSettings = async () => {
        setIsSaving(true);
        const existingLogo = companyImages.find(img => img.companyId === 'SYSTEM' && img.type === 'LOGO');
        const existingBg = companyImages.find(img => img.companyId === 'SYSTEM' && img.type === 'LOGIN_BG');
        
        try {
            // --- LOGO LOGIC ---
            if (!logoUrl && existingLogo) {
                await deleteImage(existingLogo.id);
            } else if (logoUrl && (!existingLogo || existingLogo.url !== logoUrl)) {
                if (existingLogo) await deleteImage(existingLogo.id);
                await addImage({
                    id: `IMG${Date.now()}`,
                    companyId: 'SYSTEM',
                    url: logoUrl,
                    name: 'System Logo',
                    createdAt: new Date().toISOString(),
                    type: 'LOGO'
                });
            }

            // --- BG LOGIC ---
            if (!bgUrl && existingBg) {
                await deleteImage(existingBg.id);
            } else if (bgUrl && (!existingBg || existingBg.url !== bgUrl)) {
                if (existingBg) await deleteImage(existingBg.id);
                await addImage({
                    id: `IMG${Date.now()}_BG`,
                    companyId: 'SYSTEM',
                    url: bgUrl,
                    name: 'Login Background',
                    createdAt: new Date().toISOString(),
                    type: 'LOGIN_BG'
                });
            }

            setIsSaved(true);
            setTimeout(() => {
                window.location.reload(); // Reload to refresh Sidebar/Login components
            }, 1000);
        } catch (error) {
            console.error("Error saving system assets:", error);
            alert("Failed to save settings. Check console for details.");
        } finally {
            setIsSaving(false);
        }
    };

    // 2. Company Logo Handlers (Supabase)
    const handleCompanyLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>, companyId: string) => {
        const file = e.target.files?.[0];
        if (!file) return;
        
        setUploadingFor(companyId);

        try {
             // Compress Company Logo to max 300px
            const base64Data = await compressImage(file, 300);
            
            // Remove existing logo for this company if any
            const existing = companyImages.find(img => img.companyId === companyId && img.type === 'LOGO');
            if (existing) {
                await deleteImage(existing.id);
            }

            // Create new record
            const newImage: CompanyImage = {
                id: `IMG${Date.now()}`,
                companyId: companyId,
                url: base64Data,
                name: file.name,
                createdAt: new Date().toISOString(),
                type: 'LOGO'
            };

            await addImage(newImage);
        } catch (err) {
            console.error("Upload failed", err);
            alert("Failed to upload logo.");
        } finally {
             setUploadingFor(null);
        }
    };

    const handleDeleteCompanyLogo = async (companyId: string) => {
        if (!window.confirm("Are you sure you want to remove the logo for this company?")) return;
        
        const existing = companyImages.find(img => img.companyId === companyId && img.type === 'LOGO');
        if (existing) {
            await deleteImage(existing.id);
        }
    };

    return (
        <div className="max-w-5xl mx-auto space-y-12 pb-24">
             {/* Section 1: System-Wide Branding */}
             <div className="space-y-6">
                <div className="mb-6 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-gradient-to-r from-slate-600 to-slate-700 rounded-xl text-white"><Image size={24} /></div>
                        <div>
                            <h1 className="text-2xl font-bold text-slate-800">System Appearance</h1>
                            <p className="text-slate-500 text-sm mt-1">Customize the global system logo and login background.</p>
                        </div>
                    </div>
                </div>

                {/* LOGO UPLOAD */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row gap-8 items-center">
                            <div className="w-full md:w-1/3 h-40 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center bg-slate-900 relative overflow-hidden shrink-0">
                                {logoUrl ? (
                                    <img src={logoUrl} alt="Logo Preview" className="max-w-full max-h-full object-contain p-4" />
                                ) : (
                                    <div className="text-center text-slate-500">
                                        <span className="block text-sm mb-1">No Custom Logo</span>
                                        <span className="text-xs opacity-50">Default System Logo</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 w-full">
                                <label className="block text-sm font-bold text-slate-700 uppercase mb-3">Upload System Logo</label>
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={handleLogoChange}
                                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-pink-50 file:text-pink-700 hover:file:bg-pink-100 cursor-pointer"
                                />
                                <p className="text-xs text-slate-400 mt-3">
                                    Recommended: Transparent PNG, max height 60px.
                                </p>
                                {isCompressing && <p className="text-xs text-blue-500 mt-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> Optimizing...</p>}
                                {logoUrl && (
                                    <button 
                                        onClick={() => setLogoUrl('')} 
                                        className="text-sm text-red-500 hover:underline mt-4 flex items-center gap-2 font-medium"
                                    >
                                        <div className="w-2 h-2 rounded-full bg-red-500"></div> Reset to Default
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* LOGIN BACKGROUND UPLOAD */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="p-6">
                        <div className="flex flex-col md:flex-row gap-8 items-center">
                            <div className="w-full md:w-1/3 h-40 border-2 border-dashed border-slate-300 rounded-xl flex items-center justify-center bg-slate-100 relative overflow-hidden shrink-0">
                                {bgUrl ? (
                                    <img src={bgUrl} alt="BG Preview" className="w-full h-full object-cover" />
                                ) : (
                                    <div className="text-center text-slate-400">
                                        <Monitor size={32} className="mx-auto mb-2 opacity-50"/>
                                        <span className="block text-sm mb-1">No Background</span>
                                        <span className="text-xs opacity-50">Standard Slate BG</span>
                                    </div>
                                )}
                            </div>
                            <div className="flex-1 w-full">
                                <label className="block text-sm font-bold text-slate-700 uppercase mb-3">Login Screen Background</label>
                                <input 
                                    type="file" 
                                    accept="image/*"
                                    onChange={handleBgChange}
                                    className="block w-full text-sm text-slate-500 file:mr-4 file:py-2.5 file:px-6 file:rounded-full file:border-0 file:text-xs file:font-bold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
                                />
                                <p className="text-xs text-slate-400 mt-3">
                                    Recommended: JPG/PNG (1920x1080).
                                </p>
                                {isCompressing && <p className="text-xs text-blue-500 mt-1 flex items-center gap-1"><Loader2 size={10} className="animate-spin"/> Optimizing...</p>}
                                {bgUrl && (
                                    <button 
                                        onClick={() => setBgUrl('')} 
                                        className="text-sm text-red-500 hover:underline mt-4 flex items-center gap-2 font-medium"
                                    >
                                        <div className="w-2 h-2 rounded-full bg-red-500"></div> Remove Background
                                    </button>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* Section 2: Company Logos */}
            <div className="space-y-6">
                <div className="flex flex-col gap-2 border-b border-slate-200 pb-4">
                    <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                        <Building2 className="text-blue-600" /> Company Logos
                    </h2>
                    <p className="text-slate-500 text-sm">Manage specific logos for each tenant company (Saved to Database).</p>
                </div>

                {/* Schema Error Alert */}
                {hasSchemaError && (
                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-4 flex items-start gap-4 animate-in fade-in slide-in-from-top-4">
                        <div className="bg-amber-100 p-2 rounded-full text-amber-600 shrink-0">
                            <AlertTriangle size={24} />
                        </div>
                        <div>
                            <h3 className="text-lg font-bold text-amber-900">Database Setup Required</h3>
                            <p className="text-amber-800 text-sm mt-1 mb-3">
                                The <strong>"imagens"</strong> table is missing from your Supabase database. This is required for storing branding logos.
                            </p>
                            <div className="text-xs font-mono bg-white p-3 rounded border border-amber-200 text-slate-600 mb-3 overflow-x-auto select-all">
                                create table if not exists imagens ( "id" text primary key, "companyId" text, "url" text, "name" text, "createdAt" text, "type" text );
                            </div>
                            <p className="text-xs text-amber-700">
                                Please copy the SQL above (or go to Settings &gt; Database Configuration for the full schema) and run it in your Supabase SQL Editor.
                            </p>
                        </div>
                    </div>
                )}

                {companies.length === 0 ? (
                    <div className="p-8 text-center bg-slate-50 rounded-xl border border-dashed border-slate-300">
                        <p className="text-slate-500">No companies found in the system.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                        {companies.map(company => {
                            // Only find LOGOs here
                            const companyImage = companyImages.find(img => img.companyId === company.id && img.type === 'LOGO');
                            const isUploadingThis = uploadingFor === company.id;

                            return (
                                <div key={company.id} className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden flex flex-col">
                                    <div className="p-4 border-b border-slate-100 bg-slate-50 flex justify-between items-center">
                                        <h3 className="font-bold text-slate-700 truncate" title={company.name}>{company.name}</h3>
                                        <span className="text-[10px] text-slate-400 bg-white border border-slate-200 px-2 py-0.5 rounded font-mono">
                                            {company.nickname || 'N/A'}
                                        </span>
                                    </div>
                                    <div className="p-6 flex-1 flex flex-col items-center justify-center gap-4 bg-slate-50/30">
                                        <div className="w-full h-32 flex items-center justify-center bg-white rounded-lg border border-slate-200 p-4 relative group">
                                            {isUploadingThis ? (
                                                <div className="flex flex-col items-center gap-2 text-blue-600">
                                                    <Loader2 className="animate-spin" size={24} />
                                                    <span className="text-xs font-medium">Optimizing...</span>
                                                </div>
                                            ) : companyImage ? (
                                                <>
                                                    <img src={companyImage.url} alt={company.name} className="max-w-full max-h-full object-contain" />
                                                    <button 
                                                        onClick={() => handleDeleteCompanyLogo(company.id)}
                                                        className="absolute top-2 right-2 p-1.5 bg-red-100 text-red-600 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-200"
                                                        title="Remove Logo"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </>
                                            ) : (
                                                <div className="text-center text-slate-300">
                                                    <Building2 size={32} className="mx-auto mb-2 opacity-50" />
                                                    <span className="text-xs">No Logo</span>
                                                </div>
                                            )}
                                        </div>
                                        
                                        <label className={`w-full text-center py-2 rounded-lg border border-slate-300 bg-white text-slate-600 text-xs font-bold hover:bg-slate-50 cursor-pointer transition-colors flex items-center justify-center gap-2 ${isUploadingThis ? 'opacity-50 pointer-events-none' : ''} ${hasSchemaError ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                            <Upload size={14} /> {companyImage ? 'Replace Logo' : 'Upload Logo'}
                                            <input 
                                                type="file" 
                                                accept="image/*" 
                                                className="hidden" 
                                                onChange={(e) => handleCompanyLogoUpload(e, company.id)}
                                                disabled={!!uploadingFor || hasSchemaError}
                                            />
                                        </label>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Global Save Button (Only for System Branding) */}
            <button 
                onClick={handleSaveSystemSettings}
                disabled={isSaving}
                className="fixed bottom-8 right-8 bg-slate-900 text-white font-bold py-4 px-10 rounded-full shadow-2xl hover:bg-slate-800 flex items-center justify-center gap-3 transition-all z-40 active:scale-95 disabled:opacity-70 disabled:cursor-not-allowed"
            >
                {isSaving ? <Loader2 className="animate-spin" size={20} /> : (isSaved ? <Check size={20} /> : <Save size={20} />)} 
                {isSaving ? 'Saving...' : (isSaved ? 'System Settings Saved' : 'Save System Settings')}
            </button>
        </div>
    );
};

export default AdminBranding;
